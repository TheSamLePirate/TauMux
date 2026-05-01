import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const BASE = "/TauMux";

// Prefix root-relative markdown links (`[x](/concepts/foo/)`) with the
// configured base URL so they resolve correctly under `/TauMux/`. Astro
// only auto-prefixes link components, not raw markdown links. Locale-
// prefixed links (`/fr/concepts/foo/`) are handled the same way.
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
      // English at the root (`/`), French at `/fr/`. Keeping English at root
      // avoids moving every existing file under `en/` and preserves links
      // already published. New languages can be added by dropping another
      // `locales` entry and a sibling `src/content/docs/<code>/` tree.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        fr: { label: "Français", lang: "fr" },
      },
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
        SiteTitle: "./src/components/SiteTitle.astro",
        // Custom <head> injects the browser-language auto-redirect.
        // Lives in a Starlight head override so it runs before the page
        // commits to a locale and we avoid a flash of English content.
        Head: "./src/components/Head.astro",
      },
      expressiveCode: {
        themes: ["github-dark", "github-light"],
        styleOverrides: { borderRadius: "0.5rem" },
      },
      sidebar: [
        {
          label: "Getting Started",
          translations: { fr: "Premiers pas" },
          autogenerate: { directory: "getting-started" },
        },
        {
          label: "Concepts",
          translations: { fr: "Concepts" },
          autogenerate: { directory: "concepts" },
        },
        {
          label: "Features",
          translations: { fr: "Fonctionnalités" },
          autogenerate: { directory: "features" },
        },
        {
          label: "CLI Reference (ht)",
          translations: { fr: "Référence CLI (ht)" },
          autogenerate: { directory: "cli" },
        },
        {
          label: "JSON-RPC API",
          translations: { fr: "API JSON-RPC" },
          autogenerate: { directory: "api" },
        },
        {
          label: "Sideband Protocol",
          translations: { fr: "Protocole Sideband" },
          autogenerate: { directory: "sideband" },
        },
        {
          label: "Web Mirror",
          translations: { fr: "Miroir web" },
          autogenerate: { directory: "web-mirror" },
        },
        {
          label: "Integrations",
          translations: { fr: "Intégrations" },
          autogenerate: { directory: "integrations" },
        },
        {
          label: "Configuration",
          translations: { fr: "Configuration" },
          autogenerate: { directory: "configuration" },
        },
        {
          label: "Development",
          translations: { fr: "Développement" },
          autogenerate: { directory: "development" },
        },
        {
          label: "Changelog",
          translations: { fr: "Journal des modifications" },
          slug: "changelog",
        },
      ],
    }),
  ],
});
