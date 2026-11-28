import { describe, expect, it } from "vitest";
import { readLimitedText } from "@/lib/http/body";

/** A stream that yields `chunks` chunks of `size` bytes and records how many were pulled. */
function countingStream(chunks: number, size: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) return controller.close();
      state.pulled += 1;
      controller.enqueue(new Uint8Array(size).fill(0x61)); // "a"
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe("readLimitedText", () => {
  it("returns the decoded text when the body fits", async () => {
    const body = new Response("héllo").body;
    await expect(readLimitedText(body, 1024)).resolves.toBe("héllo");
  });

  it("returns an empty string for a missing body", async () => {
    await expect(readLimitedText(null, 1024)).resolves.toBe("");
  });

  it("stops reading and cancels the stream as soon as the limit is passed", async () => {
    // 1000 chunks of 1 KB = 1 MB on offer; the limit is 4 KB.
    const { stream, state } = countingStream(1000, 1024);
    await expect(readLimitedText(stream, 4 * 1024)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(state.pulled).toBeLessThanOrEqual(6); // never buffers the whole body
    expect(state.cancelled).toBe(true);
  });

  it("accepts a body of exactly the limit", async () => {
    const { stream } = countingStream(4, 1024);
    await expect(readLimitedText(stream, 4 * 1024)).resolves.toHaveLength(4 * 1024);
  });
});
