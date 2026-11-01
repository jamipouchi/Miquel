/**
 * Hostnames and paths the Worker routes on. One place, so the entrypoint,
 * the edge Link headers and the API's CORS policy can never disagree.
 * (The Astro side takes its origin from `site` in astro.config.mjs.)
 */

/** The site's canonical origin (Custom Domain on this Worker). */
export const SITE_ORIGIN = 'https://miquelpuigturon.com';

/**
 * Stable public API origin for agents and MCP clients (zone route on this
 * Worker). Everything on this host is the API, mounted at the root.
 */
export const API_HOSTNAME = 'api.miquelpuigturon.com';

/**
 * Same-origin API mount on the site itself: what the site's own pages call
 * (`/api/comments`, `/api/subscribe`, …) — no CORS, and identical in `cf dev`.
 */
export const API_PATH_PREFIX = '/api';
