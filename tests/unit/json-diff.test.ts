import { describe, expect, it } from "vitest";
import { diffJson } from "@/lib/ui/json-diff";

describe("diffJson (audit before/after)", () => {
  it("lists only changed paths, using dotted names", () => {
    const changes = diffJson(
      { name: "Web", version: 1, configuration: { budget: { fixedMin: "500.00", currency: "USD" } } },
      { name: "Web", version: 2, configuration: { budget: { fixedMin: "750.00", currency: "USD" } } },
    );
    expect(changes).toEqual([
      { path: "configuration.budget.fixedMin", before: "500.00", after: "750.00" },
      { path: "version", before: "1", after: "2" },
    ]);
  });

  it("shows added and removed fields against a dash", () => {
    expect(diffJson(null, { status: "RUNNING" })).toEqual([
      { path: "status", before: "–", after: "RUNNING" },
    ]);
    expect(diffJson({ status: "RUNNING" }, null)).toEqual([
      { path: "status", before: "RUNNING", after: "–" },
    ]);
  });

  it("renders lists of plain values as text and lists of objects as JSON", () => {
    const [skills] = diffJson({ skills: ["React"] }, { skills: ["React", "Node.js"] });
    expect(skills).toEqual({ path: "skills", before: "React", after: "React, Node.js" });
    const [required] = diffJson({ required: [{ name: "React" }] }, { required: [{ name: "Vue" }] });
    expect(required!.after).toBe('[{"name":"Vue"}]');
  });

  it("returns nothing when both sides are equal or empty", () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffJson(null, null)).toEqual([]);
  });
});
