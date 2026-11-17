import type { ReactNode } from "react";
import { Facts, known } from "@/components/ui/facts";
import { EmptyState, Panel } from "@/components/ui/panel";
import { isSafeLinkHref } from "@/lib/security/url";
import { formatMoney } from "@/lib/ui/format";
import type { ClientContract, NormalizedClient } from "@/modules/job-sources/types";

/**
 * The client's full record from the job source. Reviews, contract titles and other job titles are
 * third-party text: rendered as plain text (React escapes it) and never sent to the AI model.
 */
export function ClientCard({ client }: { client: NormalizedClient | null }) {
  if (!client) {
    return (
      <Panel id="client" title="Client">
        <EmptyState title="No full client record yet">
          The client&apos;s hiring record is fetched when the job passes the profile&apos;s first checks. The
          job facts above show what search results supplied.
        </EmptyState>
      </Panel>
    );
  }
  const location = [client.state, client.country].filter(Boolean).join(", ") || "Unknown";
  return (
    <Panel
      id="client"
      title="Client"
      description="The client's hiring record from Upwork, refreshed each time a job of theirs is fetched."
    >
      <Facts
        rows={[
          ["Location", client.timezone ? `${location} (${client.timezone})` : location],
          [
            "Payment verified",
            client.paymentVerified === null ? "Unknown" : client.paymentVerified ? "Yes" : "No",
          ],
          [
            "Rating from freelancers",
            client.rating ? `${client.rating} from ${known(client.reviewsCount)} reviews` : "Not rated yet",
          ],
          ["Total spent", client.totalSpent ? formatMoney(client.totalSpent, "USD") : "Unknown"],
          ["Hires", known(client.totalHires)],
          ["Hire rate", known(client.hireRatePercent, "%")],
          ["Jobs posted", known(client.jobsPosted)],
          ["Open jobs", known(client.openJobs)],
          ["Active contracts", known(client.activeContracts)],
          ["Hours paid", client.hoursTotal ? Number(client.hoursTotal).toLocaleString("en") : "Unknown"],
        ]}
      />
      <div className="flex flex-col gap-2 border-t border-line px-4 py-4 text-sm">
        <Section title="Recent reviews from freelancers" count={client.recentReviews.length}>
          {client.recentReviews.map((review, i) => (
            <li key={i} className="flex flex-col gap-1">
              <span className="font-medium">
                {review.title || "Untitled contract"}
                {review.score !== null && <span className="text-muted"> · {review.score}/5</span>}
              </span>
              {review.comment && <span className="whitespace-pre-wrap">{review.comment}</span>}
              {review.endedAt && (
                <span className="text-xs text-muted">Ended {monthYear(review.endedAt)}</span>
              )}
            </li>
          ))}
        </Section>
        <Section
          title="Work history (latest contracts)"
          count={client.workHistory.open.length + client.workHistory.closed.length}
        >
          {[...client.workHistory.open, ...client.workHistory.closed].map((contract, i) => (
            <ContractItem key={i} contract={contract} open={i < client.workHistory.open.length} />
          ))}
        </Section>
        <Section title="Other open jobs" count={client.otherOpenJobs.length}>
          {client.otherOpenJobs.map((job) => (
            <li key={job.sourceJobId}>
              {isSafeLinkHref(job.url) ? (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {job.title}
                </a>
              ) : (
                job.title
              )}
              {job.jobType && <span className="text-muted"> · {job.jobType}</span>}
            </li>
          ))}
        </Section>
      </div>
    </Panel>
  );
}

const MONTH_YEAR = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Aug 2026"; contract dates span years, so the year matters more than the hour. */
function monthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown date" : MONTH_YEAR.format(date);
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return <p className="text-muted">{title}: none supplied.</p>;
  return (
    <details>
      <summary className="cursor-pointer font-medium">
        {title} ({count})
      </summary>
      <ul className="mt-2 flex flex-col gap-3 pl-4">{children}</ul>
    </details>
  );
}

function ContractItem({ contract, open }: { contract: ClientContract; open: boolean }) {
  const details = [
    open ? "Open" : "Closed",
    contract.type ? contract.type.toLowerCase() : null,
    contract.feedbackToClient !== null ? `freelancer rated client ${contract.feedbackToClient}/5` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-0.5">
      <span>{contract.title}</span>
      <span className="text-xs text-muted">
        {details.join(" · ")}
        {contract.startedAt && ` · started ${monthYear(contract.startedAt)}`}
      </span>
    </li>
  );
}
