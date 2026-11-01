# Migration: two Wrangler Workers → one Worker on the cf CLI (November 2026)

This records what changed when the project moved to a single Cloudflare
project deployed with the `cf` CLI: why it changed, how it was verified, and
how the production cutover was done. For day-to-day usage see the
[README](../README.md).

## Before → after

| | Before | After |
|---|---|---|
| Repo layout | `astro-site/` + `api-worker/`, two packages, two lockfiles | One package at the root |
| Workers | `miquel` (site) + `miquel-api-production` (API) | `miquel` (site + API) |
| Config | Two `wrangler.jsonc` (API used a Wrangler `production` env) | One `cloudflare.config.ts` |
| Tooling | Wrangler 4 (`wrangler dev/deploy/d1/types`) | `cf` CLI (`cf dev/build/deploy/d1/workers types`); no Wrangler anywhere |
| Site → API | Cross-origin `https://api.miquelpuigturon.com/*` (dev: `http://localhost:8787`) | Same-origin `/api/*` (identical in dev) |
| `api.miquelpuigturon.com` | Zone route → `miquel-api-production` | Zone route → `miquel`, API at the root (unchanged URLs) |
| Astro | 5.16, legacy content collections | 7.4, content layer (`glob` loader), Cloudflare adapter 15 (beta) |
| Local secrets | `api-worker/.env`, `api-worker/.env.local` | `.dev.vars` |
| `DEV` var | Switched CORS to `*` in dev | Removed: same-origin needs no CORS |
| Markdown siblings | `scripts/emit-markdown.mjs` after `astro build` | `integrations/markdown-siblings.mjs` inside `astro build` |

Unchanged: the D1 database, the R2 bucket and its public domain, the rate-limiter
namespaces (69, 70), Workers AI, the AI Search instance, all public URLs, and
every page's rendered output.

## Decisions

Made with the site owner:

1. **API URL shape: same-origin `/api` + keep `api.miquelpuigturon.com`.** The
   site's own pages call `/api/*`, so there's no CORS and dev works on a single
   port. `api.miquelpuigturon.com` stays as the public, advertised origin for
   agents and MCP clients (Link headers, api-catalog, docs unchanged).
2. **Fully cf-native toolchain, accepting beta packages.** For Astro, the only
   setup without Wrangler is `@astrojs/cloudflare@15` (beta), built on
   `@cloudflare/vite-plugin` v2 (beta), which emits the Build Output that `cf`
   deploys. The stable adapter (v14) still needs `wrangler.jsonc` and runs
   Wrangler underneath. Versions are pinned exactly.
3. **Zero-downtime production cutover**, done in this migration (below).

Made during the migration (each one keeps behaviour identical):

- **Worker name `miquel`**, so the existing Custom Domain and deployment history
  carry over.
- **No `workers.dev` URL and no preview URLs** (owner's choice; both were on
  before). The Worker answers only on its two hostnames.
- **`output: 'server'` with every route prerendered.** With `output: 'static'` the
  adapter goes "assets only" and silently drops a custom entrypoint.
  `integrations/static-pages-only.mjs` makes a forgotten `prerender = true` a
  build error.
- **`prerenderEnvironment: 'node'`, `session: false`, `imageService: 'passthrough'`.**
  Without these the adapter would prerender inside workerd (needing remote AI/R2
  connections and secrets at build time), auto-provision a `SESSION` KV namespace,
  and add an `IMAGES` binding. The site needs none of that.
- **Markdown via `unified()`, `compressHTML: true`.** Astro 7 defaults to the new
  Sätteri Markdown processor and JSX-style whitespace. The JSX whitespace rules
  fused words such as "task type`<Tooltip>`…" into "typeworkflow…". Both settings
  restore Astro 5's output.
- **`lastModified()` uses `git log --follow --diff-filter=AM`.** Moving every
  content file would otherwise re-date every page in the sitemap and RSS. Pure
  renames are now ignored.
- **Observability on** for the merged Worker (it was on for the old API Worker).

## Verification (before cutover)

- `astro check`: 0 errors. `cf build`: succeeds with 20 markdown siblings and
  the parity gate passing. `npm ls wrangler`: empty.
- **Build output vs. the Astro 5 baseline:** all 58 non-page files (images,
  `.md`, robots, api-catalog, …) byte-identical. Every HTML page is identical
  after normalising asset hashes, inline style/script bodies and whitespace,
  except the intended API URLs (`/api/...` instead of `https://api.miquelpuigturon.com/...`).
- **Screenshots:** all 21 pages at 1500 px and 390 px in headless Chrome, old vs.
  new: identical dimensions everywhere; residual differences are anti-aliasing
  noise of the same size as old-vs-old reruns (largest: one rounded-corner pixel).
- **`cf dev`:** pages, Link headers, api-catalog, and the API on local D1:
  subscribe, contact (rate limit 429 on the 4th call), metrics ingest with PII
  redaction, bearer-protected reads (401/200), comment validation.
- **Built Worker in workerd (`astro preview`):** markdown negotiation (incl. home
  and the excluded page falling back to HTML), `_redirects` 301, 404 page with a
  404 status, `/_astro/*` immutable caching, api-catalog on HEAD, and host
  routing (API host → API at root; site host → API only under `/api`).
- **Secrets:** the local `ENCRYPTION_KEY` decrypts 14/14 production rows. The
  local `CONTACT_KEY` could not be checked before cutover (see below).
- `cf deploy --dry-run`: bindings and triggers as expected.

## Cutover runbook (zero downtime)

The `api.miquelpuigturon.com/*` zone route belongs to `miquel-api-production`,
and `cf deploy` refuses a route owned by another Worker. So code and routing
move in separate steps, and at every point each hostname is served by a working
Worker:

1. **Upload the new version with its secrets, without going live:**
   `npx cf workers versions create --prebuilt --secrets-file .dev.vars --message "…"`
2. **Go live on `miquelpuigturon.com`:** `npx cf workers deployments create --script-name miquel --strategy percentage --versions '[{"version_id":"<id>","percentage":100}]'`.
   The site now calls `/api/*` on the new Worker. `api.miquelpuigturon.com` is
   still served by the old Worker.
3. **Verify** the site and `/api/*` live.
4. **Repoint the route atomically:** `PUT /zones/<zone>/workers/routes/<route-id>`
   with `{"pattern":"api.miquelpuigturon.com/*","script":"miquel"}` (Cloudflare API;
   the cf CLI has no zone-routes command).
5. **Reconcile triggers from config:** `npx cf workers triggers deploy --prebuilt`.
   It's a no-op for the route, which `miquel` now owns, and applies the
   domain and `workersDev`/`previewUrls` settings.
6. **Verify** `api.miquelpuigturon.com`.
7. **Retire `miquel-api-production`** once nothing points at it, after the owner
   confirms (`npx cf workers delete <worker-id> --force`).

**Rollback (until step 7):** repoint the route back to `miquel-api-production`
(step 4 with the old script name) and redeploy the previous `miquel` version
(see README, "Rolling back").

## Cutover log — 2026-11-01 (times UTC)

The operator's network was blocking every Cloudflare-proxied hostname (LaLiga
match-day IP blocking in Spain; `api.cloudflare.com` was unaffected). So every
live check ran **from Cloudflare's network** through Browser Rendering: a page is
loaded with `npx cf browser-run quick-action content --add-script-tag …`, and an
injected script runs `fetch()` checks and writes the results into the page.

| Time | Step |
|---|---|
| 17:13 | `cf workers versions create --prebuilt --secrets-file .dev.vars` → version `9a3d13e8`, secrets stored as `secret_text`. Verified on that version's preview URL against production bindings: pages, markdown negotiation, api-catalog, `_redirects`, 404, `/_astro` caching, API validation, plus one D1 metrics write and one encrypted subscription (both test rows deleted afterwards). |
| 17:16 | `cf workers deployments create` → `9a3d13e8` at 100% on `miquel`. Verified `miquelpuigturon.com` live (same checks, read-only) and that pages call `/api`. `api.miquelpuigturon.com` still on the old Worker, answering normally. |
| 17:17 | Route `api.miquelpuigturon.com/*` (id `3a2c39b1…`) repointed from `miquel-api-production` to `miquel` with one `PUT /zones/…/workers/routes/…`. The unrelated `api.workout-tracker…` route was untouched. |
| 17:17 | `cf workers triggers deploy --prebuilt`: route and apex custom domain confirmed. `workers.dev` and preview URLs off, by the owner's choice (made explicit in config afterwards). |
| 17:19 | Verified `api.miquelpuigturon.com` on the new Worker: API at the root, 401/400/404 as expected, MCP `initialize` proxied (200), CORS preflight from the site passes. The two analytics rows these checks created were deleted. |
| 17:20 | `npm run deploy` end-to-end from the committed tree → version `1897fdbf`. Also switched observability on: the split `versions create` + `deployments create` path doesn't apply Worker-level settings, `cf deploy` does. Secrets carried over (`keepSecrets`). Final smoke test of both hostnames passed. |

| 17:2x | `miquel-api-production` deleted (`npx cf workers delete <id> --force`), at the owner's request, after confirming no route, domain or `workers.dev` URL pointed at it. The `api.miquelpuigturon.com/*` route stayed on `miquel`. |

Rollback: the old API Worker is gone, so rolling back to the two-Worker setup
would mean redeploying the pre-migration code from git (commit `f532ead`). Within
the new setup, `miquel` can roll back to any earlier version (see README,
"Rolling back").

Notes:
- **`CONTACT_KEY`** in production is now the value from `.dev.vars`. It couldn't
  be compared with the old Worker's secret beforehand (secrets can't be read
  back, and the live API was unreachable from the operator's network).
  `ENCRYPTION_KEY` was confirmed identical: it decrypts all 14 production rows.
- `cf d1 query` with several statements, or with `DELETE … WHERE … IN (SELECT …)`,
  failed when run non-interactively; one simple statement per call worked.
- Browser Rendering rate-limits quick actions to a few per minute; retry with backoff.

## Known issues found along the way (pre-existing, not changed)

- **Duplicate subscriptions are stored.** Emails are encrypted with a random IV,
  so the same address never produces the same ciphertext, and
  `UNIQUE(user_email, slug)` can't catch a repeat subscription. A fix would need
  a deterministic lookup key (e.g. an HMAC of the email) next to the ciphertext.
- **The bearer check is a plain `===`.** AGENTS.md describes it as timing-safe;
  it isn't (`bearerAuthorized` in `src/worker/api/index.ts`).
