import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "@/lib/database/url";

describe("normalizeDatabaseUrl", () => {
  it("removes channel_binding, which postgres.js would send to the server as a setting", () => {
    expect(
      normalizeDatabaseUrl(
        "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require",
      ),
    ).toBe("postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full");
  });

  it("verifies the server certificate of a remote database (sslmode=require would not)", () => {
    expect(
      normalizeDatabaseUrl(
        "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
      ),
    ).toBe("postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full");
    expect(normalizeDatabaseUrl("postgresql://u:p@db.example.com/x?sslmode=prefer")).toBe(
      "postgresql://u:p@db.example.com/x?sslmode=verify-full",
    );
  });

  it("leaves local and other connection strings exactly as they are", () => {
    const url = "postgres://leadpilot:secret@postgres:5432/leadpilot";
    expect(normalizeDatabaseUrl(url)).toBe(url);
    const local = "postgres://u:p@127.0.0.1:55432/leadpilot_test?sslmode=require";
    expect(normalizeDatabaseUrl(local)).toBe(local);
    expect(normalizeDatabaseUrl("postgres://u:p@localhost/x?sslmode=require")).toBe(
      "postgres://u:p@localhost/x?sslmode=require",
    );
    expect(normalizeDatabaseUrl("not a url")).toBe("not a url");
  });
});
