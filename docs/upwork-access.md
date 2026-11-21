# Upwork access

> Real Upwork jobs can be imported today without an API key through the **Upwork sync** (Claude Code with Upwork's
> official MCP connector feeding LeadPilot's import API): see [upwork-sync.md](upwork-sync.md). This page is about
> LeadPilot calling Upwork's API directly.

**Status: not built (future option).** LeadPilot does not call Upwork's API. Jobs come only from the Upwork sync.
A placeholder adapter for the direct API was removed in the November 2026 cleanup because it could never discover
jobs; this page keeps what would be needed to build a real one.

## What a direct API adapter would need

1. **An approved Upwork API key** for this use case, requested from the Upwork account that will own the integration.
2. **Job-search access on that key.** API keys are issued with selected scopes, and a key can only use the APIs its
   scopes allow.
3. **A confirmed data contract.** The granted API must return what the qualification engine needs: title,
   description, canonical job URL, fixed/hourly type, budget or rate, currency, client payment verification, client
   history (rating, hires, spend, country), skills, category and posting time.
4. **A new job source** implementing `JobSourceProvider` (`src/modules/job-sources/types.ts`) against the documented
   API (OAuth 2.0), with pagination, rate-limit handling, tests against recorded responses and an opt-in live test.

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
