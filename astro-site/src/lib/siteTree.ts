/**
 * siteTree — single source of truth for the site's page hierarchy.
 *
 * Built once per build from `getCollection('pages')`. Folder structure IS the
 * tree: each index.md/index.mdx is one node, the top-level index is the home
 * node (slug '', path '/'). Titles come from each page's first h1, the same
 * rule src/pages/[...slug].astro uses at render time.
 *
 * Note: parent/children are real object references (the graph is cyclic), so
 * never JSON.stringify a SiteNode. Everything here is read-only by convention.
 */
import { getCollection, render } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import type { MarkdownHeading } from 'astro';

export interface SiteNode {
  /** Content slug. '' for the home page (collection slug 'index'). */
  slug: string;
  /** URL path: '/' for home, otherwise '/' + slug (no trailing slash). */
  path: string;
  /** First h1 of the page, markdown formatting stripped. */
  title: string;
  /** 0 for home, 1 for top-level sections, etc. */
  depth: number;
  /** First slug segment ('humanity', 'self', 'meta', ...); null for home. */
  section: string | null;
  parent: SiteNode | null;
  /** Direct children, alphabetical by slug (folder convention). */
  children: SiteNode[];
}

export interface Crumb {
  path: string;
  title: string;
}

type PageEntry = CollectionEntry<'pages'>;

interface TreeData {
  root: SiteNode;
  bySlug: Map<string, SiteNode>;
}

// Static build: the collection never changes mid-process, so build the tree
// once and share a single promise between all consumers/routes.
let cache: Promise<TreeData> | null = null;

/** Accepts slugs ('humanity/temporal'), paths ('/humanity/temporal/'), 'index' and ''. */
function normalizeSlug(raw: string): string {
  if (raw === 'index') return '';
  return raw.replace(/^\/+|\/+$/g, '');
}

function pathFor(slug: string): string {
  return slug === '' ? '/' : `/${slug}`;
}

/** Removes inline markdown (emphasis, code, links, html) from h1 text. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) -> label
    .replace(/`([^`]*)`/g, '$1') // `code` -> code
    .replace(/<[^>]+>/g, '') // <span> -> ''
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // **bold** -> bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // _em_ -> em
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fallback title when a page has no h1: last slug segment, capitalized. */
function prettifySlug(slug: string): string {
  if (slug === '') return 'Home';
  const last = slug.split('/').pop() ?? slug;
  const spaced = last.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

async function titleFor(entry: PageEntry, slug: string): Promise<string> {
  try {
    const { headings } = (await render(entry)) as {
      headings: MarkdownHeading[];
    };
    const h1 = headings.find((h) => h.depth === 1);
    if (h1?.text) return stripInlineMarkdown(h1.text);
  } catch {
    // Unrenderable page: fall through to the slug-derived title.
  }
  return prettifySlug(slug);
}

async function buildTree(): Promise<TreeData> {
  const entries = await getCollection('pages');
  const homeEntry = entries.find((entry) => entry.slug === 'index');
  if (!homeEntry) throw new Error("siteTree: no index page in 'pages' collection");

  // First pass: titles (parallel) and bare nodes keyed by canonical slug.
  const titles = await Promise.all(
    entries.map(async (entry) => {
      const slug = entry.slug === 'index' ? '' : entry.slug;
      return [slug, await titleFor(entry, slug)] as const;
    }),
  );
  const titleBySlug = new Map(titles);

  const bySlug = new Map<string, SiteNode>();
  for (const [slug, title] of titleBySlug) {
    const section = slug === '' ? null : slug.split('/')[0];
    bySlug.set(slug, {
      slug,
      path: pathFor(slug),
      title,
      depth: 0,
      section,
      parent: null,
      children: [],
    });
  }

  // Second pass: link children to parents. Alphabetical by slug, matching the
  // existing folder convention (plain sort, same as TreeNav).
  for (const node of bySlug.values()) {
    if (node.slug === '') continue;
    // Walk up until an existing ancestor is found; content folders always
    // have an index page, but a missing branch page shouldn't orphan a child.
    let parentSlug = node.slug.slice(0, node.slug.lastIndexOf('/')) || '';
    while (parentSlug !== '' && !bySlug.has(parentSlug)) {
      parentSlug = parentSlug.slice(0, parentSlug.lastIndexOf('/')) || '';
    }
    const parent = bySlug.get(parentSlug) ?? bySlug.get('')!;
    node.parent = parent;
    parent.children.push(node);
  }

  const root = bySlug.get('')!;

  const sortRec = (node: SiteNode, depth: number): void => {
    node.depth = depth;
    node.children.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    for (const child of node.children) sortRec(child, depth + 1);
  };
  sortRec(root, 0);

  return { root, bySlug };
}

function loadData(): Promise<TreeData> {
  if (!cache) cache = buildTree();
  return cache;
}

async function nodeFor(slug: string): Promise<SiteNode | undefined> {
  return (await loadData()).bySlug.get(normalizeSlug(slug));
}

/** The home node — root of the whole tree. */
export async function getSiteTree(): Promise<SiteNode> {
  return (await loadData()).root;
}

/** Direct children in tree order; [] for unknown slugs and leaves. */
export async function getChildren(slug: string): Promise<SiteNode[]> {
  return (await nodeFor(slug))?.children ?? [];
}

/** slug -> title for every page ('' -> home title). */
export async function getTitleMap(): Promise<Map<string, string>> {
  const data = await loadData();
  return new Map([...data.bySlug.values()].map((n) => [n.slug, n.title]));
}

/**
 * Short display title for tight spots: some deep-dive h1s embed their own
 * chain ("Worker configuration (Node) > Deep dive"), which only makes sense
 * with the parent crumbs next to it. When a title embeds a chain, keep the
 * leaf segment after the last " > "; otherwise return the title unchanged.
 * Used for the last breadcrumb crumb. h1, <title>, JSON-LD and tree nav keep
 * the full title.
 */
export function getShortTitle(title: string): string {
  const at = title.lastIndexOf(' > ');
  return at === -1 ? title : title.slice(at + 3).trim();
}

/**
 * Breadcrumb for a path, root-first, home excluded (callers prepend it if
 * wanted): '/humanity/temporal' -> [{path:'/humanity',...},{path:'/humanity/temporal',...}].
 * Accepts slugs and trailing slashes; [] for home or unknown paths.
 */
export async function getBreadcrumb(path: string): Promise<Crumb[]> {
  const node = await nodeFor(path);
  const crumbs: Crumb[] = [];
  for (let n = node ?? null; n?.parent; n = n.parent) {
    crumbs.unshift({ path: n.path, title: n.title });
  }
  return crumbs;
}
