# Common Ground

**AI-powered debate and perspective alignment platform.**

Common Ground is a web application where participants with opposing views submit their positions, and AI analyzes the discourse to steelman each argument, map genuine disagreements, and surface shared values — producing a structured **Common Ground Map**.

The system is not a debate judge or persuasion engine. Its purpose is to reduce noise in discourse and increase epistemic clarity.

---

## Features

- **Session-based debates** — Create a topic, invite participants, and collect positions asynchronously
- **5-stage AI analysis pipeline** — Normalization → Steelman → Value Extraction → Conflict Classification → Synthesis
- **Common Ground Map** — Structured output showing steelmanned positions, shared foundations, and true disagreements
- **PII redaction** — Automatic detection and masking before any data reaches LLM providers
- **Privacy controls** — Anonymous mode, position privacy until analysis completes
- **Feedback loop** — Participants rate steelman faithfulness and neutrality (1–5 scale)
- **Share links** — Revocable read-only links for non-participants

## Architecture

```
apps/
  api/        Express.js API server (Prisma, PostgreSQL, JWT auth)
  web/        Next.js frontend (React, NextAuth)
packages/
  shared/     Zod schemas, DTOs, API contracts
  config/     Environment variable parsing and validation
```

**Stack:** TypeScript · Next.js 15 · Express 4 · Prisma · PostgreSQL · Mistral / Groq / OpenRouter LLMs

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- At least one LLM API key (Mistral, Groq, or OpenRouter)

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# Edit the .env files with your database URL and API keys

# Database setup
npm run prisma:generate --workspace=@common-ground/api
npm run prisma:migrate --workspace=@common-ground/api
npm run db:seed --workspace=@common-ground/api

# Start development servers
npm run dev
```

The web app runs on `http://localhost:3000` and the API on `http://localhost:4000`.

## API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Authenticate |
| POST | `/sessions` | Create debate session |
| POST | `/sessions/:id/invite` | Invite participant |
| POST | `/sessions/:id/positions` | Submit position |
| POST | `/sessions/:id/analyze` | Trigger AI analysis |
| GET | `/sessions/:id/analysis` | Poll analysis status/results |
| POST | `/sessions/:id/feedback` | Submit feedback |
| POST | `/sessions/:id/share-links` | Create share link |
| DELETE | `/share-links/:id` | Revoke share link |

## Analysis Pipeline

| Stage | Purpose |
|-------|---------|
| 1. Normalization | Extract core claims, remove rhetorical framing |
| 2. Steelman | Construct the strongest charitable version of each position |
| 3. Value Extraction | Identify implicit values (liberty, fairness, efficiency, etc.) |
| 4. Conflict Classification | Categorize as Empirical, Value-based, Semantic, or Policy |
| 5. Synthesis | Generate shared foundations and true points of disagreement |

## License

This project is proprietary. All rights reserved.
- Build
- Accessibility smoke (`scripts/a11y-smoke.js`)

## Notes

- Auth is scaffolded via request-header demo identity in API middleware for local MVP wiring.
- Queueing is in-memory placeholder and should be swapped with Upstash/worker runtime.
- LLM analysis is deterministic placeholder logic with redaction gating and lineage metadata.
