# Local Setup and Tests

How to run the frontend, the five backend services, and their databases on one machine, how to play from a phone, and how to run every test suite (T09).

## Prerequisites

| Tool | Version | Used by |
|---|---|---|
| JDK | 21 or newer | Accounts, Question Library, Scoring |
| Maven | 3.9+ (or the one bundled with IntelliJ) | building the Java services |
| Node.js | 24 (22.18+ also runs `.ts` files directly) | Live Game Sessions, frontend, mobile app (Metro) |
| Python | 3.12 | AI Quiz Authoring |
| Expo Go | current version from the App Store or Google Play | only to play with the mobile app ([Play from a phone](#play-from-a-phone)) |
| Internet access | | live events go through the hosted [ittysockets](https://ittysockets.com/) relay; AI generation calls the Anthropic API |

No database server is needed. Question Library and Scoring each keep an embedded H2 database file in their own `data/` folder (git-ignored), so saved quizzes and finished games survive restarts. Accounts keeps hosts in memory, so they are lost when it restarts ([ADR 0004](adr/0004-accounts-in-memory-plaintext.md)).

## Configuration

Every service reads its settings from environment variables. Each one has a `.env.example` with no real secrets. Copy it to `.env` in the same folder and fill it in; `.env` files are git-ignored.

| Service | Folder | Port | Settings |
|---|---|---|---|
| Accounts | `project/services/accounts` | 8081 | `ACCOUNTS_PORT`, `JWT_SECRET`, `JWT_TTL` |
| Question Library | `project/services/question-library` | 8082 | `LIBRARY_PORT`, `LIBRARY_DB_URL`, `JWT_SECRET`, `AI_URL`, `AI_TIMEOUT` |
| Scoring | `project/services/scoring` | 8083 | `SCORING_PORT`, `SCORING_DB_URL`, `JWT_SECRET` |
| Live Game Sessions | `project/services/live-game-sessions` | 3000 | `LGS_PORT`, `JWT_SECRET`, `LIBRARY_URL`, `SCORING_URL`, `SERVICE_TIMEOUT_MS` |
| AI Quiz Authoring | `project/services/ai-quiz-authoring` | 8000 | `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_EFFORT`, `AI_TIMEOUT_SECONDS`, `AI_MAX_RETRIES` |
| Frontend | `project/frontend` | 5173 | `VITE_ACCOUNTS_URL`, `VITE_LIBRARY_URL`, `VITE_SCORING_URL`, `VITE_SESSIONS_URL` (only if a service runs elsewhere), `VITE_PUBLIC_ORIGIN` (address put in the join QR code) |
| Mobile app (Expo Go) | `project/mobile` | 8090 (Metro) | `EXPO_PUBLIC_LGS_URL` (only if Live Game Sessions is not on port 3000 of the computer running Metro) |

Two rules:

- **`JWT_SECRET` must be identical** in Accounts, Question Library, Scoring and Live Game Sessions, and at least 32 characters. Accounts signs tokens with it; the others check them with it.
- **`ANTHROPIC_API_KEY`** is your own key from [console.anthropic.com](https://console.anthropic.com/). Without it the app still works, but "Generate drafts" answers "AI generation is unavailable".

The two phone overrides, `VITE_PUBLIC_ORIGIN` and `EXPO_PUBLIC_LGS_URL`, are not in any `.env.example`. Add them by hand only when needed ([Overrides](#overrides)).

## Run

Start each service in its own terminal, from the repository root.

```bash
cd project/services/accounts && mvn spring-boot:run
```
```bash
cd project/services/question-library && mvn spring-boot:run
```
```bash
cd project/services/scoring && mvn spring-boot:run
```
```bash
cd project/services/live-game-sessions && npm install && npm start
```
```bash
cd project/services/ai-quiz-authoring && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt && .venv/Scripts/python -m uvicorn main:app --port 8000 --env-file .env
```
```bash
cd project/frontend && npm install && npm run dev
```

On Linux/macOS use `.venv/bin/python` instead of `.venv/Scripts/python`. The Spring Boot services read their `.env` automatically; Live Game Sessions loads its `.env` through `npm start`.

Then open <http://localhost:5173>. Hosts use **Host login**; players join from the start page with the room code, or from a phone (next section). The frontend's dev server forwards `/api/auth` and `/api/accounts` to Accounts, `/api/quizzes` to Question Library, `/api/games` to Scoring and `/api/rooms` to Live Game Sessions.

## Play from a phone

Players can join from a phone in two ways: the website in the phone's browser, or the QuizRoom player app in Expo Go. Both use the same room code and the same QR code. The host still runs the game from the website on the computer; the app has no host features ([ADR 0007](adr/0007-expo-player-app-and-qr-join.md)).

The phone and the computer must be on **the same Wi-Fi network**. Below, `<LAN-IP>` is the computer's address on that network (on Windows: `ipconfig`, "IPv4 Address" of the Wi-Fi adapter).

### Website

1. Start everything as in [Run](#run). The Vite dev server also listens on the local network.
2. The host creates a room. The room screen shows a QR code for `http://<LAN-IP>:5173/#/join/<CODE>`.
3. The player scans it with the phone's camera app and opens the link. The join page opens with the room code filled in; the player enters a nickname.

Without the QR code, the player can open `http://<LAN-IP>:5173` on the phone and type the room code.

### Expo Go app

1. Install **Expo Go** on the phone from the App Store (iOS) or Google Play (Android).
2. Start the services as in [Run](#run) (at least Live Game Sessions, and the frontend for the host), then start the app's dev server (Metro) on port 8090:

```bash
cd project/mobile && npm install && npm start
```

3. Metro prints a QR code in the terminal. On Android scan it with the Expo Go app; on iOS scan it with the Camera app. QuizRoom opens inside Expo Go.
4. In QuizRoom tap **Scan QR code** and scan the room QR code on the host's screen (or type the code), then enter a nickname.

The app talks to Live Game Sessions directly at `http://<LAN-IP>:3000`, where `<LAN-IP>` is the address Expo Go used to reach Metro. It uses the same REST endpoints, relay channel and resync rules as the website ([Reconnect and resync](architecture.md#reconnect-and-resync)).

### Windows firewall

The first time Vite (port 5173), Metro (port 8090) or Live Game Sessions (port 3000) listens on the network, Windows may ask whether to allow **Node.js** through the firewall. Allow it on **private networks**. If you deny it, the computer still works on `localhost`, but phones cannot connect. Make sure the Wi-Fi network is set to "Private" in Windows; on a "Public" network the rule does not apply.

### Overrides

| Variable | Where | When to set it |
|---|---|---|
| `VITE_PUBLIC_ORIGIN` | `project/frontend/.env` | The join QR code shows the wrong address (for example a VPN or virtual adapter instead of Wi-Fi). Set it to `http://<LAN-IP>:5173`; the QR code then encodes `<VITE_PUBLIC_ORIGIN>/#/join/<CODE>`. Restart `npm run dev`. |
| `EXPO_PUBLIC_LGS_URL` | `project/mobile/.env` or the shell that runs `npm start` | Live Game Sessions is not on port 3000 of the computer running Metro. Example: `EXPO_PUBLIC_LGS_URL=http://192.168.1.20:3000`. Restart `npm start`. |

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The phone cannot open the join link, or Expo Go shows "Could not connect" | Phone and computer are on different networks, or the phone uses mobile data | Put both on the same Wi-Fi; turn off mobile data on the phone if it keeps switching |
| Same Wi-Fi, still no connection | Guest, hotel, campus or other networks with client isolation block devices from reaching each other | Use another network, or a phone hotspot with the computer connected to it |
| Works on the computer but not on the phone | Windows firewall blocked Node.js, or the network is set to "Public" | See [Windows firewall](#windows-firewall) |
| The join QR code or the Metro QR code shows an address that is not the Wi-Fi adapter's "IPv4 Address" from `ipconfig` (for example a VPN or virtual adapter) | The wrong network adapter was picked | Website: set `VITE_PUBLIC_ORIGIN=http://<LAN-IP>:5173`. App: start Metro with `REACT_NATIVE_PACKAGER_HOSTNAME=<LAN-IP> npm start`; the app then also reaches Live Game Sessions on that address |
| A VPN is on, on the computer or the phone | The VPN routes LAN traffic away or hides the LAN address | Turn the VPN off while playing |
| The app joins but no live updates arrive | No internet access: live events go through the hosted relay | Check that both the computer and the phone are online |

## Tests

| What | Command | Covers |
|---|---|---|
| Accounts | `cd project/services/accounts && mvn test` | register, login, issued token claims (issuer, audience), token checks, duplicate email, bad input |
| Question Library | `cd project/services/question-library && mvn test` | question validation, approval rules and the 10-question cap, ownership, token issuer and audience, AI drafts re-checked against the notes, AI unavailable or too slow |
| Scoring | `cd project/services/scoring && mvn test` | points, ranking ties (1, 1, 3), repeated and concurrent scoring requests, late joiners, finish, ownership, token issuer and audience, bad input |
| Live Game Sessions | `cd project/services/live-game-sessions && npm test && npm run typecheck` | invalid game-state transitions, duplicate answers, correct answer hidden until scored (events and snapshot), event envelope and `eventId`, room snapshot access rules, Scoring/Library outages, 10 players answering at once, relay reconnect with backoff and jitter, token issuer and audience |
| AI Quiz Authoring | `cd project/services/ai-quiz-authoring && .venv/Scripts/python -m pip install -r requirements-dev.txt && .venv/Scripts/python -m pytest` | every T06 validation rule, error mapping, the request sent to Claude, the evaluation script (no paid API calls; the model is faked) |
| Frontend | `cd project/frontend && npm run build` | type check and production build |
| Mobile app | `cd project/mobile && npm test && npm run typecheck && npx expo export` | QR/room-code parsing and the resync rules (`src/core.test.ts`), type check, and a production bundle of the Expo app (written to `dist/`) |

### End-to-end test (T08)

`project/services/live-game-sessions/e2e/full-flow.ts` plays a complete game against the real services and the real relay: two hosts, a quiz created and approved, AI generation unavailable, one host and **ten simultaneous players**, duplicate and unknown answers, a repeated scoring request, results, and ownership checks.

1. Start Accounts, Question Library, Scoring and Live Game Sessions with one shared `JWT_SECRET`. Set `AI_URL=http://localhost:1` on Question Library so AI generation is unavailable, as the test expects.
2. Point the script at them (defaults are ports 18081, 18082, 18083 and 13000):

```bash
cd project/services/live-game-sessions && E2E_ACCOUNTS_URL=http://localhost:8081 E2E_LIBRARY_URL=http://localhost:8082 E2E_SCORING_URL=http://localhost:8083 E2E_LGS_URL=http://localhost:3000 npm run e2e
```

It prints one `PASS`/`FAIL` line per step and exits non-zero on any failure. To also test a Scoring outage in the middle of a game, set `E2E_STOP_SCORING` and `E2E_START_SCORING` to shell commands that stop and start the Scoring service; without them that step prints `SKIP`.

### AI evaluation (T07)

See [ai-evaluation.md](ai-evaluation.md). It makes real, billed API calls, so it only runs with your key and an explicit `--yes`.
