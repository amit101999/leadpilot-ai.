import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "@/lib/database/url";

describe("normalizeDatabaseUrl", () => {
  it("removes channel_binding, which postgres.js would send to the server as a setting", () => {
    expect(
      normalizeDatabaseUrl(
        "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
      ),
    ).toBe("postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require");
  });

  it("leaves other connection strings exactly as they are", () => {
    const url = "postgres://leadpilot:secret@postgres:5432/leadpilot";
    expect(normalizeDatabaseUrl(url)).toBe(url);
    expect(normalizeDatabaseUrl("not a url")).toBe("not a url");
  });
});
