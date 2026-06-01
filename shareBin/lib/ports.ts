/** Listening-port parsers for `shareBin/show_ports`. */

export interface PortRecord {
  key: string;
  proto: string;
  address: string;
  port: number;
  pid: number | null;
  command: string;
  rawName: string;
  source: "lsof" | "ss";
}

export function portKey(record: Omit<PortRecord, "key">): string {
  return `${record.proto}:${record.address}:${record.port}:${record.pid ?? "?"}:${record.command}`;
}

export function parseLsofListeningPorts(text: string): PortRecord[] {
  const out: PortRecord[] = [];
  const lines = text.trim().split("\n");
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const protoIdx = parts.findIndex((part) => part === "TCP" || part === "UDP");
    if (protoIdx === -1) continue;
    const rawName = parts.slice(protoIdx + 1).join(" ");
    if (!/\(LISTEN\)/.test(rawName) && parts[protoIdx] === "TCP") continue;
    const endpoint = extractEndpoint(rawName);
    if (!endpoint) continue;
    const record = {
      proto: parts[protoIdx] ?? "TCP",
      address: endpoint.address,
      port: endpoint.port,
      pid: parseInteger(parts[1] ?? ""),
      command: parts[0] ?? "",
      rawName,
      source: "lsof" as const,
    };
    out.push({ ...record, key: portKey(record) });
  }
  return sortPorts(out);
}

export function parseSsListeningPorts(text: string): PortRecord[] {
  const out: PortRecord[] = [];
  const lines = text.trim().split("\n");
  for (const line of lines) {
    if (!/^LISTEN\b/i.test(line.trim())) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[3] ?? parts[4] ?? "";
    const endpoint = extractEndpoint(local);
    if (!endpoint) continue;
    const users = line.match(/users:\(\("([^"]+)".*?pid=(\d+)/);
    const record = {
      proto: "TCP",
      address: endpoint.address,
      port: endpoint.port,
      pid: users ? parseInteger(users[2] ?? "") : null,
      command: users?.[1] ?? "",
      rawName: local,
      source: "ss" as const,
    };
    out.push({ ...record, key: portKey(record) });
  }
  return sortPorts(out);
}

export function extractEndpoint(input: string): { address: string; port: number } | null {
  const cleaned = input.replace(/\s*\(LISTEN\).*$/, "").trim();
  if (cleaned.length === 0) return null;
  const bracket = cleaned.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracket) return { address: bracket[1] ?? "", port: Number(bracket[2]) };
  const idx = cleaned.lastIndexOf(":");
  if (idx === -1) return null;
  const address = cleaned.slice(0, idx) || "*";
  const portText = cleaned.slice(idx + 1);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0) return null;
  return { address, port };
}

export function sortPorts(records: readonly PortRecord[]): PortRecord[] {
  return [...records].sort((a, b) => a.port - b.port || a.address.localeCompare(b.address) || a.command.localeCompare(b.command));
}

function parseInteger(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}
