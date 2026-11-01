/**
 * Build guard: every route in src/pages must be prerendered.
 *
 * Why this exists: astro.config.mjs sets `output: 'server'` — the only way to
 * make the Cloudflare adapter bundle our own Worker entrypoint
 * (src/worker/index.ts; with `output: 'static'` it emits an assets-only
 * deploy). That Worker never invokes Astro's server runtime: the site is
 * served straight from static assets. So a route that forgets
 * `export const prerender = true` would silently 404 in production.
 * This integration turns that into a loud build failure instead.
 */
export default function staticPagesOnly() {
  let command = 'build';
  return {
    name: 'static-pages-only',
    hooks: {
      'astro:config:setup': (options) => {
        command = options.command;
      },
      'astro:routes:resolved': ({ routes, logger }) => {
        const onDemand = routes
          .filter((route) => route.origin === 'project' && !route.isPrerendered)
          .map((route) => `${route.pattern}  (${route.entrypoint})`);
        if (onDemand.length === 0) return;
        const message =
          'These routes are not prerendered, but the Worker (src/worker/index.ts) only ' +
          'serves static assets — add `export const prerender = true;` to each:\n  ' +
          onDemand.join('\n  ');
        // Dev keeps running (a half-written page shouldn't kill the server); builds fail.
        if (command === 'dev') logger.warn(message);
        else throw new Error(message);
      },
    },
  };
}
