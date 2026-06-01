import { describe, expect, test } from "bun:test";
import { parseLogLine, detectLogLevel } from "../shareBin/lib/logs";
import { profileCsv } from "../shareBin/lib/csv-profile";
import { parseHttpResponse, detectBodyMode } from "../shareBin/lib/http";
import { parseLsofListeningPorts, parseSsListeningPorts } from "../shareBin/lib/ports";
import { buildProcessTreeRows, parsePsProcesses } from "../shareBin/lib/processes";
import { compareEnvFile, parseEnvFile, redactValue } from "../shareBin/lib/env-diagnostics";
import { extractOpenApiSummary } from "../shareBin/lib/openapi";

describe("shareBin helper modules", () => {
  test("detects plain and JSON log levels", () => {
    expect(detectLogLevel("2026-01-01 WARN cache miss")).toBe("warn");
    const parsed = parseLogLine('{"level":50,"time":"now","msg":"boom"}', {
      json: true,
      index: 7,
    });
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("boom");
    expect(parsed.index).toBe(7);
  });

  test("profiles CSV columns", () => {
    const profile = profileCsv(
      [
        ["name", "age", "active"],
        ["Ada", "36", "true"],
        ["Bob", "", "false"],
        ["Cy", "41", "true"],
      ],
      { hasHeader: true },
    );
    expect(profile.rowCount).toBe(3);
    expect(profile.columns[1]?.kind).toBe("integer");
    expect(profile.columns[1]?.empty).toBe(1);
    expect(profile.columns[2]?.kind).toBe("boolean");
  });

  test("parses curl-style HTTP responses", () => {
    const response = parseHttpResponse(
      "HTTP/1.1 301 Moved\r\nlocation: /next\r\n\r\nHTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"ok\":true}",
    );
    expect(response.history).toHaveLength(2);
    expect(response.final?.statusCode).toBe(200);
    expect(detectBodyMode(response)).toBe("json");
  });

  test("parses lsof and ss listening ports", () => {
    const lsof = parseLsofListeningPorts(
      "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 123 oliv 18u IPv6 0t0 TCP *:3000 (LISTEN)\n",
    );
    expect(lsof[0]?.port).toBe(3000);
    expect(lsof[0]?.command).toBe("node");

    const ss = parseSsListeningPorts(
      'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\nLISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("bun",pid=456,fd=12))\n',
    );
    expect(ss[0]?.port).toBe(5173);
    expect(ss[0]?.pid).toBe(456);
  });

  test("builds process rows", () => {
    const processes = parsePsProcesses(
      "  1  0 0.0 1024 launchd /sbin/launchd\n 10  1 3.5 2048 bun bun run dev\n",
    );
    const rows = buildProcessTreeRows(processes);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.depth).toBe(1);
    expect(rows[1]?.comm).toBe("bun");
  });

  test("redacts env secrets and compares .env files", () => {
    const parsed = parseEnvFile("API_TOKEN=secret\nPLAIN=hello\n");
    expect(redactValue("API_TOKEN", parsed.API_TOKEN)).toContain("redacted");
    const cmp = compareEnvFile(parsed, { PLAIN: "hello", EXTRA: "x" });
    expect(cmp.fileOnly).toEqual(["API_TOKEN"]);
    expect(cmp.shared).toEqual(["PLAIN"]);
  });

  test("extracts OpenAPI endpoints", () => {
    const summary = extractOpenApiSummary({
      openapi: "3.0.0",
      info: { title: "Demo", version: "1" },
      paths: {
        "/ping": {
          get: {
            tags: ["health"],
            summary: "Ping",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });
    expect(summary.title).toBe("Demo");
    expect(summary.endpoints[0]?.id).toBe("GET /ping");
    expect(summary.tags).toEqual(["health"]);
  });
});
