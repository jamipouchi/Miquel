/**
 * The one Cloudflare project for miquelpuigturon.com.
 *
 * A single Worker (`miquel`) serves everything:
 *   - the Astro site — every page is prerendered to static assets at build time;
 *   - the edge logic in front of it (markdown negotiation, Link headers,
 *     /.well-known/api-catalog) — src/worker/site.ts;
 *   - the API (comments, subscriptions, contact, WebMCP metrics, MCP proxy) —
 *     src/worker/api/, reachable at miquelpuigturon.com/api/* (what the site
 *     itself calls) and at api.miquelpuigturon.com/* (stable public URL for
 *     agents and MCP clients).
 *
 * Read by the `cf` CLI (`cf dev`, `cf build`, `cf deploy`, `cf workers types`)
 * and by the Astro Cloudflare adapter. There is no wrangler.jsonc — this file is
 * the whole deployment definition. See README.md → "How it fits together".
 */
import { bindings, defineConfig, triggers } from "cf/config";

/**
 * Production D1 database `personal-site` (subscriptions, contact, metrics).
 * Also referenced by the db:migrate:* scripts in package.json (cf's D1
 * commands take the database id, not the binding name).
 */
const D1_DATABASE_ID = "166fc1fc-543c-4355-84af-d7461d19e300";

export default defineConfig({
	worker: {
		// Kept from the old site Worker so the existing custom domain and
		// deployment history carry over. (The old API Worker was
		// `miquel-api-production`, deleted 2026-11-01 — see docs/cf-migration.md.)
		name: "miquel",
		compatibilityDate: "2026-10-23",
		entrypoint: "./src/worker/index.ts",

		assets: {
			// Every request reaches src/worker/index.ts first; it decides between
			// API, markdown, and plain assets. Static files are served via env.ASSETS.
			runWorkerFirst: true,
			notFoundHandling: "404-page",
		},

		// Apex: Custom Domain (Cloudflare manages DNS + certificate).
		domains: ["miquelpuigturon.com"],
		// API subdomain: zone route, as it has always been.
		triggers: [
			triggers.fetch({ pattern: "api.miquelpuigturon.com/*", zone: "miquelpuigturon.com" }),
		],

		// Deliberately off: the Worker is reachable only on the two hostnames above.
		// No miquel.<account>.workers.dev URL, no per-version preview URLs.
		workersDev: false,
		previewUrls: false,

		observability: { enabled: true },

		env: {
			// Static assets produced by `astro build` (wired up by the Astro adapter).
			ASSETS: bindings.assets(),

			// D1 — local SQLite in `cf dev` (npm run db:migrate:local), production on deploy.
			personal_site: bindings.d1({ name: "personal-site", id: D1_DATABASE_ID }),

			// Comment threads, one JSON file per page, publicly readable at
			// comments.miquelpuigturon.com. Remote in dev on purpose: the site reads
			// comments from that public URL even locally, so writes must land there too.
			COMMENTS_BUCKET: bindings.r2({ name: "comments", dev: { remote: true } }),

			// Workers AI (comment moderation). There is no local simulator.
			AI: bindings.ai({ dev: { remote: true } }),

			// Namespace ids are account-level counters, shared with the old API Worker.
			RATE_LIMITER: bindings.rateLimit({ namespace: "69", simple: { limit: 3, period: 60 } }),
			METRICS_LIMITER: bindings.rateLimit({ namespace: "70", simple: { limit: 60, period: 60 } }),

			// Secrets: values live in Cloudflare (production) and in .dev.vars (local).
			ENCRYPTION_KEY: bindings.secret(), // AES-GCM key (hex) for emails at rest
			CONTACT_KEY: bindings.secret(), // Bearer key for the private read endpoints
		},
	},
});
