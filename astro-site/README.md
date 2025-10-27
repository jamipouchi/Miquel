# Personal Site

A hierarchical personal site built with Astro. The folder structure automatically defines the site structure — no frontmatter or manual routing required.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## Deploying to Cloudflare Workers

This site deploys to **Cloudflare Workers** with **Workers Assets**.

### First Time Setup

```bash
# Install dependencies (includes Wrangler)
npm install

# Login to Cloudflare
npx wrangler login
```

### Deploy

```bash
# Build and deploy in one command
npm run deploy
```

This will:
1. Build your static site to `dist/`
2. Deploy it to Cloudflare Workers
3. Give you a live URL at `https://personal-site.<your-subdomain>.workers.dev`

### Configuration

The `wrangler.jsonc` file configures the deployment:
- **name**: Your worker name (appears in URL)
- **assets.directory**: Points to `./dist` where Astro builds static files
- **compatibility_date**: Cloudflare Workers compatibility date

## How It Works

### Page Types

1. **Home** (`index.astro`) - Special page with gradient title and section cards
2. **Meta** (`meta.astro`) - Static documentation page about the site
3. **Content pages** (`[...slug].astro`) - All other pages with tree navigation

### Adding Content

Create a new Markdown file in `src/content/pages/`:

```bash
# Add a new top-level section (with index)
src/content/pages/projects/index.md

# Add a page under an existing section
src/content/pages/work/consulting.md

# Add nested content (every folder needs index.md)
src/content/pages/work/projects/index.md
src/content/pages/work/projects/my-project.md
```

**Important**: Every folder must have an `index.md` file.

The site will automatically:
- Create routes for all pages
- Show tree navigation for context
- Render markdown with consistent styling

### Design Principles

- **No frontmatter required** - Just write markdown
- **Folder structure = site structure** - No manual configuration
- **Tree navigation** - Always shows local context (ancestors, siblings, children)
- **Minimalist** - Clean typography, focused on content

## Project Structure

```
personal-site/
├── src/
│   ├── components/       # TreeNav component
│   ├── content/pages/    # All your markdown content
│   └── pages/            # Route handlers (index, meta, [...slug])
└── public/               # Static assets (CSS, favicon)
```

