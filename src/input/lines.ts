/**
 * UTF-8 line iterator over a ReadableStream<Uint8Array>. Yields one line per
 * iteration without the trailing newline. The final unterminated line (if any)
 * is yielded after the stream ends.
 */
export async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder("utf-8")
  let buf = ""
  // @ts-ignore - async iteration over web streams works in Bun + Node 18+
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      yield line
    }
  }
  buf += dec.decode()
  if (buf.length) yield buf
}
