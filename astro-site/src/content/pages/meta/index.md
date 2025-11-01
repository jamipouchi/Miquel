# Meta

This page explains how this site is built and structured.

## Philosophy

This site is designed to be a personal knowledge base — a collection of thoughts, ideas, and reflections organized hierarchically by topic. The design philosophy emphasizes simplicity: write markdown, organize by folders, and the site structure emerges naturally.

## Technical Stack

Built with [Astro](https://astro.build/) using content collections. No complex CMS, no database — just markdown files in a folder structure.

Using Cloudflare's services:
- Deployed as a static website to [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/)
- Comments are stored in [Cloudflare R2](https://developers.cloudflare.com/r2/)
- AI to verify comments is provided by [Cloudflare AI](https://developers.cloudflare.com/workers-ai/)
- Users and subscriptions are stored in a [Cloudflare D1](https://developers.cloudflare.com/d1/) database
- Create subscription and comment endpoints are served by a [Cloudflare Worker](https://developers.cloudflare.com/workers/)

## Content Structure

All content lives in `src/content/pages/` as markdown files:

```
src/content/pages/
├── index.md           → / (home)
└── self/
    ├── index.md       → /self/ (branch page)
    └── addictions/
        └── index.md       → /self/addictions (leaf page)
└── humanity/
    ├── index.md       → /humanity/ (branch page)
    └── temporal/
        ├── index.md       → /humanity/temporal/ (branch page)
        ...
```

**Folder structure = site structure.** No configuration needed.

## Automatic Routing

Three route files handle all pages:

- `index.astro` - Home page with custom layout (`/`)
- `[...slug].astro` - All content pages with unified layout (including this meta page!)
- `404.astro` - Handle missing pages

## Design Choices

**No dark mode**: We are professionals, not guys coding under the covers of their bed.

**Hierarchy**: Visual hierarchy matches content hierarchy — home is special, branches organize, leaves contain

## Source

The original implementation of this site was built with cursor through a conversation with Claude 4.5 sonnet. You can read the [full chat transcript](/meta/chat-transcript/) to see how it was designed and implemented.

Further history can be seen at [https://github.com/jamipouchi/Miquel](https://github.com/jamipouchi/Miquel).

