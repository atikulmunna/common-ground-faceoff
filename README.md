# Common Ground

Common Ground is an AI-mediated discourse platform for structured, high-friction conversations. Participants submit positions on a shared topic, the system runs a multi-stage analysis pipeline, and the UI renders a Common Ground Map that separates shared foundations from irreducible disagreements.

The product is designed for clarity, neutrality, and traceability, not winner/loser debate scoring.

## Table of Contents

- [Product Goals](#product-goals)
- [Core Capabilities](#core-capabilities)
- [Demo Walkthrough](#demo-walkthrough)
- [How the System Works](#how-the-system-works)
- [End-to-End User Flow](#end-to-end-user-flow)
- [Architecture](#architecture)
- [Data Model Highlights](#data-model-highlights)
- [Security, Privacy, and Moderation](#security-privacy-and-moderation)
- [Performance and Reliability Design](#performance-and-reliability-design)
- [API Surface (High-Level)](#api-surface-high-level)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Testing and Quality Gates](#testing-and-quality-gates)
- [Operational Notes](#operational-notes)
- [Known Deployment Dependencies](#known-deployment-dependencies)
- [Repository Structure](#repository-structure)
- [License](#license)

## Product Goals

- Reduce rhetorical noise by requiring explicit position statements.
- Improve mutual understanding through steelmanned summaries.
- Distinguish disagreement types (empirical, value, semantic, policy).
- Preserve participant safety with moderation and redaction controls.
- Maintain auditable analysis lineage and security-sensitive event logs.

## Core Capabilities

- Account and auth:
  - Email/password registration with email verification
  - OAuth (Google and Microsoft)
  - SAML SSO path for institutional orgs
  - MFA support (TOTP and SMS)
- Session lifecycle:
  - Topic creation, participant invitation, shareable links
  - Position submission with character/readability assistance
  - Optional anonymous mode and optional submission deadline
- Analysis:
  - 5-stage analysis pipeline
  - Sync and async routing based on total input size
  - Round-based re-entry and round-to-round comparison
  - Confidence indicators for output sections
- Moderation and trust:
  - Auto-flag and participant reporting
  - Moderator queue and appeal flow
  - Severity taxonomy and participant-visible SLA summary
- Export and sharing:
  - PDF, Markdown, and JSON exports (available to all session participants)
  - Revocable read-only share links
- Privacy and compliance features:
  - PII redaction pipeline before LLM calls
  - Data export and account deletion endpoints
  - Consent and data subject request records
  - Subprocessor inventory endpoint

## Demo Walkthrough

[![Common Ground Demo](https://img.youtube.com/vi/TbjtFvMk2Hk/maxresdefault.jpg)](https://youtu.be/TbjtFvMk2Hk)

[![YouTube](https://img.shields.io/badge/YouTube-Watch%20Demo-red?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/TbjtFvMk2Hk)

## How the System Works

### 1) Position intake

Participants submit individual position text for a shared topic. Before analysis:

- Content policy warnings can be shown.
- Position visibility can be restricted (anonymous mode + pre-analysis privacy).
- Combined input is measured to choose sync or async path.

### 2) Redaction gate

All analysis-bound text passes a 4-stage redaction pipeline:

1. Detect potential PII
2. Mask sensitive fragments
3. Validate transformed text
4. Uncertainty check

If redaction confidence falls below threshold, analysis is blocked and session state moves to `needs_input`.

### 3) Analysis pipeline

The engine runs these stages in order:

1. Normalization
2. Steelman generation
3. Value extraction
4. Conflict classification
5. Synthesis

Outputs are stored as structured artifacts (`AnalysisResult`) with reproducibility metadata (provider/model/version/hash fields).

### 4) Delivery and interaction

The web app polls analysis state (`queued`, `running`, `completed`, `failed`, `needs_input`). On completion, participants can:

- Review steelmans and synthesis
- React per section (`represents`, `misrepresents`, `neutral`)
- Add section comments
- Submit post-analysis ratings
- Export artifacts
- Re-enter with revised positions for a new round

### 5) Notification handling

Email notifications (including analysis completion) use a durable outbox model in the API with retry/backoff and delivery status tracking.

## End-to-End User Flow

1. User registers or signs in.
2. Creator opens a session and sets topic/options.
3. Participants join via link or email invitation.
4. Each participant submits position text.
5. Creator triggers analysis.
6. API runs redaction and analysis pipeline (sync or queued async).
7. Session transitions to `completed` with result artifacts.
8. Completion notifications are dispatched.
9. Participants review, react, comment, rate, and optionally export.
10. Optional re-entry starts next round with lineage preserved.

## Architecture

Monorepo with two apps and shared packages.

- `apps/api`: Express API, Prisma ORM, PostgreSQL, queue worker logic
- `apps/web`: Next.js app (React), NextAuth integration
- `packages/shared`: Zod contracts and shared types
- `packages/config`: environment schema and parsing

Primary runtime technologies:

- TypeScript
- Next.js 15
- Express 4
- Prisma + PostgreSQL
- BullMQ (Redis-backed queue when configured)
- LLM provider adapters (Mistral/Groq/OpenRouter/OpenAI-compatible patterns)

## Data Model Highlights

Key entities:

- `User`, `RefreshToken`, `EmailVerificationToken`
- `Session`, `SessionParticipant`, `PositionSnapshot`
- `AnalysisResult`, `AnalysisEvent`, `PromptLog`
- `ModerationFlag`, `NotificationEmail` (outbox)
- `ShareLink`, `FeedbackRating`, `SectionReaction`, `SectionComment`
- Compliance models: `ConsentRecord`, `DataSubjectRequest`, `SubprocessorEntry`

## Security, Privacy, and Moderation

- JWT-based API auth with refresh-token rotation.
- Role/permission checks for privileged actions.
- Denied-action and auth event audit logging.
- Rate limiting and security headers via middleware.
- Redaction-before-LLM enforcement.
- Moderation lifecycle with report queue, action states, appeals, and SLA visibility.

## Performance and Reliability Design

- Input-threshold routing for sync/async analysis.
- Async queue with Redis-backed worker when `REDIS_URL` is set.
- Outbox-based email reliability with retries and status records.
- Session ETA estimation for async runs.
- Backup/restore scripts included for operational workflows.

## API Surface (High-Level)

Representative endpoints (not exhaustive):

- Auth: `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/verify-email`
- Sessions: `/sessions`, `/sessions/:id/positions`, `/sessions/:id/analyze`, `/sessions/:id/analysis`
- Moderation: `/moderation/report/:sessionId`, `/moderation/queue`, `/moderation/session/:sessionId/sla`
- Profile: `/profile`
- Sharing: `/share-links/*`
- Privacy: `/privacy/export`, `/privacy/account`, `/privacy/subprocessors`
- Billing: `/billing/*`
- Institutional admin: `/admin/*`, `/saml/*`

For exact request/response contracts, see `packages/shared/src/contracts.ts`.

## Local Development Setup

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL database
- API keys for at least one LLM provider

### Install

```bash
npm install
```

### Configure env

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Populate required values (database URL, auth secrets, provider keys, etc.).

### Database

```bash
npm -w @common-ground/api run prisma:generate
cd apps/api
npx prisma migrate deploy
npm run db:seed
```

### Run services

In separate terminals:

```bash
npm -w @common-ground/api run dev
npm -w @common-ground/web run dev
```

Default local URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:4100`

## Environment Variables

Commonly used variables:

- API/Auth: `DATABASE_URL`, `NEXTAUTH_SECRET`, `API_BASE_URL`, `NEXTAUTH_URL`, `CORS_ORIGIN`
- LLM providers: `MISTRAL_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`
- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- SMS MFA: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_PHONE`, `SMS_MFA_SECRET`
- Queue: `REDIS_URL`
- Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs
- Observability: `SENTRY_DSN`, optional Datadog env vars

See `apps/api/.env.example` and `apps/web/.env.example` for the full list.

## Testing and Quality Gates

API:

```bash
npm -w @common-ground/api test
npm -w @common-ground/api run typecheck
```

Web:

```bash
npm -w @common-ground/web test
npm -w @common-ground/web run typecheck
```

Additional scripts:

- Accessibility smoke checks: `scripts/a11y-smoke.js`
- Backup/restore helpers: `scripts/backup-db.sh`, `scripts/restore-db.sh`

## Operational Notes

- Resend test-mode accounts can only send to allowed recipients until a domain is verified.
- `NEXTAUTH_URL` should point to your actual web origin so links in emails resolve correctly.
- Export endpoints are authorized for all session participants.
- For production/staging deployments, use `prisma migrate deploy` (not `migrate dev`).

## Known Deployment Dependencies

Some non-functional requirements are deployment/platform dependent and require infra controls outside this repo, including:

- TLS policy enforcement
- At-rest encryption configuration
- secrets manager integration
- uptime/failover guarantees
- formal benchmark evidence and restore-drill reporting

## Repository Structure

```text
apps/
  api/        Express API, Prisma schema/migrations, services, routes
  web/        Next.js app, UI components, auth pages
packages/
  shared/     shared contracts and DTO schemas
  config/     environment parsing/validation
scripts/      operational and quality scripts
tests/        e2e notes and test artifacts
```

## License

Proprietary. All rights reserved.
