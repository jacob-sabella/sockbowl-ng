# Usability ruleset (human-centric)

The enforced contract for the web client's UI, checked programmatically by
`usability.spec.ts` (opt-in via `AUDIT=1`, `npm run audit`) across a viewport
matrix (280px → 2560px, portrait + landscape) and every reachable view —
landing, create/join forms, the proctor **config lobby**, the **buzzer**, and
the **spectator** surface (the in-game views are reached with the match
harness, which stages a real game with bot players).

A violation is a real defect: the fix goes in the CSS / component, **never in
the test**. The goal is a UI that never cuts content off, never hides or covers
a control, stays readable and reachable, and respects motion preferences —
everywhere.

## The rules

1. **No horizontal overflow.** `scrollWidth - clientWidth <= 2` on every view at
   every viewport. Content is never cut off the side.
2. **No covering of controls.** Hit-test the centre of every primary control
   with `elementFromPoint`; it must resolve to that control (a Material field's
   own floating label counts as the same control). Off-screen-but-scrollable is
   fine; on-screen-and-covered is not.
3. **Comfortable tap targets.** Primary controls are ≥ 40×40px on mobile
   (≤ 760px) and ≥ 24px on desktop.
4. **No jarring / unbounded animation.** Computed animation/transition durations
   on visible non-decorative elements stay ≤ 600ms and are not infinite
   (decorative loops — the buzzer heartbeat, spinners, glows — are allowlisted).
5. **Readable text.** No primary body/control text below 11px (uppercase
   micro-labels and decorative glyphs are exempt).
6. **Correct z-order.** Overlays/dialogs render above page content and are
   hit-testable on top.
7. **Visible keyboard focus.** Primary controls are focusable and the app ships
   a `:focus-visible` styling rule.
8. **Reduce-motion respected.** With `prefers-reduced-motion: reduce`, no
   non-decorative element runs an infinite animation.

## Defects this suite has already caught & fixed

- **Navbar overflow (32px) on narrow mobile** — the wordmark + social links +
  "Playing as Guest" + Sign In didn't fit ≤ 390px. Fixed: hide social + guest
  label ≤ 600px, collapse the wordmark to its icon ≤ 360px.
- **36px tap targets** — Material's default button height is below the 40px
  mobile floor. Fixed: 40px min-height on buttons ≤ 760px.

## Run

```sh
cd e2e
npm run audit                          # full suite (live prod)
npm run audit -- --grep "static"       # just the viewport matrix
npm run audit -- --grep "in-game"      # buzzer / spectator / config lobby
```
