import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { EXCLUDED_SLUGS } from '../lib/siteSlugs';

const BASE_URL = 'https://miquelpuigturon.com';

/**
 * lastmod from the file's last git commit date. Git does not preserve
 * mtimes, so a fresh clone would otherwise mark every page as modified on
 * every build. Falls back to mtime when git is unavailable.
 */
function lastModified(relative: string): string {
  try {
    const committed = execSync(`git log -1 --format=%cI -- ${JSON.stringify(relative)}`, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (committed) return committed;
  } catch {
    // no git history (CI shallow clone, detached file) — fall through
  }
  return statSync(join(process.cwd(), relative)).mtime.toISOString();
}

/**
 * Static sitemap with per-page <lastmod>. Cloudflare AI Search (sitemap
 * crawl mode) compares lastmod between syncs and only re-fetches pages
 * that actually changed — unchanged pages are skipped.
 */
export const GET: APIRoute = async () => {
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
