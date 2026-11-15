# QuizRoom — Architecture

A host logs in, builds a quiz by hand or from study notes with the help of a language model, reviews and approves the questions, and opens a game room. Guest players join with the room code and a nickname, answer each question the host opens, and see the correct answer and the leaderboard after every round.


## The 5 services

| Service | Port | Stack | What it does | Its data |
|---|---|---|---|---|
| **Accounts** | 8081 | Java / Spring Boot | Registers hosts, checks their login, issues JWTs | `hosts` (id, email, password, displayName) — in memory for now |
| **Question Library** | 8082 | Java / Spring Boot | Quizzes and questions, draft/approved status, notes and explanations, calls AI for drafts, hands out quiz snapshots | `quizzes`, `questions` in PostgreSQL `library` |
| **Live Game Sessions** | 3000 | TypeScript / Node.js / itty-sockets | Room codes, participants, game state, which question is open, accepted answers, publishes all live events | In memory (a room only lives while the game runs) |
| **Scoring** | 8083 | Java / Spring Boot | Checks answers, awards points, keeps totals and ranks, stores finished games | `games`, `answers`, `scores` in PostgreSQL `scoring` |
| **AI Quiz Authoring** | 8000 | Python / FastAPI | Sends notes to a pretrained language model, parses the JSON answer, validates every draft | None (stateless) |

One PostgreSQL server with a separate database per service. No service reads another service's database; it calls that service's API instead.

## How they talk

- **The browser sends every action over REST** (HTTP + JSON): login, quiz editing, creating and controlling a room, joining, submitting answers, past results.
- **Question Library calls AI Quiz Authoring** to turn notes into draft questions.
- **Live Game Sessions calls Question Library** once per room to take a fixed snapshot of the quiz.
- **Live Game Sessions calls Scoring** when a question closes (score the round) and when the game ends (store the final result).
- **Real time goes through [ittysockets](https://ittysockets.com/)**, a hosted WebSocket relay. Each room gets its own relay channel. Live Game Sessions is the only one allowed to send on it; host and players only listen, and receive participant changes, opened/closed questions, answer counts, and leaderboards.

### How a room uses the relay

1. When a room is created, Live Game Sessions connects first to a channel with an unguessable name (`quizroom-<uuid>`) and sets two keys: a `joinKey` (needed to connect) and a `sendKey` (needed to send). The `sendKey` never leaves the service.
2. The host and every player get the channel name and `joinKey` from Live Game Sessions over REST, so only people in the room can listen.
3. Clients connect without the `sendKey`, so the relay rejects anything they try to send. A player cannot fake a "question closed" or a leaderboard.
4. Players connect with `as: <participantId>` and `announce: true`. The relay tells Live Game Sessions when that participant joins or leaves, which drives the participant list.
5. The channel disappears when the last connection closes; Live Game Sessions disconnects when the game ends.

```mermaid
flowchart LR
    Host["Host browser"]
    Player["Player browser<br/>(guest)"]

    subgraph Backend
        ACC["Accounts<br/>Spring Boot :8081"]
        LIB["Question Library<br/>Spring Boot :8082"]
        LGS["Live Game Sessions<br/>Node.js :3000"]
        SCO["Scoring<br/>Spring Boot :8083"]
        AI["AI Quiz Authoring<br/>FastAPI :8000"]
    end

    RELAY(["ittysockets relay<br/>(hosted)"])
    LLM(["Pretrained LLM<br/>provider API"])
    LIBDB[("PostgreSQL<br/>library")]
    SCODB[("PostgreSQL<br/>scoring")]

    Host -- "REST: register, login" --> ACC
    Host -- "REST: quizzes, drafts, approval" --> LIB
    Host -- "REST: create and control room" --> LGS
    Player -- "REST: join, answer" --> LGS
    Host -- "REST: past results" --> SCO

    LIB -- "REST: generate drafts" --> AI
    AI -- "HTTPS" --> LLM
    LGS -- "REST: quiz snapshot" --> LIB
    LGS -- "REST: score round, finish game" --> SCO

    LIB --- LIBDB
    SCO --- SCODB

    LGS -. "WebSocket: publish events" .-> RELAY
    RELAY -. "WebSocket: live events" .-> Host
    RELAY -. "WebSocket: live events" .-> Player
```

Solid arrows are REST calls; dotted arrows are live WebSocket connections through the ittysockets relay.

## Main flow

The full step-by-step sequence is in [game-flow.md](game-flow.md); every endpoint and event is listed in [api.md](api.md).

1. Host logs in (Accounts) and gets a JWT.
2. Host creates a quiz and adds questions by hand or generates drafts from notes (Question Library → AI Quiz Authoring).
3. Host edits, approves, or discards drafts. A quiz with 1–10 approved questions is ready.
4. Host creates a room (Live Game Sessions), which takes a snapshot of the quiz, opens a relay channel, and returns a room code.
5. Players join with the code and a nickname, receive a guest session id and the channel details, and start listening on the relay.
6. For each question the host opens answering, players submit one answer each, the host closes answering, Scoring awards points, and everyone sees the correct answer and the leaderboard.
7. Host ends the game; Scoring stores the final scoreboard, which the host can open later.

## Security

- **Hosts** send `Authorization: Bearer <JWT>` on every protected call. Each service checks the token itself with the shared `JWT_SECRET`, so no service calls Accounts per request. Ownership is checked with the token's `sub` (host id): a host can only touch their own quizzes, rooms, and results.
- **Room control** (start, open, close, end) is REST with the host's JWT; Live Game Sessions only accepts it from the room's owner.
- **Guests** get a secret `sessionId` and a public `participantId` when they join. Every answer must carry the `sessionId`, so answers are tied to the right participant. The `participantId` is what other clients see on the relay, so nobody can learn another player's `sessionId`.
- **Relay channel:** unguessable name plus `joinKey` so only the room can listen; `sendKey` kept on the server so only Live Game Sessions can publish.
- **Correct answers stay on the server** until a question is closed. `question:opened` contains only the text and the four options.
- **LLM provider key** lives only in the AI Quiz Authoring service's environment.
- When Live Game Sessions calls another service on the host's behalf, it forwards the host's JWT.

## Reliability rules

| Rule | How |
|---|---|
| Timeouts on every service call (T02) | Library → AI: 60 s (models are slow). Sessions → Library / Scoring: 5 s. |
| Defined errors (T02, F11) | REST errors use one JSON shape: `{type, title, status, detail}` (RFC 7807). Live Game Sessions adds a `code` field (for example `ROOM_NOT_FOUND`). |
| Failure is never success (T02) | If AI is down, the host gets 503 and nothing is saved. If Scoring is down, the question stays closed-but-unscored and the host can retry. |
| Server decides (T05) | Only Live Game Sessions decides if a question is open and if a player may answer. Scores are computed only by Scoring, never taken from a client. |
| Fixed snapshot (T05) | The room copies the approved questions when it is created. Later library edits do not affect a running game. |
| No double counting (T05) | Sessions keeps one accepted answer per player per question. Scoring stores answers with a unique key (game, question, player), so repeating a score request returns the same result instead of adding points again. |
| AI output is checked (T06) | Required fields, question count, non-empty text, four distinct options, valid correct index, and the supporting excerpt must appear in the notes. Failing drafts are dropped. Passing drafts are still only `DRAFT` until the host approves them. |

## Stack

- Java 21 + Spring Boot 3 for Accounts, Question Library, Scoring (Spring Security for JWTs, Spring Data JPA + Flyway for PostgreSQL)
- TypeScript + Node.js 22+ for Live Game Sessions, with the `itty-sockets` npm package to publish on the relay
- Python + FastAPI for AI Quiz Authoring (automatic Swagger docs at `/docs`)
- PostgreSQL, one server, one database per service
- Web frontend with the `itty-sockets` client to listen for live events
- Configuration through environment variables, one `.env.example` per service (no real secrets)

### Note on real-time

T02 names Socket.IO for live events. This project uses ittysockets instead, a free hosted relay with no uptime guarantee. Live games therefore need an internet connection, even when all services run locally.

## Folder layout

```
QuizRoom/
  docs/
  frontend/
  services/
    accounts/              Java / Spring Boot
    question-library/      Java / Spring Boot
    scoring/               Java / Spring Boot
    live-game-sessions/    TypeScript / Node.js / itty-sockets
    ai-quiz-authoring/     Python / FastAPI
```
