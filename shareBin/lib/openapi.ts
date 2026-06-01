/** OpenAPI/Swagger extraction helpers for `shareBin/show_openapi`. */

export interface OpenApiEndpoint {
  id: string;
  method: string;
  path: string;
  tags: string[];
  summary: string;
  description: string;
  parameters: number;
  requestBody: boolean;
  responses: string[];
}

export interface OpenApiSummary {
  title: string;
  version: string;
  description: string;
  endpointCount: number;
  tags: string[];
  endpoints: OpenApiEndpoint[];
}

const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

export function extractOpenApiSummary(value: unknown): OpenApiSummary {
  const root = asRecord(value);
  const info = asRecord(root.info);
  const paths = asRecord(root.paths);
  const endpoints: OpenApiEndpoint[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    const pathObj = asRecord(pathItem);
    const sharedParams = Array.isArray(pathObj.parameters) ? pathObj.parameters.length : 0;
    for (const [method, operation] of Object.entries(pathObj)) {
      const lower = method.toLowerCase();
      if (!METHODS.has(lower)) continue;
      const op = asRecord(operation);
      const tags = Array.isArray(op.tags) ? op.tags.map(String) : ["untagged"];
      const params = sharedParams + (Array.isArray(op.parameters) ? op.parameters.length : 0);
      const responses = Object.keys(asRecord(op.responses));
      endpoints.push({
        id: `${lower.toUpperCase()} ${path}`,
        method: lower.toUpperCase(),
        path,
        tags,
        summary: stringValue(op.summary),
        description: stringValue(op.description),
        parameters: params,
        requestBody: Boolean(op.requestBody),
        responses,
      });
    }
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const tagSet = new Set<string>();
  for (const endpoint of endpoints) for (const tag of endpoint.tags) tagSet.add(tag);

  return {
    title: stringValue(info.title) || "OpenAPI document",
    version: stringValue(info.version) || stringValue(root.openapi) || stringValue(root.swagger) || "unknown",
    description: stringValue(info.description),
    endpointCount: endpoints.length,
    tags: [...tagSet].sort(),
    endpoints,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
