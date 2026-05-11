import type { Schema } from "../ir/types.js";
import type { DeclEntry } from "./render.js";

function substAll(s: string, rename: Map<string, string>): string {
  let out = s;
  for (const [from, to] of rename) {
    if (from === to) continue;
    out = out.replace(new RegExp(`(?<!\\w)${from.replace(/\$/g, "\\$")}(?!\\w)`, "g"), to);
  }
  return out;
}

/**
 * Iteratively collapse declarations that share a `<prefix>_<hash>` name and
 * have identical bodies. Body substitution is repeated until fixpoint.
 */
export function dedupeDecls(decls: DeclEntry[], rootRendered: string): { decls: DeclEntry[]; root: string } {
  let parsed = decls.map((d) => ({ name: d.name, body: d.body, doc: [...d.doc] }));

  while (true) {
    type Item = (typeof parsed)[number] & { prefix: string; hash: string };
    const items: Item[] = parsed.map((d) => {
      const m = d.name.match(/^(.*)_([0-9a-f]{8})$/);
      const prefix = m ? m[1]! : d.name;
      const hash = m ? m[2]! : "";
      return { ...d, prefix, hash };
    });

    const groups = new Map<string, Item[]>();
    for (const it of items) {
      if (!it.hash) continue;
      const key = `${it.prefix}\x00${it.body}`;
      const arr = groups.get(key) ?? [];
      arr.push(it);
      groups.set(key, arr);
    }

    const rename = new Map<string, string>();
    const mergedDocs = new Map<string, string[]>();
    let changed = false;
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      changed = true;
      group.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
      const canon = group[0]!;
      const allDocs: string[] = [];
      for (const m of group) for (const p of m.doc) if (!allDocs.includes(p)) allDocs.push(p);
      mergedDocs.set(canon.name, allDocs);
      for (let i = 1; i < group.length; i++) rename.set(group[i]!.name, canon.name);
    }
    if (!changed) {
      const out: DeclEntry[] = parsed.map((p) => {
        const orig = decls.find((d) => d.name === p.name);
        return {
          name: p.name,
          body: p.body,
          doc: p.doc,
          oldChain: orig?.oldChain ?? "",
          ir: orig?.ir ?? ({ k: "object", total: 0, props: new Map() } as Schema & { k: "object" }),
        };
      });
      return { decls: out, root: rootRendered };
    }

    const next: typeof parsed = [];
    for (const d of parsed) {
      if (rename.has(d.name)) continue;
      const newDoc = mergedDocs.get(d.name) ?? d.doc;
      next.push({ name: d.name, body: substAll(d.body, rename), doc: newDoc });
    }
    parsed = next;
    rootRendered = substAll(rootRendered, rename);
  }
}
