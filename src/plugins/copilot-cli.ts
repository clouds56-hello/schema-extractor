import type { NamePlugin } from "./types"

const MODEL_ID_PREFIXES = [
  "claude",
  "codestral",
  "deepseek",
  "devstral",
  "gemini",
  "glm",
  "gpt",
  "grok",
  "kimi",
  "llama",
  "mistral",
  "o",
  "qwen",
]

function isModelId(s: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s)) return false
  const lower = s.toLowerCase()
  if (!MODEL_ID_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}-`) || lower.startsWith(`${prefix}.`))) {
    return false
  }
  return /\d/.test(s)
}

export const copilotCliPlugin: NamePlugin = {
  name: "copilot-cli",

  contribute() {
    return {
      stringAliases: [{ name: "ModelId", predicate: isModelId }],
      recordHints: [{ field: "modelMetrics", key: "ModelId" }],
    }
  },
}
