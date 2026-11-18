# Game Flow

One complete game: the host logs in, builds a quiz with AI help, opens a room, players join and answer, and the host sees the stored results afterwards.

Solid arrows are REST requests and responses. Open arrowheads are WebSocket messages through the [ittysockets](https://ittysockets.com/) relay. Every event Live Game Sessions publishes reaches the host and all players; the diagram draws it once to keep it readable. Every event also carries `version` and a per-room `eventId`, and a client that misses events reloads the room snapshot; see [api.md](api.md) for event names, payloads and the snapshot.

```mermaid
sequenceDiagram
    autonumber
    actor Host as Host Browser
    actor Player as Player Browsers (x10)
    participant ACC as Accounts
    participant LIB as Question Library
    participant AI as AI Quiz Authoring
    participant LGS as Live Game Sessions
    participant RELAY as ittysockets relay
    participant SCO as Scoring

    rect rgba(80,120,200,0.15)
    Note over Host,ACC: 1. Log in
    Host->>ACC: POST /api/auth/login
    ACC-->>Host: JWT
    end

    rect rgba(80,200,120,0.15)
    Note over Host,AI: 2. Build the quiz
    Host->>LIB: POST /api/quizzes {title}
    LIB-->>Host: 201 quiz
    Host->>LIB: POST /api/quizzes/{id}/generate {notes, count}
    LIB->>AI: POST /generate {notes, count}
    alt AI unavailable or timeout
        AI--xLIB: error / no answer
        LIB-->>Host: 503 unavailable or 504 timeout, nothing saved
    else drafts returned
        AI-->>LIB: valid drafts + rejected list
        LIB-->>Host: 201 questions saved as DRAFT
    end
    Host->>LIB: Edit / approve / discard questions
    LIB-->>Host: Quiz is ready (1-10 approved)
    end

    rect rgba(200,160,80,0.15)
    Note over Host,RELAY: 3. Open a room
    Host->>LGS: POST /api/rooms {quizId}
    LGS->>LIB: GET /api/quizzes/{id}/snapshot
    LIB-->>LGS: Approved questions (fixed copy)
    LGS-)RELAY: Connect to quizroom-<uuid>, set joinKey + sendKey
    LGS-->>Host: 201 {roomCode, channel, joinKey}
    Host-)RELAY: Connect with joinKey (listen only)
    Player->>LGS: POST /api/rooms/{code}/players {nickname}
    alt bad code, game started, or nickname taken
        LGS-->>Player: 404 / 409 with error code
    else joined
        LGS-->>Player: 201 {sessionId, participantId, channel, joinKey}
        Player-)RELAY: Connect with joinKey, as participantId, announce
        RELAY--)LGS: join {alias: participantId}
        LGS-)RELAY: participants:update
        RELAY--)Player: participants:update
    end
    Host->>LGS: POST /api/rooms/{code}/start
    LGS-)RELAY: game:started
    RELAY--)Player: game:started
    end

    rect rgba(200,80,120,0.15)
    Note over Host,SCO: 4. Play, once per question
    loop each question
        Host->>LGS: POST /api/rooms/{code}/open-question
        LGS-)RELAY: question:opened {index, text, options} (no correct answer)
        RELAY--)Player: question:opened
        Player->>LGS: POST /api/rooms/{code}/answers {sessionId, optionIndex}
        alt question closed or already answered
            LGS-->>Player: 409 QUESTION_CLOSED / ALREADY_ANSWERED
        else first answer while open
            LGS-->>Player: 200 {accepted: true}
            LGS-)RELAY: answers:count {submitted, total}
            RELAY--)Host: answers:count
        end
        Host->>LGS: POST /api/rooms/{code}/close-question
        LGS->>SCO: POST /api/games/{roomId}/questions/{index}/score
        SCO-->>LGS: Leaderboard (equal scores share a rank)
        LGS-->>Host: 200 leaderboard
        LGS-)RELAY: question:closed {correctIndex, explanation} + leaderboard:update
        RELAY--)Player: question:closed + leaderboard:update
    end
    end

    rect rgba(150,150,150,0.15)
    Note over Host,SCO: 5. End and results
    Host->>LGS: POST /api/rooms/{code}/end
    LGS->>SCO: POST /api/games/{roomId}/finish
    SCO-->>LGS: Final scoreboard (stored)
    LGS-)RELAY: game:ended {scoreboard}, then disconnect
    RELAY--)Player: game:ended
    Host->>SCO: GET /api/games/{roomId}/results
    SCO-->>Host: Stored final scoreboard
    end
```

## What happens at each stage

1. **Log in (1–2).** Accounts returns a JWT. The host sends it with every later request.
2. **Build the quiz (3–12).** Question Library asks AI Quiz Authoring for drafts. Drafts that fail validation are dropped; the rest are saved as `DRAFT`. If the AI service is down or too slow, the host gets an error and nothing is saved. The host approves the questions they want; editing an approved question makes it `DRAFT` again.
3. **Open a room (13–28).** Live Game Sessions copies the approved questions once, so later edits in the library do not change this game. It opens a relay channel that only it can publish on. Players join over REST, get a secret `sessionId` and a public `participantId`, and connect to the channel to listen. The relay reports each connect and disconnect, and Live Game Sessions publishes the updated participant list.
4. **Play (29–42).** Only one question is open at a time and there is no timer: the host opens and closes it. Live Game Sessions accepts the first answer from each player while the question is open and rejects everything else. On close, Scoring awards 1 point per correct answer and returns the leaderboard; repeating the same score request gives the same result. Only then is the correct answer published.
5. **End (43–49).** Scoring stores the final scoreboard, so the host can open it after the room is gone.
