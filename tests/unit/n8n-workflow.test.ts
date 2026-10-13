import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIGNATURE_HEADER } from "@/lib/security/hmac";
import { STAGE_STEPS } from "@/modules/runs/engine";

interface WorkflowNode {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  retryOnFail?: boolean;
  maxTries?: number;
  onError?: string;
}
interface Workflow {
  nodes: WorkflowNode[];
  connections: Record<string, { main: { node: string }[][] }>;
}

const file = path.join(process.cwd(), "n8n", "workflows", "leadpilot-run.json");
const raw = readFileSync(file, "utf8");
const workflow = JSON.parse(raw) as Workflow;
const node = (name: string) => {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`missing node ${name}`);
  return found;
};
const targets = (name: string, output: number) =>
  (workflow.connections[name]?.main[output] ?? []).map((c) => c.node);

describe("n8n run workflow (n8n/workflows/leadpilot-run.json)", () => {
  it("connects only to nodes that exist, and every node except the trigger is reachable", () => {
    const names = new Set(workflow.nodes.map((n) => n.name));
    expect(names.size).toBe(workflow.nodes.length);
    const reached = new Set<string>();
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      expect(names.has(from)).toBe(true);
      for (const output of main) for (const c of output) reached.add(c.node);
    }
    for (const name of names) if (name !== "Run requested") expect(reached.has(name)).toBe(true);
    for (const name of reached) expect(names.has(name)).toBe(true);
  });

  it("listens on the path the app calls and checks the webhook secret with a credential", () => {
    const webhook = node("Run requested");
    // N8N_WEBHOOK_PATH defaults to /webhook/leadpilot-run in src/lib/configuration/env.ts.
    expect(webhook.parameters.path).toBe("leadpilot-run");
    expect(webhook.parameters.httpMethod).toBe("POST");
    expect(webhook.parameters.authentication).toBe("headerAuth");
    expect(webhook.parameters.responseMode).toBe("onReceived");
    expect(webhook.credentials?.httpHeaderAuth?.name).toBe("LeadPilot webhook secret");
  });

  it("only accepts a UUID run id before building any URL", () => {
    expect(targets("Run requested", 0)).toEqual(["Valid run id?"]);
    expect(targets("Valid run id?", 0)).toEqual(["Prepare run"]);
    const rule = JSON.stringify(node("Valid run id?").parameters);
    expect(rule).toContain("[0-9a-f]{8}-[0-9a-f]{4}");
  });

  it("signs step and failure calls the way the app verifies them", () => {
    for (const [sign, call] of [
      ["Sign step request", "Run step"],
      ["Sign failure report", "Report failure"],
    ] as const) {
      expect(node(sign).parameters).toMatchObject({
        action: "hmac",
        type: "SHA256",
        encoding: "hex",
        value: "={{ $json.timestamp }}.{{ $json.body }}",
        secret: "={{ $env.LEADPILOT_INTERNAL_API_SECRET }}",
      });
      const headers = JSON.stringify(node(call).parameters.headerParameters);
      expect(headers).toContain(`"name":"${SIGNATURE_HEADER}"`);
      expect(headers).toContain("t={{ $json.timestamp }},v1={{ $json.signature }}");
      // The exact signed string is sent as the raw body.
      expect(node(call).parameters).toMatchObject({ contentType: "raw", body: "={{ $json.body }}" });
    }
  });

  it("calls only the internal step and fail endpoints", () => {
    const stepUrl = JSON.stringify(node("Build step request").parameters);
    expect(stepUrl).toContain("/api/internal/runs/{{ $json.runId }}/steps/{{ $json.step }}");
    const failUrl = JSON.stringify(node("Describe failure").parameters);
    expect(failUrl).toContain("/fail");
  });

  it("maps every pipeline step to its stage when reporting a failure", () => {
    const body = JSON.stringify(node("Describe failure").parameters);
    for (const step of STAGE_STEPS) expect(body).toContain(`${step}: '`);
  });

  it("retries a failed step, leaves runs owned by another execution alone, then reports failure", () => {
    const runStep = node("Run step");
    expect(runStep.retryOnFail).toBe(true);
    expect(runStep.maxTries).toBe(3);
    expect(runStep.onError).toBe("continueErrorOutput");
    expect(targets("Run step", 1)).toEqual(["Run owned elsewhere?"]);
    expect(targets("Run owned elsewhere?", 0)).toEqual(["Leave run to its owner"]);
    expect(targets("Run owned elsewhere?", 1)).toEqual(["Describe failure"]);
    expect(targets("Too many steps?", 0)).toEqual(["Describe failure"]);
    expect(JSON.stringify(node("Too many steps?").parameters)).toContain('"rightValue":500');
  });

  it("loops back to the next step, waiting when the app asks", () => {
    expect(targets("Run finished?", 0)).toEqual(["Done"]);
    expect(targets("Wait requested?", 0)).toEqual(["Wait before next step"]);
    expect(targets("Wait requested?", 1)).toEqual(["Build step request"]);
    expect(targets("Wait before next step", 0)).toEqual(["Build step request"]);
  });

  it("contains no secrets: values come from n8n env vars and credentials", () => {
    expect(raw).not.toMatch(/"(value|secret)":\s*"[0-9a-f]{32,}"/i);
    expect(raw).not.toMatch(/Bearer\s|sk-[A-Za-z0-9]/);
    expect(raw).not.toMatch(/https?:\/\/(?!\$)/); // no hard-coded hosts; the app URL is LEADPILOT_APP_URL
    expect(raw).toContain("$env.LEADPILOT_APP_URL");
  });
});
