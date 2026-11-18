# QuizRoom

QuizRoom is a live multiple-choice quiz for a classroom or a study group. A host builds a quiz by hand or lets a language model draft questions from study notes, reviews and approves them, and runs the game. Players join as guests with a room code and a nickname, answer each question the host opens, and see the correct answer and the leaderboard after every round.

It is for teachers, tutors and students who want a quick quiz from their own notes without accounts for every player.

**Status:** all five services (Accounts, Question Library, Live Game Sessions, Scoring, AI Quiz Authoring) and the React frontend are implemented and tested locally. The frontend has an Apple-style redesign and shows a QR code for joining; players can also join from a phone with the Expo Go player app in `project/mobile` ([setup](docs/setup.md#play-from-a-phone)). Most of this work is not committed yet; see the last row of the timeline.

## Timeline

Built from `git log`. Weeks are ISO weeks.

| Week | Goal / Milestone | Verifiable Result |
|---|---|---|
| 2026-W38 (2026-09-16) | Start the project and write the description | Commits `6c48c12` Initial commit, `fca1de3` Add project description |
| 2026-W40 (2026-10-01) | First architecture diagram | Commit `2ca35a5` add mermaid diagram |
| 2026-W45 (2026-11-02) | Accounts service skeleton, documentation structure (architecture, API, flows) | Commits `1f59cea` Adding account service layout, `c93eab3` Creating the instructed structures and adding the necessary docs, `d149e56` Update Arch. |
| 2026-W46 (2026-11-15) | Accounts register, login and JWT with tests; Live Game Sessions design in the docs | Commits `5b43774` Account Service and Live Session Updates, `e66f643` Docs update |
| 2026-W47 (2026-11-17) | Question Library, Scoring, Live Game Sessions, AI Quiz Authoring, frontend, course-fit fixes (move to `project/`, ADRs, snapshot and resync, JWT issuer and audience), Apple-style frontend redesign, QR code join, Expo Go player app ([ADR 0007](docs/adr/0007-expo-player-app-and-qr-join.md)) | Not yet committed: working tree only; test commands in [docs/setup.md](docs/setup.md) |

## GitHub Projects

- [PROJECT](TODO: add the GitHub Projects board link)

Tasks are tracked on the GitHub Projects board and move from Todo → In progress → Done. The board is the only status list; this README does not repeat it.

## Additional Documents

- [docs/README.md](docs/README.md): index of all documents
- [docs/description.md](docs/description.md): requirements F01–F11 and T01–T09
- [docs/architecture.md](docs/architecture.md): C4 views, room lifecycle, quality attributes, reconnect and resync
- [docs/api.md](docs/api.md): REST endpoints and live events
- [docs/adr/README.md](docs/adr/README.md): architecture decision records
- [docs/setup.md](docs/setup.md#play-from-a-phone): playing from a phone (website QR code or Expo Go app)
- [docs/game-flow.md](docs/game-flow.md) and [docs/accounts-flow.md](docs/accounts-flow.md): sequence diagrams
- [docs/ai-evaluation.md](docs/ai-evaluation.md): AI draft evaluation (T07)

## Run and test

See [docs/setup.md](docs/setup.md).
