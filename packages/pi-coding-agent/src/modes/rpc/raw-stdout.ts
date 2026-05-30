/**
 * Backpressure-safe raw stdout writer for RPC mode.
 *
 * RPC mode streams a high volume of JSONL protocol output to its parent process
 * over stdout. Under sustained load the underlying pipe can fill up and
 * `process.stdout.write` (or its callback) reports a transient error such as
 * `ENOBUFS`, `EAGAIN`, or `EWOULDBLOCK`. Previously these surfaced as an
 * uncaught `write ENOBUFS` and crashed the process mid-turn.
 *
 * This module serializes writes through a single promise tail and retries the
 * transient backpressure errors after a short delay, so protocol output is
 * never dropped and the process survives backpressure. It also exposes a way to
 * wait for the queue to drain (`waitForRawStdoutBackpressure`) and to flush all
 * pending output during shutdown (`flushRawStdout`).
 *
 * Ported (reconstructed) from upstream earendil-works/pi commit ce0e801
 * `fix(coding-agent): retry RPC stdout backpressure`. otto-cli has no
 * `output-guard.ts` / stdout-takeover layer, so the logic lives here and writes
 * directly to the provided writer (defaulting to `process.stdout`).
 */

const RAW_STDOUT_RETRY_DELAY_MS = 10;

/** A node-style writable: `write(chunk, cb)` where `cb(err)` reports completion. */
export interface RawStdoutWriter {
	write(chunk: string, callback: (error?: Error | null) => void): unknown;
}

let writer: RawStdoutWriter = process.stdout;

let rawStdoutWriteTail: Promise<void> = Promise.resolve();

/** Errors that indicate the OS write buffer is temporarily full and should be retried. */
function isBackpressureError(error: Error): boolean {
	const code = (error as Error & { code?: unknown }).code;
	return code === "ENOBUFS" || code === "EAGAIN" || code === "EWOULDBLOCK";
}

async function writeRawStdoutChunk(text: string): Promise<void> {
	while (true) {
		try {
			await new Promise<void>((resolve, reject) => {
				try {
					writer.write(text, (error) => {
						if (error) reject(error);
						else resolve();
					});
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
			return;
		} catch (error) {
			const writeError = error instanceof Error ? error : new Error(String(error));
			if (!isBackpressureError(writeError)) {
				throw writeError;
			}
			await new Promise<void>((resolve) => setTimeout(resolve, RAW_STDOUT_RETRY_DELAY_MS));
		}
	}
}

/**
 * Queue a write of `text` to raw stdout. Writes are serialized through a single
 * promise chain and retried on transient backpressure errors. Returns
 * immediately; callers that need to apply backpressure should subsequently
 * `await waitForRawStdoutBackpressure()`.
 */
export function writeRawStdout(text: string): void {
	if (text.length === 0) {
		return;
	}
	rawStdoutWriteTail = rawStdoutWriteTail.then(() => writeRawStdoutChunk(text));
	void rawStdoutWriteTail.catch(() => {
		process.exit(1);
	});
}

/**
 * Wait until every write queued so far has been flushed to the underlying
 * stream. Re-checks the tail in case more writes were queued while awaiting, so
 * it resolves only when the queue is genuinely drained.
 */
export async function waitForRawStdoutBackpressure(): Promise<void> {
	while (true) {
		const tail = rawStdoutWriteTail;
		await tail;
		if (tail === rawStdoutWriteTail) {
			return;
		}
	}
}

/** Drain all pending writes and flush the stream. Used on graceful shutdown. */
export async function flushRawStdout(): Promise<void> {
	await waitForRawStdoutBackpressure();
	await writeRawStdoutChunk("");
}

/**
 * Test-only: override the underlying writer and reset the queue. Returns a
 * restore function. Not used in production.
 */
export function __setRawStdoutWriterForTests(next: RawStdoutWriter): () => void {
	const previous = writer;
	writer = next;
	rawStdoutWriteTail = Promise.resolve();
	return () => {
		writer = previous;
		rawStdoutWriteTail = Promise.resolve();
	};
}

/** Test-only: exercise the chunk writer directly (e.g. to assert rethrow behaviour). */
export function __writeRawStdoutChunkForTests(text: string): Promise<void> {
	return writeRawStdoutChunk(text);
}
