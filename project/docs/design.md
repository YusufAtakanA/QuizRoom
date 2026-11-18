# QuizRoom design spec ("Calm craft, loud stage")

This is the design handoff for the QuizRoom UI rework (course lecture 09-04). It covers the website in `project/frontend` (host on a laptop or projector, players in a phone browser) and the Expo player app in `project/mobile`. It changes nothing in the backend services, the REST and relay contracts, or the resync logic.

| | |
|---|---|
| Status | Ready for development |
| Winning direction | A, "Calm craft", with ideas taken from B ("Game Night") and C ("Homeroom"). See section 9. |
| Sources | Apple design skill (`apple-design`, cited as "skill §n"), course lectures (cited by number, for example 03-01), the user's report and their screenshot of the host end screen |
| Constraints | No new dependencies. Web uses CSS `linear()` springs, `@starting-style`, the View Transitions API with a fallback, the Popover API, and the Web Animations API (WAAPI) for FLIP. The app uses React Native `Animated`, `LayoutAnimation`, `AccessibilityInfo` and `expo-haptics`, all already installed. Code stays comment-free. |

---

## 1. Problem framing and goals

### 1.1 What the user said

> "Rework the UI, it should have personality and animations. The only-link type of buttons, I don't know about them."

The screenshot shows the host's "game ended" screen in dark mode: a top bar where "Quizzes", "Past results" and "Log out" are three identical blue text links, an orange "Finished" badge, a flat three-row "Final scoreboard" table, a filled blue "View stored results" button, and a "Back to quizzes" button drawn as blue text on dark grey.

### 1.2 Findings (lecture 08-03 format)

| # | Finding | Task | Observation and evidence | Consequence | Assumed cause | Severity | Direction |
|---|---|---|---|---|---|---|---|
| F1 | The nav and the logout action look like hyperlinks | Host moves between quizzes and results, or leaves | "Quizzes", "Past results" and "Log out" have the same blue link style, sit 8px apart, and the current page shows only as weight 600. The user said they don't understand them (screenshot, red annotation). | Hosts can't tell places from actions. `logout()` also clears `qr.hostRoom`, so a mis-tap during a live game removes this browser's link back to the running room. | The signifier doesn't match the behaviour (07-01). The same look is used for different meanings (03-01 heuristic 4). A consequential action sits next to frequent ones (Fitts). | 3 Serious | Show places as tabs, move the action behind a clearly button-shaped control, and name the consequence while a room is live. |
| F2 | Secondary buttons read as links | Leave the end screen | "Back to quizzes" is blue text on a grey fill, which looks like a link inside a box. | Weak hierarchy. Users hesitate over which of the two actions is the main one. | Secondary buttons use the link colour. | 2 Moderate | Three button kinds that never borrow the link look. |
| F3 | "Finished" is shown as a warning | Read the game state | An orange dot appears next to "Finished". In `Host.tsx` every not-connected state gets the `badge warn` class. | A success state reads as a problem (03-01 heuristic 1). | Status is mapped from socket state, not from game state. | 2 Moderate | Map status by meaning: Live, Connecting, Finished (neutral, with a check), Offline. |
| F4 | The end of the game has no climax and no closure | Host ends the game in front of the room | The biggest moment of the product is drawn as a 3-row table. | No sense of success or closure (03-03 success state). The room loses energy. | The happy path was designed as data, not as a moment. | 2 Moderate | A podium for the top 3, with the table kept below it as the full record. |
| F5 | Receded answer tiles fail contrast | Player reads options after locking, everyone reads them after reveal | Tiles that aren't chosen drop to `opacity: 0.3` on the web and `0.35` in the app. | Text falls far below 4.5:1 (03-02, 1.4.3). | Opacity is used as the "not available" signifier. | 2 Moderate | Recede with surface colour and secondary text, keeping the coloured letter badge. |
| F6 | State changes jump | Lock, reveal, rank change | There is no motion apart from a short pop. Rows reorder instantly. | Players miss what changed and who moved (07-03 continuity). | No motion system exists. | 2 Moderate | A small set of spring tokens, used only where motion carries information. |
| F7 | Pure black background and wrong heading tracking | All screens, dark mode | The dark background is `#000` with white text. `h1` uses `+0.01em` tracking at 34px. | Shimmer on projectors (06-03). Loose display type. | System defaults copied as they were. | 1 Cosmetic | Use a near-black background and size-specific tracking (skill §15). |

Priority (severity weighed against effort): F1, then F2 and F3 (cheap and visible on every screen), then F5, then F4, then F6, then F7.

### 1.3 Goals

1. **Clear signifiers.** Places look like tabs, actions look like buttons, and links (underlined) only ever navigate inside text.
2. **Personality where the game happens.** The chrome stays calm. The stage (join, question, lock, reveal, rank change, podium) carries the colour, the big type and the few bouncy springs.
3. **Status you can read at a glance.** Every state has a word, and colour never carries meaning on its own.
4. **Accessible by default.** WCAG 2.2 AA in both themes, full reduced-motion, reduced-transparency and increased-contrast versions, and touch targets of 44px or more.
5. **Implementable now.** No new dependencies, no backend change, no change to resync.

### 1.4 Success measures (to check in a 5-person hallway test, 08-02)

- 5 of 5 hosts correctly say which top-bar items change the page and which one logs out, without hovering.
- 0 accidental logouts while hosting.
- After a reveal, every player can say within 2 seconds whether they were right, and what the right answer was.
- An axe or Lighthouse run shows 0 contrast failures in both themes. A manual Tab pass reaches every control, with focus always visible.
- With reduced motion on, the same information is visible on every screen (07-03).

### 1.5 Out of scope

Backend and API changes, sounds, confetti, a manual theme toggle, avatars, new confirmation dialogs (see the decision log for the two that were proposed and deferred).

---

## 2. Design principles and personality

**The feeling:** calm, confident and quietly delighted (skill §16.8: choose the emotion first, then repeat it in every decision). QuizRoom should feel like a well-run room. The host never panics, every player knows what happened to their tap, and the energy comes from the game itself.

**Quiet chrome, loud stage.** Nav, forms, the library and the editor use neutral greys, one ink-indigo accent and critically damped motion. Saturated colour, display type and overshoot are reserved for the stage moments. If everything is loud, nothing is (06-02).

Principles:

1. **One accent, used rarely.** Ink indigo marks only decisions: the primary button, the current place, focus, and "you". The four answer colours are content, never chrome (06-03 colour by role).
2. **Each kind of control has its own look.** Underlined text is a link. A filled, tinted or plain shape with a label is a button. A segment in a track is a place. Nothing borrows another kind's look (07-01).
3. **Respond on press.** Every control reacts on pointer-down within 100ms. The action commits on release (skill §1, §10; 07-03 0.1s limit).
4. **Springs, critically damped by default.** Overshoot is allowed only when something lands with momentum: an answer locking, a player arriving, the podium rising. Nothing else bounces (skill §4).
5. **Never only colour, never only motion.** Every state has text. Every animation has a static equivalent (03-02, 07-03).
6. **Name the consequence.** Buttons say what will happen: "Open question 3", "Close answering and reveal", "End game and show podium" (06-02).
7. **Never lock input for an animation.** State changes are immediate. Motion follows the state and can always be interrupted (skill §3).

### 2.1 Voice

Short, warm and specific. Kind on failure. One fixed sentence per state, so the tone stays consistent.

| Moment | Copy |
|---|---|
| Player joined | "You're in, {nickname}! Waiting for the host to start." |
| Before answering | "Pick one answer. You can't change it after you tap." |
| Sending | "Sending your answer…" |
| Locked | "Locked in. Waiting for the host to close answering." |
| Correct | "Correct! You earned 1 point." |
| Wrong | "Not this time. The answer was B ◆ Lisbon." (letter and shape joined by a no-break space, the shape aria-hidden) |
| No answer | "You didn't answer this one." |
| Player end | "You finished 2nd with 4 points." Last place gets the same sentence, never a negative label. |
| Host lobby, 0 players | "No one here yet. Scan the code or go to {link} and type {code}." |
| Room gone | "This room no longer exists. Scores are saved if the game finished." |

---

## 3. Tokens

Tokens are named by role (06-03, 09-04). `styles.css` keeps its current mechanism: each role has a `-l` and a `-d` primitive, and `light-dark()` picks between them, with the `prefers-color-scheme` block as a fallback. Only the names and values change. Every text pair was checked with the WCAG formula; the ratios are listed.

### 3.1 Colour

| Token | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `--bg` | `#F5F5F7` | `#0B0B0F` | Page background (grouped). Dark is not pure black, to avoid shimmer. | |
| `--surface` | `#FFFFFF` | `#1C1C1F` | Cards, tables, receded tiles | |
| `--surface-2` | `#FAFAFC` | `#26262A` | Table header band, raised inner rows, podium 2nd and 3rd | |
| `--raised` | `#FFFFFF` | `#2E2E33` | Segmented control thumb, one step above `--fill` in both themes | |
| `--label` | `#1D1D1F` | `#F5F5F7` | Primary text | 15.5 / 18.0 on bg |
| `--label-2` | `#6E6E73` | `#98989D` | Secondary text, placeholders, footnotes | L 4.66 on bg, 5.07 on surface. D 6.84 on bg, 5.92 on surface, 5.25 on surface-2 |
| `--separator` | `rgb(60 60 67 / .14)` | `rgb(255 255 255 / .09)` | Decorative hairlines only | |
| `--control-border` | `#8A8A8E` | `#7C7C80` | Input borders, segmented track edge, outline of a receded tile | L 3.44 on surface, 3.16 on bg. D 4.09 on surface (1.4.11) |
| `--fill` | `rgb(118 118 128 / .10)` | `rgb(118 118 128 / .22)` | Segmented track, neutral capsules, hover fill | |
| `--accent-fill` | `#4F46E5` | `#5E5CE6` | Filled button background | white text 6.29 / 5.06 |
| `--accent-pressed` | `#3F37C9` | `#4F4DD6` | Filled button while pressed | white text 8.07 / 6.24 |
| `--accent` | `#4F46E5` | `#A5A1FF` | Link text, current segment underline, focus ring, "You" label, tinted button text | L 5.77 on bg. D 8.55 on bg, 7.40 on surface |
| `--accent-tint` | `#ECEBFD` | `#25233F` | Tinted button background, "you" row, Host login capsule | accent text on it 5.35 / 6.57 |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` | Text on accent-fill | |
| `--success` | `#1F7A35` | `#30D158` | Ready, Live dot, correct tag, moved-up delta | 5.39 on white / 8.41 on surface |
| `--warning` | `#B25000` | `#FF9F0A` | Connecting dot | 5.20 / 8.27 |
| `--error` | `#D70015` | `#FF6961` | Error text, Offline dot, destructive button text, log-out icon | 5.38 on white, 4.94 on bg / 6.03 on surface |
| `--bar` | `rgb(250 250 252 / .72)` | `rgb(22 22 26 / .68)` | Top bar material (blur 20px, saturate 180%) | |
| `--bar-solid` | `#FAFAFC` | `#16161A` | The bar under reduced transparency | |
| `--popover` | `rgb(255 255 255 / .82)` | `rgb(44 44 48 / .84)` | Account popover (blur 30px) | |

`accent-color` is set to `var(--accent-fill)` so native checkboxes, radios and the `<progress>` bar follow the accent.

**Answer palette.** These are content colours. The values are the same in both themes, so the projector and every phone match (03-01 heuristic 4). Each answer always keeps its letter and its shape.

| Answer | Face | Text on face | Plinth (4px bottom edge) | Face vs light bg | Plinth vs light bg | Face vs dark bg |
|---|---|---|---|---|---|---|
| A ▲ | `#D70015` | `#FFFFFF` 5.38 | `#8E000E` | 4.94 | 8.94 | 3.65 |
| B ◆ | `#0A5AD6` | `#FFFFFF` 6.09 | `#063C8F` | 5.60 | 9.40 | 3.22 |
| C ● | `#FFCC00` | `#1D1D1F` 11.1 | `#8F6B00` | 1.39 | 4.52 | 12.99 |
| D ■ | `#1F7A35` | `#FFFFFF` 5.39 | `#124A20` | 4.95 | 9.52 | 3.64 |

- The plinth is a buzzer-style bottom edge (taken from direction B). It does two jobs: it signals that the tile can be pressed (07-01), and it gives the yellow tile a 3:1 boundary on the light background (1.4.11).
- Answer tiles always sit directly on `--bg`, never inside a `--surface` card. B on the dark surface would only reach 2.79:1.

**Status mapping** (fixes F3). Each status is shown as a capsule with a dot and a word.

| State | Dot | Word |
|---|---|---|
| Live (host, socket open) | success | "Live" |
| Connected (player) | success | "Connected" |
| Connecting or reconnecting | warning, breathing | "Connecting…" |
| Finished | none, a `✓` glyph in label-2 | "Finished" |
| Offline or room gone | error | "Offline" |
| Quiz ready | success-tinted capsule | "✓ Ready" |
| Quiz not ready | neutral `--fill` capsule | "Needs approved questions" |
| Question approved / draft | success-tinted / neutral | "Approved" / "Draft" |

### 3.2 Typography

Use the system stack and the platform face (skill §15). On Windows projectors this means Segoe UI Variable, so see the risk note in the decision log.

```
--font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, system-ui, sans-serif;
--font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, system-ui, sans-serif;
--mono: ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Mono", Consolas, monospace;
```

All numbers (scores, ranks, counters, "3 of 12", the room code) use `font-variant-numeric: tabular-nums`. Sizes are in rem, so the layout follows the user's text size. Tracking gets tighter as size grows, and leading gets shorter.

| Role | Size | Line height | Tracking | Weight | Where |
|---|---|---|---|---|---|
| Display | `clamp(2.25rem, 4.2vw, 3.75rem)` | 1.05 | -0.025em | 700 | Host question on the projector, podium winner. `text-wrap: balance`, max 28ch. |
| Room code | `clamp(3rem, 9vw, 5.5rem)`, mono | 1.0 | +0.14em (wide on purpose, so each character reads from the back row) | 700 | Join panel |
| Large title (h1) | 2.125rem | 1.12 | -0.022em | 700 | Page titles. Replaces +0.01em. |
| Title 2 (h2) | 1.375rem | 1.2 | -0.014em | 700 | Section titles, player question text uses 1.625rem / 1.2 / -0.018em |
| Headline | 1.0625rem | 1.3 | -0.008em | 600 | Card titles, button labels |
| Body | 1.0625rem | 1.47 | -0.006em | 400 | Everything else. Prose capped at 70ch. |
| Callout | 0.9375rem | 1.4 | 0 | 400 / 600 | Hints, status capsules, table headers (sentence case, 600, label-2) |
| Footnote | 0.8125rem | 1.38 | +0.01em | 500 | Metadata only, never the only copy of key information |
| Answer tile | `clamp(1.125rem, 1.6vw, 1.625rem)` | 1.25 | -0.01em | 600 | Grows on the projector |

Table headers change from all-caps to sentence case (06-03).

**App (React Native, points):** largeTitle 34/41, letterSpacing 0.37, 700. title1 28/34 0.36 (question). title2 22/28 0.35. headline 17/22 600 -0.41. body 17/22 -0.41. subhead 15/20 -0.24. footnote 13/18 -0.08. The room code uses Menlo / monospace 28 with letterSpacing 4. `allowFontScaling` stays on, and tiles grow taller instead of truncating.

### 3.3 Spacing, grid and targets

- 4px base with an 8px rhythm, as tokens `--s-1` to `--s-10`: 4, 8, 12, 16, 20, 24, 32, 40, 56, 80 (in rem: 0.25 to 5). Use 8 between a label and its field, 16 inside cards, 24 between related groups, and 40 to 56 between sections.
- Page gutter: `max(1rem, safe-area-inset)`. This is the existing `--gutter`.
- Content width: 30rem for forms (Join, Auth), 52rem for the library, editor and results, 72rem for the host game.
- Host game at 64rem and up: 12 columns with a 32px gutter. The stage spans 8 columns and the side panel spans 4. Below 64rem everything stacks.
- Top bar row height: `--bar-row` (3.25rem). The account popover is placed from it.
- Targets: at least 44 × 44px on the web (`--target`), at least 50pt for app buttons. Answer tiles are at least 5rem tall on the web and 132pt in the app.

### 3.4 Radius (concentric: inner = outer - padding)

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 6px | Letter badges, tags, delta chips |
| `--r-sm` | 10px | Inputs, small buttons, segment thumb |
| `--r-md` | 14px | Buttons |
| `--r-lg` | 20px | Cards, tables, join panel, podium tops |
| `--r-xl` | 24px | Answer tiles |
| `--r-pill` | 999px | Capsules, segmented track, player chips, account button |

In React Native, use `borderCurve: 'continuous'` on every rounded view.

### 3.5 Elevation and materials (skill §12)

- **Light cards:** `--card-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 8px 24px rgb(0 0 0 / .06)`.
- **Dark cards:** no shadow. `--card-shadow` becomes `inset 0 1px 0 rgb(255 255 255 / .06)`, which reads as light catching the top edge.
- **Segment thumb:** `--thumb-shadow`, `0 1px 3px rgb(0 0 0 / .12)` in light, `inset 0 1px 0 rgb(255 255 255 / .08), 0 1px 3px rgb(0 0 0 / .3)` in dark.
- **Popover:** `--popover-shadow`, `0 12px 40px rgb(0 0 0 / .16)` in light, `/ .5` in dark.
- **Top bar:** `--bar` with `backdrop-filter: saturate(180%) blur(20px)`. Content scrolls underneath. There is no permanent border. A hairline shows only once content is under the bar: toggle a `scrolled` class from a 1px sentinel with `IntersectionObserver`.
- **Account popover:** `--popover` with blur 30px and `0 12px 40px rgb(0 0 0 / .16)`. It is the only other translucent layer. Never stack translucent on translucent.
- **Under `prefers-reduced-transparency: reduce`:** the bar uses `--bar-solid`, the popover uses `--surface`, and there is no blur.
- **Under `prefers-contrast: more`:** surfaces are solid, cards, tiles and the segmented track get a 1px `--control-border`, and `--label-2` becomes `--label`.

### 3.6 Motion tokens

These are curves sampled from the real spring equation (generator: `x(t)` for damping ratio ζ and response T). `:root` declares every spring token as `cubic-bezier(0.2, 0, 0, 1)`, and an `@supports (transition-timing-function: linear(0, 1))` block swaps in the `linear()` values, so browsers without `linear()` (Safari before 17.2) still ease. Durations are tokens too: `--dur-press` 90ms, `--dur-release`, `--dur-nav`, `--dur-content`, `--dur-move`.

| Token | Apple values | Settles in | Overshoot | CSS | RN `Animated.spring` |
|---|---|---|---|---|---|
| `--ease-spring` | ζ 1.0 (any T; the curve shape is the same, only the duration changes) | see durations | 0 | `linear(0, 0.091 6.3%, 0.265 12.5%, 0.444 18.8%, 0.595 25%, 0.714 31.3%, 0.802 37.5%, 0.865 43.8%, 0.909 50%, 0.94 56.3%, 0.96 62.5%, 0.974 68.8%, 0.983 75%, 0.989 81.3%, 0.993 87.5%, 0.995 93.8%, 1)` | see durations |
| `--dur-release` | ζ 1.0, T 0.25 | 320ms | 0 | `--ease-spring` | stiffness 632, damping 50.3 |
| `--dur-nav` | ζ 1.0, T 0.30 | 380ms | 0 | `--ease-spring` | 439 / 41.9 |
| `--dur-content` | ζ 1.0, T 0.35 | 450ms | 0 | `--ease-spring` | 322 / 35.9 |
| `--dur-move` | ζ 1.0, T 0.45 (Apple's reposition value) | 575ms | 0 | `--ease-spring` | 195 / 27.9 |
| `--spring-lock` | ζ 0.75, T 0.30 | 360ms | 2.8% | `linear(0, 0.087 6.3%, 0.272 12.5%, 0.477 18.8%, 0.659 25%, 0.803 31.3%, 0.904 37.5%, 0.969 43.8%, 1.006 50%, 1.023 56.3%, 1.028 62.5%, 1.026 68.8%, 1.021 75%, 1.015 81.3%, 1.01 87.5%, 1.006 93.8%, 1)` | 439 / 31.4 |
| `--spring-arrive` | ζ 0.82, T 0.45 | 550ms | 1.1% | `linear(0, 0.089 6.3%, 0.273 12.5%, 0.471 18.8%, 0.644 25%, 0.778 31.3%, 0.874 37.5%, 0.938 43.8%, 0.976 50%, 0.997 56.3%, 1.008 62.5%, 1.011 68.8%, 1.011 75%, 1.009 81.3%, 1.007 87.5%, 1.005 93.8%, 1)` | 195 / 22.9 |
| `--spring-podium` | ζ 0.80, T 0.50 | 615ms | 1.5% | `linear(0, 0.089 6.3%, 0.275 12.5%, 0.476 18.8%, 0.652 25%, 0.789 31.3%, 0.886 37.5%, 0.948 43.8%, 0.986 50%, 1.005 56.3%, 1.013 62.5%, 1.015 68.8%, 1.014 75%, 1.011 81.3%, 1.008 87.5%, 1.005 93.8%, 1)` | 158 / 20.1 |
| `--ease-press` | none | 90ms (`--dur-press`) | 0 | `cubic-bezier(0.2, 0, 0, 1)` | `Animated.timing` 90ms |
| `--ease-fade` | none | 150ms | 0 | `ease` | `Animated.timing` 150ms. Used as the reduced-motion substitute everywhere. |

RN conversion: stiffness = (2π/T)², damping = 4πζ/T, mass 1, `useNativeDriver: true`. Animate transform and opacity only.

**Rule:** only these tokens exist. Overshoot is allowed in exactly three of them (lock, arrive, podium). Adding a fourth bouncy token needs a decision-log entry.

---

## 4. Components and states

Every component lists the states the developer must build (06-04, 09-04). "Hover" applies only under `@media (hover: hover)`, and nothing important is ever shown only on hover.

### 4.1 Buttons

Three kinds, plus a destructive variant. Buttons never use underline or link styling.

| Kind | Look | When | Examples |
|---|---|---|---|
| **Filled** | `--accent-fill` background, `--on-accent` 600 text, radius 14, min height 44 (48 for `.big`) | The one main action of the view, or of a repeated card (one per card) | Join, Log in, Start game, Open question 3, Close answering and reveal, End game and show podium, View stored results, Host a game, Approve |
| **Tinted** | `--accent-tint` background, `--accent` text | Secondary actions that still matter | Back to quizzes, Edit questions, Copy, Add a question, Create quiz, Generate drafts, Join another game when it isn't the main action |
| **Plain** | No background, `--accent` text plus an optional glyph. On hover, a `--fill` background. | Tertiary actions, Cancel | Rename, Cancel, End game (while the game is still running) |
| **Destructive** | Plain shape with `--error` text and a leading glyph (trash or ✕). On hover, an error-tinted fill. Never filled red. | Delete quiz, Delete question | |

States (all kinds):

| State | Visual | Notes |
|---|---|---|
| Default | As above | |
| Hover | Filled: 6% darker background. Tinted and plain: `--fill` overlay. 120ms colour transition, no movement. | Pointer devices only |
| Focus | 3px `--accent` outline, 2px offset | `:focus-visible` |
| Pressed | `scale(0.97)` in 90ms `--ease-press`. Filled becomes `--accent-pressed`. | On pointer-down (`:active`). Release returns on `--ease-spring` 320ms. |
| Disabled | 40% opacity on the background only, label stays at least 4.5:1 (use `--label-2`). There is always a visible reason next to it, linked with `aria-describedby`. | "Approve 1 to 10 questions to make it playable." |
| Loading | The label is replaced by the "…ing" label (for example "Joining…"), with a 14px spinner on the leading side. The width is locked (`min-width` set to the width at rest) so the layout doesn't jump. `aria-busy` is set on the form. | The spinner rotates 800ms linear. Under reduced motion it is hidden and the text alone shows the state. |

The current `.secondary` class maps to Tinted, `.danger` maps to Destructive, and `button.link` is removed.

### 4.2 Links

- **Inline link:** `--accent` text, underlined (1px, offset 3px), underline thickening to 2px on hover. Used only inside sentences: "New here? Create an account", "Join with a room code", "Hosting a quiz? Log in as a host".
- **Back link:** a ‹ chevron glyph plus a short label ("Quizzes", "Results"), `--accent`, 44px tall, no underline (the chevron is its signifier, the same as iOS). Placed at the top-left of content. It stays an `<a>`.

### 4.3 Top bar

```
Host, wide (48rem and up):
[Q QuizRoom]          [ Quizzes | Results ]          [● Live · AB12CD] [(person) ⌄]

Host, narrow:
[Q QuizRoom]                                          [● AB12CD] [(person) ⌄]
[        Quizzes        |        Results         ]

Logged out (Join, Login, Register):
[Q QuizRoom]                                                   [ Host login ]

Player on #/play:
[Q QuizRoom]
```

- **Brand:** the "Q" tile (accent fill, radius 8) plus "QuizRoom" at 17/700, -0.01em. It links to `#/quizzes` for a logged-in host and to `#/` otherwise (Jakob's law: the logo goes home).
- **Places:** the segmented control (4.4), rendered only for a host.
- **Live pill** (from B): shown when `qr.hostRoom` exists. It is a capsule with a success dot and "Live · {code}" (on narrow screens, the code only), and it is an `<a href="#/host">`. On `#/host` it has `aria-current="page"`. It answers "how do I get back to my game?" (05-02).
- **Account button** (4.5) for a host. A "Host login" tinted capsule for a logged-out visitor, which is an `<a>` with `aria-current="page"` on the login page. On `#/play`, the right side is empty, so players are not invited away mid-game.
- The `<nav aria-label="Main">` wraps the places, the Live pill and the Host login link. The account button sits outside the nav, because it is an action, not a place.

### 4.4 Segmented control (main places)

- **Markup:** the same `<a>` elements with `aria-current="page"`. Do not use `role="tab"`: these are pages, and link semantics are correct (03-02 Robust).
- **Labels:** "Quizzes" and "Results". "Past results" is shortened for the segment; the page h1 stays "Past results".
- **Track:** `--fill` background, 1px `--control-border`, radius pill, 36px visual height inside a 44px hit area.
- **Segment:** `--label-2` at weight 500. On hover the text becomes `--label`. Selected: `--label` at 600 on the thumb.
- **Thumb:** a single `<span class="seg-thumb" aria-hidden="true">` absolutely positioned under the selected segment, inset 3px inside the 36px track, with a `--raised` background, radius pill and `--thumb-shadow` (in dark mode `--raised` is `#2E2E33` with the inset highlight). The first placement skips the transition so it doesn't slide in from the left on load. Its `translate` and `width` are set from the selected link's `offsetLeft` and `offsetWidth` in a layout effect, and they transition on `--ease-spring` 380ms. A CSS transition re-targets from the current value, so fast clicks stay smooth (skill §3). The thumb is hidden when no segment is current (for example on `#/host`).
- **Mapping:** `#/quizzes` and `#/quizzes/:id` select Quizzes. `#/results` and `#/results/:id` select Results. `aria-current="page"` stays exactly where it is today: `page === 'quizzes'` or `page === 'results'`.
- **States:** default, hover, focus (3px accent ring around the segment), selected, and pressed (`scale(0.97)` on the label).
- **Forced colours:** the selected segment gets a 2px `Highlight` outline instead of the shadow.

### 4.5 Account button and popover

- **Trigger:** a 36px tall capsule (`--fill`, 4px transparent border so the hit area is 44px) with a person glyph and a small ⌄ that turns over while open. It is `<button popovertarget="account" aria-label="Account">`. The Popover API provides `aria-expanded`, light dismiss, Esc to close, and focus return. Where the Popover API is missing, the button toggles its own `aria-expanded` and an `open` class, and Esc closes the menu.
- **Popover:** `<div id="account" popover>` with `--popover` material, radius 14, 240px wide. It is anchored under the trigger at the top-right: `position: fixed; right: var(--gutter); top: calc(safe-area-inset-top + var(--bar-row) + 4px)`. Without `backdrop-filter` it falls back to `--surface`. `transform-origin` is the top-right corner, so it grows out of the button (skill §7).
- **Content:**
  1. "Signed in as host" in footnote, label-2.
  2. Only when `qr.hostRoom` exists, a consequence line: "You're hosting {quizTitle} in room {code}. Logging out removes your host controls from this browser. Players stay in the room."
  3. A separator.
  4. A "Log out" menu row: a `<button>`, 44px tall, full width, a leaving-arrow glyph in `--error`, and the label in `--label`.
- **Behaviour:** the same `logout()` as today. There is no confirmation dialog. Opening the popover is the deliberate step, and the consequence is written at the point of decision (06-02, 07-01 alert fatigue).
- **States:** closed, open, row hover, row focus, row pressed.

### 4.6 Cards and notices

- **Card:** `--surface`, radius 20, padding 16 (24 from 40rem), with the elevation from 3.5.
- **Notice** (information): `--accent-tint` background, `--label` text, radius 14, with an inline action. Examples: "You're in room AB12CD as Yusuf. Back to the game" (tinted button) on Join, "A game is live in room AB12CD. Return to room" in the library.
- **Error card:** surface with a 4px `--error` leading bar and `--error` icon ✕. The text says what happened, what was kept, and what to do (03-03). Any action (Retry) is a filled button inside the card. It keeps `role="alert"`.
- **Success card:** the same pattern with `--success` and ✓.
- **Field error:** `--error` text under the field, starting with "Error:", with the field border in `--error` and `aria-invalid`. Already in place.
- **Skeleton:** for any list that is loading, show 3 blocks in the final layout shape, `--fill` background, no shimmer animation. The existing "Loading…" text moves into a visually hidden `role="status"` inside it.

### 4.7 List rows (grouped list)

Used for the past results list and for player lists in the app.

- Rows are `--surface`, min height 56, padding 12/16, with an inset hairline separator (`--separator`, starting at the 16px inset) and a ‹ › chevron on the right in label-2.
- The whole row is clickable through a stretched pseudo-element on the existing title link (`a::after { position: absolute; inset: 0 }`), so it stays one link for screen readers.
- The table semantics stay. Only the visual style changes. Header cells are sentence case, 13/600, label-2.
- **States:** default, hover (`--fill`), focus (ring on the row via `:focus-within`), pressed (`--fill` at double strength).
- On narrow screens (under 40rem) each row stacks: the title, then "date · players" in footnote.

### 4.8 Status capsule

A capsule (`--fill`, radius pill, 28px, callout 600) with an 8px dot and a word, as in 3.1. The "Connecting…" dot breathes in opacity from 1 to 0.4 over 1.2s, alternating, and stops once the socket is live. Under reduced motion the dot is static. The text is the source of truth. The existing `role` and `aria-live` usage stays as it is.

### 4.9 Code input (Join)

- It stays one native `<input>`, so paste, autofill, the `pattern` and `:user-invalid` keep working.
- It is drawn as 6 slots: mono at 1.75rem, `letter-spacing: 0.5em`, and a background of 6 rounded cells built from `--fill`. Width: `calc(6 * (1ch + 0.5em))` plus padding. If cell alignment is off with a platform font, fall back to a plain field with wide tracking; the slots are decoration only.
- **States:** empty, focus (accent ring), filled and valid (border `--success` plus an aria-hidden ✓ at the end; the hint text is unchanged), error (the existing `field-error` text, `aria-invalid`, and the border in `--error`), disabled while joining.
- **Error nudge:** on `invalid`, a WAAPI `translateX` sequence 0, -6, 5, -3, 0px over 280ms. Under reduced motion there is no nudge; the text and the border carry the error.

### 4.10 Answer tile

The web player tile is a `<button aria-pressed>` (existing). The host tile is an `<li>` (existing). In the app, a tile is `Pressable` with `role="radio"` (existing).

**Anatomy:** a 2 × 2 grid of tiles, radius 24, min height 5rem (web) or 132pt (app), padding 16. Each tile has:
- A letter badge at top-left (28px, radius 6, `rgb(0 0 0 / .18)` background behind the white letter on dark faces, `rgb(0 0 0 / .12)` on C; see D27).
- The option text in answer type.
- The shape glyph at top-right.
- A tag area at the bottom.
- A 4px plinth: `box-shadow: 0 4px 0 var(--plinth)`, plus `margin-bottom: 4px`.

| State | Visual | Trigger |
|---|---|---|
| Idle | Face colour and plinth | Question open, not locked |
| Hover | Face brightness 1.06, no movement | Pointer only |
| Focus | 2px `--bg` gap plus a 3px `--accent` ring (`box-shadow` stack), visible on all four faces | Keyboard |
| Pressed | `translateY(3px) scale(0.98)`, plinth shrinks to 1px, 90ms `--ease-press`. In the app, a Medium haptic fires on the same frame. | Pointer-down |
| Chosen, sending | Ring: 3px `--bg` gap plus 3px `--label`. Tag: "Sending…" | Tap released, request in flight |
| Chosen, locked | Same ring. Tag: "Locked in". The tile settles from 0.96 to 1 on `--spring-lock`. | Answer accepted (`accepted`) |
| Receded | `--surface` background, 1px `--control-border`, text `--label-2`, scale 0.97, no plinth. The letter badge keeps its answer colour with white or ink text, so the mapping survives. 240ms ease-out. Replaces opacity 0.3 / 0.35 (F5). | Another tile chosen, or revealed and not correct |
| Correct | Face colour kept, ring 3px `--bg` plus 3px `--label`, tag "✓ Correct answer". Scale pulse 1 → 1.03 → 1 on `--spring-lock`, once. | Reveal |
| Wrong pick | Receded style plus a `--label` ring and the tag "✕ Your answer" | Reveal, the player chose it |
| Disabled | The receded style. The existing `disabled` and `aria-disabled` logic is unchanged. | |
| Host tile | Not interactive: no hover or press. Projector size uses the display-scaled answer type. | |
| Forced colours | Keep the existing outline rules for chosen and correct. Faces become `Canvas` with a `CanvasText` border. | |

Layout: two columns from 18rem wide (see D35). Between 18rem and 22rem the tile drops its 3rem end padding and the text wraps under the letter row, so phones at 360 to 414px get a 2x2 grid in the thumb zone. One column below 18rem, at 200% zoom on a phone, or when any option is longer than 60 characters (add a `long` class).

### 4.11 Room code and QR panel

- **Full (lobby):** a card with the QR on a white plate at the left (`#000` on `#fff` in both themes, 240px, radius 14, 12px white padding), and on the right: "Scan with a phone camera, or join with code" (callout label-2), the room code in Room code type, the join link field with a tinted "Copy" button, and the copy status line (existing `role="status"`). On narrow screens it stacks with the QR first.
- **Compact (after the lobby):** a single row in the side panel: a 96px QR, "Join with code" and the code at 1.75rem mono. It stays visible so latecomers can still join. The copy row is hidden visually in compact mode but stays in the DOM. Switching from full to compact unmounts the full panel from the stage, and the compact one enters in the side column with the card rise (motion row 8). No View Transition is used, because the switch follows a socket event (D15).
- The visually hidden spaced reading ("Room code A B 1 2 C D") stays.

### 4.12 Player chip

- A capsule (`--surface`, 1px `--separator`, radius pill, 36px tall) with an 8px success dot and the nickname at 17/500, truncated with an ellipsis after 20ch (the full name is in `title`).
- **States:**
  - Entering: from `scale(0.6)` and opacity 0 to rest, on `--spring-arrive` 550ms through `@starting-style`. The stagger is `transition-delay: min(var(--i) * 40ms, 320ms)`, so at most 8 chips are visibly staggered.
  - Online: a visually hidden "connected".
  - Away: a hollow ring dot (1.5px `--label-2` border) plus a visible "away" in footnote.
  - Long name: truncated as above.
- The list keeps its `aria-live="polite"` wrapper as it is today.

### 4.13 Leaderboard row (`Board`)

- It stays a `<table>` with a `<caption>`. Rows are 52px, the rank and score cells use tabular numerals, and the score is right-aligned at 600.
- **States:**
  - Normal.
  - You: `--accent-tint` background, a 3px `--accent` bar at the leading edge, and a "You" label in `--accent` 600 (replaces "(you)" in bold; the visible text keeps the word).
  - Moved up: a "▲2" chip in `--success` with a visually hidden "up 2 places", plus a 600ms `--accent-tint` background fade-out.
  - Moved down: a "▼1" chip in `--label-2`, never red.
  - Every rank is written as an ordinal ("1st", "2nd", "12th") so the table, the rank card and the podium agree (D34).
- Deltas compare against the previous leaderboard seen in this mount, kept in a `useRef` map from `playerId` to rank. There are no deltas on the first render or after a resync snapshot replaces the list.
- **Reorder:** FLIP with WAAPI (see motion row 23). Projector rule: on the host reveal, show the top 8 rows plus a final row "and {n} more". The final scoreboard table always shows everyone.

### 4.14 Podium

- **New component:** `Podium({ rows, animate })` in `live.tsx`. It groups the scoreboard rows with rank 3 or better by rank and shows one block per rank (D33).
- **Layout:** visual order 2nd, 1st, 3rd. Block heights depend on rank: rank 1 is 100%, rank 2 is 64%, rank 3 and below are 48%, of a stage `clamp(10rem, 28vh, 18rem)` tall. Tied players share one block: the names are listed ("Grace, Ada"; more than 3 become "Ada, Alan +2") and the block shows "{n} players" under the ordinal. Ranks 1, 1, 3 give a "1st · 2 players" block and a "3rd" block.
- **Blocks:** radius 20 at the top only. Rank 1 uses `--accent-fill` with `--on-accent` text. Others use `--surface-2` with `--label`. Each block shows the ordinal in display type and, above the block, the name (Title 2, the winner in Display) and "{n} points".
- **Edge cases:** 1 or 2 players render only those blocks. With 0 players the podium is omitted and the table's existing "No players." row shows.
- **Accessibility:** the podium is `aria-hidden="true"`. The table below is the accessible source, so nothing is announced twice.
- **Motion:** see row 25. `animate` is true only when the phase changed to `ended` during this mount (the host's `game:ended` event or a successful `act('end')`, the player's `game:ended` event). It is false on the results page, and false when the page loads already finished. So a reconnect or resync never replays it.

### 4.15 Answer meter (host)

A 6px track (`--fill`, radius pill) under the tiles, with a fill in `--accent-fill` sized with `transform: scaleX(submitted / total)` (`transform-origin: left`), transitioning on `--ease-spring` 450ms. It is `aria-hidden`. The existing status line ("7 of 12 players answered.") stays the source.

### 4.16 Toasts and inline status

QuizRoom does not use floating toasts. They are easy to miss on a projector and need timers. Feedback appears next to its cause, in the existing `role="status"` elements:

- Copy: the status line under the copy row shows "Link copied." with a ✓, or the existing fallback copy.
- Generate drafts: the success card.
- Answer: the status line under the tiles.

Entry: `@starting-style` opacity 0 and `translateY(4px)` to rest on `--ease-spring` 320ms.

---

## 5. Motion spec

General rules:

- State changes use CSS transitions, which re-target from the current on-screen value when a snapshot or event flips state mid-animation (skill §3).
- New blocks (cards, notices, errors, boards, skeletons, the question, tiles, chips, podium) enter with a one-shot CSS `@keyframes` animation using `animation-fill-mode: backwards`, so content is in its final state if animations don't run. `@starting-style` is used where an element toggles rather than mounts: the account popover, the answer tag and the rank delta chip. Where it is unsupported, they just appear.
- Lists use WAAPI FLIP: the visual position is read with `getBoundingClientRect`, running animations are cancelled, and the row animates from the offset of its rank shift.
- View Transitions are used only for user navigation (`hashchange`), never for socket events. The route update runs as `document.startViewTransition(() => flushSync(() => setHash(location.hash)))` when supported, and as a plain `setHash` otherwise. The top bar has `view-transition-name: top` with no animation, so only the page content fades. Focus still moves to `<main>` afterwards.
- Animate only transform and opacity. The exceptions are the press plinth (`box-shadow`, 90ms) and the segment thumb width.
- No input is locked and no state waits for an animation to end.
- One CSS block under `@media (prefers-reduced-motion: reduce)` swaps every transform transition and animation for a 150ms opacity fade. JS checks `matchMedia('(prefers-reduced-motion: reduce)')` before FLIP, nudge and podium sequencing.

| # | Interaction | Technique | Easing / spring | Duration | Reduced motion |
|---|---|---|---|---|---|
| 1 | Press on any button, segment or tile | `:active` transform (tile also shrinks the plinth) | `--ease-press` | 90ms | Colour change only (`--accent-pressed`, or face brightness) |
| 2 | Release | Transition back | `--ease-spring` | 320ms | Instant |
| 3 | Hover (pointer only) | Background colour | ease | 120ms | Same |
| 4 | Segment thumb moves between Quizzes and Results | CSS transition on `translate` and `width` | `--ease-spring` | 380ms | Jumps; the selected text weight shows the state |
| 5 | Account popover opens | `@starting-style` scale 0.96 → 1 and opacity, origin top-right; on Apple platforms blur materialises with it | `--ease-spring` | 380ms | Opacity 150ms |
| 6 | Account popover closes | Same path in reverse (`transition-behavior: allow-discrete` on `display` and `overlay`; where unsupported, it closes instantly) | ease-in | 180ms | Opacity 150ms |
| 7 | Route change | View Transition: old page fades out, new page fades in and rises 8px. The top bar stays still. | crossfade 200ms, rise `--ease-spring` | 450ms | Crossfade 150ms only |
| 8 | Card, notice or status entry | Keyframe `rise`: opacity and 8px rise | `--ease-spring` | 450ms | Opacity 150ms |
| 9 | Invalid room code | WAAPI translateX 0, -6, 5, -3, 0 | ease-out | 280ms | None; text and border |
| 10 | Join button busy | Spinner rotation, label "Joining…" | linear | 800ms per turn | Spinner hidden, label only |
| 11 | Lobby player arrives | Keyframe `chip-in`: scale 0.6 → 1 and opacity, stagger 40ms capped at 320ms | `--spring-arrive` | 550ms | Opacity 150ms, no stagger |
| 12 | Player goes away | Dot cross-fades to a hollow ring, "away" text appears | ease | 200ms | Instant |
| 13 | Connecting dot | Opacity 1 → 0.4, alternating | ease-in-out | 1.2s per cycle, stops when live | Static dot |
| 14 | Question opens: text | Keyframe `rise-far`: translateY 12px and opacity | `--ease-spring` | 450ms | Opacity 150ms |
| 15 | Question opens: tiles | Keyframe `tile-in`: scale 0.96 and opacity, A to D delayed 40ms each (`--i`), clickable from frame 1 | `--ease-spring` | 450ms (about 570ms in total) | Opacity 150ms, no stagger |
| 16 | Host answer meter | `scaleX` transition | `--ease-spring` | 450ms | Instant |
| 17 | Answer lock: chosen tile | Transition on the `chosen` class: the tile stays pressed in (translateY 3px, no plinth) and the ring settles in | `--spring-lock` | 360ms | No movement; ring and tag show the state |
| 18 | Answer lock: other tiles recede | Transition background, colour and scale 0.97 | ease-out | 240ms | Colours only, 150ms |
| 19 | "Sending…" → "Locked in" tag | `@starting-style` translateY 6px and opacity | `--ease-spring` | 320ms | Instant text swap |
| 20 | Send failed | Class removed: tiles transition back to idle along the same path | `--ease-spring` | 320ms | Instant; the error message explains |
| 21 | Reveal: correct tile | Ring appears, scale 1 → 1.03 → 1 once | `--spring-lock` | 360ms | Ring and tag only |
| 22 | Reveal: outcome | Status line restyled as an outcome card (✓, ✕ or – circle), entering with keyframe `rise` (opacity and 8px). App haptic on the same frame. | `--ease-spring` | 450ms | Opacity 150ms |
| 23 | Reveal: explanation card | Entry, 120ms after the outcome (`transition-delay`) | `--ease-spring` | 450ms | Opacity 150ms, no delay |
| 24 | Leaderboard reorder | WAAPI FLIP on each moved `<tr>` in a `useLayoutEffect` after the new order renders: read the visual rect, cancel running animations, read the rect again, and animate `translateY(dy)` → 0, where `dy` is the rank shift times the row height plus the visual offset. A second update mid-move re-targets from where the row is on screen, without a jump. | `--ease-spring` | 575ms | No FLIP; rows swap, delta chips still show |
| 25 | Moved-up row highlight and delta chip | Background `--accent-tint` fading to transparent; chip `@starting-style` | ease-out / `--ease-spring` | 600ms / 320ms | Chip only |
| 26 | Podium blocks rise | `translateY(100%)` and opacity to rest, in the order 3rd, 2nd, 1st, 140ms apart (`animation-delay`) | `--spring-podium` | 615ms each, about 900ms in total | Blocks shown at final height with a 150ms fade |
| 27 | Podium names | Opacity and 6px rise after their block lands (+300ms) | `--ease-spring` | 320ms | With the blocks |
| 28 | Lobby panel → compact | Full panel unmounts from the stage, compact panel enters in the side column with keyframe `rise` (no View Transition, D15) | `--ease-spring` | 450ms | Opacity 150ms |
| 29 | Theme change | `background-color` and `color` transitions on `body` | ease | 300ms | Same (no motion involved) |
| 30 | Top bar hairline | `box-shadow` hairline when the scroll sentinel leaves the viewport | ease | 200ms | Same (no motion involved) |
| 31 | Account chevron | Rotates 180° while the popover is open | `--ease-spring` | 380ms | Instant |
| 32 | Brand mark hover | The "Q" tile tilts -8° (pointer only) | `--spring-lock` | 320ms | None (D39) |

**App (React Native).**

- **Buttons:** `Pressable` `onPressIn` runs `Animated.timing(scale → 0.97, 90ms)`, and `onPressOut` runs `Animated.spring(→ 1, stiffness 632, damping 50.3)`. This replaces the 0.7 opacity press. Disabled and busy fade only the background layer to 0.4 and draw the label in `label`, so it stays at least 4.5:1 (D28). Tinted gets a pressed tint (`accentTintPressed`, `#DCDAFA` / `#312E55`) so it still responds under reduced motion (D29). The busy spinner is hidden under reduced motion.
- **Tiles:**
  - Press: translateY 3 and scale 0.98 with a 90ms timing.
  - Lock: spring 439 / 31.4 back to 1.
  - Recede: `backgroundColor` card, secondary text, letter badge keeps its colour. This replaces opacity 0.35.
  - Question entry: `Animated.stagger(40, springs 322 / 35.9)` on opacity and scale from 0.96.
- **Outcome card and explanation:** opacity and translateY 12 with spring 322 / 35.9. The explanation is delayed 120ms.
- **Leaderboard and lobby list:** `LayoutAnimation.configureNext({ duration: 575, update: { type: 'spring', springDamping: 1 }, create: { type: 'spring', springDamping: 0.82, property: 'scaleXY' } })` before setting the new list. If it misbehaves on Android, drop to an instant update.
- **Podium mini:** three `Animated.View` blocks with spring 158 / 20.1 in the order 3rd, 2nd, 1st, 140ms apart. It is only shown when `game:ended` arrived during this mount.
- **Reduced motion:** a small `useReducedMotion()` hook in `ui.tsx` using `AccessibilityInfo.isReduceMotionEnabled()` and the `reduceMotionChanged` listener. When on, use `Animated.timing` opacity 150ms everywhere and skip `LayoutAnimation`.

**Haptics (app only, `expo-haptics`, fired on the same frame as the visual, skill §13).** These are the only moments that buzz:

| Moment | Haptic | Status |
|---|---|---|
| QR scanned | Notification Success | exists |
| Manual join succeeded | Notification Success | new, in `Join.tsx` right before `onJoined` |
| Question opens | Impact Light | new |
| Answer pressed | Impact Medium | exists |
| Reveal: correct | Notification Success | exists |
| Reveal: wrong | Notification Warning | changed from Error: gentler, not punitive |

---

## 6. Screens

The squint target names the one thing that must still stand out with blurred eyes (06-02). Each screen lists its states (03-03).

### 6.1 Website, global

- **Top bar:** as in 4.3, sticky and translucent.
- **`main`:** width depends on the page (3.3). The h1 uses Large title, the lead paragraph is body in label-2, max 60ch.
- **Route change:** row 7 of the motion table. Focus moves to `<main>` (existing).

### 6.2 Join (`#/`, `#/join/CODE`)

- **Squint target:** the code field and the Join button.
- **Layout:** one 30rem column. h1 "Join a game", then the lead "Enter the code on the host's screen, or scan its QR code with your phone camera." If `qr.player` exists, a notice: "You're in room AB12CD as Yusuf." with a tinted "Back to the game" button (it stays an `<a href="#/play">` styled as a tinted button).
- **Card:** Room code label, hint, slot field (4.9), Nickname label, hint, field, then a filled full-width "Join" (48px). Below the card, the footer line "Hosting a quiz? Log in as a host" as an inline link.
- **States:**
  - Normal.
  - Field error: on blur, as today.
  - Loading: "Joining…" with the button width locked.
  - Error: the alert under the fields, keeping the values entered.
  - Success: route to `#/play` with a View Transition.

### 6.3 Login and Register

- **Squint target:** the filled button.
- **Layout:** the same column and card. h1 "Host login" or "Create a host account", then the lead.
- **Fields:** the existing fields. The password hint stays above the field.
- **Button:** filled "Log in" or "Create account".
- **Below the card:** inline links to switch modes and to the Join page.
- **States:** normal, loading (button busy), error (error card under the fields).

### 6.4 Quizzes (library)

- **Squint target:** the quiz cards' "Host a game" buttons.
- **Layout:**
  - h1 "Your quizzes".
  - If a room is live, a notice: "A game is live in room AB12CD." with a filled "Return to room". This is the existing link, restyled.
  - An inline create card: the "New quiz title" field with a tinted "Create quiz" button.
  - A list of cards, 1 column, and 2 columns from 48rem.
- **Each card:**
  - The title as a link (Headline 600, no underline until hover, because the whole title is the link's signifier inside a card).
  - The status capsule ("✓ Ready" or "Needs approved questions").
  - Counts in footnote.
  - If the quiz is not ready, the reason "Approve 1 to 10 questions to make it playable." linked to the disabled button with `aria-describedby`.
  - An action row: filled "Host a game", tinted "Edit questions", plain "Rename", and destructive "Delete" pushed to the far end with `margin-inline-start: auto` (Fitts). The existing `confirm()` stays.
- **States:**
  - Loading: 3 skeleton cards.
  - Empty: "No quizzes yet. Give your first one a name above."
  - Error: an error card.
  - Renaming: the inline form, with a filled "Save" and a plain "Cancel".

### 6.5 Quiz editor and AI drafts

- **Squint target:** the questions list and the "Approve" buttons.
- **Header:** a back link "‹ Quizzes", then h1 with the title and the status capsule, then a lead with the counts.
- **AI section:** a card with a 4px `--accent` leading bar and the heading "Generate drafts from notes". It contains the existing fields and a tinted "Generate drafts" button. While generating, the existing `<progress>` and copy stay in the status region. Under it, 2 skeleton question cards show where the drafts will land. On success, a success card ("5 draft questions added below. Review and approve them before using them in a game."). Rejected suggestions follow as a plain list.
- **Question card:**
  - The status capsule (Approved or Draft).
  - The question text (Headline).
  - The 4 options as rows, each with the coloured letter and shape badge from the answer palette, with the correct one marked by a `--success` ✓ and the text "Correct".
  - The "From your notes" excerpt as a `figure` with a 3px `--separator` leading bar.
  - Actions: filled "Approve" (drafts only), tinted "Edit", and destructive "Delete" at the far end.
  - Editing keeps the existing notice "Saving changes moves this question back to Draft…".
- **Footer:** a tinted, big "Add a question".
- **States:** loading (skeleton), empty ("No questions yet. Add one by hand or generate drafts from your notes."), error card, draft, approved.

### 6.6 Host game (`#/host`), the projector stage

```
>= 64rem
+-----------------------------------------------------------------------+
| AIESEC                                                     (● Live)    |  h1 + status capsule
| Status line (role=status)                                             |
| [ Primary action named for the next step ]          [ End game ]      |  control row
+----------------------------------------------+------------------------+
| STAGE (8 cols)                               | SIDE (4 cols, sticky)  |
|  lobby: full join panel                      |  Players · 12          |
|  open:  "Question 3 of 10" capsule           |  chips...              |
|         Display question                     |  or compact join panel |
|         2x2 tiles + answer meter             |  + Leaderboard after   |
|  closed: tiles revealed + explanation        |    reveal (top 8)      |
|  ended:  podium + final table + actions      |                        |
+----------------------------------------------+------------------------+
```

- **Header:**
  - h1 with the quiz title.
  - The status capsule (3.1). This fixes "Finished" in the screenshot: it becomes a neutral "✓ Finished".
  - The existing status line, with its exact text.
- **Control row:** one filled primary named for the next step, and a plain "End game" separated by flexible space at the far end (Fitts):
  - Lobby: "Start game · 12 players". With 0 players it stays enabled, and the status line already says to start when everyone has joined.
  - Waiting: "Open question 1".
  - Closed and more questions remain: "Open question {n + 1}".
  - Open: "Close answering and reveal".
  - Closed and it was the last question: the end action becomes the filled primary, "End game and show podium".
  - Unknown (resumed): "Open next question" and "Close answering", as today.

  These are copy and class changes only. The conditions (`canOpen`, `canClose`, `canEnd`) are untouched.
- **Error:** an error card with a filled "Retry" (the existing SCORING_UNAVAILABLE path).
- **Lobby:**
  - Stage: the full join panel (4.11).
  - Side: "Players · {n}" plus chips (4.12).
  - Empty: "No one here yet. Scan the code or go to {link} and type {code}."
  - Squint target: the room code.
- **Question open:**
  - Stage: a "Question 3 of 10" capsule, the question in Display type, the tiles (host style) on `--bg` (no card), and the answer meter. The status line carries "7 of 12 players answered."
  - Side: the compact join panel, then Players.
  - Squint target: the question.
- **Reveal (closed):**
  - The tiles show reveal states: the correct tile is the only saturated one, the others recede (squint test).
  - The explanation shows as a large callout card under the tiles.
  - Side: Leaderboard first (above the compact join panel and Players), top 8 plus "and {n} more", with FLIP and deltas, so the top 8 rows fit a 1280x800 projector without scrolling (D36).
- **Ended:**
  - "The game has ended." stays in the status line.
  - The stage shows the podium, animated once (4.14), then the "Final scoreboard" table, then the actions: filled "View stored results" (the existing `<a>`) and tinted "Back to quizzes".
  - Single column, centred, 52rem.
- **Gone:** an error card: "This room no longer exists. Scores are saved if the game finished." with a filled "Back to quizzes".
- **Below 64rem:** everything stacks in this order: header, control row, stage, side.

### 6.7 Past results (`#/results`)

- **Squint target:** the list.
- **Layout:** h1 "Past results", then the grouped list (4.7) with three columns: Quiz (link), Finished (date in label-2), Players (tabular). The caption stays visually hidden.
- **States:**
  - Loading: 3 skeleton rows.
  - Empty: "No finished games yet. Host a quiz and its results will appear here." with a tinted "Go to quizzes".
  - Error: an error card.

### 6.8 Result detail (`#/results/:id`)

A back link "‹ Results", then h1 with the quiz title, then the metadata line in footnote label-2 ("Finished 17/11/2026, 14:05. 10 questions scored."). Then a static podium (`animate={false}`) and the "Final scoreboard" table. States: loading skeleton, error card.

### 6.9 Player (`#/play`) on a phone browser

- **Player bar:** at the top of the content: the nickname (Headline), "Room AB12CD" in mono footnote, and the status capsule. The global top bar shows only the brand.
- **Lobby or waiting:**
  - A hero line in Large title: "You're in, {nickname}!" (lobby) or "Get ready" (waiting).
  - The existing status sentence in the `role="status"` line.
  - "Players · {n}" with chips. The player's own chip comes first and has the "You" label.
- **Question:**
  - The "Question 3 of 10" capsule and the question in Title 2 phone size.
  - Tiles in the bottom ~60% of the viewport, for thumb reach.
  - The status line under the tiles.
  - Squint target: the tiles.
- **Reveal:**
  - The tiles show reveal states.
  - The status line becomes the outcome card (✓ / ✕ / – circle plus the existing sentence; the wrong case adds "The answer was B ◆ Lisbon.", with the shape aria-hidden and kept on the letter's line).
  - Then the explanation card.
  - Then a "Your rank" card: "3rd · 4 points" in Title 2 tabular, and the sentence "You are 3rd with 4 points." ("You are tied for 3rd…" when others share the rank; D34).
  - Then the leaderboard with the player's own row highlighted.
- **Ended:**
  - h1 "Game over" with the placement line "You finished 2nd with 4 points."
  - The mini podium (animated only if the end arrived live), then the final table, then a filled "Join another game".
- **Gone:** the existing alert as an error card, then a filled "Join another game".
- **Send failed:** the tiles return to idle and the existing message shows in a notice above the tiles.

### 6.10 Expo app

Same tokens, mirrored as one `light` / `dark` object in `ui.tsx`. It replaces the iOS system colours: background `#F5F5F7` / `#0B0B0F`, card `#FFFFFF` / `#1C1C1F`, accent fill `#4F46E5` / `#5E5CE6`, accent text `#4F46E5` / `#A5A1FF`, answer palette and plinths as in 3.1.

- **`Button`:** Filled / Tinted / Plain as on the web, 50pt, radius 14, with spring press scale.
- **Join:**
  - The large title "Join a game" and its subtitle.
  - A filled "Scan QR code" (it becomes the primary, because scanning is the fastest path).
  - An "or type the code" footnote divider.
  - The grouped form (Room code in mono 28 with letterSpacing 4, then Nickname).
  - A tinted "Join". When the code field holds 6 valid characters, Join becomes filled and Scan becomes tinted, so there is still one primary.
  - Camera denied: the existing copy, with a tinted "Open Settings" button instead of blue text.
- **Scanner:** a full-bleed camera, a 260pt rounded frame (radius 28, white 3pt corners), and a "Cancel" capsule top-left on `rgb(0 0 0 / .55)` (solid black under reduced transparency; D30). When a code is detected, the frame scales to the code (spring 439 / 41.9) on the same frame as the Success haptic.
- **Game bar:** "{nickname} · Room {code}" in footnote and the `Pill`.
- **Lobby:** the large title "You're in!" with its subtitle, then the Room code and Playing as group, then the Players group (rows animate in with `LayoutAnimation`). "Away" keeps its text.
- **Question:**
  - The counter, the question in title1, and the tiles (min height 132, plinth with `borderBottomWidth: 4`, press, lock and recede as in 5). The Light haptic fires when the question opens.
  - The status text below.
- **Reveal:** the outcome card springs in (existing content, plus "The answer was B ◆." for wrong), then the explanation, then Your rank and Score, then the Board with `LayoutAnimation`.
- **Ended:** the large title "Game over" and the placement subtitle (existing), the mini podium, the Board, then a filled "Join another game".
- **Gone:** as now, with the filled button.
- There is no in-game "Leave" control today, and none is added.

---

## 7. Accessibility checklist

Contrast and colour (03-02, WCAG 2.2 AA):

- [ ] All body and secondary text is at least 4.5:1 in both themes (ratios in 3.1).
- [ ] Filled button text is at least 5:1. Accent text is at least 5.3:1.
- [ ] Answer tile text is at least 5.38:1.
- [ ] Control borders, the plinth of the yellow tile, and the focus ring are at least 3:1 against their background.
- [ ] Receded tiles use `--label-2` on `--surface`, with no opacity on text (fixes F5).
- [ ] Colour is never the only signal. Answers have a letter, a shape and a colour. Statuses have a word. "You" has a label. Rank changes have ▲ / ▼ text plus a visually hidden "up 2 places". Correct and wrong have ✓ / ✕ plus a word. Away has a ring plus a word.

Semantics (Robust):

- [ ] Nav stays `<a aria-current="page">` inside `<nav aria-label="Main">`. No `role="tab"`.
- [ ] Log out stays a `<button>`, inside a native popover opened by `<button popovertarget aria-label="Account">`. Focus returns to the trigger on close.
- [ ] Answer tiles stay `<button aria-pressed>` with the existing `disabled` and `aria-disabled` logic on the web, and `radiogroup` / `radio` in the app.
- [ ] Boards stay `<table>` with `<caption>`. The podium is `aria-hidden`, and the table is the single accessible source.
- [ ] All existing `role="status"`, `aria-live` and `role="alert"` regions keep their text and position. The outcome card is a restyle of the existing status line, not a new region.
- [ ] Decorative glyphs, the QR plate frame, the meter and the slot background are `aria-hidden`. The QR keeps `role="img"` and its title.
- [ ] Back links keep their visible text, and the chevron is aria-hidden.

Keyboard and focus:

- [ ] Tab order: brand, then segments, then Live pill, then account, then main.
- [ ] Esc closes the popover. Enter and Space press tiles. There are no traps.
- [ ] Visible 3px focus on everything. Tiles use the double ring so it shows on all four faces.
- [ ] `scroll-padding-top` keeps focused elements below the sticky bar (existing; update it if the bar height changes on narrow screens).
- [ ] Focus moves to `<main>` on every route change, after the View Transition.

Motion and preferences:

- [ ] Under `prefers-reduced-motion`, every transform becomes a 150ms opacity fade. No stagger, nudge, FLIP, podium rise or breathing dot. All text states remain.
- [ ] Nothing flashes (2.3.1). Nothing moves on its own for more than 5s (2.2.2): the connecting dot stops once live, and the podium runs once.
- [ ] `prefers-reduced-transparency` makes the bar and popover solid. `prefers-contrast: more` gives solid surfaces and borders. `forced-colors` keeps the existing outline rules, and the selected segment uses a `Highlight` outline.
- [ ] App: `AccessibilityInfo` reduce motion is honoured. Haptics are supplementary, never the only signal.

Size and zoom:

- [ ] Targets are at least 44px on the web and at least 50pt for app buttons. Tiles are at least 5rem / 132pt.
- [ ] At 200% zoom: tiles go to 1 column, the segmented nav takes its own row, the room code clamps without truncation, and nothing is clipped.
- [ ] Text uses rem, and app text scales (`allowFontScaling`).

Copy:

- [ ] Errors say what happened, what was kept and what to do (03-03).
- [ ] Disabled controls show their reason next to them.
- [ ] Buttons name the consequence.

---

## 8. Decision log

| # | Decision | Alternatives considered | Reason | Reference |
|---|---|---|---|---|
| D1 | Direction A "Calm craft" as the base | B "Game Night", C "Homeroom" | Best fit with the Apple skill's critically damped default, the strongest accessibility, and the fewest moving parts. Personality is taken from B and C only where it carries information. | skill §4, §16; scores in 9 |
| D2 | Places become a segmented control of `<a aria-current>` | Bottom tab bar, keep the links, `role="tab"` | Two host areas, used on a laptop. Tabs signal "place". Link semantics stay correct. | 05-02, 07-01, 03-02 Robust |
| D3 | Log out moves into an account popover, with consequence copy while a room is live | Ghost button next to the nav (B), outline button plus a confirm while live (C), a confirm dialog always | Separates the rare action from the frequent ones (Fitts, Hick). The popover is the deliberate step, and the consequence is shown at the point of decision. No new dialog and no behaviour change. | 03-01, 07-01 alert fatigue, 06-02 |
| D4 | "Live · CODE" pill in the bar while a room is open | Rely on the notice in the library (current) | Wayfinding back to a running game from any page | 05-02, skill §16 |
| D5 | Three button kinds plus destructive. No button ever looks like a link. | Keep `.secondary` blue-on-grey | Fixes F2. Underline means link everywhere. | 07-01, 03-01 heuristic 4 |
| D6 | Status mapped by meaning. "Finished" is neutral with ✓. | Keep the socket-based ok/warn | Fixes F3. Success states must not read as warnings. | 03-01 heuristic 1 |
| D7 | Podium plus the full table. The podium is aria-hidden. | Table only (current), `<ol>` podium with the table removed | Gives closure and a climax (F4). The table stays the complete accessible record, so nothing is double-announced. | 03-03 success state, 03-02 |
| D8 | Podium animates only when the end arrives live during this mount | Animate on every render | A resync or snapshot must not replay celebrations, and archival views stay static | skill §3, risk 4 of B |
| D9 | Receded tiles use surface plus label-2 text, not opacity | Opacity 0.3 / 0.35 (current) | Fixes F5. Text contrast stays at least 4.5:1. | 03-02 1.4.3 (from C) |
| D10 | A buzzer plinth on answer tiles | Flat tiles | It signals pressability and gives the yellow tile a 3:1 boundary on the light background | 07-01, 1.4.11 (from B) |
| D11 | Answer palette `#D70015 / #0A5AD6 / #FFCC00 / #1F7A35`, the same in both themes | iOS system colours (current: green with black text, yellow washes out) | Every face passes 4.5:1 text with headroom for projector washout. Matching colours on the projector and the phones. | 06-03, 03-01 heuristic 6 |
| D12 | Dark background `#0B0B0F`, not `#000` | Pure black (current) | Avoids shimmer and halation on projectors | 06-03 (F7) |
| D13 | One critically damped curve at four durations, plus exactly three bouncy tokens (lock, arrive, podium) | Five or more spring tokens with bounce on chips, rows and stamps (B, C) | Overshoot only where something lands with momentum. A small token set is easy to keep consistent. | skill §4 |
| D14 | CSS transitions plus `@starting-style` plus WAAPI FLIP, with no animation library | Motion / Framer Motion | No new dependency. CSS transitions re-target from the current value. FLIP reads the live rect. There are no drag gestures, so velocity hand-off isn't needed. | skill §3, §11; project constraint |
| D15 | View Transitions only for route changes | Use them for phase changes from socket events too | Socket events can arrive mid-transition. State must never wait on motion. | skill §3, 07-03 |
| D16 | Leaderboard reorders at ζ 1.0, 575ms | A bouncy reorder (C) | A rank change is information, not celebration. 575ms matches Apple's reposition value. | skill §4 table |
| D17 | Rank delta chips, with moving down in neutral grey | No deltas, or red for down | Motion is never the only signal. No shaming. | 07-03, 03-04 |
| D18 | Projector leaderboard shows the top 8 plus "and n more" during the game | All rows | Legible from the back of the room. The final table shows everyone. | 06-02, 06-04 extreme content |
| D19 | No confetti, sound, count-up or rolling digits | Confetti burst (B), shape burst (C), score count-up (A) | Delight comes from getting the rest right. Fails the "would they understand less without it" test. Less to build and test. | skill §16.8, 07-03 |
| D20 | No floating toasts. Feedback appears next to its cause in the existing status regions. | Toast stack | Easy to miss on a projector, needs timers, and duplicates live regions | 07-03, 03-03 |
| D21 | Haptics: add Light on question open and Success on manual join, change wrong to Warning | Keep as is, or add one for a top-3 finish | Causal, at most one per moment, gentle on failure | skill §13 |
| D22 | System font. Rounded display face not used. | `ui-rounded` (B, C) | Windows projectors would not get it anyway. Personality must not depend on a face. | skill §15 |
| D23 | Brand links to `#/quizzes` for a host | Always `#/` | The logo goes home, and a host's home is the library | 03-01 Jakob's law |
| D24 | Hide the top-bar actions on `#/play` | Keep "Host login" | Prevents players tapping away mid-question | 03-01 heuristic 5 (from C) |
| D25 | Deferred: confirm "End game" when questions remain, and a hard logout guard while hosting | Build them now | They are behaviour changes outside this visual brief. Logged as follow-up findings (severity 3, logout while hosting; severity 2, ending early). | 08-03, 09-02 |
| D26 | The outcome card restyles the existing status line under the tiles instead of adding a new region above them | A new card above the tiles (A) | Keeps ARIA intact and the reading order (instruction, tiles, result) | 03-02, project constraint |
| D27 | Letter badge on dark faces is `rgb(0 0 0 / .18)` behind white, replacing `rgb(255 255 255 / .22)` | Keep the light wash, or drop the badge fill | The light wash put the 15pt bold letter at 3.5 to 4.35:1 (D 3.52, B 3.98, A 4.35). The dark wash raises it above the bare face (at least 7:1), and the letter is how players match the projector to the phone. | 03-02 1.4.3, usability review |
| D28 | App buttons fade only a background layer (0.4) when disabled or busy; the label is drawn in `label`, not `label-2` | Opacity 0.5 on the whole button (previous app spec), `label-2` text (4.1) | Whole-button opacity put "Joining…" at about 2.3:1. `label-2` on a faded filled background is about 2.4:1 in light mode; `label` is at least 8:1 in both themes. | 03-02 1.4.3, usability review |
| D29 | Tinted app buttons swap to `accentTintPressed` while pressed | Scale only | Under reduced motion the scale is skipped, so tinted buttons gave no press feedback at all (principle 3). Accent text stays at least 5.3:1 on the pressed tint. | skill §13, usability review |
| D30 | Scanner Cancel capsule at `rgb(0 0 0 / .55)` | `.5` | White 17pt semibold on 50% black over a white scene is 3.98:1; 55% gives 4.75:1. | 03-02 1.4.3, usability review |
| D32 | Player capsule on a finished game is neutral "✓ Finished"; only a vanished room shows "Offline" | Red "Offline" for both | Same reasoning as D6, for the player at the moment of celebration | 03-01 heuristics 1 and 9, usability review |
| D33 | Podium groups tied players into one block per rank | First 3 rows, two blocks with the same ordinal | With a 4-way tie for 2nd, two tied players were left off the podium on every screen. One block per rank is fair and still fits three columns. | 03-01 heuristic 2, usability review |
| D34 | Ordinals everywhere, "tied for" when a rank is shared | "#1", "ranked 1" and "1st" on one screen | One way to write a rank. Ties are explained instead of silently repeated. | 03-01 heuristic 4, usability review |
| D35 | Two answer columns from 18rem, with a compact tile between 18 and 22rem | 22rem | At 375px the container is 21.4rem, so phones always got one column and the outcome card fell below the fold. The compact tile keeps the text width readable. | 6.9 thumb zone, usability review |
| D36 | Host reveal: leaderboard first in the side column; host-only tags, counter, deltas and "away" use `clamp(0.9375rem, 1.4vw, 1.25rem)`; `scrollbar-gutter: stable`; stale question cleared as soon as "Open question" succeeds | Players card above the board; 13px secondary type | The payoff was below the fold on a 1280x800 projector, secondary type was unreadable from the back row, the layout jumped 8px when the page started to scroll, and the old reveal flashed before `question:opened` arrived | 06-02, 06-04, usability review |
| D37 | The segmented control is centred on the page from 48rem; the Live pill hides as soon as the game ends | Centred in the nav; pill read on the next navigation | "Live · CODE" next to "✓ Finished" contradicted itself, and the control jumped about 45px when the pill went away | 03-01 heuristic 1, usability review |
| D38 | Join form uses `noValidate` and routes validation through the inline errors; the login error adds what was kept and what to do | Native bubble plus inline error; bare "Invalid email or password." | Two messages in two styles for one problem; 4.6 asks for what happened, what was kept, what to do | 03-01 heuristic 4, 03-03, usability review |
| D39 | The brand "Q" tile tilts -8° on hover with `--spring-lock` | No hover motion on the brand | One small, optional touch of personality in the chrome. It uses an existing token, runs only on pointer devices with motion allowed, and carries no information, so nothing depends on it. | skill §16.8, principle 4 exception |
| D31 | App announces the reveal outcome, send-failure notice and Join error with `announceForAccessibility`; the outcome card replaces the status line under the tiles and the send-failure notice sits directly above the tiles | Rely on `accessibilityRole="alert"` and live regions on newly mounted views | Android only announces live regions on views that are already mounted, iOS ignores `accessibilityLiveRegion`, so the result was silent at the key moment. Placing content below or beside the tiles also stops the tiles jumping at reveal. | 03-02 4.1.3, D26 |

Risks to check during the design review:

1. Segoe UI at -0.025em display tracking. If glyphs touch, relax to -0.015em.
2. FLIP on `<tr>` in Safari. If it glitches, animate a wrapper inside each cell. The table semantics must stay.
3. `linear()` and `@starting-style` support. Fallbacks are declared, and content always shows.
4. `LayoutAnimation` on Android with the new architecture. Fall back to instant.
5. `backdrop-filter` cost on low-end projector laptops. It is limited to the bar and the popover.
6. Lobby bursts of 30 or more joins. At most 8 chips stagger, and `aria-live` noise needs testing with NVDA and VoiceOver.
7. Resolved: `save()` dispatches a `qr:save` event and `App` re-renders on it, so the "Live" pill disappears as soon as the game ends (D37).

---

## 9. Scores

Each direction was scored 1 to 5 per criterion.

| Criterion | A "Calm craft" | B "Game Night" | C "Homeroom" |
|---|---|---|---|
| Fit for a live quiz on projector and phones | 4 | 5 | 4 |
| Usability (03-01 heuristics) | 5 | 4 | 5 |
| Accessibility (03-02) | 5 | 4 | 5 |
| Affordance clarity (07-01) | 5 | 4 | 4 |
| Motion quality per the Apple skill | 5 | 4 | 3 |
| Personality | 3 | 5 | 4 |
| Implementable without new dependencies | 5 | 3 | 3 |
| **Total (of 35)** | **32** | **29** | **28** |

Why the scores differ:

- **A** is the most faithful to the skill: critically damped by default, overshoot only on lock, arrival and podium, symmetric popover paths, and materials limited to the bar and popover. It also fixes the nav problem most cleanly. Its weak point is personality, which risks feeling plain to a party-quiz crowd.
- **B** has the strongest stage (buzzer tiles, a Live pill, kind copy, one-shot celebrations gated against resync). It costs more: confetti particles, rolling digits, a rounded face that Windows lacks, and five spring tokens with bounce on chrome-like elements. Its yellow and green faces rely on the plinth for contrast.
- **C** has the best copy and the best contrast fix (receded tiles without opacity), and it hides the nav during play. Its motion breaks the skill (bouncy leaderboard rows, 4.6% podium overshoot with 500 to 700ms suspense gaps). It also adds an icon set, avatar hues and more surface area to build.

**Winner: A**, with these grafts:

| Idea | Taken from |
|---|---|
| Buzzer plinth on tiles | B |
| "Quiet chrome, loud stage" rule | B |
| Live · CODE pill | B |
| Celebrations gated against resync | B |
| Projector top 8 | B |
| Neutral rank-down | B |
| Warning haptic for wrong | B |
| Receded tiles without opacity | C |
| Kind outcome copy naming the right answer | C |
| "Start game · 12 players" | C |
| Hiding the nav on `#/play` | C |
| Brand goes home | C |

A's lack of personality is covered by B's stage ideas, without bringing in B's dependencies or C's motion problems.

### Files the implementation touches

| Area | Files |
|---|---|
| Tokens, components, motion CSS | `frontend/src/styles.css` |
| Top bar, segmented nav, account popover, Live pill, View Transition on route change | `frontend/src/App.tsx` |
| `Board` (FLIP, deltas, you row, top-8 option), `People` chips, new `Podium` | `frontend/src/live.tsx` |
| Control labels, layout columns, status mapping, meter, podium on end | `frontend/src/Host.tsx` |
| Join slots and nudge, player bar, tiles, outcome card, podium | `frontend/src/Play.tsx` |
| Card actions, status capsules, skeletons, editor badges | `frontend/src/Library.tsx` |
| Tokens, `Button` spring press, `useReducedMotion`, `Board` LayoutAnimation, podium mini | `mobile/src/ui.tsx` |
| Tiles, haptics, outcome card animation | `mobile/src/Game.tsx` |
| Scan / join buttons, join haptic, scanner frame | `mobile/src/Join.tsx` |
