# AGENTS.MD

Guide for AI assistants working on this personal site.

## Philosophy

**Simplicity above all**: Write markdown, organize by folders, site structure emerges naturally.

**No configuration needed**: Folder structure IS the site structure. No frontmatter, no complex routing config, no CMS.

**Content-first**: Pages are just markdown files. The system automatically handles routing, navigation, TOC, and layout.

**Hierarchy matters**: Visual hierarchy reflects content hierarchy. HOME is special, branches organize topics, leaves contain actual content.

**No dark mode**: Deliberate choice. Professional, consistent, light theme only.

## Architecture Overview

### Core Principle: Three Routes, Infinite Pages

Only three route files handle the entire site:

1. `src/pages/index.astro` - Home page (special layout, no TOC)
2. `src/pages/[...slug].astro` - ALL content pages (unified layout)
3. `src/pages/404.astro` - Not found page

That's it. Everything else is markdown in `src/content/pages/`.

### How Routing Works

```
src/content/pages/
├── index.md              → / (home)
├── self/
│   ├── index.md          → /self/
│   └── addictions/
│       └── index.md      → /self/addictions/
└── humanity/
    ├── index.md          → /humanity/
    └── temporal/
        ├── index.md      → /humanity/temporal/
        └── worker-configuration/
            └── index.mdx → /humanity/temporal/worker-configuration/
```

**Critical**: All pages must be named `index.md` or `index.mdx`. The folder structure determines the URL.

### Why This Works

Astro's content collections (`getCollection('pages')`) automatically discovers all files in `src/content/pages/`. The slug is derived from the folder path. No configuration needed.

## File Structure

```
astro-site/
├── src/
│   ├── worker.ts              # Edge Worker: markdown negotiation, Link headers, api-catalog
│   ├── content/
│   │   ├── config.ts          # Content collections (no schema)
│   │   └── pages/             # ALL CONTENT GOES HERE
│   │       └── ...            # Folders = site structure
│   ├── lib/
│   │   ├── siteTree.ts        # CANONICAL page tree (titles, hierarchy, breadcrumbs)
│   │   ├── aiSearch.ts        # AI Search endpoint + SSE streaming client
│   │   ├── lastModified.ts    # Shared lastmod helper (git commit date, mtime fallback) for RSS + sitemap
│   │   └── siteSlugs.ts       # EXCLUDED_SLUGS (sitemap, RSS, get_site_map, markdown emitter)
│   ├── components/
│   │   ├── CommonHead.astro   # <head>: title, canonical, description, OG, RSS, view transitions
│   │   ├── Breadcrumbs.astro  # "Home / … / current" trail + BreadcrumbList JSON-LD
│   │   ├── SiteTree.astro     # Recursive node renderer for the home full tree
│   │   ├── Footer.astro       # TreeNav + SubscribeForm + Comments + fine print
│   │   ├── TableOfContents.astro  # Auto-generated from h2/h3
│   │   ├── TreeNav.astro      # Context navigation tree ("you are here")
│   │   ├── CommentList.astro  # Fetch/display nested comments
│   │   ├── CommentForm.astro  # Post comments with threading
│   │   ├── SubscribeForm.astro # Email subscriptions per scope
│   │   └── Tooltip.astro      # Hover tooltips
│   ├── pages/
│   │   ├── index.astro        # Home page route
│   │   ├── [...slug].astro    # Catch-all content route
│   │   ├── rss.xml.ts         # Full-content RSS 2.0 feed
│   │   ├── sitemap.xml.ts     # Sitemap for AI Search sync
│   │   └── 404.astro          # Not found
│   └── styles/
│       └── global.css         # All global styles
├── public/
│   ├── _redirects            # /work/* → /humanity/ 301 (honored via ASSETS.fetch)
│   ├── robots.txt            # Sitemap pointer + Content-Signal: ai-train=no, search=yes, ai-input=yes
│   ├── .well-known/
│   │   └── api-catalog       # RFC 9727 linkset+json catalog of the four public API endpoints
│   └── favicon.svg
├── scripts/
│   └── emit-markdown.mjs     # Build step: emits dist/<slug>.md for every content page
├── astro.config.mjs          # Minimal config (MDX integration)
├── wrangler.jsonc            # main Worker (src/worker.ts) + ASSETS binding, run_worker_first
└── package.json
```

## Components Deep Dive

### siteTree.ts — Canonical Page Tree (`src/lib/siteTree.ts`)

The single source of truth for the site's hierarchy. Built once per build from `getCollection('pages')`: every `index.md`/`index.mdx` becomes one node, the top-level index is the home node (slug `''`, path `/`). Titles come from each page's first h1 (inline markdown stripped; fallback: capitalized last slug segment) — the same rule `[...slug].astro` uses for `<title>`.

**Components must consume siteTree, never re-derive hierarchy or titles from slugs.** Breadcrumbs, TreeNav, SiteTree, SubscribeForm scopes and RSS titles all read from it (`getSiteTree`, `getBreadcrumb`, `getTitleMap`, `getShortTitle`, `getChildren`).

**Orientation, not reading order.** There are no prev/next cards and no arrow-key navigation; a reader's sense of place comes from the breadcrumbs above the body, the TreeNav "you are here" block at the end of every page, and the full tree on the home page.

Note: `parent`/`children` are real object references (the graph is cyclic) — never `JSON.stringify` a SiteNode. Everything is read-only by convention.

### Footer.astro

The tail of every content page reads, in order: article body → TreeNav → SubscribeForm → comments → footer fine print. The footer is rendered by `[...slug].astro`, immediately after the body, and contains:
- **TreeNav**: Context-aware navigation (renders on all pages, including meta pages with special styling)
- **SubscribeForm**: Email subscriptions with a scope picker (see below)
- **Comments**: CommentList + CommentForm (can be skipped via `skipComments` prop)
- **Fine print**: hairline-ruled copyright line

Props: `currentSlug`, `path`, `skipComments?`

### Breadcrumbs.astro

- **Breadcrumbs** (`src/components/Breadcrumbs.astro`): rendered above the article body in `[...slug].astro`. "Home / Section / … / current", built from `src/lib/siteTree.ts`; current page last and not linked. Emits schema.org BreadcrumbList JSON-LD (last ListItem omits `item`). Not rendered on home.

### TreeNav.astro

**Smart navigation** that shows:
- HOME (always)
- Ancestors in current path
- Siblings of current page
- Children of current page

**Labels**: Real page titles, h1-derived via `src/lib/siteTree.ts` (not slug-derived). HOME keeps its all-caps label. Very long titles truncate with CSS ellipsis; the full title stays in each link's `title` attribute.

**Current page**: marked with `aria-current="page"`, a bold accent-colored label and a short left rule; it keeps its natural alphabetical position among siblings (no reordering).

**Full tree**: any page at depth > 0 gets a "Full tree ↑" link to `/#site-tree` — the whole-tree section on the home page, rendered by `src/components/SiteTree.astro`.

**Special behavior for meta pages**:
- When on meta pages, TreeNav renders but only shows meta-related siblings (no cross-contamination with other top-level sections)
- Uses purple color scheme (#7c3aed) instead of the standard blue (#0066cc) to visually indicate the special meta section
- Helps isolate meta content from main site navigation while maintaining consistent navigation UX

### TableOfContents.astro

Fixed position sidebar (left side on large screens, hidden < 1450px).
- Auto-generated from h2 and h3 headings
- Highlights current section on scroll
- Smooth scroll on click
- Only renders if page has headings

### Comments System

**CommentList.astro**: Fetches from R2 bucket (`https://comments.miquelpuigturon.com{path}.json`)
- Nested/threaded comments
- GIF support (auto-detects image URLs)
- No loading state: starts with "No comments yet." to prevent layout shifts
- Smooth fade-in animation when comments load
- Graceful error handling: both failure modes show in the same neutral, reader-facing gray card (never dev-internal styling or detail). On timeout (5s `AbortSignal.timeout`, `TimeoutError`): "Unable to reach the comments R2 bucket. Likely because the sons of bitches of LaLiga are blocking the ip. You can use a VPN like 1.1.1.1 to bypass this." — intentional joke, keep it verbatim. On any other error: "Failed to load comments. Please try again later."

**CommentForm.astro**: Posts to API worker (`https://api.miquelpuigturon.com/comments`)
- Rich text with GIF paste support
- Reply threading (stores path array)
- Character limits (name: 50, message: 500)

### SubscribeForm.astro

Email subscriptions with a scope picker (all options titled from siteTree, never raw paths):

- **Default scope is always "Everything — the whole site"** (`/`), first in the dropdown. On home it is the only option and the form renders without a selector.
- Narrower options follow the page's breadcrumb chain: one per ancestor branch, labels accumulating with " → " (e.g. "Humanity → Temporal"), then the current page — "Just this article" for leaves, the branch title for pages with children, "Just this page" for paths unknown to the tree (e.g. 404).
- The scope line under the picker and the submit button label ("Subscribe to everything / this branch / this article") update with the selection; the success message restates the chosen scope.
- Posts `{ email, path }` to the API worker (`/subscribe`); `path` carries no trailing slash, `/` = the whole site.
- A quiet discoverability line sits under the form on every page (home included): "Prefer a feed? Everything, in full, via RSS." linking `/rss.xml`.
- The "?" help modal documents scope, multiple subscriptions, privacy (emails stored AES-GCM-encrypted in D1) and unsubscribing (email `miquel@miquelpuigturon.com`). It also points feed readers to `/rss.xml` and is honest about branch scoping: options only cover ancestors of the current page — "to subscribe to a different branch, open any page inside it — the options follow where you are."
- **Focus management (SearchModal pattern)**: opening the modal moves focus to the close button and makes the background inert (the modal is nested, so every off-chain sibling subtree of its ancestor chain gets `inert`, not `document.body.children`); closing (close button, overlay click, or Escape) removes `inert` and restores focus to the "?" trigger.
- The Escape handler is a document-level listener bound exactly once per session, guarded by `window.__subscribeEscapeBound`; it resolves the modal at keypress time so it survives view transitions without accumulating listeners.
- The status message div is `role="alert"` only (errors + success of the reader's own action; `role="alert"` already implies an assertive live region — an extra `aria-live="polite"` would conflict).

### CommonHead.astro (head-tag standards)

Single `<head>` partial for every route:

- `<title>` from the `title` prop; canonical URL derived from the request path (trailing-slash convention, `/` for home; omitted on 404 — detected by exact `pathname === '/404'`, never a loose `endsWith`).
- **Description**: explicit `description` prop > `«h1 title» — «site description»` looked up in siteTree's title map > generic site description.
- **One** RSS autodiscovery link (`/rss.xml`, `rel="alternate"`) — the only one on the site.
- Open Graph tags (og:title, og:description, og:type, og:url, og:site_name; omitted on 404). `og:type` comes from an optional `ogType` prop, default `'website'`; content pages may pass `'article'` (`[...slug].astro` does).
- `<ClientRouter />` for view transitions; favicon.

`astro.config.mjs` sets `site: 'https://miquelpuigturon.com'` — the single origin source. CommonHead derives canonical/OG URLs from `Astro.site` (build fails loudly if `site` is ever removed), and `rss.xml.ts` / `sitemap.xml.ts` take the origin from the route context's `site`. No hardcoded production origins anywhere.

## Styling Philosophy

### Global First

All base styles in `src/styles/global.css`:
- Reset + base typography
- `.prose` class for all content
- Consistent spacing, colors, fonts
- Responsive breakpoints
- **Overflow contract** (nothing in prose may push the page wider than the viewport): `pre` scrolls horizontally, inline code and prose text break long unbreakable strings (`overflow-wrap`), `.prose img`/`.prose svg` scale down with `max-width: 100%`, and wide tables scroll horizontally below 768px (`display: block; overflow-x: auto` in a `max-width: 767px` media query — desktop keeps the classic full-width `width: 100%` table layout, which `display: block` would collapse to content width).

### Component Styles

Components use scoped `<style>` blocks. No CSS modules, no preprocessors.

### Design System

**Colors**:
- Primary: `#0066cc` (links, interactive)
- Hover: `#0052a3`
- Text: `#1a1a1a` (body), `#000` (headings)
- Background: `#fafafa`
- Borders: `#e0e0e0`

**Typography**:
- System fonts: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto...`
- Monospace: `'SF Mono', Monaco, 'Cascadia Code'...`
- Line height: 1.7 (body), tighter for headings

**Spacing**: Consistent use of `rem` units, generous whitespace.

## Key Conventions

### Naming

- **Folders**: lowercase-with-hyphens (becomes URL)
- **Files**: Always `index.md` or `index.mdx`
- **Components**: PascalCase.astro

### Slugs

The `slug` in Astro content collections:
- `'index'` = home page
- `'self'` = `/self/`
- `'self/addictions'` = `/self/addictions/`

No leading/trailing slashes in slugs.

### Titles

No frontmatter: a page's title is its first h1. siteTree derives every navigation label, breadcrumb, RSS title and default meta description from these h1s — never from slugs. A page without an h1 falls back to its capitalized last slug segment.

### Paths

Routes/URLs always end with `/`:
- `path = '/' + page.slug` for content pages
- `path = '/'` for home
- Used for comments, subscriptions (exact match)

## Interactive Features

### View Transitions

Enabled via `<ClientRouter />` in CommonHead. Smooth page transitions without full reload.

Scripts need `astro:page-load` listener to reinitialize on navigation.

### Comments

Stored as JSON in R2 bucket, structured as nested arrays:
```json
{
  "comments": [
    {
      "name": "Alice",
      "message": "Great post!",
      "created_at": "2025-11-01T12:00:00Z",
      "comments": [ /* nested replies */ ]
    }
  ]
}
```

### Subscriptions

Stored in D1 database (see `api-worker/`). Supports path hierarchy:
- Subscribe to `/` = all updates (the form's default scope)
- Subscribe to `/humanity/` = humanity + all subpaths
- Subscribe to `/humanity/temporal/` = only temporal + subpaths

Emails are stored encrypted at rest (AES-GCM); unsubscribing is manual — the reader emails `miquel@miquelpuigturon.com`.

### RSS (`/rss.xml`)

Hand-rolled RSS 2.0 in `src/pages/rss.xml.ts` (deliberately not `@astrojs/rss` — full control over escaping and content):

- Same page set as the sitemap: every page except `EXCLUDED_SLUGS` (meta pages are content too).
- **Full content**: each item's `<content:encoded>` carries the fully rendered page HTML, entity-escaped rather than CDATA-wrapped (no `]]>` edge cases). `<description>` is a ~200-char plain-text excerpt.
- Titles come from siteTree's title map; `pubDate`/`lastBuildDate` from each file's last git commit date (mtime fallback, via the shared `src/lib/lastModified.ts` helper), mirroring the sitemap's `lastmod`.
- Item URLs and the channel link derive from the route context's `site` (`astro.config.mjs`) — no hardcoded origin. The plain-text excerpt's entity decoder is hardened: per-match try/catch with clamping for out-of-range numeric code points, unknown named entities left untouched.
- Items sort by lastmod descending. The feed's job: whole pages, in a feed reader, on change — not just new pages.

## Development Workflow

```bash
npm run dev      # Start dev server (localhost:4321)
```

## Special Pages

### Home (`/`)

- Custom layout in `src/pages/index.astro`
- No TOC, comments disabled
- Gradient h1, special card styling
- Page tail: welcome copy → site-tree section → TreeNav → SubscribeForm (no comments)
- Renders the whole site tree below the welcome text (`<section id="site-tree">`, `src/components/SiteTree.astro`): every page reachable as one static nested list; the meta branch is visually separated with a purple accent and a "site-internal pages" note. Excluded from AI Search indexing (outside `.page-body`).

### Meta pages (`/meta/*`)

- TreeNav renders with special purple styling to indicate the meta section
- Navigation is isolated: only shows meta siblings, not other top-level pages
- Otherwise treated like normal content pages

### 404

- Custom layout, centered design
- Gradient 404, humorous explanations

## API Integration (api.miquelpuigturon.com)

- `POST /subscribe`, `POST /comments` — pre-existing
- `ALL /mcp` — MCP proxy (header allow-list, funnel logging)
- `POST /metrics/webmcp` — agent metrics ingest (rate-limited)
- `GET /metrics/webmcp` — aggregates (Bearer `CONTACT_KEY`)
- `POST /contact`, `GET /contact/messages` — contact tool (reads need Bearer `CONTACT_KEY`)

Backend API worker at `/api-worker/`:
- **POST /comments**: Create comment (with AI spam check)
- **POST /subscribe**: Create email subscription

Frontend calls these endpoints, no direct database access.

## Build Output

Static site generated to `dist/`:
- All content pages pre-rendered
- `npm run build` = `astro check && astro build && node scripts/emit-markdown.mjs` — the last step adds one sibling `.md` per page (see the Agent-Readiness Edge Worker below)
- Deployed to Cloudflare Workers (main Worker in front of static assets — `"deploy"` runs the full build, never `astro build` alone, or the `.md` siblings go missing)
- No server-side rendering, pure static

## Agent-Readiness Edge Worker (`src/worker.ts`)

The site deploys as a Cloudflare Worker (`"main": "./src/worker.ts"` in `wrangler.jsonc`) with the static assets mounted behind it (`binding: "ASSETS"`, `run_worker_first: true`). Every request hits the Worker first, and **every response header the site emits is set by the Worker** — there is no `_headers` file, by design, so there is exactly one mechanism to reason about. The default path is a plain pass-through to `env.ASSETS.fetch(request)`, which is what keeps `public/_redirects` (`/work/* → /humanity/`) and the `404-page` handling working untouched.

1. **Markdown negotiation**: GET/HEAD requests whose `Accept` lists `text/markdown` (simple parse: token present with a non-zero q-value) are served the sibling `.md` emitted at build time (`/humanity/x/` → `/humanity/x.md`, `/` → `/index.md`). Markdown responses carry `Content-Type: text/markdown; charset=utf-8`, `Vary: Accept` and `x-markdown-tokens` — a rough context budget (bytes ÷ 4, rounded up). When no `.md` exists (non-content paths, excluded pages, every static asset) the Worker falls through to the normal HTML asset, so browsers never notice negotiation is happening.
2. **Link headers (RFC 8288)**: every HTML page response (status 200 with `text/html` — which excludes the 404 and all non-HTML responses) gets one Link header per target: `</.well-known/api-catalog>; rel="api-catalog"`, `<https://api.miquelpuigturon.com/mcp>; rel="service-desc"`, `</meta/webmcp/>; rel="service-doc"`, and `</rss.xml>` / `</sitemap.xml>` as `rel="alternate"`. Agents discover the API surface without parsing HTML. Those HTML responses also carry `Vary: Accept` (same 200 text/html scope as the Link rule) — the same URL is content-negotiated against `text/markdown`, so caches must key on Accept.
3. **API catalog (RFC 9727)**: `/.well-known/api-catalog` is a linkset+json catalog of the four public API endpoints (`/mcp`, `/subscribe`, `/contact`, `/comments` on api.miquelpuigturon.com). The Worker forces `Content-Type: application/linkset+json` on it and adds the `Link: </.well-known/api-catalog>; rel="api-catalog"` self-reference on GET **and HEAD** — the spec requires the header on HEAD, and caches probe the well-known URI that way.
4. **Markdown emission** (`scripts/emit-markdown.mjs`, last step of `npm run build`): walks `src/content/pages/**` and writes each page to `dist/<slug>.md`. `<slug>` runs every source-folder segment through Astro's own slugification (github-slugger-style: lowercase, punctuation stripped, spaces → `-`) — so `OOM-investigation/` emits `oom-investigation.md`, matching the route Astro builds rather than the raw folder casing. Plain `.md` pages are copied verbatim; `.mdx` pages get a light text transform — `import` lines stripped, `<Tooltip>` unwrapped to its inner text (quote-aware, since tooltip text may contain `>`), `<AgentTools />` dropped — enough to read as markdown while the MDX source stays canonical for the HTML render. Exclusions are parsed out of `EXCLUDED_SLUGS` in `src/lib/siteSlugs.ts` (a `.ts` file plain Node can't import), so the emitter can never drift from the sitemap/RSS/indexing exclusion list — an unparseable or empty list fails the build. As the final gate, the script walks `dist` itself and fails the build if any built HTML page lacks its sibling `.md`, compared **case-sensitively** against the `.md` files actually on disk (`existsSync` is case-insensitive on macOS, so it would bless a wrong-cased sibling markdown negotiation can't serve); stray `.md` files with no matching route fail too.
5. **Discovery signals elsewhere**: `public/robots.txt` carries `Content-Signal: ai-train=no, search=yes, ai-input=yes` next to the sitemap pointer.

## Key Principles for Agents

1. **Don't overcomplicate**: If you're adding config, you're probably doing it wrong
2. **Respect the hierarchy**: Folder structure drives everything
3. **Keep it unified**: All content pages should look/behave the same (except home)
4. **No dark mode**: Don't add theme switching, it's intentional
5. **Global styles**: Prefer extending `global.css` over component styles
6. **Avoid layout shifts**: Everything loads fast, avoid loading states that cause layout shifts
7. **One tree source**: Navigation, breadcrumbs, subscribe scopes and RSS titles all come from `src/lib/siteTree.ts`; components consume it, they don't re-derive
8. **Test the build**: `npm run build` must pass before deploying

## Search & AI Answers (Cloudflare AI Search)

Site search (⌘K / `/` button, top-right) is a single-mode "ask" experience powered by a managed Cloudflare AI Search instance (`miquel-site`): a streaming markdown answer grounded in the site's pages, with a sources list. It syncs daily from `sitemap.xml` (generated at build time by `src/pages/sitemap.xml.ts`, with per-page `<lastmod>` from each file's last git commit date via `src/lib/lastModified.ts`) — unchanged pages are skipped, so idle syncs cost one sitemap fetch. It indexes only the `.page-body` div (the wrapped markdown content — never nav, comments, or footer). Browser rendering is off (the site is static HTML).

- **No framework**: `src/components/SearchModal.astro` is vanilla TS (module script + event delegation, so it survives view transitions). Do not add React.
- **Shared client**: `src/lib/aiSearch.ts` holds the public endpoint URL and the SSE streaming/dedupe logic. LLM output is untrusted: the markdown renderer escapes all HTML first and only emits its own tags (no raw HTML, http(s) links only).
- **Query API**: public endpoint (`<id>.search.ai.cloudflare.com`) — `POST /search` for results, `POST /chat/completions` (streamable, OpenAI-compatible) for AI answers. Manage the instance via `wrangler ai-search` (needs an AI Search API token from the dashboard) or the REST API.
- **Indexing**: content changes are picked up by the daily sync (within ~24h of a deploy). After publishing, run a manual sync job if you want it searchable immediately. Result titles are derived client-side from the page's first markdown h1 (sitemap crawl mode doesn't store title metadata). Only canonical trailing-slash URLs are in the sitemap, so the index stays deduplicated. Pages excluded from indexing (e.g. `meta/chat-transcript` — big and unrelated) are listed in `EXCLUDED_SLUGS` in `src/lib/siteSlugs.ts`; the sync removes anything absent from the sitemap.

## WebMCP (browser-native agent tools)

`src/components/ModelContextTools.astro` registers **five tools** on `document.modelContext` on **every page** — four read-only (`search_site`, `read_page`, `ask_site`, `get_site_map`, all with `readOnlyHint`) plus one write tool (`contact_miquel`, deliberately without `readOnlyHint` so agents confirm with the user first). Chrome 151 exposes the API on normal pages, no COOP/COEP needed (the old `public/_headers` isolation block was removed). A synchronous `window.__webmcpToolsRegistered` flag prevents double registration across view transitions. `/meta/webmcp/` (`src/content/pages/meta/webmcp/index.mdx` + `src/components/AgentTools.astro`) is the human-facing status/docs page and registers nothing itself.

Non-browser agents get the same capability through the hosted MCP endpoint, proxied behind this site's own domain at `https://api.miquelpuigturon.com/mcp` (transparent pass-through to the AI Search public endpoint, defined in `api-worker/src/index.ts`).

**Metrics (AXO-style agent analytics, dogfood)**: D1 table `webmcp_metric` (migrations `0002`–`0004`) captures the agent funnel on both surfaces. `mcp-proxy` rows are written server-side by the api-worker: `__initialize__` (connect), `__list__` (discovery), and tool names (invocation), with a User-Agent-derived agent label (`agentFromUserAgent`); proxy "success" means HTTP 2xx. `webmcp` rows are self-reported by the in-page tools via `POST /metrics/webmcp` (rate-limited, own limiter namespace): tool, outcome, duration, page, random per-tab `session` id, redacted error, and the tool's input. **Inputs are PII-redacted server-side before storage** (`redactInput` in the api-worker — the single redactor: credential-shaped fields of any value type and literals like `ghp_…`/`sk-…`/`AKIA…`/`Bearer …` → `[redacted]`/`[token]`, emails → `[email]`, phone-like numbers → `[number]`). The client sends raw inputs over HTTPS to our own API, same as the contact form. Reading aggregates is **private**: `GET /metrics/webmcp` with header `Authorization: Bearer <CONTACT_KEY>` (timing-safe compared) returns totals, funnel, by_tool, by_agent, by_day, `sessions` (ordered per-session journeys with inputs, newest-50 steps, `truncated` flag), and `recent`.

**Contact tool**: `contact_miquel` (the only write tool — no `readOnlyHint`, so agents confirm with the user) POSTs to `api.miquelpuigturon.com/contact` (validated, rate-limited) → D1 `contact_message` with the email **encrypted at rest**. Read messages at `GET /contact/messages` with `Authorization: Bearer <CONTACT_KEY>`; the key is the `CONTACT_KEY` Worker secret.

Until WebMCP ships as a standard, Chrome gates it behind an **origin trial**. Today it only activates for browsers that enabled `chrome://flags/#enable-webmcp-testing`. To enable it for all Chrome visitors: register the origin `miquelpuigturon.com` at [developer.chrome.com/origin-trials](https://developer.chrome.com/origin-trials) (WebMCP trial), then add the issued token to `CommonHead.astro` as `<meta http-equiv="origin-trial" content="TOKEN">`. Tokens expire (~6 weeks) and are renewed in the same console.

## Summary

This is a **content-first static site** built with Astro. The core insight: folder structure = site structure. Everything else (routing, navigation, TOC, layout) is automatically derived from that structure. 

Write markdown, organize folders, deploy. That's it.

## Final Note

Whenever any of the behaviours specified changed, update this file. For example, if you make another special path, or another special <>.astro file, mention it here, explaining the reasoning.

Happy coding!
