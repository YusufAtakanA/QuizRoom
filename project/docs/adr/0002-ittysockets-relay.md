# ADR 0002: Hosted ittysockets relay instead of Socket.IO

## Status

accepted, 2026-11-17

## Context

T02 says browsers must receive live game events through Socket.IO. Live Game Sessions must push participant changes, opened and closed questions, answer counts and leaderboards to the host and every player.

## Alternatives

- **Socket.IO server inside Live Game Sessions.** What T02 names. All traffic stays local, but the service has to hold every browser connection and its own room membership.
- **Plain WebSocket server inside Live Game Sessions.** Same as above without the Socket.IO protocol.
- **Hosted [ittysockets](https://ittysockets.com/) relay.** Live Game Sessions and the browsers connect to a public relay channel. The channel has a `joinKey` (needed to connect) and a `sendKey` (needed to send).

## Decision

Use the hosted ittysockets relay. Each room gets its own channel with an unguessable name (`quizroom-<uuid>`), a random `joinKey` and a random `sendKey`. Only Live Game Sessions knows the `sendKey`, so only it can publish. Browsers get the channel name and `joinKey` over REST when they create or join a room.

## Consequences

- This deviates from T02, which names Socket.IO.
- Live games need an internet connection, even when every service runs on one machine.
- Every live message and every nickname passes through a third-party host (`itty.ws`). The relay has no uptime guarantee.
- The itty-sockets client puts the `joinKey` (and, on the Live Game Sessions server, the `sendKey`) in the query string of the `wss://` URL. Lecture 10.5 warns that URLs end up in logs. We accept this risk: the keys are random values per room, they live only as long as the room, and the `sendKey` never leaves the Live Game Sessions server.
- Delivery is at most once and the relay keeps nothing. A client that is disconnected misses events. Clients recover with three things (see [Reconnect and resync](../architecture.md#reconnect-and-resync)):
  - the room snapshot endpoint `GET /api/rooms/{code}`,
  - an `eventId` counter on every message, so a client notices a gap and loads the snapshot again,
  - reconnect with exponential backoff and full jitter, on the server and in the browser.

## Review condition

Review if the relay is unreachable during a demo or a test run, if a room shows state that the snapshot cannot repair, or if Socket.IO itself is required for grading.
