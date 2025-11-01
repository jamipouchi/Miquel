# API Worker

Hono-based API running on Cloudflare Workers providing comments and subscription functionality.

## Tech Stack

- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (for comment data)
- **AI**: Cloudflare Workers AI (Llama 3.3 for comment moderation)
- **Rate Limiting**: Cloudflare Rate Limiting
- **Runtime**: Cloudflare Workers

## Prerequisites

### For Local Development
- Wrangler CLI (installed via npm)

### For Production Deployment
- Cloudflare account
- D1 database created (`wrangler d1 create <name>`)
- R2 bucket created (`wrangler r2 bucket create <name>`)
- Encryption key secret configured

## Setup

1. Install dependencies:
```bash
npm install
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Run database migrations:
```bash
wrangler d1 migrations apply personal-site
```

## Development

```bash
wrangler dev
```

This starts a local development server with:
- Local D1 database (persisted in `.wrangler/state`)
- Remote R2 bucket (production data)
- Remote Workers AI access

## Configuration

### Bindings

The worker requires these Cloudflare bindings (configured in `wrangler.jsonc`):

- `personal_site` - D1 Database binding
- `COMMENTS_BUCKET` - R2 Bucket binding
- `AI` - Workers AI binding
- `RATE_LIMITER` - Rate Limiting binding

### Environment Variables

- `DEV` - Boolean flag for development mode (affects CORS)

### Secrets

Set the encryption key secret:
```bash
wrangler secret put ENCRYPTION_KEY --env production
```

## Deployment

Deploy to production:
```bash
npm run deploy
```

This deploys to the production environment with custom domain routing at `api.miquelpuigturon.com/*`.