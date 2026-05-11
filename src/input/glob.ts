/**
 * Tilde-and-glob expansion using Bun.Glob. Returns an absolute-or-cwd-relative
 * file list. Patterns with no glob chars are passed through after `~` expansion;
 * patterns that match nothing (including those whose prefix directory doesn't
 * exist, e.g. `~/.codex/sessions/**` on a fresh CI runner) log a warning to
 * stderr and contribute zero entries.
 */
import { existsSync } from "node:fs"

export function expandGlobs(patterns: readonly string[]): string[] {
  const home = process.env.HOME ?? "~"
  const out: string[] = []
  for (const p of patterns) {
    const expanded = p.startsWith("~/") ? home + p.slice(1) : p
    if (!/[*?[{]/.test(expanded)) {
      out.push(expanded)
      continue
    }
    const segs = expanded.split("/")
    let i = 0
    while (i < segs.length && !/[*?[{]/.test(segs[i]!)) i++
    const prefix = segs.slice(0, i).join("/")
    const pattern = segs.slice(i).join("/")
    const cwd = prefix === "" ? (expanded.startsWith("/") ? "/" : ".") : prefix
    const matches: string[] = []
    if (!existsSync(cwd)) {
      console.error(`warning: no files matched ${p}`)
      continue
    }
    const glob = new Bun.Glob(pattern)
    try {
      for (const m of glob.scanSync({ cwd, onlyFiles: true })) {
        matches.push(cwd === "/" ? `/${m}` : `${cwd}/${m}`)
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ENOENT" || code === "ENOTDIR") {
        console.error(`warning: no files matched ${p}`)
        continue
      }
      throw err
    }
    if (matches.length === 0) {
      console.error(`warning: no files matched ${p}`)
    } else {
      matches.sort()
      out.push(...matches)
    }
  }
  return out
}
