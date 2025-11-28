import { decrypt } from '../src/encrypt.js'
import { execSync } from 'child_process'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

if (!ENCRYPTION_KEY) {
    console.error('Error: ENCRYPTION_KEY environment variable is not set.')
    process.exit(1)
}

async function main() {
    try {
        console.log('Fetching data from D1 (production)...')
        const command = `npx wrangler d1 execute personal-site --remote --command "SELECT user_email, slug FROM subscription" --json`
        const output = execSync(command, { encoding: 'utf-8' })
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
