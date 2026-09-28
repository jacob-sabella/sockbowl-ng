---
name: Sockbowl
description: Live quiz bowl, with real packets, phone buzzers and a board on the TV.
colors:
  bg-primary: "#0a0e1a"
  bg-secondary: "#111827"
  bg-tertiary: "#1a2234"
  bg-elevated: "#1f2937"
  surface: "#1f2937"
  surface-hover: "#374151"
  surface-active: "#4b5563"
  text-primary: "#f9fafb"
  text-secondary: "#d1d5db"
  text-muted: "#9ca3af"
  accent-primary: "#6366f1"
  accent-primary-hover: "#818cf8"
  accent-secondary: "#8b5cf6"
  accent-tertiary: "#06b6d4"
  success: "#10b981"
  warning: "#f59e0b"
  error: "#ef4444"
  info: "#3b82f6"
  border-subtle: "rgba(75, 85, 99, 0.3)"
  border-medium: "rgba(107, 114, 128, 0.5)"
  border-strong: "rgba(156, 163, 175, 0.6)"
typography:
  display:
    fontFamily: "'Space Grotesk', 'Inter', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "3rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Space Grotesk', 'Inter', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Space Grotesk', 'Inter', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "'Inter', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  reading:
    fontFamily: "'Newsreader', Georgia, 'Times New Roman', serif"
    fontSize: "clamp(1.15rem, 1rem + 1vw, 1.5rem)"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "'Inter', 'Roboto', -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "0.875rem"
rounded:
  sm: "6px"
  md: "12px"
  lg: "20px"
  xl: "24px"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  2xl: "3rem"
  3xl: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 1.75rem"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent-primary-hover}"
  lobby-action:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "1rem 1.25rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  input:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "48px"
  buzz-button:
    backgroundColor: "{colors.error}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.full}"
    size: "min(72vw, 240px)"
  navbar:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    height: "64px"
---

# Design System: Sockbowl

<!-- Provenance: G0 of M5 (unattended loop, 2026-09-28) wrote this in document scan mode. Token values, file paths and component facts come from the code at goal/int-m3m4-pre 9dea1fd. All qualitative language (the North Star, character names, rule names and philosophy) is inferred, because no one could be asked, and it is marked (inferred). The owner can confirm, rename or delete it. The frontmatter shows the default Dark theme. Each of the 8 themes redefines the same token names (see Colors). -->

## Overview

**Creative North Star: "The Buzzer Room" (inferred)**

(inferred) Sockbowl is a competition room lit by a screen. The chrome is a dark, quiet ground with one confident accent. Question text is set in a bookish serif so it reads like a real packet. The one loud object on the screen is the buzzer. The display face (Space Grotesk, tracked-in and heavy) carries scores, titles and the brand. Inter carries the controls. Newsreader carries the questions. The system is dense enough for a proctor at a laptop and big enough to use one-handed on a phone.

(inferred) The theme lineup is part of the identity. The layout, type and shapes stay constant, and all colour comes from about 21 semantic tokens that each theme redefines (Dark, Light, Nord, Monokai, Catppuccin, Dracula, Solarized Dark, Solarized Light). Components must never hold a colour of their own. They name a role.

Existing code comments record deliberate refusals: no gradient-clipped text (`.text-gradient` is a solid accent), no neon glows (`.glow-effect` is a plain drop shadow), and no ambient purple wash on the lobby card.

**Key Characteristics:**
- A theme-agnostic token contract: `--bg-*`, `--surface*`, `--text-*`, `--accent-*`, status and `--border-*`, set on `body.theme-<name>`.
- Three type voices: display (Space Grotesk), UI (Inter) and reading (Newsreader).
- Rounded, soft-edged containers (12–24px) with flat fills and drop shadows only for real elevation.
- A single physical signature: the round, domed buzz button.
- Status is also shown with a coloured left stripe on info blocks (question, answer, verdict).

## Colors

(inferred) The palette is a deep, cool ground with one electric accent. Other themes swap the whole palette but keep the roles.

### Primary
- **Electric Indigo (inferred)** (accent-primary): primary actions, links, the focus ring, the brand wordmark in the navbar, the active tab underline, the selected state, and the "question" stripe. It is used on about 216 declarations, which makes it the most-used colour in the app.
- **Lifted Indigo (inferred)** (accent-primary-hover): hover state for accent fills and links.

### Secondary
- **Violet (inferred)** (accent-secondary): subcategory labels, bonus tally, "judging" status dot.

### Tertiary
- **Signal Cyan (inferred)** (accent-tertiary): occasional third accent. It is used in 10 places.

### Neutral
- **Midnight (inferred)** (bg-primary): page ground.
- **Slate Deep / Slate (inferred)** (bg-secondary, bg-tertiary): inset wells (inputs, info blocks, form-field fill).
- **Card Slate (inferred)** (surface, bg-elevated): cards, dialogs, menus, select panels.
- **Hover / Pressed Slate (inferred)** (surface-hover, surface-active): interactive surface states.
- **Paper / Mist / Fog (inferred)** (text-primary, text-secondary, text-muted): three text steps.
- **Hairlines** (border-subtle, border-medium, border-strong): translucent separators.

### Status
- success (correct answer, completed), warning (waiting, rate limit), error (wrong answer, fatal banner, and the buzz button fill), info (reading, category).

### Theme lineup
Each theme file in `src/styles/themes/_<name>.scss` sets the same 24 custom properties (the colours above plus `--glow-primary`, `--glow-secondary` and `--shadow-color`). `material-theme.scss` maps light and solarized-light to `color-scheme: light` and the rest to `dark`. The cast receiver loads the same values from `src/cast-theme-tokens.css`, which is generated by `npm run gen:cast-tokens`.

### Named Rules
**The Role-Not-Hue Rule. (inferred)** Component styles name a role token (`var(--accent-primary)`, `var(--success)`) and never a hex. A colour that has to be "white on the accent" is a missing token (`--on-accent`), not a `#fff`.

**The Eight-Theme Rule. (inferred)** A colour decision is not done until it passes in all 8 themes. Dark and light are the ones captured in screenshots. The other six are checked by the contrast matrix.

## Typography

**Display Font:** Space Grotesk (with Inter, system sans)
**Body Font:** Inter (with Roboto, system sans)
**Reading Font:** Newsreader (with Georgia, Times New Roman)
**Mono:** system monospace stack

**Character (inferred):** a grotesk display with a scoreboard feel, a neutral UI sans, and an optical-size serif that makes a tossup read like a printed packet.

### Hierarchy
- **Display** (800, 2.5–3rem, 1.1–1.2, -0.02em): the lobby wordmark "Sockbowl" and hero scores.
- **Headline** (600, 1.875rem `--text-3xl`, 1.25): page titles (h1/h2) through the heading rule in `styles.scss`.
- **Title** (600–700, 1.25–1.7rem): card titles such as "Tossup N of M".
- **Body** (400, 1rem, 1.5): UI copy.
- **Reading** (400–500, clamp(1.15rem, 1rem + 1vw, 1.5rem), 1.7): question text in the play card and reading view.
- **Label** (600, 0.72–0.75rem, 0.04em, uppercase): info-block labels and speed-control captions.

Scale tokens: `--text-xs` 12px through `--text-6xl` 60px, weights 400/500/600/700, and leading 1.25/1.5/1.75 (`src/styles/abstracts/_variables.scss`).

**Implementation gap (G0 audit):** the rendered app does not match this intent yet. The `mat-typography` class on `<body>` from the prebuilt Material theme sets `font: 400 14px/20px Roboto` on body and h1–h4, and it beats the element selectors in `styles.scss`. So UI text renders in Roboto 14px and Inter never loads. Headings get Space Grotesk only where they carry `.font-display`. F1 owns the fix.

### Named Rules
**The Three-Voice Rule. (inferred)** Space Grotesk is for chrome, titles and numbers. Inter is for controls and body copy. Newsreader is only for question and answer text. Never mix the reading serif into the UI.

## Layout

- **Model:** a single centred column on phones. Content maxes out at about 960px for play cards and 480px for the lobby card. Admin and builder views use wider grids.
- **Spacing:** a 4px-based scale (`--spacing-xs` 4px to `--spacing-3xl` 64px). Most components still use raw rem values (see the audit).
- **Breakpoints:** tokens and mixins define 768/1024/1280/1536px (`_breakpoints.scss`), but no component uses the mixins. The code has 11 different ad-hoc widths (600, 640/641, 720, 760, 768/769, 1024, 360, 480).
- **Viewport:** the viewport meta is `width=device-width, initial-scale=1` and `100dvh` is used for full-height play surfaces. There is no safe-area handling yet.
- **Touch:** Material buttons get `min-height: 40px` at ≤760px. The play surfaces use 48px controls, and the buzzer is at least 240px.

## Elevation & Depth

(inferred) The system is flat with real drop shadows. Surfaces separate by tone (bg-primary < surface < surface-hover) and a hairline border. Shadows mean elevation: cards, dialogs, menus, and the raised primary lobby action.

### Shadow Vocabulary
- **Shadow steps** (`--shadow-sm` 0 2px 8px → `--shadow-2xl` 0 20px 60px, coloured by the theme's `--shadow-color`): utilities `.shadow-sm`…`.shadow-2xl`.
- **Lobby card** (`0 24px 70px rgba(0,0,0,.55)` plus a 1px top inner highlight): the one hero container.
- **Buzzer dome** (base ring, cast shadow, light top inset, dark bottom inset). On press it translates 8px down and the shadow collapses.

### Named Rules
**The No-Glow Rule. (inferred)** Depth comes from shadow and tone, never a coloured glow. `--glow-*` tokens exist, but new work should not use them.

## Shapes

(inferred) Soft, friendly geometry: `--radius-sm` 6px for chips and small controls, `--radius-md` 12px for buttons and inputs, `--radius-lg` 20px for cards, `--radius-xl` 24px for the lobby card, and full circles for the buzzer and status dots. Info blocks use a 3–4px left stripe in the status colour on a 10% tint of the same colour.

## Components

### Buttons
- **Shape:** gently rounded (12px). Material buttons are 36px tall by default and at least 40px on mobile.
- **Primary:** a solid accent-primary fill with a white label today, which is a known contrast defect in 6 of 8 themes (see the audit). The fix is an `--on-accent` token. The play surfaces use 48px buttons.
- **Hover / Focus:** `brightness(1.06)` and/or a 2px lift. Focus is a 2px accent-primary outline with a 2px offset, but it is set per component and there is no global rule.
- **Ghost / Text:** Material text and outlined buttons are forced to `--text-primary`. Palette-coloured ones (`color="primary"`/`"warn"`) still use the prebuilt indigo-pink colours.

### Lobby Action (signature)
A full-width row button: leading icon, a label with a hint line, and a trailing arrow that slides 3px on hover. The primary variant is an accent fill.

### Buzz Button (signature)
A round dome, `min(72vw, 240px)` across, in the display face (800, uppercase), filled with `--error`. The locked state is `--surface-active` with muted text. Space and Enter buzz.

### Cards / Containers
- **Corner Style:** 20px (play card), 24px (lobby).
- **Background:** `--surface` with a 1px `--border-subtle` line. Material cards are forced to these values with `!important`.
- **Internal Padding:** 1rem on mobile and 1.5rem on desktop.

### Inputs / Fields
- **Style:** a `--bg-secondary` well with a 2px `--border-medium` line and a 12px radius. The play-card answer input is 48px tall.
- **Focus:** the border changes to accent-primary, and the outline is removed.
- **Material form fields:** the wrapper is forced to `--bg-secondary`, with labels in `--text-secondary`.

### Navigation
A Material toolbar on `--bg-elevated` with the accent wordmark "SOCKBOWL" in the display face, a theme selector, social links, and auth actions. The auth actions are role-gated buttons, with labels hidden on narrow screens.

### Status Banner (stomp-error-banner)
A rounded 8px row with a 12% status tint over the surface, a 1px status border, and a status icon. It is a warning, or an error when fatal. Non-fatal banners hide themselves after 5 seconds.

## Do's and Don'ts

### Do:
- **Do** name a role token for every colour, and check the pair in all 8 themes.
- **Do** keep question text in Newsreader at the reading size and line-height 1.7.
- **Do** keep the primary in-game action at least 48px tall and inside thumb reach.
- **Do** honour `prefers-reduced-motion` for every looping or entrance animation, as `_qb-play-card.scss` already does.

### Don't:
- **Don't** put `#fff`/`white` text on an accent or status fill. It fails AA in most themes. Use an on-colour token.
- **Don't** use gradient text, coloured glows or ambient purple washes. The incumbent code removed them on purpose.
- **Don't** add `!important` or new global selectors from a component. Material theming belongs in `vendors/_material-overrides.scss`.
