// @tau-mux/sdk — typed access to every τ-mux control surface from an
// extension app. Two entry points keep the browser bundle free of node deps:
//
//   import { createBackendSdk } from "@tau-mux/sdk/backend";   // Bun backend
//   import { createFrontendSdk } from "@tau-mux/sdk/frontend"; // Vite frontend
//
// This root module re-exports only the shared wire types/constants (safe in
// both environments).

export * from "./protocol";
export type { BackendSdk } from "./backend";
export type { FrontendSdk } from "./frontend";
