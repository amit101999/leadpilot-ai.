import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/database/schema.ts",
  out: "./database/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/leadpilot" },
  strict: true,
});
