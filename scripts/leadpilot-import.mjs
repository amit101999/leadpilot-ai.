#!/usr/bin/env node
/**
 * Bridge between the /upwork-sync agent and LeadPilot's import API. The agent saves Upwork MCP
 * results as JSON files under .upwork-sync/ and calls this script; the script validates sizes,
 * attaches fetched job details, chunks the upload and prints short summaries (never the token).
 *
 *   node scripts/leadpilot-import.mjs context [--scheduled]
 *   node scripts/leadpilot-import.mjs screen <profileId>
 *   node scripts/leadpilot-import.mjs commit <profileId>
 *   node scripts/leadpilot-import.mjs status <profileId> <OK|PARTIAL|ERROR> [message]
 *
 * Files for a profile: .upwork-sync/<profileId>/jobs.json (array of search items, as returned by
 * Upwork) and .upwork-sync/<profileId>/details/<jobId>.json (raw `find_jobs get` responses).
 * Settings: LEADPILOT_URL (default http://localhost:3000) and LEADPILOT_IMPORT_TOKEN, from .env.
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const WORK_DIR = resolve(".upwork-sync");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CHUNK = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID = /^[A-Za-z0-9~]{1,64}$/;

const baseUrl = (process.env.LEADPILOT_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.env.LEADPILOT_IMPORT_TOKEN;

function fail(message) {
  console.error(`leadpilot-import: ${message}`);
  process.exit(1);
}

/** Results go to stdout as JSON for the agent to read. */
function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  if (!existsSync(path)) fail(`missing file ${path}`);
  if (statSync(path).size > MAX_FILE_BYTES) fail(`${path} is larger than 5 MB`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${path} is not valid JSON`);
  }
}

async function api(method, path, body) {
  if (!token) fail("LEADPILOT_IMPORT_TOKEN is not set (create one in LeadPilot: Settings > Import tokens)");
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    fail(`LeadPilot is not reachable at ${baseUrl} (${error.cause?.code ?? error.name})`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    fail(`${method} ${path} -> HTTP ${response.status}: ${payload?.error?.message ?? "no details"}`);
  }
  return payload?.data;
}

function profileDir(profileId) {
  if (!UUID.test(profileId ?? "")) fail("profileId must be a UUID");
  return join(WORK_DIR, profileId);
}

/** Search items (deduplicated by id) with any fetched details attached as `details`. */
function loadJobs(profileId) {
  const dir = profileDir(profileId);
  const list = readJson(join(dir, "jobs.json"));
  if (!Array.isArray(list)) fail("jobs.json must contain a JSON array of job objects");
  const byId = new Map();
  for (const job of list) {
    if (job && typeof job === "object" && typeof job.id === "string") byId.set(job.id, job);
  }
  const detailsDir = join(dir, "details");
  if (existsSync(detailsDir)) {
    for (const file of readdirSync(detailsDir)) {
      const id = file.replace(/\.json$/, "");
      if (!JOB_ID.test(id) || !byId.has(id)) continue;
      byId.set(id, { ...byId.get(id), details: readJson(join(detailsDir, file)) });
    }
  }
  return [...byId.values()];
}

const [command, ...args] = process.argv.slice(2);

if (command === "context") {
  const scheduled = args.includes("--scheduled");
  const data = await api("GET", `/api/import/context?scheduled=${scheduled}`);
  print(data);
} else if (command === "screen") {
  const jobs = loadJobs(args[0]);
  const totals = { received: 0, valid: 0, rejected: 0, invalid: 0, detailsWanted: [] };
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const data = await api("POST", "/api/import/jobs/screen", {
      profileId: args[0],
      origin: "upwork-mcp",
      jobs: jobs.slice(i, i + CHUNK),
    });
    totals.received += data.received;
    totals.valid += data.valid;
    totals.rejected += data.rejected;
    totals.invalid += data.invalid.length;
    totals.detailsWanted.push(...data.detailsWanted);
  }
  print(totals);
} else if (command === "commit") {
  const jobs = loadJobs(args[0]);
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const data = await api("POST", "/api/import/jobs", {
      profileId: args[0],
      origin: "upwork-mcp",
      jobs: jobs.slice(i, i + CHUNK),
    });
    print({
      status: data.status,
      runId: data.runId,
      accepted: data.accepted,
      invalid: data.invalid.length,
      withDetails: jobs.slice(i, i + CHUNK).filter((j) => j.details).length,
    });
  }
  if (jobs.length === 0) print({ status: "NOTHING_TO_IMPORT" });
} else if (command === "status") {
  const [profileId, status, ...message] = args;
  if (!["OK", "PARTIAL", "ERROR"].includes(status)) fail("status must be OK, PARTIAL or ERROR");
  profileDir(profileId);
  await api("POST", "/api/import/sync-status", {
    profileId,
    status,
    ...(message.length ? { message: message.join(" ").slice(0, 1000) } : {}),
  });
  print({ profileId, status });
} else {
  fail(
    "usage: context [--scheduled] | screen <profileId> | commit <profileId> | status <profileId> <OK|PARTIAL|ERROR> [message]",
  );
}
