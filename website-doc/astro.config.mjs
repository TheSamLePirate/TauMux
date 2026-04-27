import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
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
