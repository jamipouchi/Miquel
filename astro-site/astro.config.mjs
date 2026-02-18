import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { visit } from "unist-util-visit";

export default defineConfig({
  markdown: {
    rehypePlugins: [
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
  },
  integrations: [mdx()],
  output: "static",
});
