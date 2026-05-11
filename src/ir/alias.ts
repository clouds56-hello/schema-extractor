// String alias detection: pick the most specific format that ALL observed strings match.

export interface AliasDef {
  name: string
  predicate: (s: string) => boolean
  /** If set, at least one sample across the merged set must satisfy this in addition to `predicate`. */
  evidence?: (s: string) => boolean
}

export function isPathLike(key: string): boolean {
  if (!key) return false
  if (key.includes("/") || key.includes("\\")) return true
  if (key.startsWith("~")) return true
  return false
}

export function isPathLikeValue(s: string): boolean {
  if (!s) return false
  if (s.startsWith("~/") || s.startsWith("./") || s.startsWith("../")) return true
  if (s.includes("/") || s.includes("\\")) return true
  return false
}

// Order matters: most specific first. Render precedence follows this list.
export const ALIASES: AliasDef[] = [
  { name: "VscodeCallId", predicate: (s) => /^call_[A-Za-z0-9]+__vscode-\d+$/.test(s) },
  { name: "Uuid", predicate: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) },
  { name: "Sha256", predicate: (s) => /^[0-9a-f]{64}$/i.test(s) },
  { name: "Sha1", predicate: (s) => /^[0-9a-f]{40}$/i.test(s) },
  { name: "Semver", predicate: (s) => /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.\-]+)?(\+[0-9A-Za-z.\-]+)?$/.test(s) },
  { name: "Email", predicate: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) },
  {
    name: "IsoDate",
    predicate: (s) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s),
  },
  { name: "Url", predicate: (s) => /^[a-z][a-z0-9+.\-]*:\/\//i.test(s) },
  { name: "Path", predicate: isPathLikeValue },
  { name: "Hex", predicate: (s) => s.length >= 8 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s) },
  {
    name: "Base64",
    predicate: (s) => s.length >= 24 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+=*$/.test(s),
    evidence: (s) => s.endsWith("="),
  },
]

export function buildAliasMaps(s: string): { only: Map<string, boolean>; ev: Map<string, boolean> } {
  const only = new Map<string, boolean>()
  const ev = new Map<string, boolean>()
  for (const a of ALIASES) {
    only.set(a.name, a.predicate(s))
    if (a.evidence) ev.set(a.name, a.evidence(s))
  }
  return { only, ev }
}

/** Pick the most specific alias from ALIASES that all keys satisfy (with evidence if required). */
export function detectKeyAlias(keys: string[]): string {
  for (const def of ALIASES) {
    if (!keys.every((k) => def.predicate(k))) continue
    if (def.evidence && !keys.some((k) => def.evidence!(k))) continue
    return def.name
  }
  return "string"
}
