import { describe, expect, it } from "vitest";
import { pickClientIp } from "@/lib/http/api";

describe("client address behind a proxy", () => {
  it("uses the entry the proxy appended, never the client-supplied first entry", () => {
    // A client sends a fake address; Render appends the real one.
    expect(pickClientIp("203.0.113.9, 198.51.100.7", null, 1)).toBe("198.51.100.7");
    expect(pickClientIp("198.51.100.7", null, 1)).toBe("198.51.100.7");
  });

  it("can skip more trusted proxies when there are several", () => {
    expect(pickClientIp("203.0.113.9, 198.51.100.7, 10.0.0.2", null, 2)).toBe("198.51.100.7");
  });

  it("falls back to the first entry, X-Real-IP, then unknown", () => {
    expect(pickClientIp("198.51.100.7", null, 3)).toBe("198.51.100.7");
    expect(pickClientIp(null, " 198.51.100.8 ", 1)).toBe("198.51.100.8");
    expect(pickClientIp(" , ", null, 1)).toBe("unknown");
  });
});
