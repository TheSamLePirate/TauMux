/** Environment diagnostics helpers for `shareBin/show_env`. */

export interface PathEntryDiagnostic {
  path: string;
  index: number;
  duplicate: boolean;
  exists: boolean;
}

export interface EnvComparison {
  fileKeys: string[];
  envOnly: string[];
  fileOnly: string[];
  shared: string[];
}

const SECRET_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|API[_-]?KEY|ACCESS[_-]?KEY|AUTH|COOKIE|SESSION|CREDENTIAL|BEARER)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_RE.test(key);
}

export function redactValue(key: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (!isSecretKey(key)) return value;
  if (value.length === 0) return "(empty)";
  return `•••• redacted (${value.length} chars)`;
}

export async function pathDiagnostics(pathValue = process.env.PATH ?? ""): Promise<PathEntryDiagnostic[]> {
  const entries = pathValue.split(":").filter((entry) => entry.length > 0);
  const seen = new Map<string, number>();
  const out: PathEntryDiagnostic[] = [];
  for (let i = 0; i < entries.length; i++) {
    const path = entries[i] ?? "";
    const duplicate = seen.has(path);
    seen.set(path, (seen.get(path) ?? 0) + 1);
    out.push({ path, index: i, duplicate, exists: await existsDir(path) });
  }
  return out;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const idx = withoutExport.indexOf("=");
    if (idx <= 0) continue;
    const key = withoutExport.slice(0, idx).trim();
    const value = unquote(withoutExport.slice(idx + 1).trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

export function compareEnvFile(fileEnv: Record<string, string>, env: NodeJS.ProcessEnv = process.env): EnvComparison {
  const fileKeys = Object.keys(fileEnv).sort();
  const envKeys = Object.keys(env).sort();
  const envSet = new Set(envKeys);
  const fileSet = new Set(fileKeys);
  return {
    fileKeys,
    envOnly: envKeys.filter((key) => !fileSet.has(key)),
    fileOnly: fileKeys.filter((key) => !envSet.has(key)),
    shared: fileKeys.filter((key) => envSet.has(key)),
  };
}

export function selectedEnvRows(env: NodeJS.ProcessEnv = process.env, includeAll = false): { key: string; value: string }[] {
  const important = new Set([
    "SHELL",
    "TERM",
    "TERM_PROGRAM",
    "COLORTERM",
    "LANG",
    "LC_ALL",
    "USER",
    "HOME",
    "PWD",
    "PATH",
    "BUN_INSTALL",
    "NODE_ENV",
    "HT_CONFIG_DIR",
  ]);
  return Object.keys(env)
    .filter((key) => includeAll || important.has(key) || key.startsWith("HT_"))
    .sort()
    .map((key) => ({ key, value: redactValue(key, env[key]) }));
}

async function existsDir(path: string): Promise<boolean> {
  try {
    const stat = await Bun.file(path).stat();
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
