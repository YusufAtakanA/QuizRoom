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

### REST

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/rooms` | JWT | `{quizId}` → 201 `{roomId, roomCode}`; 409 quiz not ready; 503 library unavailable |
| GET | `/api/rooms/{code}` | public | → 200 `{status: LOBBY \| IN_PROGRESS \| FINISHED}`; 404 unknown code |

### Socket.IO: client → server

| Event | Sent by | Payload | Reply (ack) |
|---|---|---|---|
| `host:join` | host (JWT in `auth.token`) | `{roomCode}` | `{participants}` or error `NOT_HOST` |
| `player:join` | player | `{roomCode, nickname}` | `{sessionId}` or error `ROOM_NOT_FOUND`, `ROOM_NOT_JOINABLE`, `NICKNAME_TAKEN` |
| `host:start` | host | `{}` | error `INVALID_STATE` if not in lobby |
| `host:open-question` | host | `{}` | opens the next question; error `INVALID_STATE` if one is already open or none left |
| `answer:submit` | player | `{sessionId, optionIndex}` | `{accepted: true}` or `{accepted: false, code: QUESTION_CLOSED \| ALREADY_ANSWERED \| NOT_IN_ROOM}` |
| `host:close-question` | host | `{}` | error `INVALID_STATE` if no question is open; `SCORING_UNAVAILABLE` if Scoring fails |
| `host:end` | host | `{}` | — |

### Socket.IO: server → client

| Event | Sent to | Payload |
|---|---|---|
| `participants:update` | everyone in the room | `[{nickname, connected}]` |
| `game:started` | everyone | `{questionCount}` |
| `question:opened` | everyone | `{index, text, options}` — never the correct answer |
| `answers:count` | host | `{submitted, total}` |
| `question:closed` | everyone | `{index, correctIndex, explanation}` |
| `leaderboard:update` | everyone | `[{nickname, score, rank}]` |
| `game:ended` | everyone | `{scoreboard: [{nickname, score, rank}]}` |
| `error` | the sender | `{code, message}` |

## Scoring — `:8083`

Called by Live Game Sessions with the host's JWT, and by the host's browser for past results.

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/games/{gameId}/questions/{index}/score` | owner | `{correctIndex, participants: [{sessionId, nickname}], answers: [{sessionId, optionIndex}]}` → 200 leaderboard. Sending the same request again returns the same leaderboard and adds no points. |
| POST | `/api/games/{gameId}/finish` | owner | → 200 final scoreboard, stored |
| GET | `/api/games` | JWT | → host's finished games `[{gameId, quizTitle, finishedAt, playerCount}]` |
| GET | `/api/games/{gameId}/results` | owner | → `{scoreboard: [{nickname, score, rank}]}` |

Scoring: 1 point for a correct answer, 0 for a wrong or missing answer. Ranks use standard competition ranking: equal scores share a rank and the next rank is skipped (1, 1, 3).
