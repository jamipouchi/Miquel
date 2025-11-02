# AGENTS.MD

Guide for AI assistants working on this personal site.

## Philosophy

**Simplicity above all**: Write markdown, organize by folders, site structure emerges naturally.

**No configuration needed**: Folder structure IS the site structure. No frontmatter, no complex routing config, no CMS.

**Content-first**: Pages are just markdown files. The system automatically handles routing, navigation, TOC, and layout.

**Hierarchy matters**: Visual hierarchy reflects content hierarchy. HOME is special, branches organize topics, leaves contain actual content.

**No dark mode**: Deliberate choice. Professional, consistent, light theme only.

## Architecture Overview

### Core Principle: Three Routes, Infinite Pages

Only three route files handle the entire site:

1. `src/pages/index.astro` - Home page (special layout, no TOC)
2. `src/pages/[...slug].astro` - ALL content pages (unified layout)
3. `src/pages/404.astro` - Not found page

That's it. Everything else is markdown in `src/content/pages/`.

### How Routing Works

```
src/content/pages/
├── index.md              → / (home)
├── self/
│   ├── index.md          → /self/
│   └── addictions/
│       └── index.md      → /self/addictions/
└── humanity/
    ├── index.md          → /humanity/
    └── temporal/
        ├── index.md      → /humanity/temporal/
        └── worker-configuration/
            └── index.mdx → /humanity/temporal/worker-configuration/
```

**Critical**: All pages must be named `index.md` or `index.mdx`. The folder structure determines the URL.

### Why This Works

Astro's content collections (`getCollection('pages')`) automatically discovers all files in `src/content/pages/`. The slug is derived from the folder path. No configuration needed.

## File Structure

```
astro-site/
├── src/
│   ├── content/
│   │   ├── config.ts          # Content collections (no schema)
│   │   └── pages/             # ALL CONTENT GOES HERE
│   │       └── ...            # Folders = site structure
│   ├── components/
│   │   ├── CommonHead.astro   # <head> with meta, favicon, view transitions
│   │   ├── Footer.astro       # TreeNav + SubscribeForm + Comments
│   │   ├── TableOfContents.astro  # Auto-generated from h2/h3
│   │   ├── TreeNav.astro      # Smart navigation tree
│   │   ├── CommentList.astro  # Fetch/display nested comments
│   │   ├── CommentForm.astro  # Post comments with threading
│   │   ├── SubscribeForm.astro # Email subscriptions per path
│   │   └── Tooltip.astro      # Hover tooltips
│   ├── pages/
│   │   ├── index.astro        # Home page route
│   │   ├── [...slug].astro    # Catch-all content route
│   │   └── 404.astro          # Not found
│   └── styles/
│       └── global.css         # All global styles
├── public/
│   ├── _redirects            # Netlify redirects
│   └── favicon.svg
├── astro.config.mjs          # Minimal config (MDX integration)
└── package.json
```

## Components Deep Dive

### Footer.astro

The footer is where all page-level features live:
- **TreeNav**: Context-aware navigation (renders on all pages, including meta pages with special styling)
- **SubscribeForm**: Path-based email subscriptions
- **Comments**: CommentList + CommentForm (can be skipped via `skipComments` prop)

Props: `currentSlug`, `path`, `skipComments?`

### TreeNav.astro

**Smart navigation** that shows:
- HOME (always)
- Ancestors in current path
- Siblings of current page
- Children of current page

**Naming convention**:
- HOME: all caps
- Branch pages (with children): Capitalized
- Leaf pages (no children): lowercase with spaces (replaces hyphens)

**Special behavior for meta pages**:
- When on meta pages, TreeNav renders but only shows meta-related siblings (no cross-contamination with other top-level sections)
- Uses purple color scheme (#7c3aed) instead of the standard blue (#0066cc) to visually indicate the special meta section
- Helps isolate meta content from main site navigation while maintaining consistent navigation UX

### TableOfContents.astro

Fixed position sidebar (left side on large screens, hidden < 1450px).
- Auto-generated from h2 and h3 headings
- Highlights current section on scroll
- Smooth scroll on click
- Only renders if page has headings

### Comments System

**CommentList.astro**: Fetches from R2 bucket (`https://comments.miquelpuigturon.com{path}.json`)
- Nested/threaded comments
- GIF support (auto-detects image URLs)
- No loading state: starts with "No comments yet." to prevent layout shifts
- Smooth fade-in animation when comments load
- Graceful error handling with timeout detection

**CommentForm.astro**: Posts to API worker (`https://api.miquelpuigturon.com/comments`)
- Rich text with GIF paste support
- Reply threading (stores path array)
- Character limits (name: 50, message: 500)

### SubscribeForm.astro

Path-based subscriptions:
- Dropdown to select subscription level (root, current path, etc.)
- Posts to API worker (`/subscribe`)
- Email validation
- Smart defaults (2nd level path for deep pages)

## Styling Philosophy

### Global First

All base styles in `src/styles/global.css`:
- Reset + base typography
- `.prose` class for all content
- Consistent spacing, colors, fonts
- Responsive breakpoints

### Component Styles

Components use scoped `<style>` blocks. No CSS modules, no preprocessors.

### Design System

**Colors**:
- Primary: `#0066cc` (links, interactive)
- Hover: `#0052a3`
- Text: `#1a1a1a` (body), `#000` (headings)
- Background: `#fafafa`
- Borders: `#e0e0e0`

**Typography**:
- System fonts: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto...`
- Monospace: `'SF Mono', Monaco, 'Cascadia Code'...`
- Line height: 1.7 (body), tighter for headings

**Spacing**: Consistent use of `rem` units, generous whitespace.

## Key Conventions

### Naming

- **Folders**: lowercase-with-hyphens (becomes URL)
- **Files**: Always `index.md` or `index.mdx`
- **Components**: PascalCase.astro

### Slugs

The `slug` in Astro content collections:
- `'index'` = home page
- `'self'` = `/self/`
- `'self/addictions'` = `/self/addictions/`

No leading/trailing slashes in slugs.

### Paths

Routes/URLs always end with `/`:
- `path = '/' + page.slug` for content pages
- `path = '/'` for home
- Used for comments, subscriptions (exact match)

## Interactive Features

### View Transitions

Enabled via `<ClientRouter />` in CommonHead. Smooth page transitions without full reload.

Scripts need `astro:page-load` listener to reinitialize on navigation.

### Comments

Stored as JSON in R2 bucket, structured as nested arrays:
```json
{
  "comments": [
    {
      "name": "Alice",
      "message": "Great post!",
      "created_at": "2025-11-01T12:00:00Z",
      "comments": [ /* nested replies */ ]
    }
  ]
}
```

### Subscriptions

Stored in D1 database (see `api-worker/`). Supports path hierarchy:
- Subscribe to `/` = all updates
- Subscribe to `/humanity/` = humanity + all subpaths
- Subscribe to `/humanity/temporal/` = only temporal + subpaths

## Development Workflow

```bash
npm run dev      # Start dev server (localhost:4321)
```

## Special Pages

### Home (`/`)

- Custom layout in `src/pages/index.astro`
- No TOC, comments disabled
- Gradient h1, special card styling

### Meta pages (`/meta/*`)

- TreeNav renders with special purple styling to indicate the meta section
- Navigation is isolated: only shows meta siblings, not other top-level pages
- Otherwise treated like normal content pages

### 404

- Custom layout, centered design
- Gradient 404, humorous explanations

## API Integration

Backend API worker at `/api-worker/`:
- **POST /comments**: Create comment (with AI spam check)
- **POST /subscribe**: Create email subscription

Frontend calls these endpoints, no direct database access.

## Build Output

Static site generated to `dist/`:
- All content pages pre-rendered
- Deployed to Cloudflare Workers (static assets)
- No server-side rendering, pure static

## Key Principles for Agents

1. **Don't overcomplicate**: If you're adding config, you're probably doing it wrong
2. **Respect the hierarchy**: Folder structure drives everything
3. **Keep it unified**: All content pages should look/behave the same (except home)
4. **No dark mode**: Don't add theme switching, it's intentional
5. **Global styles**: Prefer extending `global.css` over component styles
6. **Avoid layout shifts**: Everything loads fast, avoid loading states that cause layout shifts
6. **Test the build**: `npm run build` must pass before deploying

## Summary

This is a **content-first static site** built with Astro. The core insight: folder structure = site structure. Everything else (routing, navigation, TOC, layout) is automatically derived from that structure. 

Write markdown, organize folders, deploy. That's it.

## Final Note

Whenever any of the behaviours specified changed, update this file. For example, if you make another special path, or another special <>.astro file, mention it here, explaining the reasoning.

Happy coding!
