import type { APIRoute } from 'astro';
import { getCollection, render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import mdxRenderer from '@astrojs/mdx/server.js';
import { join } from 'node:path';
import { EXCLUDED_SLUGS } from '../lib/siteSlugs';
import { getTitleMap } from '../lib/siteTree';
import { lastModified } from '../lib/lastModified';

const FEED_TITLE = 'Miquel Puig Turon';
// One sentence, per the feed's job: whole pages, in tree order, on change.
const FEED_DESCRIPTION =
  'The whole site, root to leaf: every article lives on a path in a tree of thoughts, and new or changed pages arrive here in full.';

/**
 * Shared lastmod helper (src/lib/lastModified.ts): each file's last git
 * commit date, mtime fallback — identical to the sitemap's <lastmod> so
 * the feed and the sitemap always agree on "when a page changed".
 */

/** XML-escape any text (also used for whole HTML documents). */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

/**
 * Single-pass entity decode (amp handled in the same pass, so no
 * double-decode). Hardened per-match: out-of-range code points (e.g.
 * &#x110000;) are clamped into valid Unicode inside a try/catch instead of
 * throwing RangeError and breaking the build; unknown named entities are
 * left untouched.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (match, hex, dec, name) => {
    if (!hex && !dec) {
      return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    }
    try {
      const parsed = hex ? parseInt(hex, 16) : Number(dec);
      if (!Number.isFinite(parsed) || parsed < 0) return match;
      return String.fromCodePoint(Math.min(parsed, 0x10ffff));
    } catch {
      return match;
    }
  });
}

/** Plain-text excerpt: first ~200 chars of the rendered page, tags stripped. */
function excerptFrom(html: string, maxChars = 200): string {
  const text = decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Full-content RSS 2.0 feed for the entire site (same page set as the
 * sitemap: everything except EXCLUDED_SLUGS — meta pages are content too).
 * Item content is the fully rendered page HTML, entity-escaped inside
 * <content:encoded> (escaping instead of CDATA has no ]]> edge cases).
 * Items are ordered by lastmod descending, as feeds should be.
 */
export const GET: APIRoute = async ({ site }) => {
  // Single origin source: `site` in astro.config.mjs (surfaced on the route
  // context). Same value CommonHead and the sitemap derive from.
  if (!site) throw new Error('rss.xml: `site` must be set in astro.config.mjs');
  const BASE_URL = site.origin;

  const pages = (await getCollection('pages')).filter(
    (page) => !EXCLUDED_SLUGS.has(page.slug),
  );

  const titles = await getTitleMap();
  // The MDX renderer must be registered explicitly for the container to
  // render .mdx entries (plain .md entries render as Astro components).
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: mdxRenderer });

  const items = await Promise.all(
    pages.map(async (page) => {
      const slug = page.slug;
      const url = slug === 'index' ? `${BASE_URL}/` : `${BASE_URL}/${slug}/`;
      const title = titles.get(slug === 'index' ? '' : slug) ?? slug;
      const lastmod = lastModified(join('src/content/pages', page.id));
      const { Content } = await render(page);
      const html = await container.renderToString(Content);
      return {
        title,
        url,
        lastmod,
        description: excerptFrom(html),
        content: html,
      };
    }),
  );

  items.sort((a, b) => Date.parse(b.lastmod) - Date.parse(a.lastmod));
  const lastBuildDate = items.length
    ? new Date(items[0].lastmod).toUTCString()
    : new Date().toUTCString();

  const channel = [
    '    <title>' + escapeXml(FEED_TITLE) + '</title>',
    `    <link>${BASE_URL}/</link>`,
    '    <description>' + escapeXml(FEED_DESCRIPTION) + '</description>',
    '    <language>en</language>',
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${BASE_URL}/rss.xml" rel="self" type="application/rss+xml" />`,
  ].join('\n');

  const entries = items
    .map(
      (item) => `  <item>
    <title>${escapeXml(item.title)}</title>
    <link>${escapeXml(item.url)}</link>
    <guid isPermaLink="true">${escapeXml(item.url)}</guid>
    <pubDate>${new Date(item.lastmod).toUTCString()}</pubDate>
    <description>${escapeXml(item.description)}</description>
    <content:encoded>${escapeXml(item.content)}</content:encoded>
  </item>`,
    )
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    channel,
    entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
