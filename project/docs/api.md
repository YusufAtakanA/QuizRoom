# API and Live Events

All REST payloads are JSON. Protected endpoints need `Authorization: Bearer <JWT>` from Accounts. "Owner" means the host id in the token must match the owner of the quiz, room, or game.

Tokens are HS256, signed with the shared `JWT_SECRET`, and carry `sub` (host id), `email`, `iat`, `exp`, `iss = "quizroom-accounts"` and `aud = ["quizroom-accounts", "quizroom-library", "quizroom-scoring", "quizroom-sessions"]`. Each service accepts a token only if `iss` is `quizroom-accounts` and `aud` contains its own name: `quizroom-accounts` (Accounts), `quizroom-library` (Question Library), `quizroom-scoring` (Scoring), `quizroom-sessions` (Live Game Sessions). A token that fails this check gets 401, exactly like an invalid or expired token. See [ADR 0006](adr/0006-jwt-shared-secret.md).

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
| POST | `/api/quizzes/{id}/generate` | owner | `{notes, count}` (1–10) → 201 `{created: [question], rejected: ["reason", ...]}`; 400 count outside 1–10; 503 AI unavailable; 504 AI timeout. Library re-checks every AI question (same rules as below) and saves only the valid ones as `DRAFT`. |
| GET | `/api/quizzes/{id}/snapshot` | owner | → `{quizId, title, questions: [{text, options, correctIndex, explanation}]}`; 409 quiz not ready |

A quiz is **ready** when it has 1 to 10 approved questions. Only approved questions go into the snapshot.

## AI Quiz Authoring — `:8000`

Called only by Question Library. Holds the model-provider key (`ANTHROPIC_API_KEY`) and calls Claude (`claude-opus-5-5` by default) with a JSON-schema structured output. Stateless.

| Method | Path | Request → Response |
|---|---|---|
| POST | `/generate` | `{notes, count}` (notes ≤ 20000 chars, count 1–10) → 200 `{model, promptVersion, effort, durationMs, questions: [...], rejected: [{index, reason}]}`; 422 invalid request; 502 the model refused or returned unusable output; 503 no key configured, rate-limited, or provider unavailable; 504 model timeout. The whole call stays under 100 s so Question Library (120 s timeout) always gets a real answer. |
| GET | `/health` | → 200 `{status: "ok", model, configured}` (`configured` is false when no key is set) |

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

Validation (T06): required fields present with the right types, number of questions ≤ `count` (a shortfall is reported in `rejected`), non-empty text and explanation, exactly four distinct options, `correctIndex` in 0–3, `sourceExcerpt` found in `notes`. Failing questions go to `rejected`. Passing these checks does not prove the answer is right; every generated question is saved as `DRAFT` and must be approved by the host. How the drafts are evaluated (T07) is described in [ai-evaluation.md](ai-evaluation.md).

## Live Game Sessions — `:3000`

Every action is a REST call. Live events are published on the room's [ittysockets](https://ittysockets.com/) channel. Errors carry an extra `code` field, for example `{"status": 409, "code": "ALREADY_ANSWERED", "detail": "..."}`.

### REST: host (JWT, room owner only)

Another host gets 404 `ROOM_NOT_FOUND`; a missing, invalid, or expired token, or one without issuer `quizroom-accounts` and audience `quizroom-sessions`, gets 401 `UNAUTHORIZED`.

| Method | Path | Request → Response |
|---|---|---|
| POST | `/api/rooms` | `{quizId}` → 201 `{roomId, roomCode, channel, joinKey}`; 400 `INVALID_REQUEST`; 404 `QUIZ_NOT_FOUND`; 409 `QUIZ_NOT_READY`; 503 `LIBRARY_UNAVAILABLE` or `RELAY_UNAVAILABLE` |
| POST | `/api/rooms/{code}/start` | → 200 `{status}`; 409 `INVALID_STATE` if not in the lobby |
| POST | `/api/rooms/{code}/open-question` | → 200 `{index}`; 409 `INVALID_STATE` if not started, a question is open, the previous one is not scored yet, or none are left |
| POST | `/api/rooms/{code}/close-question` | → 200 `{index, leaderboard}`; 409 `INVALID_STATE` if there is nothing to close; 503 `SCORING_UNAVAILABLE` (the question stays closed and nothing is revealed; call again to retry scoring) |
| POST | `/api/rooms/{code}/end` | → 200 Scoring's results; 409 `INVALID_STATE` if a question is open or unscored; 503 `SCORING_UNAVAILABLE`. Once end has been requested, the room accepts nothing else (no start, open, or join) until a retried end succeeds. Calling end on a finished room returns the same results. |

### REST: players (public)

| Method | Path | Request → Response |
|---|---|---|
| GET | `/api/rooms/{code}` | → 200 `{status: LOBBY \| IN_PROGRESS \| FINISHED}`, or the full snapshot for the host or a player of the room (see [Room snapshot](#room-snapshot)); 404 `ROOM_NOT_FOUND` |
| POST | `/api/rooms/{code}/players` | `{nickname}` (1–20 characters) → 201 `{sessionId, participantId, channel, joinKey}`; 400 `INVALID_REQUEST`; 404 `ROOM_NOT_FOUND`; 409 `ROOM_NOT_JOINABLE`, `NICKNAME_TAKEN` (case-insensitive), or `ROOM_FULL` (100 players) |
| POST | `/api/rooms/{code}/answers` | `{sessionId, optionIndex}` → 200 `{accepted: true, index}`; 400 `INVALID_REQUEST`; 403 `NOT_IN_ROOM`; 409 `QUESTION_CLOSED` or `ALREADY_ANSWERED` |

`sessionId` is secret and proves who is answering. `participantId` is public and is the player's alias on the relay. Room codes are 6 characters and case-insensitive.

All rooms live in memory. A room with no requests for 4 hours is removed the next time any room is created; after that its code returns 404 and can be reused. Finished games stay available from Scoring.

### Room snapshot

`GET /api/rooms/{code}` is public, but how much it returns depends on who asks.

- **No credentials, or credentials that do not match this room:** 200 `{status}` only. An invalid token, a token of another host, or an unknown session id is not an error here; it just gets `{status}`.
- **The room's host:** header `Authorization: Bearer <JWT>` that verifies and whose `sub` is the room's host → full snapshot.
- **A player of this room:** header `X-Session-Id: <sessionId>` → full snapshot.
- Unknown room code: 404 `ROOM_NOT_FOUND`.

Credentials never go in the URL.

Full snapshot:

```json
{
  "status": "IN_PROGRESS",
  "eventId": 12,
  "questionCount": 5,
  "participants": [{ "participantId": "…", "nickname": "Ada", "connected": true }],
  "question": { "index": 1, "text": "…", "options": ["…", "…", "…", "…"] },
  "open": false,
  "answers": { "index": 1, "submitted": 9, "total": 10 },
  "reveal": { "index": 1, "correctIndex": 2, "explanation": "…" },
  "leaderboard": [{ "playerId": "…", "nickname": "Ada", "score": 2, "rank": 1 }],
  "scoreboard": null
}
```

| Field | Meaning |
|---|---|
| `status` | `LOBBY`, `IN_PROGRESS` or `FINISHED` |
| `eventId` | The `eventId` of the last published event when the snapshot was taken; 0 if nothing was published yet |
| `questionCount` | Number of questions in the room's quiz |
| `participants` | `[{participantId, nickname, connected}]`, same as `participants:update` |
| `question` | The current question `{index, text, options}`, open or closed; `null` before the first question. Never contains `correctIndex` |
| `open` | `true` while the current question accepts answers |
| `answers` | `{index, submitted, total}` for the current question, or `null` |
| `reveal` | `{index, correctIndex, explanation}` only after the current question has been scored; otherwise `null`. The correct answer is never in the snapshot while the current question is unscored |
| `leaderboard` | Latest leaderboard from Scoring, `[]` before any question is scored |
| `scoreboard` | Final scoreboard when `FINISHED`, otherwise `null` |
| `myAnswer` | Only in a player's snapshot: that player's own option index for the current question, or `null` if they have not answered (or there is no current question). Lets a player who reloads see their locked answer and the right result at the reveal |

Clients load the snapshot when the page opens, every time the relay connection opens, and when they notice a gap in `eventId` (see [Reconnect and resync](architecture.md#reconnect-and-resync)).

### Connecting to the relay

```ts
import { connect } from 'itty-sockets'

const room = connect(channel, { joinKey, as: participantId, announce: true }) // host: no `as`/`announce`
room.on('question:opened', ({ message }) => showQuestion(message))
```

Only Live Game Sessions holds the channel's `sendKey`, so clients can listen but cannot publish.

### Relay events (published by Live Game Sessions, received by host and players)

Every message has the same envelope: `{ type, version: 1, eventId, ...payload }`.

- `type` is the event name; itty-sockets uses it to route the message to `.on(type, ...)`.
- `version` is always `1`.
- `eventId` is a per-room counter. It starts at 0 and each publish adds 1, so the first event of a room has `eventId` 1 and every event has a number one higher than the one before.

The relay delivers each message at most once and keeps nothing. A client that misses events (`eventId` jumps by more than 1) loads the [room snapshot](#room-snapshot) again. Clients ignore events with an `eventId` they have already seen and events without a numeric `eventId`.

Payloads (inside the envelope):

| `type` | Payload |
|---|---|
| `participants:update` | `{participants: [{participantId, nickname, connected}]}` |
| `game:started` | `{questionCount}` |
| `question:opened` | `{index, text, options}` — never the correct answer |
| `answers:count` | `{index, submitted, total}` |
| `question:closed` | `{index, correctIndex, explanation}` |
| `leaderboard:update` | `{leaderboard: [{playerId, nickname, score, rank}]}` — `playerId` is the public `participantId`, so each player can find their own row |
| `game:ended` | `{scoreboard: [{playerId, nickname, score, rank}]}` |

Live Game Sessions also listens for the relay's own `join` and `leave` events (sent because players connect with `announce: true`) to mark participants connected or disconnected.

## Scoring — `:8083`

Called by Live Game Sessions with the host's JWT, and by the host's browser for past results. `gameId` is the room's `roomId`. A game belongs to the host who first scores or finishes it; any other host gets 404.

Players are identified by `playerId`, which is their public `participantId` from Live Game Sessions. Scoring never sees the secret `sessionId`, so leaderboards can be published on the relay as they are.

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/games/{gameId}/questions/{index}/score` | owner | `{quizTitle, correctIndex, participants: [{playerId, nickname}], answers: [{playerId, optionIndex}]}` → 200 `{gameId, questionIndex, leaderboard}`. The first call creates the game. Sending the same question again changes nothing and returns the current leaderboard. 409 if the game is finished; 400 for invalid input, duplicate players, or an answer from a player not in `participants`. |
| POST | `/api/games/{gameId}/finish` | owner | `{quizTitle, participants: [{playerId, nickname}]}` → 200 results (below). Calling it again returns the same stored results. |
| GET | `/api/games` | JWT | → host's finished games, newest first: `[{gameId, quizTitle, finishedAt, playerCount}]` |
| GET | `/api/games/{gameId}/results` | owner | → `{gameId, quizTitle, finished, finishedAt, questionsScored, scoreboard}` |

`leaderboard` and `scoreboard` entries are `{playerId, nickname, score, rank}`, sorted by score (highest first), then nickname.

Scoring: 1 point for a correct answer, 0 for a wrong or missing answer, no speed bonus. Players who join late get 0 for the questions before they joined. Ranks use standard competition ranking: equal scores share a rank and the next rank is skipped (1, 1, 3).
