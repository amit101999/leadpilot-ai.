import { describe, expect, it } from "vitest";
import { exportHref } from "@/lib/ui/export-href";
import { parseSearchParams } from "@/lib/validation/search-params";
import { leadListQuery } from "@/modules/jobs/list-query";
import { runListQuery } from "@/modules/runs/list-query";

describe("date range upper bound (q.endDate)", () => {
  it("treats a bare date as the end of that UTC day", () => {
    const parsed = runListQuery.parse({ to: "2026-10-11" });
    expect(parsed.to?.toISOString()).toBe("2026-10-11T23:59:59.999Z");
  });

  it("keeps an explicit timestamp as given", () => {
    const parsed = leadListQuery.parse({ discoveredTo: "2026-10-11T08:00:00.000Z" });
    expect(parsed.discoveredTo?.toISOString()).toBe("2026-10-11T08:00:00.000Z");
  });

  it("leaves the lower bound at the start of the day", () => {
    expect(runListQuery.parse({ from: "2026-10-11" }).from?.toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });
});

describe("parseSearchParams", () => {
  it("drops invalid values instead of failing the page", () => {
    const parsed = parseSearchParams(runListQuery, {
      status: "NOT_A_STATUS",
      minQualified: "-5",
      search: "abc",
      page: "2",
    });
    expect(parsed.status).toBeUndefined();
    expect(parsed.minQualified).toBeUndefined();
    expect(parsed.search).toBe("abc");
    expect(parsed.page).toBe(2);
  });

  it("returns defaults for an empty URL", () => {
    expect(parseSearchParams(leadListQuery, {})).toEqual(leadListQuery.parse({}));
  });
});

describe("exportHref", () => {
  it("serialises validated filters and ignores paging and empty values", () => {
    const href = exportHref("/api/exports/leads.csv", {
      decision: ["QUALIFIED", "NEEDS_REVIEW"],
      discoveredFrom: new Date("2026-10-01T00:00:00.000Z"),
      scoreMin: 75,
      paymentVerified: "true",
      page: 3,
      pageSize: 25,
      search: "",
      skill: undefined,
    });
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/api/exports/leads.csv");
    expect(url.searchParams.get("decision")).toBe("QUALIFIED,NEEDS_REVIEW");
    expect(url.searchParams.get("discoveredFrom")).toBe("2026-10-01T00:00:00.000Z");
    expect(url.searchParams.get("scoreMin")).toBe("75");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("search")).toBe(false);
  });

  it("produces a URL the export endpoint's schema accepts", () => {
    const href = exportHref("/api/exports/leads.csv", { decision: ["QUALIFIED"], scoreMin: 80 });
    const params = Object.fromEntries(new URL(href, "http://localhost").searchParams);
    expect(leadListQuery.safeParse(params).success).toBe(true);
  });
});
