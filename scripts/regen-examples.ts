#!/usr/bin/env bun
/**
 * Regenerate the committed examples in `examples/`. Run with:
 *   bun run regen:examples
 */
import { extractSchemaFromFiles } from "../src/index.js";

async function main() {
  const codex = await extractSchemaFromFiles(["~/.codex/sessions/**/*.jsonl"], { rootName: "CodexRollout" });
  // @ts-ignore - Bun global
  await Bun.write("examples/codex.d.ts", codex);
  console.error("wrote examples/codex.d.ts");

  const copilot = await extractSchemaFromFiles(
    ["~/.local/share/workspaceStorage/*/chatSessions/*.jsonl"],
    { rootName: "CopilotChat" },
  );
  // @ts-ignore
  await Bun.write("examples/copilot-chat.d.ts", copilot);
  console.error("wrote examples/copilot-chat.d.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
