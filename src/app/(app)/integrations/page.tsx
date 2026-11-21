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
import { IMPORT_SOURCE_ID } from "@/modules/job-sources/import-provider";
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
  const usesImport = providers.jobSource.id === IMPORT_SOURCE_ID;

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
      setup: usesImport ? (
        <>
          <p>
            Jobs come from the <strong>Upwork sync</strong>: Claude searches Upwork through Upwork&apos;s
            official connector and sends the results to LeadPilot with an import token (Settings → Import
            tokens). Every run, including <strong>Run now</strong> on a profile, processes only the jobs the
            sync delivered for that profile; with nothing delivered it finds no jobs. No demo data is used.
          </p>
          <p className="mt-1">
            The test only confirms this mode; check the last sync on each profile (Search &amp; sync) and in
            Search History. See <code className="text-xs">docs/upwork-sync.md</code>.
          </p>
        </>
      ) : (
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
      title: "E-mail (SMTP or Brevo)",
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
          . Any SMTP mailbox works, e.g. a Gmail address with an app password. Where SMTP ports are blocked
          (Render&apos;s free plan), use <code className="text-xs">EMAIL_PROVIDER=brevo</code> with{" "}
          <Vars names={["BREVO_API_KEY"]} /> and a sender verified in Brevo as{" "}
          <code className="text-xs">EMAIL_FROM</code>. The test checks the login or API key without sending
          anything.
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
