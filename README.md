# miquelpuigturon.com

My personal site: essays as a tree of Markdown pages, plus a small API for
comments, subscriptions, a contact tool and agent (MCP/WebMCP) analytics.

It is **one Cloudflare project**. A single Worker, `miquel`, serves the static
Astro site and the API. It's defined in one file, [`cloudflare.config.ts`](./cloudflare.config.ts),
and built, run and deployed with the [`cf` CLI](https://blog.cloudflare.com/cf-cli-local-explorer/).
There is no Wrangler config and no Wrangler dependency.

- **How the site behaves and why** (routing, navigation, RSS, markdown negotiation,
  WebMCP…): [AGENTS.md](./AGENTS.md)
- **History of the move from two Wrangler Workers to this setup**: [docs/cf-migration.md](./docs/cf-migration.md)

---

## How it fits together

```
                         ┌──────────── Worker "miquel" (cloudflare.config.ts) ─────────────┐
 miquelpuigturon.com ───►│ src/worker/index.ts                                             │
   (Custom Domain)       │   ├─ Host api.miquelpuigturon.com ──► API at /       ─┐         │
                         │   ├─ /api/*  ───────────────────────► API at /api/*  ─┴► src/worker/api (Hono)
 api.miquelpuigturon.com►│   └─ everything else ──► src/worker/site.ts ──► env.ASSETS       │
   (zone route)          │          markdown negotiation, Link headers,   (prerendered Astro │
                         │          /.well-known/api-catalog               site + .md files)│
                         └─────────────────────────────────────────────────────────────────┘
   bindings: D1 personal-site · R2 comments · Workers AI · 2 rate limiters · 2 secrets
```

- **The site** is Astro, fully prerendered at build time. Folders under
  `src/content/pages/` *are* the site structure (see AGENTS.md).
- **The edge handler** (`src/worker/site.ts`) runs before every static asset. It
  serves `text/markdown` to agents that ask for it, adds discovery `Link` headers,
  and serves the RFC 9727 API catalog.
- **The API** (`src/worker/api/`, Hono) is mounted twice:
  - at `/api/*` on the site's own origin, which is what the site's own pages call
    (same origin, so no CORS);
  - at the root of `api.miquelpuigturon.com`, the stable public URL for agents
    and MCP clients.
- **Outside the Worker:** comments are JSON files in the R2 bucket `comments`. The
  browser reads them straight from its public domain `comments.miquelpuigturon.com`,
  and the API writes them. Search and the MCP upstream are the Cloudflare AI Search
  instance `miquel-site`.

## Repository layout

| Path | What |
|---|---|
| `cloudflare.config.ts` | The deployment: Worker name, domain, route, bindings, secrets |
| `astro.config.mjs` | Astro + Cloudflare adapter configuration |
| `src/worker/` | The Worker: `index.ts` (dispatch), `site.ts` (edge), `api/` (API), `origins.ts` |
| `src/content/pages/` | All content — one folder per page, `index.md`/`index.mdx` |
| `src/pages/`, `src/components/`, `src/lib/`, `src/styles/` | The Astro site |
| `integrations/` | Build-time Astro integrations (markdown siblings, prerender guard) |
| `migrations/` | D1 schema migrations |
| `scripts/decrypt-emails.ts` | Prints subscribers (decrypted) per scope |
| `public/` | Static files copied as-is (`_redirects`, `robots.txt`, api-catalog, images) |

Generated and gitignored: `.cloudflare/` (build output, local D1/R2 state,
generated types), `dist/`, `.astro/`, `.dev.vars`.

## Requirements

- **Node.js** `^22.23`, `^24.22` or `>=26.12` (what `cf` requires; check with `node -v`).
- **A Cloudflare login** for the account that owns the zone: `npx cf auth login`.
  Local dev needs it too, because Workers AI and the R2 bucket are used remotely.

Nothing needs to be installed globally. `cf` is a dev dependency, so use `npx cf …`
or the npm scripts. If you also have a global `cf`, it may be an older beta; the
project's version is the one that counts.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in the two secrets (see "Secrets")
npx cf auth login                # once per machine
npm run db:migrate:local         # creates the local D1 tables
npm run dev                      # http://localhost:4321
```

`npm run dev` runs `cf dev`, which runs `astro dev` with the Worker in the real
workerd runtime. Pages, the edge handler and `/api/*` all answer on the same port,
exactly as in production.

| Binding | In `cf dev` |
|---|---|
| D1 `personal_site` | **Local** SQLite in `.cloudflare/state/` (`npm run db:migrate:local` to create tables) |
| R2 `COMMENTS_BUCKET` | **Production bucket** (remote). The site reads comments from the public bucket URL even locally, so writes go there too. Comments you post locally are real. |
| `AI` (Workers AI) | Remote (no local simulator) |
| Rate limiters | Local |
| `ENCRYPTION_KEY`, `CONTACT_KEY` | From `.dev.vars` |

Things that only exist in the **built** output (not in `npm run dev`):
markdown siblings (`Accept: text/markdown`), `public/_redirects`, and the
`/_astro/*` cache header. To test those, run the production build locally:

```bash
npm run build
npx astro preview                # the built Worker + assets in workerd, :4321
curl -H 'Accept: text/markdown' localhost:4321/self/

# The api.miquelpuigturon.com host (Vite blocks unknown Host headers by default):
npx astro preview --allowed-hosts api.miquelpuigturon.com
curl -H 'Host: api.miquelpuigturon.com' localhost:4321/metrics/webmcp   # → 401
```

Astro 7 may run the dev/preview server in the background. Stop it with
`npx astro dev stop` / `npx astro preview stop`.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Local dev server (`cf dev`) |
| `npm run check` | Generate Worker types (`cf workers types`) + `astro check` |
| `npm run build` | Production build (`cf build`) → `.cloudflare/output/` |
| `npm run deploy` | `check`, then `cf deploy` (build + upload + go live + domains/routes) |
| `npm run types` | Regenerate `.cloudflare/types/index.d.ts` (`Env` from `cloudflare.config.ts`) |
| `npm run db:migrate:local` | Apply D1 migrations to the local database |
| `npm run db:migrate:remote` | Apply D1 migrations to production |
| `npm run subscribers` | List subscribers per scope, decrypted (needs `ENCRYPTION_KEY` in `.dev.vars`) |

## Deploying

```bash
git status            # deploy from a committed tree (see below)
npm run deploy
```

`cf deploy` builds the project (`astro build`), uploads a new Worker version with
the static assets, deploys it to 100% and applies the domain and route from
`cloudflare.config.ts`. Useful variants:

```bash
npx cf deploy --dry-run                       # build + validate, upload nothing
npx cf deploy --message "what changed"        # annotate the version
npx cf workers versions create                # upload a version without going live
```

The Worker only answers on `miquelpuigturon.com` and `api.miquelpuigturon.com`.
`workers.dev` and per-version preview URLs are deliberately off (`workersDev: false`,
`previewUrls: false`). To try a build before it goes live, use `npx astro preview`
locally (see "Local development").

**Deploy from a committed tree.** Sitemap `<lastmod>` and RSS dates come from each
page's last git commit. Uncommitted files fall back to their modification time,
which would re-date pages in feed readers and trigger AI Search re-indexing.

**Rolling back:** list recent versions, then deploy an older one:

```bash
npx cf workers deployments list --script-name miquel
npx cf workers deployments create --script-name miquel --strategy percentage \
  --versions '[{"version_id":"<VERSION_ID>","percentage":100}]'
```

**After deploying content:** AI Search re-crawls `sitemap.xml` daily. Trigger a
sync with `cf ai-search` if a change should be searchable right away.

## Secrets

| Name | What | Notes |
|---|---|---|
| `ENCRYPTION_KEY` | AES-GCM key (64 hex chars) for emails at rest in D1 | **Never rotate casually**: existing rows can only be decrypted with this key |
| `CONTACT_KEY` | Bearer key for `GET …/metrics/webmcp` and `GET …/contact/messages` | Any long random string |

Both are declared in `cloudflare.config.ts` (`bindings.secret()`), so types and
local dev know about them. Values live in two places:

- **Local:** `.dev.vars` (gitignored; template in `.dev.vars.example`).
- **Production:** Worker secrets on `miquel`.

```bash
npx cf workers secrets list --script-name miquel            # names only
# Set/rotate: upload with a deploy (values read from the file, never echoed)
npx cf deploy --secrets-file .dev.vars
# …or set one secret directly (the value ends up in your shell history)
npx cf workers secrets update CONTACT_KEY --script-name miquel --type secret_text --text '<value>'
```

## Database (D1)

Production database: `personal-site` (id `166fc1fc-543c-4355-84af-d7461d19e300`).
Tables `user`, `subscription`, `webmcp_metric` and `contact_message` are defined
by `migrations/`. cf's D1 commands take the **database id**, not the binding name.
Applied migrations are tracked in the `d1_migrations` table (the same format
Wrangler used, so the history carried over).

```bash
npx cf d1 migrations create "add something"   # new numbered file in migrations/
npm run db:migrate:local                      # try it locally
npm run db:migrate:remote                     # then production
npx cf d1 migrations list 166fc1fc-543c-4355-84af-d7461d19e300   # pending in production
npx cf d1 query 166fc1fc-543c-4355-84af-d7461d19e300 --sql "SELECT COUNT(*) FROM subscription"
```

## API

The same app answers on `https://miquelpuigturon.com/api/<path>` and on
`https://api.miquelpuigturon.com/<path>`.

| Method + path | Purpose | Auth / limits |
|---|---|---|
| `POST /comments` | Add a (threaded) comment: Llama-moderated, written to R2 | 3/min per IP |
| `POST /subscribe` | Subscribe an email to a path scope (`/` = everything) | — |
| `POST /contact` | Message from the `contact_miquel` WebMCP tool, stored encrypted | 3/min per IP |
| `GET /contact/messages` | Read contact messages (decrypted) | `Authorization: Bearer $CONTACT_KEY` |
| `POST /metrics/webmcp` | Agent-tool usage event (inputs PII-redacted) | 60/min per IP |
| `GET /metrics/webmcp` | 30-day agent analytics | `Authorization: Bearer $CONTACT_KEY` |
| `ALL /mcp` | MCP endpoint, proxied to the AI Search instance | — |

CORS: the site uses `/api` same-origin, so no CORS is needed. On
`api.miquelpuigturon.com`, browsers are only allowed from `https://miquelpuigturon.com`.

## Logs

Observability is enabled on the Worker. Logs and traces are in the Cloudflare
dashboard (Workers & Pages → `miquel` → Logs), or from the CLI with `npx cf logs query` /
`npx cf o11y telemetry query`.

## Toolchain notes

- **Beta packages, pinned exactly.** `cf@1.0.0-beta.26` and
  `@astrojs/cloudflare@15.0.0-beta.4` (which brings `@cloudflare/vite-plugin` v2 beta)
  are the only way today to run an Astro project on `cloudflare.config.ts` and `cf`
  with no Wrangler. Upgrade them deliberately, together, then run
  `npm run check && npm run build && npx cf deploy --dry-run` before deploying.
  `npm ls wrangler` should stay empty.
- **`output: 'server'` with every page prerendered.** That setting is the only
  way to make the adapter bundle our own Worker entrypoint. Every route file has
  `export const prerender = true`, and `integrations/static-pages-only.mjs` fails
  the build if one doesn't. Content pages need nothing.
- **Astro 7, rendering exactly like before.** Markdown goes through `unified()`
  (remark/rehype) instead of the new default Sätteri, and `compressHTML: true`
  keeps the old whitespace handling. Screenshots of every page before and after
  the upgrade match, apart from anti-aliasing noise (see docs/cf-migration.md).
- **npm `allowScripts`:** `package.json` allows `workerd`'s postinstall. When
  `workerd` updates, npm asks again; approve with `npm install-scripts approve workerd`.

## Troubleshooting

- **Site, API or comments time out from Spain on match days.** ISPs block
  Cloudflare IPs during LaLiga broadcasts. Use a VPN such as 1.1.1.1/WARP. Building
  and `cf` commands still work, because `api.cloudflare.com` is not blocked.
- **`Missing required secrets … ENCRYPTION_KEY`:** create `.dev.vars` from
  `.dev.vars.example`.
- **`no such table: subscription` in dev:** run `npm run db:migrate:local`.
- **`EBADENGINE` warning for `cf`:** upgrade Node to a version in the
  "Requirements" range.
- **Types out of date after editing `cloudflare.config.ts`:** run `npm run types`.
