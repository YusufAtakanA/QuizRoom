# ADR 0007: Expo Go player app next to the website, one QR code for joining

## Status

accepted, 2026-11-17

## Context

In a classroom, players join from their phones. Until now they had to open the website on the phone and type the computer's address and the room code. Typing an address like `http://10.x.x.x:5173` on a phone is slow and error-prone, and the website was not designed for small screens.

The backend does not change for this: the services, the Live Game Sessions REST contract and the relay channel ([ADR 0002](0002-ittysockets-relay.md)) stay exactly as they are. The earlier client choice from the course (lecture 10.6) is also unchanged: the React web frontend stays the main client and the only one for hosts.

## Alternatives

- **Website only, optionally as a PWA.** One client, nothing extra to install. A QR code on the host screen already removes the typing. A PWA adds an icon on the home screen but no real native feel, and the camera scanner would have to be built in the browser.
- **Native Swift (iOS) and Kotlin (Android) apps.** Best native feel, but two more codebases in two more languages, and they need Xcode, Android Studio, signing and store accounts before anyone can try them.
- **Expo (React Native + TypeScript) app run in Expo Go.** One TypeScript codebase for iOS and Android, close to the existing React frontend. Expo Go loads the app from the developer's machine, so no build, signing or store account is needed. The camera scanner comes from Expo.

## Decision

Keep the website for everyone and add a player-only Expo app in `project/mobile`, run in Expo Go.

- The host's room screen shows one QR code that encodes the join link `http://<LAN-IP>:5173/#/join/<CODE>` (`CODE` is the 6-character room code, upper case).
- Scanned with a phone's camera app, it opens the website's join page with the code filled in.
- The app's **Scan QR code** button reads the same QR code. It takes the code from the first `/join/<CODE>` in the text; if there is none, it accepts the whole text when it is a 6-character code. The code is upper-cased.
- The app calls Live Game Sessions directly at `http://<host>:3000` (`<host>` is the address Expo Go used to reach Metro; `EXPO_PUBLIC_LGS_URL` overrides it) and uses the same REST endpoints, relay channel and [resync rules](../architecture.md#reconnect-and-resync) as the website.

## Consequences

- The app only runs in development mode through Expo Go and the Metro dev server (port 8090). There is no store release and no standalone build.
- Phone and computer must be on the same Wi-Fi network without client isolation, and Windows must allow Node.js through the firewall on private networks; otherwise phones cannot reach Vite, Metro or Live Game Sessions ([setup.md](../setup.md#play-from-a-phone)).
- There are now two clients of the Live Game Sessions contract. Every change to the REST endpoints, the snapshot or the relay events must be made in both `project/frontend` and `project/mobile`.
- The app has no host features. Hosts log in, build quizzes and run games only on the website.
- The join link contains the computer's LAN address, so the QR code only works on that network. If the wrong network adapter is picked, `VITE_PUBLIC_ORIGIN` sets the address by hand.

## Review condition

Review when a change to the Live Game Sessions contract is made in one client but not the other, when players regularly cannot connect from phones on the network used for a demo, or when the app must be installable without Expo Go (store release or standalone build).
