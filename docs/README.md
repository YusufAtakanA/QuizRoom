# Documentation

QuizRoom: hosts build multiple-choice quizzes (by hand or from study notes with a language model), open a room, and run a live quiz that guest players join with a room code.

| Document | What it covers |
|---|---|
| [description.md](description.md) | Project description, functional requirements (F01–F11), and technical requirements (T01–T09) |
| [architecture.md](architecture.md) | The 5 services, how they talk, data ownership, security, reliability rules, stack, and folder layout |
| [game-flow.md](game-flow.md) | Sequence diagram of one full game, from login to stored results |
| [accounts-flow.md](accounts-flow.md) | Sequence diagram of registration, login, and token checks |
| [api.md](api.md) | Every REST endpoint and Socket.IO event, with payloads and errors |

Diagrams are written in [Mermaid](https://mermaid.js.org/), so GitHub renders them directly and they can be edited as text.
