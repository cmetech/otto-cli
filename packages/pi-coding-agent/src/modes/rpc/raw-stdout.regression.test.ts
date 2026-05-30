/**
 * Regression test for upstream ce0e801 — "retry RPC stdout backpressure" (#63).
 *
 * Bug: RPC mode wrote protocol output via a direct `process.stdout.write(...)`
 * with no handling for transient pipe-backpressure errors. Under high-volume
 * streaming the OS write buffer fills and the write reports `ENOBUFS` /
 * `EAGAIN` / `EWOULDBLOCK`, which previously crashed the process with an
 * uncaught `write ENOBUFS` and dropped queued protocol output.
 *
 * Fix: a serialized, retrying raw-stdout writer (`raw-stdout.ts`) that retries
 * transient backpressure errors after a short delay, lets callers await the
 * drain via `waitForRawStdoutBackpressure`, and flushes pending output on
 * shutdown via `flushRawStdout`.
 *
 * Against the unfixed tree the `raw-stdout` module does not exist and the import
 * fails, so this test FAILS before the fix and PASSES after.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	__setRawStdoutWriterForTests,
	__writeRawStdoutChunkForTests,
	flushRawStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
	type RawStdoutWriter,
} from "./raw-stdout.js";

/**
 * A writer that fails the first `failures` write attempts with a transient
 * backpressure error before succeeding, recording every chunk it accepts.
 */
function makeFlakyWriter(code: string, failures: number) {
	const written: string[] = [];
	let remaining = failures;
	const writer: RawStdoutWriter = {
		write(chunk: string, callback: (error?: Error | null) => void) {
			if (chunk.length > 0 && remaining > 0) {
				remaining -= 1;
				const err = Object.assign(new Error(`write ${code}`), { code });
				callback(err);
				return false;
			}
			// Empty-string writes are flush markers (flushRawStdout) — don't record them.
			if (chunk.length > 0) {
				written.push(chunk);
			}
			callback();
			return true;
		},
	};
	return { writer, written, attemptsLeft: () => remaining };
}

describe("raw-stdout backpressure retry (ce0e801 / #63)", () => {
	it("retries ENOBUFS and eventually flushes the chunk instead of crashing", async () => {
		const flaky = makeFlakyWriter("ENOBUFS", 3);
		const restore = __setRawStdoutWriterForTests(flaky.writer);
		try {
			writeRawStdout("hello\n");
			await waitForRawStdoutBackpressure();
			assert.deepEqual(flaky.written, ["hello\n"], "chunk must be written after retries");
			assert.equal(flaky.attemptsLeft(), 0, "all transient failures must have been retried");
		} finally {
			restore();
		}
	});

	it("retries EAGAIN and EWOULDBLOCK the same way", async () => {
		for (const code of ["EAGAIN", "EWOULDBLOCK"]) {
			const flaky = makeFlakyWriter(code, 2);
			const restore = __setRawStdoutWriterForTests(flaky.writer);
			try {
				writeRawStdout(`${code}-line\n`);
				await waitForRawStdoutBackpressure();
				assert.deepEqual(flaky.written, [`${code}-line\n`]);
			} finally {
				restore();
			}
		}
	});

	it("preserves write order across multiple queued writes under backpressure", async () => {
		const flaky = makeFlakyWriter("ENOBUFS", 2);
		const restore = __setRawStdoutWriterForTests(flaky.writer);
		try {
			writeRawStdout("a\n");
			writeRawStdout("b\n");
			writeRawStdout("c\n");
			await waitForRawStdoutBackpressure();
			assert.deepEqual(flaky.written, ["a\n", "b\n", "c\n"]);
		} finally {
			restore();
		}
	});

	it("flushRawStdout drains queued output on shutdown", async () => {
		const flaky = makeFlakyWriter("ENOBUFS", 1);
		const restore = __setRawStdoutWriterForTests(flaky.writer);
		try {
			writeRawStdout("pending\n");
			await flushRawStdout();
			assert.deepEqual(flaky.written, ["pending\n"]);
		} finally {
			restore();
		}
	});

	it("rethrows non-backpressure errors instead of retrying forever", async () => {
		// A fatal, non-transient error (e.g. an EPIPE-style code) must surface
		// rather than being swallowed and retried in an infinite loop.
		let attempts = 0;
		const writer: RawStdoutWriter = {
			write(_chunk: string, callback: (error?: Error | null) => void) {
				attempts += 1;
				callback(Object.assign(new Error("fatal"), { code: "EPIPE" }));
				return false;
			},
		};
		const restore = __setRawStdoutWriterForTests(writer);
		try {
			await assert.rejects(() => __writeRawStdoutChunkForTests("x\n"), /fatal/);
			assert.equal(attempts, 1, "non-backpressure errors must not be retried");
		} finally {
			restore();
		}
	});
});
