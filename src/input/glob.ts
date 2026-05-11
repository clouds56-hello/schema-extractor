/**
 * Tilde-and-glob expansion using Bun.Glob. Returns an absolute-or-cwd-relative
 * file list. Patterns with no glob chars are passed through after `~` expansion;
 * patterns that match nothing log a warning to stderr.
 */
export function expandGlobs(patterns: readonly string[]): string[] {
  const home = process.env.HOME ?? "~";
  const out: string[] = [];
  for (const p of patterns) {
    const expanded = p.startsWith("~/") ? home + p.slice(1) : p;
    if (!/[*?[{]/.test(expanded)) {
      out.push(expanded);
      continue;
    }
    const segs = expanded.split("/");
    let i = 0;
    while (i < segs.length && !/[*?[{]/.test(segs[i]!)) i++;
    const prefix = segs.slice(0, i).join("/");
    const pattern = segs.slice(i).join("/");
    const cwd = prefix === "" ? (expanded.startsWith("/") ? "/" : ".") : prefix;
    // @ts-ignore - Bun global
    const glob = new Bun.Glob(pattern);
    const matches: string[] = [];
    for (const m of glob.scanSync({ cwd, onlyFiles: true })) {
      matches.push(cwd === "/" ? "/" + m : `${cwd}/${m}`);
    }
    if (matches.length === 0) {
      console.error(`warning: no files matched ${p}`);
    } else {
      matches.sort();
      out.push(...matches);
    }
  }
  return out;
}
