# API and Live Events

All REST payloads are JSON. Protected endpoints need `Authorization: Bearer <JWT>` from Accounts. "Owner" means the host id in the token must match the owner of the quiz, room, or game.

REST errors use one shape (RFC 7807):

```json
{ "type": "about:blank", "title": "Conflict", "status": 409, "detail": "Email already registered" }
```

## Accounts — `:8081`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/auth/register` | public | `{email, password, displayName}` → 201 `{id, email, displayName}`; 400 invalid; 409 email taken |
| POST | `/api/auth/login` | public | `{email, password}` → 200 `{accessToken, tokenType, expiresIn}`; 401 wrong email or password |
| GET | `/api/accounts/me` | JWT | → 200 `{id, email, displayName}` |

## Question Library — `:8082`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/api/quizzes` | JWT | → host's quizzes `[{id, title, approvedCount, draftCount, ready}]` |
| POST | `/api/quizzes` | JWT | `{title}` → 201 quiz |
| GET | `/api/quizzes/{id}` | owner | → quiz with all questions and their status |
| PUT | `/api/quizzes/{id}` | owner | `{title}` → 200 quiz |
| DELETE | `/api/quizzes/{id}` | owner | → 204 |
| POST | `/api/quizzes/{id}/questions` | owner | `{text, options[4], correctIndex, explanation?}` → 201 question (`DRAFT`) |
| PUT | `/api/quizzes/{id}/questions/{qid}` | owner | same body → 200, status goes back to `DRAFT` |
| POST | `/api/quizzes/{id}/questions/{qid}/approve` | owner | → 200 `APPROVED`; 422 if the question is invalid or the quiz already has 10 approved |
| DELETE | `/api/quizzes/{id}/questions/{qid}` | owner | → 204 (discard) |
| POST | `/api/quizzes/{id}/generate` | owner | `{notes, count}` (1–10) → 201 `{created: [question], rejected: [{reason}]}`; 503 AI unavailable; 504 AI timeout |
| GET | `/api/quizzes/{id}/snapshot` | owner | → `{quizId, title, questions: [{text, options, correctIndex, explanation}]}`; 409 quiz not ready |

A quiz is **ready** when it has 1 to 10 approved questions. Only approved questions go into the snapshot.

## AI Quiz Authoring — `:8000`

Called only by Question Library. Holds the model-provider key.

| Method | Path | Request → Response |
|---|---|---|
| POST | `/generate` | `{notes, count}` → 200 `{model, promptVersion, durationMs, questions: [...], rejected: [{index, reason}]}`; 502 model returned unusable output; 504 model timeout |
| GET | `/health` | → 200 `{status: "ok"}` |

Each generated question:

```json
{
  "text": "What does HTTP status 404 mean?",
  "options": ["OK", "Not Found", "Forbidden", "Server Error"],
  "correctIndex": 1,
  "explanation": "404 means the server could not find the resource.",
  "sourceExcerpt": "A 404 status means the requested resource was not found."
}
```

Validation (T06): required fields present, number of questions ≤ `count`, non-empty text, exactly four distinct options, `correctIndex` in 0–3, `sourceExcerpt` found in `notes`. Failing questions go to `rejected`.

## Live Game Sessions — `:3000`

Every action is a REST call. Live events are published on the room's [ittysockets](https://ittysockets.com/) channel. Errors carry an extra `code` field, for example `{"status": 409, "code": "ALREADY_ANSWERED", "detail": "..."}`.

### REST: host (JWT, room owner only)

| Method | Path | Request → Response |
|---|---|---|
| POST | `/api/rooms` | `{quizId}` → 201 `{roomId, roomCode, channel, joinKey}`; 409 `QUIZ_NOT_READY`; 503 `LIBRARY_UNAVAILABLE` |
| POST | `/api/rooms/{code}/start` | → 200; 409 `INVALID_STATE` if not in lobby |
| POST | `/api/rooms/{code}/open-question` | → 200 `{index}`; 409 `INVALID_STATE` if a question is already open or none are left |
| POST | `/api/rooms/{code}/close-question` | → 200 leaderboard; 409 `INVALID_STATE` if no question is open; 503 `SCORING_UNAVAILABLE` (question stays closed, call again to retry scoring) |
| POST | `/api/rooms/{code}/end` | → 200 final scoreboard |

### REST: players (public)

| Method | Path | Request → Response |
|---|---|---|
| GET | `/api/rooms/{code}` | → 200 `{status: LOBBY \| IN_PROGRESS \| FINISHED}`; 404 `ROOM_NOT_FOUND` |
| POST | `/api/rooms/{code}/players` | `{nickname}` → 201 `{sessionId, participantId, channel, joinKey}`; 404 `ROOM_NOT_FOUND`; 409 `ROOM_NOT_JOINABLE` or `NICKNAME_TAKEN` |
| POST | `/api/rooms/{code}/answers` | `{sessionId, optionIndex}` → 200 `{accepted: true}`; 403 `NOT_IN_ROOM`; 409 `QUESTION_CLOSED` or `ALREADY_ANSWERED` |

`sessionId` is secret and proves who is answering. `participantId` is public and is the player's alias on the relay.

### Connecting to the relay

```ts
import { connect } from 'itty-sockets'

const room = connect(channel, { joinKey, as: participantId, announce: true }) // host: no `as`/`announce`
room.on('question:opened', ({ message }) => showQuestion(message))
```

Only Live Game Sessions holds the channel's `sendKey`, so clients can listen but cannot publish.

### Relay events (published by Live Game Sessions, received by host and players)

Each message is JSON with a `type` field, which itty-sockets uses to route it to `.on(type, ...)`.

| `type` | Payload |
|---|---|
| `participants:update` | `{participants: [{participantId, nickname, connected}]}` |
| `game:started` | `{questionCount}` |
| `question:opened` | `{index, text, options}` — never the correct answer |
| `answers:count` | `{index, submitted, total}` |
| `question:closed` | `{index, correctIndex, explanation}` |
| `leaderboard:update` | `{leaderboard: [{nickname, score, rank}]}` |
| `game:ended` | `{scoreboard: [{nickname, score, rank}]}` |

Live Game Sessions also listens for the relay's own `join` and `leave` events (sent because players connect with `announce: true`) to mark participants connected or disconnected.

## Scoring — `:8083`

Called by Live Game Sessions with the host's JWT, and by the host's browser for past results.

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/games/{gameId}/questions/{index}/score` | owner | `{correctIndex, participants: [{sessionId, nickname}], answers: [{sessionId, optionIndex}]}` → 200 leaderboard. Sending the same request again returns the same leaderboard and adds no points. |
| POST | `/api/games/{gameId}/finish` | owner | → 200 final scoreboard, stored |
| GET | `/api/games` | JWT | → host's finished games `[{gameId, quizTitle, finishedAt, playerCount}]` |
| GET | `/api/games/{gameId}/results` | owner | → `{scoreboard: [{nickname, score, rank}]}` |

Scoring: 1 point for a correct answer, 0 for a wrong or missing answer. Ranks use standard competition ranking: equal scores share a rank and the next rank is skipped (1, 1, 3).
