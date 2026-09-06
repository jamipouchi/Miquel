/**
 * The site's edge Worker. With `run_worker_first` every request hits this
 * file before the assets, and every response header the site emits is set
 * here — there is deliberately no `_headers` file, so there is exactly one
 * mechanism to reason about.
 *
 * Three jobs, in order:
 *  1. Serve text/markdown to agents that ask for it, from the sibling .md
 *     files emitted at build time by scripts/emit-markdown.mjs.
 *  2. Stamp RFC 8288 Link headers onto HTML pages so agents can discover
 *     the API catalog, MCP endpoint, docs, feed and sitemap without
 *     parsing HTML.
 *  3. Serve /.well-known/api-catalog as an RFC 9727 linkset with the Link
 *     self-reference the spec requires (including on HEAD).
 *
 * Everything else is a plain pass-through to the ASSETS binding, which is
 * what keeps _redirects (/work/* → /humanity/) and the 404 page working.
 */

interface Env {
  ASSETS: Fetcher;
}

// Discovery links advertised on every HTML page (one Link header per target).
const LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '<https://api.miquelpuigturon.com/mcp>; rel="service-desc"; title="Model Context Protocol endpoint"',
  '</meta/webmcp/>; rel="service-doc"; title="Agent tools documentation"',
  '</rss.xml>; rel="alternate"; type="application/rss+xml"',
  '</sitemap.xml>; rel="alternate"; type="application/xml"',
];

// Paths shaped like static files (extension-bearing): never a page, so
// the .md sibling lookup cannot apply.
const NOT_A_PAGE = /\.(png|jpe?g|gif|svg|ico|webp|avif|css|js|mjs|json|xml|txt|pdf|woff2?|html)$/i;

/** True when the Accept header lists text/markdown with a non-zero q-value. */
function wantsMarkdown(accept: string | null): boolean {
  return (accept ?? '').split(',').some((part) => {
    const [media, ...params] = part.trim().toLowerCase().split(';');
    if (media !== 'text/markdown') return false;
    const q = params.find((p) => p.trim().startsWith('q='));
    return !q || parseFloat(q.slice(q.indexOf('=') + 1)) > 0;
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const readable = request.method === 'GET' || request.method === 'HEAD';

    // RFC 9727: the catalog is served as application/linkset+json and must
    // answer HEAD with the self-reference too (caches probe the well-known
    // URI with HEAD).
    if (readable && url.pathname === '/.well-known/api-catalog') {
      const res = await env.ASSETS.fetch(new Request(url));
      const headers = new Headers(res.headers);
      headers.set('Content-Type', 'application/linkset+json');
      headers.append('Link', '</.well-known/api-catalog>; rel="api-catalog"');
      return new Response(res.body, { status: res.status, headers });
    }

    // Markdown negotiation: map the URL to its build-time .md sibling
    // ('/' → '/index.md', '/self/' → '/self.md') and serve it when one was
    // emitted. A missing .md (non-content paths, excluded pages, anything
    // NOT_A_PAGE) falls through to the plain HTML asset.
    if (readable && !NOT_A_PAGE.test(url.pathname) && wantsMarkdown(request.headers.get('Accept'))) {
      const mdPath = url.pathname === '/' ? '/index.md' : url.pathname.replace(/\/+$/, '') + '.md';
      const mdUrl = new URL(mdPath, url);
      const md = await env.ASSETS.fetch(new Request(mdUrl));
      if (md.status === 200) {
        const buffer = await md.arrayBuffer();
        const headers = new Headers(md.headers);
        headers.set('Content-Type', 'text/markdown; charset=utf-8');
        headers.set('Vary', 'Accept');
        // Rough token estimate (≈4 bytes/token) so agents can budget context.
        headers.set('x-markdown-tokens', String(Math.ceil(buffer.byteLength / 4)));
        return new Response(request.method === 'HEAD' ? null : buffer, { status: 200, headers });
      }
    }

    // Default: assets routing (static files, _redirects, 404-page). HTML
    // pages get the discovery Link headers stamped on; the 404 and every
    // non-HTML response pass through untouched.
    const res = await env.ASSETS.fetch(request);
    if (res.status === 200 && res.headers.get('Content-Type')?.startsWith('text/html')) {
      const out = new Response(res.body, res);
      for (const link of LINKS) out.headers.append('Link', link);
      // HTML pages are content-negotiated too (the Accept: text/markdown
      // branch above picks a different representation for the same URL), so
      // RFC 9110 requires Vary here as well — same scope as the Link rule
      // (200 text/html only).
      const vary = out.headers.get('Vary');
      if (!vary?.toLowerCase().includes('accept')) {
        out.headers.set('Vary', vary ? `${vary}, Accept` : 'Accept');
      }
      return out;
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
