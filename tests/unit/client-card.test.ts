import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientCard } from "@/components/jobs/client-card";
import { normalizeUpworkMcpJob, upworkMcpJobSchema } from "@/modules/job-sources/upwork-import/normalize";
import detailsHourly from "../fixtures/upwork/details-hourly.json";
import searchHourly from "../fixtures/upwork/search-hourly.json";

const client = normalizeUpworkMcpJob(
  upworkMcpJobSchema.parse({ ...searchHourly, details: detailsHourly }),
).client!;
const render = (c: typeof client | null) => renderToStaticMarkup(createElement(ClientCard, { client: c }));

describe("client card", () => {
  it("shows the client's hiring record", () => {
    const html = render(client);
    for (const text of [
      "PA, United States (America/New_York)",
      "4.99 from 16 reviews",
      "$34,285.90",
      "77%",
      "3,606.17",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("Recent reviews from freelancers (2)");
    expect(html).toContain("Work history (latest contracts) (4)");
    expect(html).toContain("Other open jobs: none supplied.");
  });

  it("renders third-party text as text and links only to safe URLs", () => {
    const html = render({
      ...client,
      recentReviews: [
        {
          title: "<img src=x onerror=alert(1)>",
          comment: "<script>alert(1)</script>",
          score: 5,
          endedAt: null,
        },
      ],
      otherOpenJobs: [
        { sourceJobId: "1", title: "Safe job", jobType: "FIXED", url: "https://www.upwork.com/jobs/~01" },
        { sourceJobId: "2", title: "No link job", jobType: null, url: null },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://www.upwork.com/jobs/~01"');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("explains when no client record has been fetched yet", () => {
    expect(render(null)).toContain("No full client record yet");
  });
});
