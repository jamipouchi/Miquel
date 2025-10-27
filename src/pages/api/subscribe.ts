import type { APIRoute } from 'astro'

export const prerender = false

export const POST: APIRoute = async ({ request, locals }) => {
    try {
        const { email, path } = await request.json()

        // Validate inputs
        if (!email || !path) {
            return new Response(JSON.stringify({ error: 'Email and path are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            return new Response(JSON.stringify({ error: 'Invalid email format' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        // Validate path format (should start with /)
        if (!path.startsWith('/')) {
            return new Response(JSON.stringify({ error: 'Path must start with /' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        const DB = (locals as any).runtime.env.personal_site

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
                return new Response(
                    JSON.stringify({
                        success: true,
                        message: 'Subscription created.',
                    }),
                    { status: 201, headers: { 'Content-Type': 'application/json' } }
                )
            }
            throw error
        }

        // Success - new subscription created
        return new Response(
            JSON.stringify({
                success: true,
                message: 'Subscription created.',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('Subscription error:', error)
        return new Response(JSON.stringify({ error: 'Failed to create subscription' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}
