import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TestConnectionButton, TestMessageButton } from "@/components/integrations/integration-actions";
import { toRecipientOptions } from "@/components/profiles/recipient-options";
import { StatusBadge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { getIntegrationStatuses } from "@/modules/integrations/service";
import { listRecipients } from "@/modules/notifications/recipients";
import { getProviders } from "@/modules/providers";

export const metadata: Metadata = { title: "Integrations" };

const UPWORK_API_KEY_URL =
  "https://support.upwork.com/hc/en-us/articles/115015857647-How-to-request-an-API-key-from-Upwork";

function Vars({ names }: { names: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {names.map((name) => (
        <code key={name} className="rounded bg-sunken px-1.5 py-0.5 text-xs">
          {name}
        </code>
      ))}
    </span>
  );
}

export default async function IntegrationsPage() {
  const { actor } = await requireUser();
  const db = getDb();
  const providers = getProviders();
  const [statuses, recipients] = await Promise.all([
    getIntegrationStatuses(db, providers),
    listRecipients(db, actor),
  ]);
  const canTest = hasRole(actor, "OPERATOR");

  const info: Record<string, { title: string; setup: ReactNode }> = {
    database: {
      title: "Database",
      setup: (
        <>
          PostgreSQL connection from <Vars names={["DATABASE_URL"]} />. Apply schema changes with{" "}
          <code className="text-xs">npm run db:migrate</code>.
        </>
      ),
    },
    job_source: {
      title: "Job source (Upwork)",
      setup: (
        <>
          <p>
            Live Upwork search is <strong>blocked</strong> until Upwork approves an API key with job-search
            access and the adapter is verified against that access. LeadPilot never scrapes Upwork pages or
            reuses browser sessions. Until then runs use the mock source.
          </p>
          <p className="mt-1">
            Request a key on{" "}
            <a
              href={UPWORK_API_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Upwork&apos;s API key page
            </a>
            , then set <Vars names={["JOB_SOURCE_PROVIDER", "UPWORK_CLIENT_ID", "UPWORK_CLIENT_SECRET"]} />{" "}
            and, only once job-search access is granted,{" "}
            <Vars names={["UPWORK_JOB_SEARCH_SCOPE_CONFIRMED"]} />.
          </p>
          <p className="mt-1">
            Meanwhile, the Upwork sync agent (Claude with Upwork&apos;s official connector) can import jobs
            through an import token from Settings. See <code className="text-xs">docs/upwork-sync.md</code>.
          </p>
        </>
      ),
    },
    email: {
      title: "E-mail (SMTP)",
      setup: (
        <>
          Set{" "}
          <Vars
            names={[
              "EMAIL_PROVIDER",
              "SMTP_HOST",
              "SMTP_PORT",
              "SMTP_SECURE",
              "SMTP_USER",
              "SMTP_PASSWORD",
              "EMAIL_FROM",
            ]}
          />
          . Any SMTP mailbox works, e.g. a Gmail address with an app password. The test checks the login
          without sending anything.
        </>
      ),
    },
    ai: {
      title: "AI scoring (OpenAI)",
      setup: (
        <>
          Set <Vars names={["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL"]} />. Create a project-scoped key
          on the OpenAI platform. The test retrieves the model, which is free and proves the key works.
        </>
      ),
    },
    n8n: {
      title: "n8n workflows",
      setup: (
        <>
          Optional. Set{" "}
          <Vars names={["RUN_EXECUTOR", "N8N_BASE_URL", "N8N_WEBHOOK_SECRET", "INTERNAL_API_SECRET"]} /> to
          let n8n drive runs. Without it, runs use the built-in in-process executor.
        </>
      ),
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">Integrations</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The services LeadPilot depends on. Results show the last connection test; nothing is checked until
          you select Test connection. Secrets are never shown.
        </p>
      </header>

      {statuses.map((status) => {
        const meta = info[status.name]!;
        const configuration = status.configuration as Record<string, unknown>;
        return (
          <Panel
            key={status.name}
            id={`integration-${status.name}`}
            title={meta.title}
            actions={
              <>
                {status.status ? (
                  <StatusBadge status={status.status} />
                ) : (
                  <span className="text-[13px] text-muted">Not tested yet</span>
                )}
                {canTest && <TestConnectionButton name={status.name} label={meta.title} />}
              </>
            }
          >
            <div className="grid gap-4 px-4 py-4 text-sm lg:grid-cols-[1fr_1fr]">
              <dl className="grid content-start gap-x-6 gap-y-2 sm:grid-cols-[150px_1fr]">
                <dt className="text-muted">Last checked</dt>
                <dd>
                  {status.lastCheckedAt ? <Time value={status.lastCheckedAt} /> : "Never"}
                  {status.lastCheckedAt && status.stale && (
                    <span className="text-muted"> (over an hour ago)</span>
                  )}
                </dd>
                <dt className="text-muted">Last success</dt>
                <dd>{status.lastSuccessAt ? <Time value={status.lastSuccessAt} /> : "Never"}</dd>
                <dt className="text-muted">Result</dt>
                <dd>{status.message ?? "–"}</dd>
                {status.error && (
                  <>
                    <dt className="text-muted">Problem</dt>
                    <dd className="text-danger">{status.error}</dd>
                  </>
                )}
                <dt className="text-muted">Mode</dt>
                <dd>
                  {configuration.isMock === true
                    ? "Mock (no external calls)"
                    : String(configuration.provider ?? configuration.executor ?? configuration.kind ?? "–")}
                </dd>
              </dl>
              <div className="flex flex-col gap-3 text-[13px] text-muted">
                <div>{meta.setup}</div>
                {status.name === "email" && canTest && (
                  <div className="flex flex-col items-start gap-1">
                    <TestMessageButton
                      recipients={toRecipientOptions(recipients)}
                      isMock={providers.email.isMock}
                    />
                  </div>
                )}
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
