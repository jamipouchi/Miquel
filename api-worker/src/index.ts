import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { encrypt } from './encrypt.js'

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

        // Validate inputs
        if (!email || !path) {
            return c.json({ error: 'Email and path are required' }, 400)
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            return c.json({ error: 'Invalid email format' }, 400)
        }

        // Validate path format (should start with /)
        if (!path.startsWith('/')) {
            return c.json({ error: 'Path must start with /' }, 400)
        }

        const encryptedEmail = await encrypt(email, c.env.ENCRYPTION_KEY)

        const DB = c.env.personal_site

        try {
            // Insert or update user
            await DB.prepare(`INSERT INTO user (email) VALUES (?) ON CONFLICT(email) DO NOTHING`)
                .bind(encryptedEmail)
                .run()

            // Insert subscription
            await DB.prepare(`INSERT INTO subscription (user_email, slug) VALUES (?, ?)`)
                .bind(encryptedEmail, path)
                .run()
        } catch (error: any) {
            // Handle duplicate subscription silently - don't reveal if already subscribed
            // This prevents email enumeration attacks
            if (error.message?.includes('UNIQUE') || error.message?.includes('constraint')) {
                // Return success anyway
                return c.json({ success: true, message: 'Subscription created.' }, 201)
            }
            throw error
        }

        // Success - new subscription created
        return c.json({ success: true, message: 'Subscription created.' }, 201)
    } catch (error) {
        console.error('Subscription error:', error)
        return c.json({ error: 'Failed to create subscription' }, 500)
    }
})

// Helper function to escape HTML
function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, (m) => map[m])
}

// Helper function to sanitize and validate comment input
function sanitizeComment(
    name: string,
    message: string
): { valid: boolean; error?: string; name?: string; message?: string } {
    // Trim whitespace
    const trimmedName = name.trim()
    const trimmedMessage = message.trim()

    // Validate name
    if (!trimmedName) {
        return { valid: false, error: 'Name is required' }
    }
    if (trimmedName.length > 50) {
        return { valid: false, error: 'Name must be 50 characters or less' }
    }

    // Validate message
    if (!trimmedMessage) {
        return { valid: false, error: 'Message is required' }
    }
    if (trimmedMessage.length > 500) {
        return { valid: false, error: 'Message must be 500 characters or less' }
    }

    // Escape HTML
    const safeName = escapeHtml(trimmedName)
    const safeMessage = escapeHtml(trimmedMessage)

    return { valid: true, name: safeName, message: safeMessage }
}

type Comment = {
    name: string
    message: string
    created_at: string
    comments: Comment[]
}

// Helper function to insert comment at the right location in the tree
function insertCommentAtPath(comments: Comment[], parentPath: number[], newComment: Comment): Comment[] {
    if (parentPath.length === 0) {
        // Top-level comment
        comments.push(newComment)
        return comments
    }

    // Navigate to parent comment
    const [first, ...rest] = parentPath

    if (first >= comments.length) {
        throw new Error('Invalid parent path: index out of bounds')
    }

    if (rest.length === 0) {
        // Insert as child of this comment
        if (!comments[first].comments) {
            comments[first].comments = []
        }
        comments[first].comments.push(newComment)
    } else {
        // Recurse deeper
        if (!comments[first].comments) {
            throw new Error('Invalid parent path: no nested comments at this index')
        }
        comments[first].comments = insertCommentAtPath(comments[first].comments, rest, newComment)
    }

    return comments
}

app.post('/comments', async (c) => {
    try {
        const { name, message, path, parentPath = [] } = await c.req.json()

        // Validate inputs
        if (!name || !message || !path) {
            return c.json({ error: 'Name, message, and path are required' }, 400)
        }

        // Validate parentPath
        if (!Array.isArray(parentPath)) {
            return c.json({ error: 'parentPath must be an array' }, 400)
        }

        // Validate path format (should start with /)
        if (!path.startsWith('/')) {
            return c.json({ error: 'Path must start with /' }, 400)
        }

        // Don't allow comments on root page
        if (path === '/') {
            return c.json({ error: 'Comments are not allowed on the root page' }, 400)
        }

        // Sanitize input
        const sanitized = sanitizeComment(name, message)
        if (!sanitized.valid) {
            return c.json({ error: sanitized.error }, 400)
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

            // Parse the JSON response

            if (!response.allowed) {
                return c.json(
                    {
                        error: `Your comment was not approved: ${response.reason}. If you believe this is an error, please contact miquel@miquelpuigturon.com`,
                    },
                    400
                )
            }
        } catch (error) {
            console.error('Moderation error:', error)
            return c.json({ error: 'Failed to moderate comment' }, 500)
        }

        // Generate R2 key from path. remove the leading /
        const r2Key = `${path.replace('/', '')}.json`

        // Retry logic for ETag conflicts
        const maxRetries = 3
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Fetch current comments from R2

                const existing = await c.env.COMMENTS_BUCKET.get(r2Key)

                // If file doesn't exist, the page doesn't exist or hasn't been initialized
                if (!existing) {
                    return c.json({ error: 'Comments not available for this page' }, 404)
                }

                const etag = existing.etag
                const text = await existing.text()
                const data = JSON.parse(text)
                let comments: Array<any> = data.comments || []

                // Create new comment with empty comments array for potential replies
                const newComment = {
                    name: sanitized.name!,
                    message: sanitized.message!,
                    created_at: new Date().toISOString(),
                    comments: [],
                }

                // Insert comment at the right location (top-level or nested)
                try {
                    comments = insertCommentAtPath(comments, parentPath, newComment)
                } catch (error: any) {
                    return c.json({ error: error.message || 'Invalid parent path' }, 400)
                }

                // Prepare updated data
                const updatedData = {
                    comments,
                }

                // Write back to R2 with conditional write (always use ETag since we know file exists)
                await c.env.COMMENTS_BUCKET.put(r2Key, JSON.stringify(updatedData), {
                    httpMetadata: {
                        contentType: 'application/json',
                        cacheControl: 'public, max-age=60',
                    },
                    onlyIf: { etagMatches: etag },
                })

                // Success!
                return c.json({ success: true, comments: updatedData.comments }, 201)
            } catch (error: any) {
                // Check if it's a precondition failed error (ETag mismatch)
                if (error.message?.includes('412') || error.message?.includes('precondition')) {
                    if (attempt < maxRetries - 1) {
                        continue
                    }
                }
                throw error
            }
        }

        // If we get here, we exhausted retries
        return c.json({ error: 'Failed to save comment due to conflicts. Please try again.' }, 409)
    } catch (error) {
        return c.json({ error: 'Failed to save comment' }, 500)
    }
})

export default app
