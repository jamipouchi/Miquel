# Astro Site

Static personal site built with Astro. The folder structure defines the site structure.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## Deployment

This site deploys to **Cloudflare Workers** with **Workers Assets**.

### First Time Setup

```bash
# Install dependencies (includes Wrangler)
npm install

# Login to Cloudflare
wrangler login
```

### Deploy

```bash
# Build and deploy in one command
npm run deploy
```

This will:
1. Build your static site to `dist/`
2. Deploy it to Cloudflare Workers
3. Give you a live URL at `https://personal-site.<your-subdomain>.workers.dev`

### Configuration

The `wrangler.jsonc` file configures the deployment:
- **name**: Your worker name (appears in URL)

## Project Structure

```
astro-site/
├── src/
│   ├── components/       # Astro components (TreeNav, CommentList, etc.)
│   ├── content/pages/    # Markdown content
│   └── pages/            # Route handlers
└── public/               # Static assets
```

