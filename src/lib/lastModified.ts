import { statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Shared "when did this page last change" helper, consumed by both
 * src/pages/rss.xml.ts and src/pages/sitemap.xml.ts so the feed and the
 * sitemap always agree on lastmod.
 *
 * lastmod from the file's last git commit date. Git does not preserve
 * mtimes, so a fresh clone would otherwise mark every page as modified on
 * every build. Falls back to mtime when git is unavailable.
 *
 * Moves don't count as changes: `--follow` tracks the file across renames
 * and `--diff-filter=AM` skips commits that only renamed it, so a pure
 * restructure (like the 2026 move out of astro-site/) doesn't mark every
 * page as updated in the sitemap and the RSS feed.
 *
 * @param relative Path relative to the project root — a content entry's
 *   `filePath`, e.g. 'src/content/pages/humanity/index.md'.
 */
export function lastModified(relative: string): string {
  try {
    const committed = execSync(`git log -1 --follow --diff-filter=AM --format=%cI -- ${JSON.stringify(relative)}`, {
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
