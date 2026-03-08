# Common Ground SRS Compliance Matrix

Date: 2026-03-08  
Source: `Common_Ground_SRS_v1.1.md`  
Assessment basis: repository code, tests, CI workflow, scripts

## Legend
- Implemented: requirement is substantially delivered in code.
- Partial: requirement is partly delivered, but gaps remain.
- Missing: no meaningful implementation found.
- Infra/Ops: depends on deployment/platform controls outside app code.

## Functional Requirements (FR)

### Authentication & Account
- CG-FR01: Partial (registration exists; email verification flow not implemented)
- CG-FR02: Implemented (Google + Microsoft OAuth)
- CG-FR03: Partial (SAML flow present; ACS parsing is simplified and lacks robust signature validation)
- CG-FR04: Implemented (profile update + notification preferences)
- CG-FR05: Implemented (password complexity schema enforcement)
- CG-FR06: Implemented (TOTP + SMS MFA setup/login/disable flows)
- CG-FR07: Implemented (30-min timeout, explicit 5-minute warning UI, activity-based heartbeat)

### Session Creation & Invitation
- CG-FR08: Implemented
- CG-FR09: Implemented
- CG-FR10: Implemented
- CG-FR11: Implemented
- CG-FR12: Implemented
- CG-FR13: Implemented
- CG-FR14: Implemented

### Position Submission
- CG-FR15: Implemented
- CG-FR16: Implemented
- CG-FR17: Implemented
- CG-FR18: Implemented
- CG-FR19: Implemented
- CG-FR20: Implemented

### AI Analysis Pipeline
- CG-FR21: Implemented
- CG-FR22: Implemented
- CG-FR23: Implemented (`Policy` taxonomy aligned; backward-compatible rendering for older `procedural` data)
- CG-FR24: Implemented
- CG-FR25: Implemented
- CG-FR26: Implemented
- CG-FR27: Implemented
- CG-FR28: Partial (timeouts and estimates exist; no hard proof of SLA achievement)
- CG-FR29: Implemented
- CG-FR30: Implemented
- CG-FR55: Implemented
- CG-FR56: Implemented
- CG-FR57: Implemented
- CG-FR58: Implemented
- CG-FR59: Implemented
- CG-FR60: Implemented

### Common Ground Map
- CG-FR31: Implemented
- CG-FR32: Implemented
- CG-FR33: Implemented
- CG-FR34: Implemented
- CG-FR35: Implemented
- CG-FR36: Implemented
- CG-FR68: Implemented
- CG-FR69: Implemented

### Export & Sharing
- CG-FR37: Implemented
- CG-FR38: Implemented
- CG-FR39: Implemented
- CG-FR40: Implemented

### Dashboard & Retention
- CG-FR41: Implemented
- CG-FR42: Implemented
- CG-FR43: Implemented
- CG-FR44: Implemented

### Institutional
- CG-FR45: Implemented
- CG-FR46: Implemented
- CG-FR47: Implemented
- CG-FR48: Implemented
- CG-FR49: Implemented

### Moderation & Safety
- CG-FR50: Implemented
- CG-FR51: Implemented
- CG-FR52: Implemented
- CG-FR53: Implemented
- CG-FR54: Implemented
- CG-FR63: Implemented
- CG-FR64: Implemented
- CG-FR65: Partial (severity and timestamps exist; explicit SLA enforcement/participant-visible SLA not fully implemented)
- CG-FR66: Implemented

### Authorization & External Controls
- CG-FR61: Implemented
- CG-FR62: Implemented
- CG-FR67: Partial (Stripe webhook signature/replay controls implemented; SAML callback security remains simplified)

## Non-Functional Requirements (NFR)

### Performance & Reliability
- CG-NFR01: Partial (no measured proof in repo)
- CG-NFR02: Partial (timeouts/estimates in code; p95 proof absent)
- CG-NFR03: Missing (no concurrency/load benchmark evidence)
- CG-NFR04: Missing (no p95 API latency evidence)
- CG-NFR05: Infra/Ops
- CG-NFR06: Infra/Ops
- CG-NFR07: Infra/Ops
- CG-NFR08: Implemented
- CG-NFR25: Missing (no formal p95 benchmark artifacts)
- CG-NFR26: Missing (no formal p95/p99 async benchmark artifacts)
- CG-NFR35: Partial (backup scripts exist; 15-min log backup schedule not guaranteed by code)
- CG-NFR36: Partial (restore tooling exists; no operational proof of <=15m RPO)
- CG-NFR37: Partial (restore tooling exists; no operational proof of <=60m RTO)
- CG-NFR38: Missing (no quarterly restore-drill automation/evidence)

### Security
- CG-NFR09: Partial (security headers exist; TLS 1.3 is deployment-dependent)
- CG-NFR10: Infra/Ops (at-rest AES-256 depends on DB/storage platform config)
- CG-NFR11: Implemented
- CG-NFR12: Partial (hardening present, but OWASP compliance not formally demonstrated)
- CG-NFR13: Infra/Ops (no secrets manager integration in app)
- CG-NFR14: Implemented
- CG-NFR15: Implemented
- CG-NFR39: Implemented

### Privacy & Compliance
- CG-NFR16: Partial (substantial features shipped; formal compliance program not evidenced in repo)
- CG-NFR17: Implemented
- CG-NFR18: Implemented
- CG-NFR19: Implemented
- CG-NFR29: Partial (benchmark tests exist; weekly audit workflow not automated)
- CG-NFR30: Partial (prompt log exists, but lifecycle retention/deletion automation not evident)
- CG-NFR31: Implemented
- CG-NFR32: Implemented
- CG-NFR33: Implemented
- CG-NFR34: Partial (DB propagation implemented; cache/object storage/search log propagation not fully evidenced)

### Accessibility & Quality Gates
- CG-NFR20: Partial (many a11y improvements; full WCAG AA certification not evidenced)
- CG-NFR21: Partial (patterns exist; full keyboard acceptance suite not complete)
- CG-NFR22: Partial (many ARIA labels; not comprehensive proof for all interactive elements)
- CG-NFR23: Missing (cross-browser validation evidence absent)
- CG-NFR24: Partial (responsive CSS exists; explicit 375px acceptance evidence absent)
- CG-NFR27: Missing (release gate on rolling 1,000-session ratings not implemented)
- CG-NFR28: Implemented
- CG-NFR40: Implemented
- CG-NFR41: Partial (CI a11y smoke exists, but not critical/serious violation threshold scanning)
- CG-NFR42: Missing (no complete keyboard-only acceptance suite)
- CG-NFR43: Missing (no NVDA/VoiceOver smoke evidence in CI)

## Critical findings to close first
1. Implement email verification flow for CG-FR01.
2. Add SMS MFA path for CG-FR06.
3. Replace simplified SAML ACS parsing with proper signed assertion validation.
4. Align conflict taxonomy label (`Policy` vs `procedural`) or update SRS/contracts consistently.
5. Formalize moderation SLA enforcement for CG-FR65.
