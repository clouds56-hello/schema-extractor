export const name = "alias-record"
// Object whose keys are all UUIDs → should collapse to Record<Uuid, V>.
export const input =
  `
{"items":{"550e8400-e29b-41d4-a716-446655440000":{"n":1},"6ba7b810-9dad-11d1-80b4-00c04fd430c8":{"n":2,"o":"x"}}}
{"items":{"6ba7b811-9dad-11d1-80b4-00c04fd430c8":{"n":3}}}
`.trim() + "\n"
