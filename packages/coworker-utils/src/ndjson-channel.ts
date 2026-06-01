// NDJSON channel — one JSON object per line over Node streams.
// Used by scratchpad <-> kernel subprocess and other inter-process channels.
// Spec §6.3.
import type { Readable, Writable } from 'node:stream';

export async function writeNdjson(stream: Writable, message: unknown): Promise<void> {
  const line = JSON.stringify(message) + '\n';
  await new Promise<void>((resolve, reject) => {
    stream.write(line, 'utf8', (err) => (err ? reject(err) : resolve()));
  });
}

export async function* readNdjson(stream: Readable): AsyncGenerator<unknown> {
  stream.setEncoding('utf8');
  let buffer = '';
  let lineNumber = 0;
  for await (const chunk of stream) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      lineNumber++;
      if (line.length === 0) continue;
      try {
        yield JSON.parse(line);
      } catch (err) {
        throw new Error(`NDJSON parse error at line ${lineNumber}: ${(err as Error).message}`);
      }
    }
  }
  // Tail (no trailing newline)
  if (buffer.length > 0) {
    lineNumber++;
    try {
      yield JSON.parse(buffer);
    } catch (err) {
      throw new Error(`NDJSON parse error at line ${lineNumber}: ${(err as Error).message}`);
    }
  }
}
