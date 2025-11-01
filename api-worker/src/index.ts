import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { encrypt } from './encrypt.js'
import { sanitizeComment, insertCommentAtPath, type Comment_v1 } from './commentUtils.js'

interface Env {
    personal_site: D1Database
    COMMENTS_BUCKET: R2Bucket
    AI: Ai
    RATE_LIMITER: RateLimit
    DEV: boolean
    ENCRYPTION_KEY: string
}

const app = new Hono<{ Bindings: Env }>()

app.use(
    '*',
    cors({
        origin: (origin, c) => {
            if (c.env.DEV) {
                return '*'
            } else {
                return 'https://miquelpuigturon.com'
            }
        },
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    })
)

app.post('/subscribe', async (c) => {
    try {
        const { email, path } = await c.req.json()

        if (!email || !path) {
            return c.json({ error: 'Email and path are required' }, 400)
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            return c.json({ error: 'Invalid email format' }, 400)
        }

        if (!path.startsWith('/')) {
            return c.json({ error: 'Path must start with /' }, 400)
        }

        const encryptedEmail = await encrypt(email, c.env.ENCRYPTION_KEY)

        const DB = c.env.personal_site

        try {
            await DB.batch([
                DB.prepare(`INSERT INTO user (email) VALUES (?) ON CONFLICT(email) DO NOTHING`).bind(
                    encryptedEmail
                ),
                DB.prepare(`INSERT INTO subscription (user_email, slug) VALUES (?, ?)`).bind(
                    encryptedEmail,
                    path
                ),
            ])
        } catch (error: any) {
            // Handle duplicate subscription silently - don't reveal if already subscribed
            // This prevents email enumeration attacks
            if (error.message?.includes('UNIQUE') || error.message?.includes('constraint')) {
                // Return success anyway
                return c.json({ success: true, message: 'Subscription created.' }, 201)
            }
            throw error
        }

        return c.json({ success: true, message: 'Subscription created.' }, 201)
    } catch (error) {
        console.error('Subscription error:', error)
        return c.json({ error: 'Failed to create subscription' }, 500)
    }
})

app.post('/comments', async (c) => {
    try {
        const { name, message, path, parentPath = [] } = await c.req.json()

        if (!name || !message || !path) {
            return c.json({ error: 'Name, message, and path are required' }, 400)
        }

        if (!Array.isArray(parentPath)) {
            return c.json({ error: 'parentPath must be an array' }, 400)
        }

        if (!path.startsWith('/')) {
            return c.json({ error: 'Path must start with /' }, 400)
        }

        if (path === '/') {
            return c.json({ error: 'Comments are not allowed on the root page' }, 400)
        }

        const sanitized = sanitizeComment(name, message)
        if (!sanitized.valid) {
            return c.json({ error: sanitized.error }, 400)
        }

        const giphyPattern = /https:\/\/media[0-9]*\.giphy\.com\/media\/.+?\/giphy\.gif/g
        const giphyMatches = sanitized.message!.match(giphyPattern)
        if (giphyMatches && giphyMatches.length > 1) {
            return c.json({ error: 'Only one GIF per comment is allowed' }, 400)
        }

        const clientIP = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

        try {
            const rateLimitResult = await c.env.RATE_LIMITER.limit({ key: clientIP })
            if (!rateLimitResult.success) {
                return c.json(
                    { error: 'Rate limit exceeded. Please wait before posting another comment.' },
                    429
                )
            }
        } catch (error) {
            return c.json({ error: 'Rate limit check failed' }, 500)
        }

        // AI moderation using Llama 3.1
        try {
            const moderationMessages = [
                {
                    role: 'system' as const,
                    content: `You are a content moderation assistant. Your task is to review user comments on a personal website and determine if they are appropriate.
Review both the name and the message of the comment.

Comments should be REJECTED if they contain:
- Hate speech, harassment, or bullying
- Sexually explicit content
- Personal attacks or threats
- Spam or promotional content
- Misinformation or harmful advice
- Private information (doxxing)
- Illegal content

Comments should be ALLOWED if they are:
- Constructive feedback or criticism
- Questions or discussions related to the content
- Respectful personal opinions
- Friendly and conversational

If the comment contains a link, it should be ALLOWED if:
  - It is a Giphy URL
  - It is an educational or informative URL
It should be REJECTED if:
  - It is a promotional or spam URL
  - It is a malicious or harmful URL
  - It is a phishing or scam URL
  - It is a malware or virus URL
  - It is a spyware or adware URL
  - It is a tracking or analytics URL
  - Other URLs that are not educational or informative

Be lenient with casual language and humor, but firm on the content policy violations listed above.`,
                },
                {
                    role: 'user' as const,
                    content: `Please moderate this comment:
Name: ${sanitized.name}
Message: ${sanitized.message}
Page path: ${path}
`,
                },
            ]

            const { response } = (await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
                messages: moderationMessages,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'moderation_result',
                        schema: {
                            type: 'object',
                            properties: {
                                allowed: { type: 'boolean' },
                                reason: { type: 'string' },
                            },
                            required: ['allowed', 'reason'],
                        },
                    },
                },
            })) as { response: { allowed: boolean; reason: string } }

            console.log('moderationResponse', response)

            if (!response.allowed) {
                return c.json(
                    {
                        error: `Your comment was not approved: ${response.reason}
                        If you believe this is an error, please contact miquel@miquelpuigturon.com`,
                    },
                    400
                )
            }
        } catch (error) {
            console.error('Moderation error:', error)
            return c.json({ error: 'Failed to moderate comment' }, 500)
        }

        const r2Key = `${path.replace('/', '')}.json`

        const maxRetries = 3
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const existing = await c.env.COMMENTS_BUCKET.get(r2Key)

                if (!existing && parentPath.length > 0) {
                    return c.json({ error: 'Cannot reply to non-existent comment' }, 400)
                }

                let comments: Comment_v1[] = []
                if (existing) {
                    const data = await existing.json<{ comments: Comment_v1[] }>()
                    comments = data.comments || []
                }

                const newComment = {
                    name: sanitized.name!,
                    message: sanitized.message!,
                    created_at: new Date().toISOString(),
                    comments: [],
                }

                try {
                    comments = insertCommentAtPath(comments, parentPath, newComment)
                } catch (error: any) {
                    return c.json({ error: error.message || 'Invalid parent path' }, 400)
                }

                const updatedData = { comments }

                const putResult = await c.env.COMMENTS_BUCKET.put(r2Key, JSON.stringify(updatedData), {
                    httpMetadata: {
                        contentType: 'application/json',
                        cacheControl: 'no-cache',
                    },
                    onlyIf: existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: '*' },
                })

                if (!!putResult) {
                    return c.json(updatedData, 201)
                } else {
                    if (attempt < maxRetries - 1) {
                        continue
                    }
                    return c.json({ error: 'Failed to save comment due to conflicts. Please try again.' }, 409)
                }
            } catch (error: any) {
                if (error.message?.includes('412') || error.message?.includes('precondition')) {
                    if (attempt < maxRetries - 1) {
                        continue
                    }
                }
                throw error
            }
        }

        return c.json({ error: 'Failed to save comment due to conflicts. Please try again.' }, 409)
    } catch (error) {
        return c.json({ error: 'Failed to save comment' }, 500)
    }
})

export default app
