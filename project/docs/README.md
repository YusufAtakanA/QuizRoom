# Documentation

QuizRoom: hosts build multiple-choice quizzes (by hand or from study notes with a language model), open a room, and run a live quiz that guest players join with a room code.

| Document | What it covers |
|---|---|
| [description.md](description.md) | Project description, functional requirements (F01–F11), and technical requirements (T01–T09) |
| [architecture.md](architecture.md) | C4 Context and Container views, the 5 services and the two clients (website and Expo player app), how they talk, room lifecycle, security, reliability rules, quality attributes, reconnect and resync, stack, and folder layout |
| [adr/README.md](adr/README.md) | Architecture decision records: five services, ittysockets relay, H2 files, Accounts storage, synchronous AI call, JWT secret, Expo player app and QR join |
| [game-flow.md](game-flow.md) | Sequence diagram of one full game, from login to stored results |
| [accounts-flow.md](accounts-flow.md) | Sequence diagram of registration, login, and token checks |
| [api.md](api.md) | Every REST endpoint, the room snapshot, and every live relay event, with payloads and errors |
| [setup.md](setup.md) | How to run everything locally, how to play from a phone (website or Expo Go), and how to run the tests |
| [ai-evaluation.md](ai-evaluation.md) | How AI-generated drafts are evaluated (T07) |
| [design.md](design.md) | UI design handoff: findings, principles, tokens, components and states, motion spec, screens (website and Expo app), accessibility checklist, decision log |

The project overview and timeline are in [../README.md](../README.md). Diagrams are written in [Mermaid](https://mermaid.js.org/), so GitHub renders them directly and they can be edited as text.
