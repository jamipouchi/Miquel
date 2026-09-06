#!/usr/bin/env node
/**
 * Emits sibling .md files into dist/ so the edge Worker (src/worker.ts) can
 * serve text/markdown versions of every page.
 *
 * Walks src/content/pages/**: each folder with an index.md/index.mdx maps to
 * its folder path as the slug (the root index.md → dist/index.md). Slugs are
 * run through Astro's own slugification (github-slugger per path segment) so
 * the .md paths always match the HTML routes Astro builds, whatever the
 * source folder casing. Plain .md pages are copied verbatim; .mdx pages get
 * a light text transform — imports stripped, <Tooltip> unwrapped to its
 * inner text, <AgentTools /> dropped — enough to read as markdown, while the
 * MDX source stays canonical for the HTML render.
 *
 * Excluded slugs are parsed out of EXCLUDED_SLUGS in src/lib/siteSlugs.ts
 * (a .ts file plain Node cannot import, so we read the one literal from it —
 * and fail loudly if its shape ever changes, or if it parses to nothing) so
 * the two can never drift. As a final gate, every emitted HTML page must
 * have a sibling .md — compared case-sensitively against the .md files
 * actually present in dist (existsSync is case-insensitive on macOS, so it
 * would happily bless a wrong-cased sibling markdown negotiation can't see).
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGES = join(ROOT, 'src/content/pages');
const DIST = join(ROOT, 'dist');

const slugsSource = readFileSync(join(ROOT, 'src/lib/siteSlugs.ts'), 'utf8');
const setLiteral = slugsSource.match(/new Set\(\[([\s\S]*?)\]\)/);
if (!setLiteral) throw new Error('Could not parse EXCLUDED_SLUGS from src/lib/siteSlugs.ts');
const EXCLUDED_SLUGS = [...setLiteral[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (EXCLUDED_SLUGS.length === 0) {
  throw new Error(
    'emit-markdown: EXCLUDED_SLUGS in src/lib/siteSlugs.ts parsed to an empty list — ' +
      'the Set literal changed shape or lost its entries. Refusing to emit markdown ' +
      'with no exclusions (chat-transcript et al. would leak into dist/*.md).'
  );
}

// Astro builds each content-route slug by pushing every path segment through
// github-slugger's slug() (getContentEntryIdAndSlug in astro/dist/content/
// utils.js): lowercase, ASCII punctuation stripped ('-' and '_' kept),
// spaces → '-'. Mirror that transform explicitly so emitted .md paths match
// Astro's HTML routes regardless of source-folder casing — e.g.
// OOM-investigation/ must emit oom-investigation.md, or markdown negotiation
// (which looks up the lowercase route) would 404 the file.
const ASCII_PUNCTUATION = /[\0-\x1F!-,./:-@\[-^`{-~]/gu; // github-slugger's ASCII set
function astroSlugSegment(segment) {
  return segment.toLowerCase().replace(ASCII_PUNCTUATION, '').replace(/ /g, '-');
}
function astroSlug(pathWithoutExt) {
  return pathWithoutExt.split('\\').join('/').split('/').map(astroSlugSegment).join('/');
}

function transformMdx(source) {
  return (
    source
      .replace(/^import\s.*$/gm, '') // MDX-only import lines
      // Opening tag only, respecting quoted attribute values (a naive
      // <Tooltip[^>]*> stops at the '>' inside text="… a > b …" and leaves
      // garbage like `tasksDispatchRate">` in the output). Each match
      // consumes its own closing tag; the inner text is kept.
      .replace(/<Tooltip(?:\s+(?:"[^"]*"|'[^']*'|[^>"'])+)?>([\s\S]*?)<\/Tooltip>/g, '$1')
      .replace(/<AgentTools[^>]*\/>/g, '') // browser-only interactive component
      .replace(/^\s+/, '') // collapse blank lines left by stripped imports
  );
}

function collectPages(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectPages(full));
    else if (entry.name === 'index.md' || entry.name === 'index.mdx') found.push(full);
  }
  return found;
}

function collectHtmlPages(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectHtmlPages(full));
    else if (entry.name === 'index.html') found.push(dirname(full));
  }
  return found;
}

const emitted = [];
const transformed = [];
for (const file of collectPages(PAGES)) {
  const slug = astroSlug(relative(PAGES, dirname(file))); // '' = home
  if (EXCLUDED_SLUGS.includes(slug)) continue;
  let content = readFileSync(file, 'utf8');
  if (file.endsWith('.mdx')) {
    transformed.push({ slug, file });
    content = transformMdx(content);
  }
  const target = slug === '' ? join(DIST, 'index.md') : join(DIST, `${slug}.md`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  emitted.push(slug === '' ? '(home)' : slug);
}

// Parity gate — case-sensitive. dist is Astro's own output, so the built
// index.html paths are the ground truth for route casing: derive the
// expected .md sibling from each of them and compare exact names against
// the .md files actually on disk (readdirSync never lies about case;
// existsSync would, on a case-insensitive macOS/Windows checkout).
const mdOnDisk = new Set();
(function walkMd(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMd(full);
    else if (entry.name.endsWith('.md')) {
      mdOnDisk.add(relative(DIST, full).split('\\').join('/'));
    }
  }
})(DIST);

const missing = [];
const expected = new Set();
for (const dir of collectHtmlPages(DIST)) {
  const slug = relative(DIST, dir).split('\\').join('/');
  if (EXCLUDED_SLUGS.includes(slug)) continue;
  const mdRel = slug === '' ? 'index.md' : `${slug}.md`;
  expected.add(mdRel);
  if (!mdOnDisk.has(mdRel)) missing.push(slug || '(home)');
}
// The inverse check catches the casing failure mode itself: a .md whose
// name doesn't exactly match any route (OOM-investigation.md vs the
// oom-investigation route) can never be served — or is stale output.
const stray = [...mdOnDisk].filter((rel) => !expected.has(rel));
if (missing.length > 0) {
  console.error(`emit-markdown: pages without a sibling .md: ${missing.join(', ')}`);
  process.exit(1);
}
if (stray.length > 0) {
  console.error(
    `emit-markdown: .md files in dist with no matching route (wrong casing or stale?): ${stray.join(', ')}`
  );
  process.exit(1);
}

console.log(`emit-markdown: ${emitted.length} pages → dist/*.md (excluded: ${EXCLUDED_SLUGS.join(', ') || 'none'})`);
if (transformed.length > 0) console.log(`emit-markdown: MDX transformed: ${transformed.map((t) => t.slug).join(', ')}`);

// Short before/after sample of the first MDX transform, for build logs.
if (transformed.length > 0) {
  const sample = transformed[0];
  const before = readFileSync(sample.file, 'utf8').split('\n');
  const after = readFileSync(join(DIST, `${sample.slug}.md`), 'utf8').split('\n');
  const diff = [];
  for (let i = 0; i < before.length && diff.length < 6; i++) {
    if (before[i] !== after[i]) diff.push(`  - ${before[i].trim()}\n  + ${after[i].trim()}`);
  }
  console.log(`emit-markdown: sample transform (${sample.slug}):\n${diff.slice(0, 3).join('\n')}`);
}
