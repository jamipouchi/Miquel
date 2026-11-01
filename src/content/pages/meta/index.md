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
- Search and AI answers are powered by [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/), which crawls and indexes this site automatically

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
- `404.astro` - Missing pages

## Getting Around

Everything here is one tree, and a page's path is part of its meaning: broader topics near the root (`/humanity/`), specifics deeper down (`/humanity/temporal/worker-configuration/`).

**Finding your bearings.** Breadcrumbs at the top of every page (Home / section / … / where you are), a small tree at the end of every page showing the current page among its siblings and children, and the [whole tree on the home page](/#site-tree). The tree block on these site-internal pages only ever shows other meta pages — the section keeps to its own corner.

**Subscribing.** The form at the end of every page defaults to *everything — the whole site*; you can narrow it to a single branch (that page and everything under it) or to just one article. Emails are stored encrypted and used for nothing else. To unsubscribe, email [miquel@miquelpuigturon.com](mailto:miquel@miquelpuigturon.com). If you prefer feeds, every page arrives in full at [/rss.xml](/rss.xml).

## Design Choices

**No dark mode**: We are professionals, not guys coding under the covers of their bed.

**Hierarchy**: Visual hierarchy matches content hierarchy — home is special, branches organize, leaves contain

**Static**: Everything is served statically. Comments too.

## Source

The original implementation of this site was built with cursor through a conversation with Claude 4.5 sonnet. You can read the [full chat transcript](/meta/chat-transcript/) to see how it was designed and implemented.

Further history can be seen at [https://github.com/jamipouchi/Miquel](https://github.com/jamipouchi/Miquel).

