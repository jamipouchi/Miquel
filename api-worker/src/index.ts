import { Hono } from 'hono'
import { cors } from 'hono/cors'

interface Env {
    personal_site: D1Database
    DEV: boolean
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

        const DB = c.env.personal_site

        try {
            // Insert or update user
            await DB.prepare(`INSERT INTO user (email) VALUES (?) ON CONFLICT(email) DO NOTHING`)
                .bind(email)
                .run()

            // Insert subscription
            await DB.prepare(`INSERT INTO subscription (user_email, slug) VALUES (?, ?)`)
                .bind(email, path)
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

export default app
