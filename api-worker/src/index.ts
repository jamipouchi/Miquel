import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { encrypt, decrypt } from './encrypt.js'
import { sanitizeComment, insertCommentAtPath, type Comment_v1 } from './commentUtils.js'

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

// MCP (Model Context Protocol): transparent proxy to the site's Cloudflare
// AI Search public endpoint, so agents get a stable first-party URL
// (https://api.miquelpuigturon.com/mcp) instead of the generated hostname.
const AI_SEARCH_MCP_URL = 'https://78a22e35-6a11-4b9a-84fe-1ee03a805a39.search.ai.cloudflare.com/mcp'

// PII-safe serialization of tool inputs: credential-shaped fields and
// literals, emails, and phone-like numbers are masked before storage.
function redactInput(raw: unknown): string | null {
    if (raw == null) return null
    let candidate: unknown = raw
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try { candidate = JSON.parse(trimmed) } catch { candidate = raw }
        }
    }
    let json: string
    try {
        json = typeof candidate === 'string' ? candidate : JSON.stringify(candidate)
    } catch {
        return null
    }
    if (!json || json === '{}' || json === '[]') return null
    return json
        // credential-ish keys with any JSON value type (string/array/object/number)
        .replace(/"([^"]*(?:password|passwd|token|secret|api[_-]?key|apikey|authorization|credential)[^"]*)"\s*:\s*(?:"[^"]*"|\[[^\]]*\]|\{[^}]*\}|[^\s,}]+)/gi, '"$1":"[redacted]"')
        // token-shaped literals regardless of field name
        .replace(/\b(?:ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{15,})/g, '[token]')
        // free-text "the password is hunter2" shape
        .replace(/\b((?:password|passwd|secret|api[_-]?key|token)\s*(?:is|:)\s*)\S+/gi, '$1[redacted]')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
        .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
        .slice(0, 1000)
}

// Bearer-token gate for the private read endpoints (CONTACT_KEY secret).
// The key travels in a header, never a query string, so it cannot leak
// into observability logs.
function bearerAuthorized(c: { req: { header(name: string): string | undefined }; env: Env }): boolean {
    const provided = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    return Boolean(provided && c.env.CONTACT_KEY && provided === c.env.CONTACT_KEY)
}

// Heuristic agent identification from User-Agent (the WebMCP spec never
// reveals which agent invoked an in-page tool, and MCP clients vary — so
// these labels are estimates by design).
function agentFromUserAgent(userAgent: string | null): string {
    const ua = (userAgent ?? '').toLowerCase()
    const known: [string, string][] = [
        ['claude', 'claude'],
        ['chatgpt', 'chatgpt'],
        ['gemini', 'gemini'],
        ['copilot', 'copilot'],
        ['cursor', 'cursor'],
        ['windsurf', 'windsurf'],
        ['mcp-inspector', 'mcp-inspector'],
        ['vscode', 'vscode'],
        ['node', 'node-client'],
        ['python', 'python-client'],
        ['httpx', 'python-client'],
        ['curl', 'curl'],
    ]
    for (const [needle, label] of known) {
        if (ua.includes(needle)) return label
    }
    if (ua.includes('mozilla')) return 'browser'
    return (userAgent ?? 'unknown').slice(0, 60)
}

// Records a WebMCP tool usage metric (fire-and-forget via waitUntil).
function recordToolMetric(
    env: Env,
    source: string,
    tool: string,
    success: boolean,
    durationMs: number | null,
    page: string | null,
    session: string | null = null,
    agent: string | null = null,
    error: string | null = null,
    input: string | null = null
) {
    return env.personal_site
        .prepare(`INSERT INTO webmcp_metric (source, tool, success, duration_ms, page, session, agent, error, input) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(source, tool, success ? 1 : 0, durationMs, page, session, agent, error ? error.slice(0, 200) : null, input)
        .run()
        .catch((e) => console.error('webmcp metric insert failed:', e))
}

app.all('/mcp', async (c) => {
    const incoming = c.req.raw
    // Allow-list (not drop-list): only headers the MCP upstream needs.
    const allowed = new Set([
        'content-type', 'accept', 'accept-encoding', 'accept-language',
        'user-agent', 'origin', 'mcp-session-id', 'mcp-protocol-version',
        'last-event-id', 'mcp-idempotency-key',
    ])
    const headers = new Headers()
    incoming.headers.forEach((value, key) => {
        if (allowed.has(key.toLowerCase())) headers.set(key, value)
    })

    // Peek at small JSON-RPC requests to capture the agent funnel:
    // initialize -> tools/list (discovery) -> tools/call (invocation).
    // Bodies over 10 KB (or unknown length over 10 KB) are forwarded
    // without logging rather than buffered.
    let funnelEvent: { tool: string; input?: string | null } | null = null
    const contentLength = parseInt(incoming.headers.get('content-length') ?? '', 10)
    const sizeKnown = Number.isFinite(contentLength)
    if (
        incoming.method === 'POST' &&
        (incoming.headers.get('content-type') ?? '').includes('application/json') &&
        (!sizeKnown || contentLength <= 10_000)
    ) {
        try {
            const text = await incoming.clone().text()
            if (text.length < 10000) {
                const rpc = JSON.parse(text)
                if (rpc?.method === 'tools/call' && typeof rpc?.params?.name === 'string') {
                    funnelEvent = { tool: rpc.params.name.slice(0, 64), input: redactInput(rpc.params.arguments) }
                } else if (rpc?.method === 'tools/list') {
                    funnelEvent = { tool: '__list__' }
                } else if (rpc?.method === 'initialize') {
                    funnelEvent = { tool: '__initialize__' }
                }
            }
        } catch {
            // not JSON — forward untouched
        }
    }

    const upstream = await fetch(`${AI_SEARCH_MCP_URL}${new URL(incoming.url).search}`, {
        method: incoming.method,
        headers,
        body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : incoming.body,
        redirect: 'manual',
    })

    const responseHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
        const lower = key.toLowerCase()
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(lower)) {
            return
        }
        responseHeaders.set(key, value)
    })

    if (funnelEvent) {
        const agent = agentFromUserAgent(incoming.headers.get('user-agent'))
        // Note: "success" here means HTTP 2xx. The streamable-HTTP MCP
        // transport can still carry a JSON-RPC error inside a 200 body;
        // that distinction is not visible without consuming the stream.
        c.executionCtx.waitUntil(
            recordToolMetric(c.env, 'mcp-proxy', funnelEvent.tool, upstream.status >= 200 && upstream.status < 300, null, null, null, agent, null, funnelEvent.input ?? null)
        )
    }

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
})

// WebMCP tool usage metrics: written by the site's in-page tools,
// plus the mcp-proxy funnel rows written above.
app.post('/metrics/webmcp', async (c) => {
    try {
        const { tool, success, duration_ms = null, page = null, session = null, error = null, input = null } = await c.req.json()

        if (!tool || typeof tool !== 'string' || tool.length > 64) {
            return c.json({ error: 'Invalid tool' }, 400)
        }
        // Generous limiter (own namespace so metrics can't starve comments).
        const clientIP = c.req.header('CF-Connecting-IP') ?? 'unknown'
        try {
            const limited = await c.env.METRICS_LIMITER.limit({ key: clientIP })
            if (!limited.success) {
                return c.json({ error: 'Too many metric events' }, 429)
            }
        } catch {
            return c.json({ error: 'Rate limit check failed' }, 500)
        }

        await c.env.personal_site
            .prepare(`INSERT INTO webmcp_metric (source, tool, success, duration_ms, page, session, agent, error, input) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(
                'webmcp',
                tool,
                typeof success === 'boolean' ? (success ? 1 : 0) : 1,
                typeof duration_ms === 'number' && Number.isFinite(duration_ms) ? Math.round(duration_ms) : null,
                typeof page === 'string' ? page.slice(0, 512) : null,
                typeof session === 'string' ? session.slice(0, 64) : null,
                'browser-agent',
                typeof error === 'string' ? error.slice(0, 200) : null,
                redactInput(input)
            )
            .run()

        return c.json({ success: true }, 201)
    } catch (error) {
        console.error('WebMCP metric error:', error)
        return c.json({ error: 'Failed to record metric' }, 500)
    }
})

// Aggregates carry visitor telemetry (pages, sessions, redacted inputs),
// so this read is private: Authorization: Bearer <CONTACT_KEY>.
app.get('/metrics/webmcp', async (c) => {
    if (!bearerAuthorized(c)) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    const db = c.env.personal_site
    const windowClause = `WHERE created_at > datetime('now', '-30 days')`

    // Pick the 20 most recently active sessions first, then fetch their
    // events — a busy session can't starve others out of the window.
    const sessionHeads = await db
        .prepare(
            `SELECT session, MAX(id) as last_id FROM webmcp_metric
             WHERE session IS NOT NULL GROUP BY session ORDER BY last_id DESC LIMIT 20`
        )
        .all<{ session: string }>()
    const sessionIds = (sessionHeads.results ?? []).map((r) => r.session)

    const [totals, funnel, byTool, byAgent, byDay, recent, sessionEvents] = await Promise.all([
        db.prepare(
            `SELECT COUNT(*) as events, COUNT(DISTINCT session) as sessions,
                    ROUND(AVG(CASE WHEN success = 0 THEN 0.0 ELSE 100.0 END), 1) as success_rate
             FROM webmcp_metric ${windowClause}`
        ).first<{ events: number; sessions: number; success_rate: number }>(),
        db.prepare(
            `SELECT source,
                    SUM(CASE WHEN tool = '__initialize__' THEN 1 ELSE 0 END) as initialize,
                    SUM(CASE WHEN tool = '__list__' THEN 1 ELSE 0 END) as discovered,
                    SUM(CASE WHEN tool NOT IN ('__initialize__', '__list__') THEN 1 ELSE 0 END) as invoked
             FROM webmcp_metric ${windowClause} GROUP BY source`
        ).all(),
        db.prepare(
            `SELECT source, tool, COUNT(*) as calls,
                    ROUND(AVG(CASE WHEN success = 0 THEN 0.0 ELSE 100.0 END), 1) as success_rate,
                    CAST(AVG(duration_ms) AS INTEGER) as avg_ms,
                    MAX(created_at) as last_used
             FROM webmcp_metric ${windowClause}
             GROUP BY source, tool ORDER BY calls DESC`
        ).all(),
        db.prepare(
            `SELECT agent, COUNT(*) as calls, MAX(created_at) as last_used
             FROM webmcp_metric ${windowClause} AND agent IS NOT NULL
             GROUP BY agent ORDER BY calls DESC`
        ).all(),
        db.prepare(
            `SELECT date(created_at) as day, COUNT(*) as calls
             FROM webmcp_metric ${windowClause} GROUP BY day ORDER BY day`
        ).all(),
        // Deliberately the latest 25 ever, not window-filtered.
        db.prepare(
            `SELECT created_at, source, tool, success, duration_ms, page, session, agent, input
             FROM webmcp_metric ORDER BY id DESC LIMIT 25`
        ).all(),
        sessionIds.length
            ? db.prepare(
                  `SELECT session, created_at, tool, success, duration_ms, page, input
                   FROM webmcp_metric WHERE session IN (${sessionIds.map(() => '?').join(',')})
                   ORDER BY id ASC`
              ).bind(...sessionIds).all()
            : Promise.resolve({ results: [] }),
    ])

    // Group each session's events into an ordered journey, keeping the
    // newest 50 steps (flagged) if a session ran long.
    type Step = { ts: string; tool: string; success: number; ms: number | null; page: string | null; input: string | null }
    const sessions = new Map<string, { session: string; steps: Step[]; truncated: boolean }>()
    for (const row of (sessionEvents.results as any[]) ?? []) {
        let entry = sessions.get(row.session)
        if (!entry) {
            entry = { session: row.session, steps: [], truncated: false }
            sessions.set(row.session, entry)
        }
        entry.steps.push({
            ts: row.created_at,
            tool: row.tool,
            success: row.success,
            ms: row.duration_ms,
            page: row.page,
            input: row.input,
        })
    }
    const sessionList = sessionIds
        .map((id) => sessions.get(id))
        .filter((s): s is { session: string; steps: Step[]; truncated: boolean } => Boolean(s))
        .map((s) => {
            if (s.steps.length > 50) {
                return { session: s.session, truncated: true, steps: s.steps.slice(-50) }
            }
            return s
        })

    return c.json({
        window: '30d',
        totals: {
            events: totals?.events ?? 0,
            sessions: totals?.sessions ?? 0,
            success_rate: totals?.success_rate ?? null,
        },
        funnel: funnel.results,
        by_tool: byTool.results,
        by_agent: byAgent.results,
        by_day: byDay.results,
        sessions: sessionList,
        recent: recent.results,
    })
})

// Contact tool: agents send a message to the site owner on behalf of the user.
app.post('/contact', async (c) => {
    try {
        const { name: rawName, email: rawEmail, message: rawMessage } = await c.req.json()
        const name = typeof rawName === 'string' ? rawName.trim() : ''
        const email = typeof rawEmail === 'string' ? rawEmail.trim() : ''
        const message = typeof rawMessage === 'string' ? rawMessage.trim() : ''

        if (!name || !email || !message) {
            return c.json({ error: 'Name, email, and message are required' }, 400)
        }
        if (
            name.length > 100 ||
            email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            message.length > 5000
        ) {
            return c.json({ error: 'Invalid contact fields' }, 400)
        }

        const clientIP = c.req.header('CF-Connecting-IP') ?? 'unknown'
        try {
            const rateLimitResult = await c.env.RATE_LIMITER.limit({ key: clientIP })
            if (!rateLimitResult.success) {
                return c.json({ error: 'Rate limit exceeded. Please wait before sending another message.' }, 429)
            }
        } catch {
            return c.json({ error: 'Rate limit check failed' }, 500)
        }

        // Email encrypted at rest, matching the /subscribe privacy posture.
        const encryptedEmail = await encrypt(email, c.env.ENCRYPTION_KEY)

        await c.env.personal_site
            .prepare(`INSERT INTO contact_message (name, email, message, source) VALUES (?, ?, ?, 'webmcp')`)
            .bind(name, encryptedEmail, message)
            .run()

        return c.json({ success: true, message: 'Message sent.' }, 201)
    } catch (error) {
        console.error('Contact error:', error)
        return c.json({ error: 'Failed to send message' }, 500)
    }
})

// Messages are private (they carry the sender's email) — Bearer-key read.
app.get('/contact/messages', async (c) => {
    if (!bearerAuthorized(c)) {
        return c.json({ error: 'Unauthorized' }, 401)
    }
    const { results } = await c.env.personal_site
        .prepare(`SELECT id, name, email, message, source, created_at FROM contact_message ORDER BY id DESC LIMIT 50`)
        .all<{ email: string }>()

    const messages = await Promise.all(
        (results ?? []).map(async (row: any) => {
            let email = row.email
            try {
                email = await decrypt(row.email, c.env.ENCRYPTION_KEY)
            } catch {
                // leave as-is (legacy plaintext rows)
            }
            return { ...row, email }
        })
    )
    return c.json({ messages })
})

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
