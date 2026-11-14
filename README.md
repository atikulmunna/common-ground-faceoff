<p align="center">
  <img src="assets/logo.svg" alt="Common Ground logo: two overlapping circles, teal and yellow, overlapping in green" width="120" />
</p>

<h1 align="center">Common Ground</h1>

<p align="center">
  Find the ground you share. Everyone writes what they think; Common Ground restates each view fairly and shows the points you share and the few you really differ on.
</p>

<p align="center">
  <a href="https://common-ground.100-60-92-23.sslip.io"><img src="https://img.shields.io/badge/Live%20Demo-137D6B?style=for-the-badge" alt="Live Demo" /></a>
  <a href="https://youtu.be/TbjtFvMk2Hk"><img src="https://img.shields.io/badge/Walkthrough-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="Walkthrough" /></a>
</p>

<p align="center">
  <a href="https://common-ground.100-60-92-23.sslip.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/landing-dark.png" />
      <img src="assets/landing-light.png" alt="Common Ground landing page: the headline Find the ground you share, printed in overlapping teal and yellow" width="100%" />
    </picture>
  </a>
</p>

Common Ground is for conversations where people disagree but still want to understand one another. Each person writes their perspective; an analysis restates every view in its clearest, fairest form, then shows the points they share, backed by words from each view, and the differences that remain worth talking about.

The goal is not to score a winner. It is to make the conversation clearer, fairer, and more constructive.

> The public deployment is a limited beta running on AWS Lightsail with a temporary `sslip.io` hostname. Do not submit sensitive or confidential information.

## What you can do

- Start a conversation around one question, with an optional deadline and an anonymous mode that stays anonymous after the results.
- Invite people by email and see who has taken part and who has submitted.
- Write a perspective by answering three questions (what you believe, why, and what could change your mind), or write freely.
- Follow the analysis stage by stage while it runs, and get an email when the results are ready.
- Read the results as cards: each common point with the quote from every person's restated view that backs it, and each difference with its kind (facts, values, definitions or approach) and what could change minds on factual ones.
- See how many proposed common points held up when checked against every restated view.
- Confirm your own restated view ("Is this what you meant?"), say you understand the others, and leave comments; a "Not quite" note comes back when you revise your perspective.
- Answer "Did this feel fair to you?" after the results.
- Start another round, and see what changed since the last one: new common ground, and differences that were resolved or narrowed.
- Share a revocable, read-only link that unfurls with the question and a summary in chat apps, and export results as PDF, Markdown or JSON.
- Report a problem; moderators review reports and can hold a conversation.
- Manage your profile, two-step sign-in, data export and account deletion. The site follows your system's light or dark setting.

## Product journey

1. Sign in and start a conversation with a question, an optional deadline and, if you like, anonymity.
2. Invite the people whose perspectives should be represented.
3. Each person answers in their own words; nobody sees anyone else's words until the results are ready (and never in an anonymous conversation).
4. The host finds common ground. The API masks personal data and runs the analysis in the background.
5. Everyone reads the results, confirms how their view was restated, and says whether it felt fair.
6. The group can revise their perspectives and start another round.

<p align="center">
  <img src="assets/results.png" alt="A results page: You agree on 2 points and differ on 2, with each common point shown between a quote from each person's view, and each difference labelled Approach or Facts" width="100%" />
</p>

## How analysis works

Before anything is sent to a model, structured personal data is replaced with placeholders in the topic, every perspective and every "what could change your mind" answer: email addresses, phone numbers, US social security numbers, payment card numbers, IP addresses and dates of birth. This is pattern matching, not language understanding, so names, street addresses and other free-text details are not detected; participants should leave them out. Each run logs which kinds of values were masked and where, never the values themselves.

The analysis then runs five stages:

1. Normalize the submitted perspectives.
2. Restate each one in its clearest, fairest form, without adding anything the person did not say.
3. Find what matters to each person.
4. Classify the differences as facts, values, definitions or approach.
5. Synthesize the shared foundations and the differences that remain, each with a verbatim quote from every restated view it relies on. Factual differences can say what evidence would settle them, based on what people said could change their minds.

Every quote is checked against the restated views, and a point whose quotes do not hold up is dropped. The result records how many proposed points held up, which is what the page shows instead of the model's own confidence. From round 2 on, a sixth stage compares the new results with the previous round's.

Results are stored with each point and its quotes, each person's values, the prompt version, and the provider, model and lineage metadata. Every analysis runs in the background: the request queues it in PostgreSQL and returns at once, and an analysis worker claims queued conversations, runs them, and puts runs abandoned by a crashed worker back in the queue.

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

- `apps/web`: Next.js 15 interface and NextAuth integration.
- `apps/api`: Express API, Prisma data access, workers, and provider services.
- `packages/shared`: shared Zod contracts and TypeScript types.
- `packages/config`: runtime environment parsing and validation.
- `e2e`: Playwright coverage for the primary product journey.
- `docker`: production API and web image definitions.

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
- Anonymous conversations stay anonymous after the results: other people's accounts and words are never returned, and participant labels do not follow the order people joined.
- Share links show the results only: never participants' own words, the model used, or confidence scores. Shared pages are kept out of search engines, and link previews never include names.

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

The checked-in container profile is intentionally locked to the invite-only beta: public registration, social OAuth buttons, billing, SMS MFA, external export storage, and Datadog are disabled. TOTP, the core conversation journey, local exports, sharing, moderation, and privacy controls remain available.

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

Current automated coverage includes authentication, profile updates, TOTP setup, conversation creation, invitations, moderation reports, the guided perspective editor, the results cards, public sharing, reactions, comments, the fairness question, PDF/Markdown/JSON exports, and starting another round.

The analysis itself is measured by a 30-case quality benchmark that calls the model and needs an OpenRouter key; see [docs/ANALYSIS_QUALITY.md](docs/ANALYSIS_QUALITY.md) for how to run it and the latest results.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, the build and the accessibility smoke check on every pull request and every push to `master`. A second job applies every migration to an empty PostgreSQL 16 database and runs the integration suite against it.

## Deploying

The `Deploy` workflow (`.github/workflows/deploy.yml`) is started by hand from the Actions tab. It builds both images from the selected commit, pushes them to ECR tagged `release-<commit>`, and runs `scripts/deploy/remote-deploy.sh` on the server over SSH. The server's firewall keeps SSH closed: the workflow opens port 22 for its own runner's address, connects with a short-lived certificate that Lightsail issues for the run (no SSH key is stored anywhere), and always closes the port again (`scripts/deploy/lightsail-ssh.sh`). The deploy script backs up the database, points `/opt/common-ground/docker-compose.yml` at the new images, applies migrations, restarts the API and web containers and checks their health; if any step fails it restores the previous images. Migrations that already ran are not undone, so restore the backup with `scripts/restore-db.sh` if a schema change must be reversed.

One-time setup:

1. In AWS IAM, add GitHub's OIDC identity provider (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) and a role that trusts it only for this repository's `production` environment (`sub` = `repo:<owner>/<repo>:environment:production`). Allow:
   - `ecr:GetAuthorizationToken`;
   - on the `common-ground-api` and `common-ground-web` repositories: `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`;
   - on the Lightsail instance: `lightsail:OpenInstancePublicPorts`, `lightsail:CloseInstancePublicPorts` and `lightsail:GetInstanceAccessDetails`.
2. In GitHub, create a `production` environment that only the `master` branch can deploy to (add required reviewers if deploys should need an approval), with:
   - variables `AWS_DEPLOY_ROLE_ARN`, `PUBLIC_API_URL` and `PUBLIC_WEB_URL`;
   - optionally `LIGHTSAIL_INSTANCE` (default `common-ground-staging`), `AWS_REGION` (default `us-east-1`) and the `NEXT_PUBLIC_*` flags for the web build (default `false`).

The `Check server` workflow (`.github/workflows/server-check.yml`) connects the same way and reports the running containers, their published ports and their settings by name, without printing secret values. Run it before a deploy to see what is on the server.

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

## Giving people access

The beta is invite only: public sign-up is off, so an organization administrator gives people their accounts.

1. **Become the administrator (once).** While no administrator exists, the API writes a one-time setup code to its log each time it starts. Read it with the AWS CLI. The command is one line and works in PowerShell and bash; use the last line it prints, because the code changes every time the API restarts:

   ```bash
   aws logs filter-log-events --log-group-name /common-ground/staging/containers --filter-pattern 'organization admin exists' --query 'events[].message' --output text
   ```

   In Git Bash, put `MSYS_NO_PATHCONV=1 ` in front so the log group name is not turned into a Windows path.

   Open `/admin` (you do not need to be signed in). Under "Set up administration", enter the code with your name, email and a password. If an account with that email already exists, it becomes the administrator and gets the new password, so this also works if you have forgotten your own. Then sign in with that email and password. The code stops working once an administrator exists.
2. **Give someone an account.** On the Administration page, enter their name and email under "Give someone an account". The page shows a temporary password once; send the sign-in details privately. This also activates the account that a conversation invitation created for that email.
3. **They choose their own password.** After signing in they see a reminder, and change the password under Password in their profile.

## Beta limitations

- The public link uses a temporary hostname rather than an owned domain.
- Email delivery remains restricted by the configured sender/domain status.
- The API, analysis worker, and email outbox share a process in the beta profile. Several workers can share the queue safely, but the email outbox has not been checked for running in more than one process.
- Automated accessibility checks do not replace manual keyboard and screen-reader acceptance testing.
- Real provider behavior still depends on LLM, email, Stripe, SMS, OAuth, and storage sandbox or production configuration.

## API overview

Representative route groups:

- `/auth`: registration, login, refresh, verification, and internal OAuth exchange.
- `/sessions`: conversation lifecycle, perspectives, analysis and its progress, invitations, reactions, comments, feedback, rounds, and exports.
- `/share-links`: revocable public result sharing.
- `/moderation`: reports, queue actions, appeals, and SLA information.
- `/profile` and `/mfa`: account preferences and multi-factor authentication.
- `/privacy`: data export, account erasure, and subprocessors.
- `/billing`: Stripe checkout, portal, and webhook handling.
- `/admin`: institutional administration and analytics.

Exact request and response schemas live in `packages/shared/src/contracts.ts`.

## Repository status

The staging release currently provides HTTPS, health/readiness checks, encrypted database backups, restore validation, CloudWatch logs, Lightsail alarms, and an immutable ECR release process. Launch work still includes an owned domain, provider callback updates, formal policies, manual accessibility acceptance, email-domain authentication, and a limited beta review.

## License

Proprietary. All rights reserved.
