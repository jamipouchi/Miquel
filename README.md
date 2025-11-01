# Personal Site

A monorepo containing a personal website with static content and API backend.

## Project Structure

```
personal-site/
├── astro-site/      # Static site built with Astro
└── api-worker/      # API backend with Hono on Cloudflare Workers
```

## Getting Started

Each project has its own README with setup instructions:

- **[Astro Site](./astro-site/README.md)** - Static content site with hierarchical navigation
- **[API Worker](./api-worker/README.md)** - API for comments and subscriptions

## Tech Stack

- **Frontend**: Astro, MDX, TypeScript
- **Backend**: Hono, Cloudflare Workers (D1, R2, Workers AI)
- **Deployment**: Cloudflare Workers

