// Re-export shim. The implementation moved to src/bun/web/ during the
// http-web-ui-refactor. Keeping this file means existing imports such as
// `import { WebServer } from "./web-server"` continue to work unchanged.
export { WebServer } from "./web/server";
