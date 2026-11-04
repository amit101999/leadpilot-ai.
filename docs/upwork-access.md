# Upwork access

> Real Upwork jobs can be imported today without an API key through the **Upwork sync** (Claude Code with Upwork's
> official MCP connector feeding LeadPilot's import API): see [upwork-sync.md](upwork-sync.md). This page is about
> LeadPilot calling Upwork's API directly.

**Status: direct Upwork API discovery is BLOCKED.** LeadPilot runs on a mock job source. The Upwork provider exists only as
a configuration check and refuses to discover jobs. It never scrapes pages, reuses browser sessions or calls guessed
endpoints.

## What the code does today

`src/modules/job-sources/upwork-provider.ts` (`JOB_SOURCE_PROVIDER=upwork`):

| Configuration                                              | `checkConnection()` result                                     | Run outcome      |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ---------------- |
| `UPWORK_CLIENT_ID` or `UPWORK_CLIENT_SECRET` missing       | `NOT_CONFIGURED`                                               | `BLOCKED_SOURCE` |
| Credentials set, `UPWORK_JOB_SEARCH_SCOPE_CONFIRMED=false` | `NOT_AUTHORIZED`                                               | `BLOCKED_SOURCE` |
| Credentials set and scope confirmed                        | `NOT_AUTHORIZED` ("live adapter not implemented and verified") | `BLOCKED_SOURCE` |

`discoverJobs()` always throws `SourceNotAuthorizedError`. The run stops at the source check, keeps its partial data,
skips the later stages and shows the reason in the UI and on the Integrations page.

## What would unblock it

1. **An approved Upwork API key** for this use case, requested from the Upwork account that will own the integration.
2. **Job-search access on that key.** API keys are issued with selected scopes, and a key can only use the APIs its
   scopes allow.
3. **A confirmed data contract.** The granted API must return what the qualification engine needs: title,
   description, canonical job URL, fixed/hourly type, budget or rate, currency, client payment verification, client
   history (rating, hires, spend, country), skills, category and posting time. If payment verification or budget are
   not available, the hard filters treat them as unknown, which rejects the job under the default profile.
4. **A live adapter** that implements `discoverJobs` and `normalizeJob` against the documented API (OAuth 2.0), with
   pagination, rate-limit handling and tests against recorded responses, then `npm run test:live` with real
   credentials.
5. Only then set `UPWORK_JOB_SEARCH_SCOPE_CONFIRMED=true` together with the new adapter.

## What Upwork's documentation says

Upwork's own pages ([Request an API key][key], [developer documentation][docs]) refused automated retrieval (HTTP 403)
on 2026-10-15. The points below come from search-engine excerpts of those official pages, and should be re-read in a
browser before applying:

- To request a key, the Upwork account needs a valid personal name, a full address, a profile photo, a verified payment
  method and identity verification. The request must describe the intended use and say whether the application is
  exposed to third parties or used only personally ([support article][key]).
- The same article states that the Upwork API is not available for commercial use and that Upwork's logo or brand must
  not be used in the application ([support article][key]).
- During the request you select scopes; the selection defines which APIs the key can call. Missing permissions return
  an error, and Upwork support can extend a key's scopes ([developer documentation][docs]).
- The current API is GraphQL ([GraphQL API documentation][graphql]).

Not confirmed from an official source (third-party claims only, do not rely on them): the exact scope names needed for
read-only job search, and specific rate limits.

## Policy notes

Automated access outside the official API is not an option for this project. Upwork's terms prohibit scraping and
automated means of accessing the site without written permission. Several third-party sources also describe job-alert
and watcher tools as prohibited bot use. Before building the live adapter, confirm that the intended use (an
individual or agency monitoring jobs for its own proposals) is acceptable under the API terms that apply to the
approved key, and get written confirmation from Upwork if it is not explicit.

[key]: https://support.upwork.com/hc/en-us/articles/115015857647-Request-an-API-Key
[docs]: https://www.upwork.com/developer/documentation/graphql
[graphql]: https://www.upwork.com/developer/documentation/graphql/api/docs/index.html
