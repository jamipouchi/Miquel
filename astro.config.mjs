import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { visit } from "unist-util-visit";
import markdownSiblings from "./integrations/markdown-siblings.mjs";
import staticPagesOnly from "./integrations/static-pages-only.mjs";

export default defineConfig({
  // Single origin source for canonical/OG/RSS/sitemap URLs (see AGENTS.md).
  site: "https://miquelpuigturon.com",

  // The site is fully static, but `output: "server"` is what makes the
  // Cloudflare adapter bundle our own Worker (cloudflare.config.ts →
  // src/worker/index.ts) instead of shipping assets only. Every route opts
  // into prerendering with `export const prerender = true`, and
  // static-pages-only fails the build if one forgets.
  output: "server",
  adapter: cloudflare({
    // Prerender in Node at build time: no workerd instance, so builds need
    // no remote bindings (Workers AI, R2) and no secrets.
    prerenderEnvironment: "node",
    // No image transforms (images are plain files in public/). Without this
    // the adapter would add a Cloudflare Images binding.
    imageService: "passthrough",
  }),
  // No Astro sessions. Without this the adapter would add (and auto-provision)
  // a SESSION KV namespace.
  session: false,

  // Astro ≤6 whitespace handling (lossless). Astro 7's default ('jsx') drops
  // the line break between text and an inline element — e.g. "at\n<code>…"
  // renders "at…" — which would fuse words across the existing pages and MDX.
  compressHTML: true,

  markdown: {
    // The remark/rehype pipeline (Astro 7's default is Sätteri). Kept so pages
    // render exactly as before and the rehype plugin below keeps working; .mdx
    // pages inherit this processor via @astrojs/mdx.
    processor: unified({
      rehypePlugins: [
        // External links open in a new tab.
        () => (tree) => {
          visit(tree, "element", (node) => {
            if (
              node.tagName === "a" &&
              node.properties?.href?.startsWith("http")
            ) {
              node.properties.target = "_blank";
              node.properties.rel = "noopener noreferrer";
            }
          });
        },
      ],
    }),
  },
  integrations: [mdx(), markdownSiblings(), staticPagesOnly()],
});
