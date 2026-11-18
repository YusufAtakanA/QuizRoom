# ADR 0005: Synchronous AI generation call

## Status

accepted, 2026-11-17

## Context

Generating draft questions from notes calls a language model and can take tens of seconds. Lecture 7.2 recommends `202 Accepted` with a status resource for long operations: the client gets an id at once and polls until the work is done.

## Alternatives

- **202 Accepted + status resource.** The host is never blocked, but Question Library must store jobs, track their state and clean them up, and the frontend must poll.
- **Synchronous call with a long timeout.** `POST /api/quizzes/{id}/generate` waits for the answer.

## Decision

Synchronous. The browser calls Question Library, which calls `POST /generate` on AI Quiz Authoring with a 120 s timeout (`AI_TIMEOUT`). AI Quiz Authoring keeps all its work, retries included, inside a 100 s budget (`BUDGET_SECONDS` in `generator.py`).

Why:

- It is simpler: no job table, no polling, no cleanup.
- It is one host action: the host presses "Generate drafts" and waits.
- Nothing is saved on failure: either the valid drafts are saved, or the host gets 503 or 504 and nothing changed.
- The 100 s budget inside the 120 s timeout means Question Library always gets a real answer (drafts or a defined error) instead of cutting the call off.

## Consequences

- The host waits up to about 100 s with a request open.
- A Question Library request thread is busy for that time.
- If the browser or a proxy gives up first, the drafts can still be saved; the host sees them after a reload.

## Review condition

Review if generation regularly takes more than about 60 s (the evaluation in [ai-evaluation.md](../ai-evaluation.md) reports median and maximum time), or if more than one generation per host runs at the same time.
