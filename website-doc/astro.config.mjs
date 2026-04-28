import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const BASE = "/TauMux";

// Prefix root-relative markdown links (`[x](/concepts/foo/)`) with the
// configured base URL so they resolve correctly under `/TauMux/`. Astro
// only auto-prefixes link components, not raw markdown links.
function remarkPrefixBase() {
  return (tree) => {
    const visit = (node) => {
      if (
        node.type === "link" &&
        typeof node.url === "string" &&
        node.url.startsWith("/") &&
        !node.url.startsWith("//") &&
        !node.url.startsWith(`${BASE}/`)
      ) {
        node.url = BASE + node.url;
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

export default defineConfig({
  // GitHub Pages: served from https://thesamlepirate.github.io/TauMux/.
  site: "https://thesamlepirate.github.io",
  base: BASE,
  markdown: {
    remarkPlugins: [remarkPrefixBase],
  },
  integrations: [
    starlight({
      title: "τ-mux",
      description:
        "A hybrid terminal emulator with floating canvas overlays, live process metadata, and a scriptable CLI. Built on Electrobun + Bun.",
      logo: { src: "./public/favicon.svg", alt: "τ-mux", replacesTitle: false },
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/TheSamLePirate/TauMux",
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/TheSamLePirate/TauMux/edit/main/website-doc/",
      },
      lastUpdated: true,
      pagefind: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
      customCss: ["./src/styles/theme.css"],
      components: {
        // Adds a "v<root-package-version>" pill next to the site title
        // so docs visitors can see exactly which τ-mux release the
        // currently-deployed docs were built from.
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      expressiveCode: {
        themes: ["github-dark", "github-light"],
        styleOverrides: { borderRadius: "0.5rem" },
      },
      sidebar: [
        {
          label: "Getting Started",
          autogenerate: { directory: "getting-started" },
        },
        {
          label: "Concepts",
          autogenerate: { directory: "concepts" },
        },
        {
          label: "Features",
          autogenerate: { directory: "features" },
        },
        {
          label: "CLI Reference (ht)",
          autogenerate: { directory: "cli" },
        },
        {
          label: "JSON-RPC API",
          autogenerate: { directory: "api" },
        },
        {
          label: "Sideband Protocol",
          autogenerate: { directory: "sideband" },
        },
        {
          label: "Web Mirror",
          autogenerate: { directory: "web-mirror" },
        },
        {
          label: "Integrations",
          autogenerate: { directory: "integrations" },
        },
        {
          label: "Configuration",
          autogenerate: { directory: "configuration" },
        },
        {
          label: "Development",
          autogenerate: { directory: "development" },
        },
        { label: "Changelog", slug: "changelog" },
      ],
    }),
  ],
});
