import { describe, expect, it } from "vitest";
import { formatMicroUsd } from "@/lib/ui/format";

describe("formatMicroUsd", () => {
  it("shows 4 decimals under a dollar so per-call costs stay visible", () => {
    expect(formatMicroUsd(0n)).toBe("$0.0000");
    expect(formatMicroUsd(3000n)).toBe("$0.0030");
    expect(formatMicroUsd(49n)).toBe("$0.0000");
    expect(formatMicroUsd(50n)).toBe("$0.0001"); // rounds half up
  });

  it("shows 2 decimals and thousands separators from a dollar up", () => {
    expect(formatMicroUsd(2_310_000n)).toBe("$2.31");
    expect(formatMicroUsd(1_234_567_890_000n)).toBe("$1,234,567.89");
  });

  it("shows a dash when there is no amount", () => {
    expect(formatMicroUsd(null)).toBe("–");
  });
});
