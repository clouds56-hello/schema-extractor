import { copilotCliPlugin } from "@/plugins/index"

export const name = "plugin-string-alias-record"
export const options = { plugins: [copilotCliPlugin] }
export const input = `${`
{"modelMetrics":{"glm-4.7":{"count":1}},"system-reminder":{"text":"keep"}}
{"modelMetrics":{"gpt-4.1":{"count":2,"cost":0.5}},"system-reminder":{"text":"safe"}}
`.trim()}\n`
