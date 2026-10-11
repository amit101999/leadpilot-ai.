# CLAUDE.md --- Codebase Documentation, Engineering Standards, and Review Instructions

## Purpose

Use this file as persistent guidance when working in this repository.

Your responsibilities are to understand the existing codebase, document
what is actually implemented, preserve a clean and maintainable
architecture, and review the code for bugs, security weaknesses, and
quality issues after coding is complete.

This file is not a product requirements document. Do not assume features
exist just because they are mentioned in a conversation or plan. Inspect
the repository and describe the actual implementation accurately.

## 1. Start by Understanding the Repository

Before making changes:

1.  Inspect the repository structure, README files, package manifests,
    configuration files, environment examples, database migrations,
    tests, and existing documentation.
2.  Identify the frameworks, libraries, services, tools, and conventions
    already in use.
3.  Trace important application flows across the frontend, backend,
    APIs, database, background jobs, and third-party integrations.
4.  Identify incomplete features, placeholders, duplicated logic, dead
    code, known limitations, and external dependencies.
5.  Avoid overwriting or deleting unrelated work.
6.  Create a concise plan for significant changes before implementing
    them.

Prefer the existing architecture and conventions when they are sound. Do
not introduce a new framework, library, abstraction, or service without
a clear reason.

## 2. Maintain Accurate Project Documentation

Keep the repository documentation current as the codebase changes.
Create or update the relevant documentation files as appropriate,
including a project README and focused documents for architecture, API
design, database design, setup, testing, security, and deployment.

Document what is implemented, how it works, and where to find it. Base
every claim on the current code, migrations, configuration, tests, or
verified runtime behavior.

The documentation should explain the following areas where applicable:

### Project overview

- What the application does and the problems it solves.
- The major features that are implemented.
- Features that are partial, mocked, planned, or blocked by external
  dependencies.
- High-level architecture and major components.

### Frontend

- Framework, language, UI library, styling system, and
  form/state-management tools.
- Page and route structure.
- Component organization and reusable UI patterns.
- How forms are validated and submitted.
- How loading, empty, success, and error states are handled.
- How the frontend communicates with backend APIs.
- Authentication, authorization-related UI behavior, accessibility,
  and responsive design.

### Backend

- Runtime, framework, module structure, and application entry points.
- Separation between routes/controllers, business logic, validation,
  and data-access code.
- Authentication, authorization, input validation, and error handling.
- Background processing, asynchronous operations, and external-service
  adapters.
- Logging, configuration, and observability.

### API design

- Available endpoints and their methods.
- Request and response formats.
- Authentication and authorization requirements.
- Validation rules and standard error responses.
- Pagination, filtering, sorting, idempotency, and rate limiting where
  implemented.
- External API integrations, authentication methods, timeouts,
  retries, and failure behavior.
- Known limitations and endpoints that are not yet implemented.

Do not document secrets, access tokens, passwords, cookies, or other
sensitive values.

### Database and data model

- Database technology and schema organization.
- Tables/entities, their responsibilities, relationships, and
  important constraints.
- Indexes and uniqueness rules.
- Migration strategy and commands.
- Transactions, concurrency controls, and data-integrity guarantees.
- Data-retention, backup, and recovery considerations where
  applicable.

### System design

- A high-level architecture diagram when useful.
- Data flow between major components.
- Request and background-job lifecycles.
- External dependencies and trust boundaries.
- Scalability decisions, bottlenecks, failure modes, and recovery
  behavior.
- Important design trade-offs and why they were chosen.

### Tools and developer workflow

- Languages, frameworks, packages, services, and development tools
  actually used.
- Environment setup and required software versions.
- Environment variables, documented by name and purpose only.
- Commands for installation, development, formatting, linting, type
  checking, testing, building, migrations, and deployment.
- CI/CD and infrastructure configuration where present.

### Testing and operational guidance

- Test structure and the behaviors covered.
- How to run each test suite.
- How to run the application locally.
- How to troubleshoot common failures.
- What has been verified and what still needs verification.

Use clear, direct language. Prefer useful examples and small diagrams
over long, abstract explanations. Keep documentation consistent with the
actual code.

## 3. Code Quality Standards

Write code that is clean, modular, readable, and suitable for
production.

### Keep code simple

- Prefer straightforward solutions over clever or unnecessarily
  abstract designs.
- Use clear names that explain intent.
- Keep functions and modules focused on one responsibility.
- Use small, understandable functions when that improves readability.
- Avoid deeply nested conditionals, overly long functions, and
  complicated control flow.
- Do not create abstractions, interfaces, factories, or helper layers
  without a real need.
- Avoid premature optimization and unnecessary dependencies.
- Follow the principle: the simplest design that safely meets the
  requirements is preferred.

### Keep the codebase modular

- Separate presentation, business logic, data access, validation, and
  integration code.
- Avoid putting substantial business logic in UI components or route
  handlers.
- Reuse common logic when doing so improves consistency.
- Keep module boundaries understandable.
- Avoid circular dependencies and unnecessary coupling.
- Use consistent project conventions rather than mixing patterns
  without reason.

### Type safety and consistency

- Use the language's type system properly.
- In TypeScript projects, prefer strict typing and avoid `any`; if an
  exception is necessary, keep it narrow and explain why.
- Validate untrusted data at system boundaries even when static types
  exist.
- Use consistent formatting, linting, naming, and error-handling
  patterns.
- Remove unused imports, dead code, debug statements, and stale
  comments.
- Comments should explain intent or non-obvious decisions, not merely
  repeat the code.

### Production readiness

- Handle expected failures explicitly.
- Avoid silent failures and swallowed exceptions.
- Do not expose internal stack traces or sensitive implementation
  details to end users.
- Keep configuration outside business logic.
- Use safe defaults and fail closed for security-sensitive decisions.
- Preserve data integrity with database constraints and transactions
  where needed.
- Make retries bounded and safe.
- Consider concurrency, duplicate requests, partial failures, and
  recovery.
- Add tests for important business rules and failure cases.
- Do not claim code is error-free simply because it compiles.

## 4. Security Requirements

Treat security as part of implementation, not a final cosmetic step.

Review and address the following where relevant:

- Authentication and session management.
- Authorization checks on every protected operation and resource.
- Input validation and output encoding.
- SQL/NoSQL injection and unsafe query construction.
- Cross-site scripting (XSS).
- Cross-site request forgery (CSRF), where applicable.
- Server-side request forgery (SSRF).
- Insecure direct object references and cross-user data access.
- File upload and file path handling.
- Command injection and unsafe deserialization.
- CORS configuration and security headers.
- Rate limiting and abuse prevention.
- Secret management and accidental credential exposure.
- Sensitive data in logs, URLs, error messages, and analytics.
- Dependency vulnerabilities and outdated packages.
- Webhook authentication and request verification.
- Unsafe retries, duplicate side effects, and race conditions.
- Excessive permissions and publicly exposed infrastructure.
- Insecure development defaults that could reach production.

Never commit real credentials or secrets. Keep `.env` files out of
version control and maintain a safe `.env.example` when needed. Do not
log tokens, passwords, session cookies, private keys, or unnecessary
personal information.

Do not disable security controls merely to make a test pass. If a
security issue cannot be resolved safely, document it clearly and
explain the remaining risk.

## 5. Use Installed Skills and Review Tools

Before implementing substantial features or conducting a code review:

1.  Inspect the skills available in the current Claude environment.
2.  Use relevant installed skills for architecture, frontend
    development, backend implementation, database work, testing,
    security reviews, debugging, and code quality.
3.  If skills are not obvious, use `/find-skills` when available to
    discover suitable skills. Follow the instructions of the selected
    skills and use them where they materially help.
4.  Inspect the available project tools, scripts, linters, type
    checkers, test runners, dependency scanners, and security scanners.
5.  Use the tools that are actually available in the current
    environment. Do not claim to have run a tool that is unavailable or
    was not executed.
6.  Follow repository-specific instructions and existing CI checks.

Do not install extra tools or dependencies automatically when an
existing tool is sufficient. If an additional tool is necessary, explain
why and use a trusted, appropriate option.

## 6. Mandatory Review After Coding

After completing an implementation or meaningful code change, perform a
review of the actual codebase. Do not stop immediately after writing the
code.

### Step 1 --- Functional review

- Trace the changed feature from the UI or entry point through the
  backend and data layer.
- Check edge cases, empty states, invalid inputs, and unexpected
  external responses.
- Check that buttons, forms, links, API endpoints, and background
  actions behave as intended.
- Look for incomplete implementations, placeholders, dead paths, and
  misleading success messages.

### Step 2 --- Automated checks

Run the applicable commands available in the repository, such as: -
Formatter or formatting check. - Linter. - Type checker. - Unit tests. -
Integration tests. - End-to-end tests. - Production build. - Database
migration validation. - Dependency and vulnerability audit.

Use the package manager and scripts already defined by the project. Do
not invent test results. If a check cannot run, state the exact reason.

### Step 3 --- Bug and regression review

Inspect for: - Incorrect business logic. - Boundary-condition
failures. - Null/undefined handling problems. - Incorrect async
behavior. - Race conditions and duplicate processing. - Resource
leaks. - Incorrect status transitions. - Data corruption or inconsistent
records. - Broken error paths. - Backward-compatibility problems. -
Performance issues caused by avoidable queries or repeated work.

Fix issues introduced by the change and any directly related issues that
can be safely addressed without unrelated rewrites.

### Step 4 --- Security review

Use relevant installed security-review skills and available scanners.
Review the security requirements in Section 4 and inspect changed code
in context.

Check for leaked secrets, unsafe dependencies, missing authorization,
injection risks, insecure configurations, sensitive logs, and unsafe
external calls.

Report any unresolved security concerns explicitly. Do not claim that a
complete security audit has been performed if only limited checks were
possible.

### Step 5 --- Final verification

After fixing issues, rerun the relevant checks. Review the final diff
and confirm: - No unrelated files were changed unnecessarily. - No
temporary debugging code remains. - No credentials or generated
artifacts were accidentally added. - Documentation reflects the final
implementation. - Tests and builds have been rerun after the last
relevant changes.

## 7. Change Management

For significant work:

1.  Explain the intended change and likely affected modules.
2.  Inspect the relevant code before editing.
3.  Implement the smallest complete solution.
4.  Add or update tests.
5.  Update documentation.
6.  Run the review and verification process.
7.  Summarize what changed and what was verified.

Avoid rewriting working modules without a clear reason. Preserve
existing behavior unless the requirement explicitly calls for a change.
If a migration or API change could affect existing data or clients,
explain the impact and provide a safe migration path.

Do not hide failing tests, warnings, unresolved bugs, or security
issues.

## 8. Stress-Test Plans with the Grilling Skill

- When to run it: before new features, architecture changes, schema or migration changes, API or integration changes, and security-sensitive work, plus any time you say "grill me". Small fixes such as typos and formatting skip it.
- How to run it: I invoke the grilling skill myself, because grill-me can only be started by you as /grill-me. I look facts up in the code myself and only ask you about decisions. Each numbered question comes with my recommended answer and the trade-off behind it, so you learn the reasoning. I don't write code until you confirm we agree.

## 9. Definition of Done

A feature is not complete merely because code has been written.

Before considering a task finished, confirm that:

- The implementation matches the requested behavior.
- Code is readable, modular, and consistent with the repository.
- Input validation and error handling are appropriate.
- Security-sensitive operations are protected.
- Important business rules have automated tests.
- Relevant linting, type checking, tests, and builds have been run.
- The changed code has been reviewed for bugs, regressions, and
  security issues.
- Documentation has been updated to match actual behavior.
- Remaining limitations and unverified integrations are documented.

## 10. Final Response Format

At the end of a substantial task, provide a concise, factual report with
these headings:

1.  **Implemented** --- What changed and where.
2.  **Architecture and Data Flow** --- How the affected components work
    together.
3.  **Documentation Updated** --- Which documents were created or
    changed.
4.  **Checks Run** --- Commands executed and actual results.
5.  **Security and Bug Review** --- Findings, fixes, and unresolved
    risks.
6.  **Remaining Work** --- Blockers, assumptions, and items not
    verified.

Use plain, human-readable language. Be specific about file paths and
commands. Distinguish between verified behavior, mocked behavior, and
work that remains incomplete.

## Core Principle

Build software that is simple to understand, easy to maintain, secure by
design, well tested, and ready for real-world use. Prefer clear code
over clever code, verified behavior over assumptions, and honest
reporting over claims of perfection.
