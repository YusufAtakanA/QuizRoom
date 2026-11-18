# ADR 0001: Five separately deployed services

## Status

accepted, 2026-11-17

## Context

QuizRoom is built by one person. The course (lectures 3.4 and 3.6) says that for a small team a modular monolith usually fits better than microservices: one deployment, in-process calls, one database with clear module boundaries.

The assignment does not leave this open. T01 requires five independently runnable services with defined responsibilities: Accounts, Question Library, Live Game Sessions, Scoring and AI Quiz Authoring. T03 requires that each service controls its own data and that no service reads another service's tables.

## Alternatives

- **Modular monolith.** One application with five modules. Cheaper to run and test, but does not meet T01.
- **Five services sharing one database.** Meets "five services" on paper, but breaks T03 and couples every service to every schema.
- **Five services, each owning its data.** Meets T01 and T03.

## Decision

Five services, each started and deployed on its own, each owning its data:

| Service | Owns |
|---|---|
| Accounts | hosts |
| Question Library | quizzes and questions |
| Live Game Sessions | running rooms (in memory) |
| Scoring | games, running scores, scored questions, final results |
| AI Quiz Authoring | nothing (stateless) |

## Consequences

What we pay:

- Network calls instead of method calls, each with a timeout and a defined error (T02).
- Partial failure: Scoring or the AI service can be down while the rest works. Every caller must handle that without reporting success.
- Three runtimes (Java, Node.js, Python) and five processes to start, configure and test.

How we avoid a distributed monolith:

- Each service has its own data. Nobody reads another service's tables; they call its API.
- Synchronous chains are short: at most two hops (browser → Live Game Sessions → Scoring or Question Library, browser → Question Library → AI Quiz Authoring).
- A room takes a fixed snapshot of the quiz when it is created, so a running game never calls Question Library.
- Scoring is idempotent per question (each scored question is recorded once per game with a unique key on game and question index, plus optimistic locking), so a retried close never adds points twice.
- No shared tables and no shared code library. The only shared thing is the JWT secret (see [ADR 0006](0006-jwt-shared-secret.md)).

## Review condition

Review if a change to one service regularly needs a matching change to another service in the same commit, or if a request needs a synchronous chain of more than two service calls.
