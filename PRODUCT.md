# Product

<!-- impeccable:product-schema 1 -->

> **Provenance.** Written by the M5 G0 pass of an unattended loop on 2026-09-28. The init interview could not run: the session had no question tool and no decision page, so no one could answer. Facts come from `GOAL.md`, the ledger's decisions D1–D21 (`PROGRESS.md`), `README.md`, `CLAUDE.md`, and the code at `goal/int-m3m4-pre` 9dea1fd. Anything marked **(inferred)** has not been confirmed by the owner and can be edited or removed at any time. Unmarked facts are traceable to the code or the ledger.

## Platform

web

(An installable PWA: `manifest.webmanifest` with `display: standalone`, plus a service worker through `ngsw-config.json`. A second web surface, `src/cast-receiver.html`, is a plain-JS page shown on a TV or projector through the Presentation API.)

## Users

- **Quiz bowl players** join a room with a join code and buzz on their own phones. The buzzer is the main thing they touch. They play as a guest or signed in (D1). **(inferred)** They are mostly high school and college students, often playing in a noisy classroom or club room.
- **Proctors (moderators)** read the tossups and bonuses aloud, judge answers, and move the match forward from a laptop or tablet. Any seated player can claim the proctor seat, and the owner can reassign it (D18). **(inferred)** They are often coaches, teachers or club officers, and the room usually sees the game on a projector or TV through the cast receiver.
- **Solo players** practice alone against a packet, with answers judged automatically (the `SINGLE_PLAYER` mode, "Solo practice" on the landing page).
- **Packet authors** (the `author` role, permission `packet:create`) write, import, validate, preview and publish packets in the packet builder (M3). **(inferred)** They are coaches and tournament writers who already work in the ACF/NAQT plaintext format (D5).
- **Moderators and admins** (`user:ban`, `admin:access`, `taxonomy:manage`) triage abuse: they ban users and IP ranges (D8), set usage quotas (D10) and look after the category taxonomy (D4).

## Product Purpose

Sockbowl runs real quiz bowl matches live: a room of players on their own devices with buzzers, a proctor who reads and judges, and a shared board on a TV. It uses real packets, either searched from an existing packet bank (qbreader), generated from a question bank, generated with AI, or written in the builder. The landing page line is "Real quiz-bowl packets and live buzzers."

Success means a group can go from "we want to play" to buzzing on a real packet in under a minute, with no accounts needed, and the match state stays correct and fair (buzz order, lockouts, scoring) the whole way through. **(inferred)**

## Positioning

**(inferred)** Sockbowl reproduces the quiz bowl ritual, which is tossups read aloud with players buzzing in and then bonuses, rather than a flashcard or self-paced quiz. Four modes (`QUIZ_BOWL_CLASSIC`, `AUTO_PROCTOR`, `FREE_FOR_ALL`, `SINGLE_PLAYER`) cover a full proctored match, a room with no human reader, a free-for-all, and solo practice. The phone is the buzzer and the TV is the board.

## Operating Context

- **Match flow:** `MatchState` goes CONFIG → IN_GAME → COMPLETED. Inside a round, `RoundState` goes PROCTOR_READING → AWAITING_BUZZ → AWAITING_ANSWER → (BONUS_PENDING → BONUS_READING_PREAMBLE → BONUS_READING_PART → BONUS_AWAITING_ANSWER → BONUS_COMPLETED) → COMPLETED.
- **Devices:** phones for buzzers, a laptop for the proctor, and a TV or projector for the cast receiver. The cast board mirrors the viewer's chosen theme. **(inferred)** The phone is held in one hand in portrait, and the room may be loud and dim.
- **Real-time transport:** STOMP over WebSocket. Errors surface as ERROR frames (fatal: BANNED, token expired) or `/user/queue/errors` messages (non-fatal: RATE_LIMITED and others).
- **Auth:** Keycloak OIDC with `AUTH_ENABLED` on or off. When auth is off, every permission is granted. Guests can host and join, with limits per IP (D1, D10).
- **Packets:** EPHEMERAL (made in a game by a guest or player, game-only, deleted after 24h), DRAFT (owned) and PUBLISHED (D2, D15). Import uses ACF/NAQT-style plaintext (D5). Saving is explicit per card or with "Save all", with a guard on unsaved changes (D6).
- **Limits:** per-role quotas (D10), a global AI budget (D11), and 429 or QUOTA_EXCEEDED responses shown in the UI (M4).

## Capabilities and Constraints

- Frontend: Angular 22, Angular Material 22 (currently the prebuilt `indigo-pink` M2 theme plus token overrides), SCSS, RxJS and STOMP. Karma is used for unit tests and Playwright for e2e.
- There are 8 selectable themes plus `auto`, persisted in localStorage (`sockbowl-theme-preference`). All user-facing colour comes from CSS custom properties on `body.theme-*`.
- The cast receiver is a non-Angular page. It shares theme tokens through `npm run gen:cast-tokens`.
- Browser evidence on this host comes from Chromium only. Safari/iOS behaviour is untested.
- **Undecided:** whether `auto` (follow the system) should be the default theme. The code defaults to `dark`, and a comment says it will become `auto`.

## Brand Commitments

- **Name:** "Sockbowl". The in-game terms are quiz bowl's own: tossup, bonus, buzz, proctor, packet, power.
- **Tagline in the product:** "Real quiz-bowl packets and live buzzers." (landing page and manifest).
- **Themes:** the 8-theme lineup (Dark, Light, Nord, Monokai, Catppuccin, Dracula, Solarized Dark, Solarized Light) is an existing user-facing feature. Removing or replacing a theme is a product decision for the owner (M5 plan §9).
- **Voice (inferred):** short, plain and friendly. The copy speaks to players directly ("Just you vs. the packet, answers auto-judged", "Enter a room's join code").
- **Links:** GitHub (`jacob-sabella/sockbowl-game`) and Discord, both in the navbar.

## Evidence on Hand

- Real content: question packets from qbreader and the local question bank. The UI-test clips gallery lives in `src/assets/test-clips/` and opens when "clips" is typed.
- Icons: `src/assets/icons/icon-{192,512}.png` and `icon.svg`.
- There are no testimonials, user counts, press or pricing. Future work must not invent any.

## Product Principles

1. **The buzz is sacred (inferred).** Buzz order, lockout and judging must be unambiguous and fast on a phone. Nothing covers or delays the buzzer.
2. **Play first, sign in optional.** Guests can host and play. An account adds ownership, authoring and quotas, and is never a gate to playing (D1).
3. **Read aloud, seen across the room (inferred).** Question text and the board are built to be read from the proctor's screen and from the far end of a room on a TV.
4. **Your packets, your rules.** Authors own their drafts, publishing is explicit, and nothing is saved behind the author's back (D2, D6).
5. **Fail loudly and recover gently.** Limits, bans and connection errors are shown in plain words, with a way forward.

## Accessibility & Inclusion

- Target: WCAG 2.2 AA in **every** selectable theme, not just Dark and Light (M5 plan §4, F1 done-when).
- Keyboard play must work: Space or Enter to buzz, and judge keys for the proctor.
- Reduced motion must be respected. Motion must never be the only signal of a state change.
- **(inferred)** Players are often on phones in portrait. Touch targets aim for 44px (the usability floor is 40px), and the main action stays in thumb reach.
