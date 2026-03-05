# E2E Scenarios (MVP)

## Functional

1. Create a session from `/create`.
2. Submit position text >= 100 chars.
3. Trigger analysis.
4. Confirm status transitions and map rendering.
5. Submit feedback.

## Security/Privacy

1. Verify participant cannot read other raw position before `completed`.
2. Verify low-confidence redaction blocks processing (`needs_input`).

## Reliability

1. Trigger large combined input (>4000 chars) and verify queued path.
2. Confirm queued job finishes and status transitions to `completed`.
