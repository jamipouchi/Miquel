import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { join } from 'node:path';
import { EXCLUDED_SLUGS } from '../lib/siteSlugs';
import { lastModified } from '../lib/lastModified';

/**
 * Static sitemap with per-page <lastmod>. Cloudflare AI Search (sitemap
 * crawl mode) compares lastmod between syncs and only re-fetches pages
 * that actually changed — unchanged pages are skipped.
 */
export const GET: APIRoute = async ({ site }) => {
  // Single origin source: `site` in astro.config.mjs (surfaced on the route
  // context). Same value CommonHead, RSS and the sitemap all derive from.
  if (!site) throw new Error('sitemap.xml: `site` must be set in astro.config.mjs');
  const BASE_URL = site.origin;

  const pages = (await getCollection('pages')).filter(
    (page) => !EXCLUDED_SLUGS.has(page.slug),
  );

  const entries = pages
    .map((page) => {
      const loc =
        page.slug === 'index' ? `${BASE_URL}/` : `${BASE_URL}/${page.slug}/`;
      const source = join('src/content/pages', page.id);
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastModified(source)}</lastmod>\n  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
