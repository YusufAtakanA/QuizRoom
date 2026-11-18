# ADR 0003: Embedded H2 file databases for Question Library and Scoring

## Status

accepted, 2026-11-17

## Context

T03 requires saved quizzes and finished games to survive restarts, and each service to own its data. The development machine has no database server, and T09 asks for a simple local setup.

## Alternatives

- **One PostgreSQL server with one schema per service.** Allowed by T03 and closer to production, but needs a server installed and running.
- **In-memory H2.** Nothing to install, but data is lost on restart, which breaks T03.
- **Embedded H2 in file mode, one file per service.**

## Decision

Question Library and Scoring each use an embedded H2 database in file mode: `data/library` and `data/scoring` inside the service folder, git-ignored. The URL comes from `LIBRARY_DB_URL` and `SCORING_DB_URL`. Each database has exactly one owner and one schema; no other service opens it.

## Consequences

- Nothing to install, and data survives restarts.
- Ownership is physical: another service cannot reach the file.
- Only one process can open a file at a time, so neither service can run as more than one instance.
- Moving to a database server later only changes the URL and the JDBC driver.

## Review condition

Review when a service is deployed beyond one machine, when a service needs more than one instance, or when concurrent load needs a database server.
