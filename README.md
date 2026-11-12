<p align="center">
  <img src="assets/logo.png" alt="Common Ground logo" width="120" />
</p>

<h1 align="center">Common Ground</h1>

<p align="center">
  AI-mediated conversations that turn disagreement into shared understanding.
</p>

<p align="center">
  <a href="https://common-ground.100-60-92-23.sslip.io"><img src="https://img.shields.io/badge/Live%20Demo-137D6B?style=for-the-badge" alt="Live Demo" /></a>
  <a href="https://youtu.be/TbjtFvMk2Hk"><img src="https://img.shields.io/badge/Walkthrough-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="Walkthrough" /></a>
</p>

<p align="center">
  <a href="https://common-ground.100-60-92-23.sslip.io"><img src="assets/common-ground.png" alt="Common Ground landing page" width="100%" /></a>
</p>

Common Ground is a structured discourse platform for conversations where people disagree but still want to understand one another. Participants contribute their perspectives, an AI pipeline analyzes the strongest version of each position, and the product produces a Common Ground Map separating shared foundations, important differences, and unresolved disagreements.

The goal is not to score a winner. It is to make the conversation clearer, fairer, and more constructive.

> The public deployment is a limited beta running on AWS Lightsail with a temporary `sslip.io` hostname. Do not submit sensitive or confidential information.

## What you can do

- Create a guided conversation around a shared topic.
- Invite participants by link or email.
- Submit and revise perspectives across multiple rounds.
- Run a five-stage AI analysis, with structured personal data masked before provider calls.
- Review steelmanned positions, shared values, conflict types, and synthesis.
- React to individual result sections and leave contextual comments.
- Report unsafe content and follow moderation status.
- Share a revocable, read-only result link.
- Export results as PDF, Markdown, or JSON.
- Manage profile, MFA, privacy export, and account deletion controls.
- Enable Stripe billing and external export storage through feature flags.

## Product journey

1. Sign in and create a conversation.
2. Define the topic, privacy mode, and optional deadline.
3. Invite the people whose perspectives should be represented.
4. Each participant submits a position in their own words.
5. The API redacts sensitive information and runs the analysis pipeline.
6. Participants explore the Common Ground Map and provide feedback.
7. The group can revise perspectives and begin another round.

## How analysis works

Before anything is sent to a model, structured personal data is replaced with placeholders in the topic and in every perspective: email addresses, phone numbers, US social security numbers, payment card numbers, IP addresses and dates of birth. This is pattern matching, not language understanding, so names, street addresses and other free-text details are not detected; participants should leave them out. Each run logs which kinds of values were masked and where, never the values themselves.

The analysis then runs five stages:

1. Normalize the submitted positions.
2. Generate a charitable steelman of each position.
3. Extract shared and divergent values.
4. Classify empirical, value, semantic, and policy conflicts.
5. Synthesize common ground and the remaining disagreements.

Results are stored as structured analysis artifacts with provider, model, version, and lineage metadata. Every analysis runs in the background: the request queues it in PostgreSQL and returns at once, and an analysis worker claims queued conversations, runs them, and puts runs abandoned by a crashed worker back in the queue.

## Architecture

```mermaid
flowchart LR
    Browser[Next.js web app] -->|HTTPS| Caddy[Caddy reverse proxy]
    Caddy --> Web[Next.js container]
    Caddy --> API[Express API container]
    Web -->|Internal OAuth exchange| API
    API --> DB[(PostgreSQL)]
    API --> LLM[OpenRouter]
    API -. optional .-> Stripe[Stripe]
    API -. optional .-> Email[Resend]
    API -. optional .-> Storage[R2 / S3-compatible storage]
```

The monorepo contains:

- `apps/web` — Next.js 15 interface and NextAuth integration.
- `apps/api` — Express API, Prisma data access, workers, and provider services.
- `packages/shared` — shared Zod contracts and TypeScript types.
- `packages/config` — runtime environment parsing and validation.
- `e2e` — Playwright coverage for the primary product journey.
- `docker` — production API and web image definitions.

The beta deployment uses one AWS Lightsail instance with Caddy, the web and API containers, and PostgreSQL. Images are stored in private ECR. Database backups are encrypted in S3, and container logs are shipped to CloudWatch.

## Technology

- TypeScript, React, and Next.js 15
- Express 4 and Prisma
- PostgreSQL 16
- NextAuth and JWT refresh-token rotation
- OpenRouter for LLM access
- A PostgreSQL-backed analysis queue and worker
- Stripe, Resend, Twilio, Sentry, and S3-compatible integrations
- Docker Compose, Caddy, AWS Lightsail, ECR, S3, and CloudWatch
- Vitest, Supertest, and Playwright

## Security and privacy

- Structured personal data (emails, phone numbers, SSNs, card numbers, IP addresses, dates of birth) is masked in the topic and perspectives before LLM analysis. Names and addresses are not detected.
- API access uses short-lived JWTs and rotating refresh tokens.
- The NextAuth-to-API OAuth exchange uses a separate internal secret and is blocked at the public proxy.
- Authorization checks protect sessions, exports, moderation, billing, and administration.
- Security-sensitive actions are recorded in audit logs.
- Rate limiting, secure headers, restricted CORS, and HTTPS are enabled in staging.
- Account erasure revokes tokens, pseudonymizes user data, and scrubs authored positions.
- Free-tier retention cleanup removes expired conversation data and linked records.

SAML exists only as an experimental path and is rejected in production. It requires signed assertion validation, audience and destination validation, request correlation, replay protection, and interoperability testing before launch.

## Local development

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL
- Docker for browser and disposable-database tests
- An OpenRouter API key for real analysis

### Install

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Generate two different random secrets of at least 32 characters. `NEXTAUTH_SECRET` and `OAUTH_EXCHANGE_SECRET` must each match between the API and web environments, but they must not match one another.

Configure the database and generate the Prisma client:

```bash
npm -w @common-ground/api run prisma:generate
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Start the applications in separate terminals:

```bash
npm -w @common-ground/api run dev
npm -w @common-ground/web run dev
```

Default addresses:

- Web: `http://localhost:3000`
- API health: `http://localhost:4100/health`
- API readiness: `http://localhost:4100/ready`

## Environment configuration

The application treats integrations as capabilities: credentials configure a provider, while feature flags decide whether users can access it.

The checked-in container profile is intentionally locked to the invite-only beta: public registration, social OAuth buttons, billing, SMS MFA, SAML, external export storage, and Datadog are disabled. TOTP, the core conversation journey, local exports, sharing, moderation, and privacy controls remain available.

Required API settings:

```env
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=at-least-32-random-characters
OAUTH_EXCHANGE_SECRET=a-different-32-character-secret
CORS_ORIGIN=http://localhost:3000
```

Required web settings:

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=the-same-nextauth-secret-as-the-api
OAUTH_EXCHANGE_SECRET=the-same-exchange-secret-as-the-api
API_BASE_URL=http://localhost:4100
NEXT_PUBLIC_API_BASE_URL=http://localhost:4100
```

Analysis runs through OpenRouter. Put `OPENROUTER_API_KEY` in `apps/api/.env` (never commit it). By default the API uses OpenRouter's Auto Router (`openrouter/auto`), which picks a model for each request:

- `OPENROUTER_COST_TIER` (default `medium`) sets the cost band the router chooses within, from `low` through `max`; `medium` balances cost and capability.
- `OPENROUTER_ALLOWED_MODELS` optionally restricts the router to model patterns, for example `openai/*,google/*`.
- `OPENROUTER_MODEL` pins a single model (for example `openai/gpt-oss-120b`) instead of routing.

All five stages of one analysis share a routing session, requests avoid providers that store or train on prompt data, and every model that answered is recorded with the result.

`TRUST_PROXY_HOPS` (default `1`) is the number of reverse proxies in front of the API, so rate limits and audit logs see the real client address. With the default, keep the API port unreachable from the internet; a client talking to the API directly could otherwise choose its own address. Set it to `0` if the API is ever served without a proxy.

Optional integrations include:

- Billing: Stripe secret, webhook secret, price IDs, and `ENABLE_BILLING=true`.
- Email: Resend API key and sender address.
- SMS MFA: Twilio credentials, a separate MFA secret, and the API/web SMS flags.
- Process roles: `API_PROCESS_ROLE` is `all` (default: HTTP API plus analysis worker), `api`, or `worker`. Analyses queue in PostgreSQL, so at least one process must run with `all` or `worker`.
- External exports: R2 credentials and `ENABLE_EXTERNAL_EXPORT_STORAGE=true`.
- Monitoring: Sentry or Datadog credentials and flags.

Never commit `.env`, `.env.local`, provider keys, webhook secrets, or production connection strings.

## Quality gates

Run the standard repository checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:accessibility
```

Run the migration-backed API integration suite with a disposable database whose name contains `test`:

```bash
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/common_ground_test npm run test:integration
```

Run the primary browser journey:

```bash
npx playwright install chromium
npm run test:e2e
```

The E2E runner creates an isolated PostgreSQL container, applies every migration, starts dedicated API and web processes, exercises the core journey, and removes its database afterward. Paid or external boundaries use deterministic fixtures where appropriate.

Current automated coverage includes authentication, profile updates, TOTP setup, conversation creation, invitations, moderation reports, perspective submission and revision, completed analysis rendering, public sharing, reactions, comments, feedback, and PDF/Markdown/JSON exports.

## Containers

The production images run as an unprivileged `node` user. The local Compose profile includes PostgreSQL, which also serves as the analysis queue.

```powershell
$env:POSTGRES_PASSWORD = "replace-with-a-long-random-password"
$env:NEXTAUTH_SECRET = "replace-with-at-least-32-random-characters"
$env:OAUTH_EXCHANGE_SECRET = "replace-with-a-different-32-character-secret"

docker compose build
docker compose up -d db
docker compose run --rm api ./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma
docker compose up -d api web
```

Local container addresses:

- Web: `http://localhost:3001`
- API health: `http://localhost:4100/health`
- API readiness: `http://localhost:4100/ready`

## Beta limitations

- The public link uses a temporary hostname rather than an owned domain.
- Email delivery remains restricted by the configured sender/domain status.
- The API, analysis worker, and email outbox share a process in the beta profile. Several workers can share the queue safely, but the email outbox has not been checked for running in more than one process.
- Automated accessibility checks do not replace manual keyboard and screen-reader acceptance testing.
- Real provider behavior still depends on LLM, email, Stripe, SMS, OAuth, and storage sandbox or production configuration.
- SAML is not production-ready and must remain disabled.

## API overview

Representative route groups:

- `/auth` — registration, login, refresh, verification, and internal OAuth exchange.
- `/sessions` — conversation lifecycle, positions, analysis, invitations, and exports.
- `/share-links` — revocable public result sharing.
- `/moderation` — reports, queue actions, appeals, and SLA information.
- `/profile` and `/mfa` — account preferences and multi-factor authentication.
- `/privacy` — data export, account erasure, and subprocessors.
- `/billing` — Stripe checkout, portal, and webhook handling.
- `/admin` — institutional administration.

Exact request and response schemas live in `packages/shared/src/contracts.ts`.

## Repository status

The staging release currently provides HTTPS, health/readiness checks, encrypted database backups, restore validation, CloudWatch logs, Lightsail alarms, and an immutable ECR release process. Launch work still includes an owned domain, provider callback updates, formal policies, manual accessibility acceptance, email-domain authentication, and a limited beta review.

## License

Proprietary. All rights reserved.
