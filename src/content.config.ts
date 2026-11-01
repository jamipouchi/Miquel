import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Every page is a folder with an index.md / index.mdx under src/content/pages.
 * No schema: no frontmatter by design — a page's title is its first h1.
 *
 * Entry ids are the folder path, slugified per segment (lowercase, punctuation
 * stripped), with the root page as 'index': 'humanity/temporal/oom-investigation'.
 * `entry.filePath` is the source path relative to the project root.
 */
const pages = defineCollection({
  loader: glob({ pattern: '**/index.{md,mdx}', base: './src/content/pages' }),
});

export const collections = { pages };
