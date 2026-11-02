# Game Flow

One complete game: the host logs in, builds a quiz with AI help, opens a room, players join and answer, and the host sees the stored results afterwards.

Solid arrows are REST requests and responses. Open arrowheads are Socket.IO events. Event names and payloads are listed in [api.md](api.md).

```mermaid
sequenceDiagram
    autonumber
    actor Host as Host Browser
    actor Player as Player Browsers (x10)
    participant ACC as Accounts
    participant LIB as Question Library
    participant AI as AI Quiz Authoring
    participant LGS as Live Game Sessions
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
        LIB-->>Host: 503 "AI generation unavailable", nothing saved
    else drafts returned
        AI-->>LIB: valid drafts + rejected list
        LIB-->>Host: 201 questions saved as DRAFT
    end
    Host->>LIB: Edit / approve / discard questions
    LIB-->>Host: Quiz is ready (1-10 approved)
    end

    rect rgba(200,160,80,0.15)
    Note over Host,LGS: 3. Open a room
    Host->>LGS: POST /api/rooms {quizId}
    LGS->>LIB: GET /api/quizzes/{id}/snapshot
    LIB-->>LGS: Approved questions (fixed copy)
    LGS-->>Host: 201 {roomCode}
    Host-)LGS: host:join {roomCode} (JWT in handshake)
    Player-)LGS: player:join {roomCode, nickname}
    alt bad code or game already started
        LGS--)Player: error {ROOM_NOT_FOUND / ROOM_NOT_JOINABLE}
    else joined
        LGS--)Player: ack {sessionId}
        LGS--)Host: participants:update
        LGS--)Player: participants:update
    end
    Host-)LGS: host:start
    LGS--)Player: game:started
    end

    rect rgba(200,80,120,0.15)
    Note over Host,SCO: 4. Play, once per question
    loop each question
        Host-)LGS: host:open-question
        LGS--)Player: question:opened {index, text, options} (no correct answer)
        Player-)LGS: answer:submit {sessionId, optionIndex}
        alt question closed or already answered
            LGS--)Player: ack {accepted: false, code}
        else first answer while open
            LGS--)Player: ack {accepted: true}
            LGS--)Host: answers:count {submitted, total}
        end
        Host-)LGS: host:close-question
        LGS->>SCO: POST /api/games/{roomId}/questions/{index}/score
        SCO-->>LGS: Leaderboard (equal scores share a rank)
        LGS--)Player: question:closed {correctIndex, explanation}
        LGS--)Player: leaderboard:update
        LGS--)Host: question:closed + leaderboard:update
    end
    end

    rect rgba(150,150,150,0.15)
    Note over Host,SCO: 5. End and results
    Host-)LGS: host:end
    LGS->>SCO: POST /api/games/{roomId}/finish
    SCO-->>LGS: Final scoreboard (stored)
    LGS--)Player: game:ended {scoreboard}
    LGS--)Host: game:ended {scoreboard}
    Host->>SCO: GET /api/games/{roomId}/results
    SCO-->>Host: Stored final scoreboard
    end
```

## What happens at each stage

1. **Log in (1–2).** Accounts returns a JWT. The host sends it with every later request.
2. **Build the quiz (3–12).** Question Library asks AI Quiz Authoring for drafts. Drafts that fail validation are dropped; the rest are saved as `DRAFT`. If the AI service is down or too slow, the host gets an error and nothing is saved. The host approves the questions they want; editing an approved question makes it `DRAFT` again.
3. **Open a room (13–24).** Live Game Sessions copies the approved questions once, so later edits in the library do not change this game. Players join with the code and a nickname and get a `sessionId`. Everyone sees the participant list update.
4. **Play (25–36).** Only one question is open at a time and there is no timer: the host opens and closes it. Live Game Sessions accepts the first answer from each player while the question is open and rejects everything else. On close, Scoring awards 1 point per correct answer and returns the leaderboard; repeating the same score request gives the same result. Only then do players see the correct answer.
5. **End (37–43).** Scoring stores the final scoreboard, so the host can open it after the room is gone.
