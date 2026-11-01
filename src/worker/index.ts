/**
 * Worker entrypoint — the single Worker behind miquelpuigturon.com
 * (`entrypoint` in cloudflare.config.ts).
 *
 * `assets.runWorkerFirst` is on, so every request lands here first and is
 * dispatched to exactly one of two handlers:
 *
 *   api.miquelpuigturon.com/*      → API, mounted at the root (agents, MCP clients)
 *   miquelpuigturon.com/api/*      → the same API, mounted under /api (the site's
 *                                    own pages; same origin, also in `cf dev`)
 *   everything else                → site edge handler: markdown negotiation,
 *                                    Link headers, api-catalog, then static assets
 *
 * Astro's server runtime is never invoked: every page is prerendered at build
 * time (enforced by integrations/static-pages-only.mjs), so the site is served
 * straight from env.ASSETS.
 */
import { Hono } from 'hono';
import api from './api';
import { API_HOSTNAME, API_PATH_PREFIX } from './origins';
import { handleSite } from './site';

/** The API under /api on the site's own origin. Same routes, same middleware. */
const siteApi = new Hono<{ Bindings: Env }>().route(API_PATH_PREFIX, api);

function isApiPath(pathname: string): boolean {
  return pathname === API_PATH_PREFIX || pathname.startsWith(`${API_PATH_PREFIX}/`);
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === API_HOSTNAME) return api.fetch(request, env, ctx);
    if (isApiPath(url.pathname)) return siteApi.fetch(request, env, ctx);
    return handleSite(request, env);
  },
} satisfies ExportedHandler<Env>;
