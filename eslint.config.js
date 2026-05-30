import tseslint from "typescript-eslint";

// Flat ESLint config. Lints the project's own authored TypeScript only.
//
// Why the explicit ignores + tsconfigRootDir: without them `eslint .`
// crawled `.claude/worktrees/` (full repo checkouts, each with their own
// tsconfig.json + node_modules) and generated bundles, which both (a)
// produced ~22k bogus "problems" and (b) gave the typescript-eslint parser
// MULTIPLE candidate tsconfig roots → a fatal "No tsconfigRootDir was set"
// parse error on every file. Pinning the root + ignoring non-source trees
// makes `eslint .` fast and meaningful.
export default [
  {
    // Global ignores (a config block with ONLY `ignores` applies repo-wide).
    ignores: [
      "node_modules/",
      "build/",
      "dist/",
      "coverage/",
      "test-results/",
      ".design-artifacts/",
      // Git worktrees — full checkouts with their own tsconfig/node_modules.
      ".claude/",
      // Generated / vendored bundles served to the web mirror + packaged app.
      "assets/",
      "vendor/",
      // Self-contained sub-projects with their own toolchains.
      "website-doc/",
      "shareBin/",
      ".sandcastle/",
      // Type declaration files are generated/ambient.
      "**/*.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Pin the root so the parser never has to guess among multiple
        // candidate tsconfigs (the worktree ones are ignored above, but
        // this is belt-and-suspenders and silences the "multiple candidate
        // TSConfigRootDir" fatal).
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
