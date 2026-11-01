/**
 * Lists subscribers per subscription scope, decrypting the emails stored
 * AES-GCM-encrypted in the production D1 database.
 *
 *   npm run subscribers
 *
 * Needs ENCRYPTION_KEY in .dev.vars (the production key) and a logged-in cf
 * CLI (`cf auth login`). Runs directly on Node's built-in TypeScript support.
 */
import { execFileSync } from 'node:child_process'
import { decrypt } from '../src/worker/api/encrypt.ts'

// Production D1 database `personal-site` (same id as cloudflare.config.ts).
const D1_DATABASE_ID = '166fc1fc-543c-4355-84af-d7461d19e300'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

if (!ENCRYPTION_KEY) {
    console.error('Error: ENCRYPTION_KEY is not set (expected in .dev.vars — see .dev.vars.example).')
    process.exit(1)
}

async function main() {
    try {
        console.log('Fetching data from D1 (production)...')
        const output = execFileSync(
            'npx',
            ['cf', 'd1', 'query', D1_DATABASE_ID, '--sql', 'SELECT user_email, slug FROM subscription'],
            { encoding: 'utf-8' }
        )
        const result = JSON.parse(output)

        if (!result || !result[0] || !result[0].results) {
            console.error('Failed to parse D1 output:', output)
            process.exit(1)
        }

        const rows = result[0].results
        const groupedEmails: Record<string, string[]> = {}

        for (const row of rows) {
            const slug = row.slug as string
            const encryptedEmail = row.user_email as string

            try {
                const decrypted = await decrypt(encryptedEmail, ENCRYPTION_KEY!)
                if (!groupedEmails[slug]) {
                    groupedEmails[slug] = []
                }
                groupedEmails[slug].push(decrypted)
            } catch (error) {
                console.error(`Failed to decrypt email for slug ${slug}: ${encryptedEmail}`, error)
            }
        }

        for (const [slug, emails] of Object.entries(groupedEmails)) {
            console.log(`Slug: ${slug}`)
            for (const email of emails) {
                console.log(`- ${email}`)
            }
        }
    } catch (error) {
        console.error('An error occurred:', error)
        process.exit(1)
    }
}

main()
