---
name: impeccable
description: "Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, or loud designs that should become quieter. Not for backend-only or non-UI tasks."
license: Apache 2.0 (upstream: https://github.com/pbakaus/impeccable)
---

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft.

> **Lite manual port.** This is a text-guidance-only copy of the [impeccable](https://github.com/pbakaus/impeccable) skill, hand-installed without its CLI/scripts. Available: all design rules below plus the `reference/*.md` command playbooks (critique, audit, polish, bolder, quieter, distill, harden, onboard, animate, colorize, typeset, layout, delight, clarify, adapt, optimize, shape, craft, document, extract, init, brand, product). **Not available**: `live` (browser-based visual iteration server), the automated design-detector hook, and the `npx impeccable detect/pin/unpin/hooks` CLI commands — those require the full npm package (`npx impeccable install`). Where a reference doc below tells you to run a `node {{scripts_path}}/*.mjs` script, skip that step and proceed using judgment and your own file-reading/editing tools instead.

## Setup

Before proceeding:

1. Look for `PRODUCT.md` and `DESIGN.md` at the project root (or under `.agents/context/` or `docs/`). If found, read them for register, audience, brand voice, anti-references, and visual tokens. If missing, skim `reference/init.md` for what these files are meant to capture, but don't block on writing them — proceed with reasonable defaults inferred from the existing codebase.
2. If the user invoked a sub-command (`craft`, `shape`, `audit`, `polish`, ...), read `reference/<command>.md` next — it defines that command's flow.
3. Familiarize yourself with any existing design system, conventions, and components in the code (CSS/tokens/theme/a representative component). Use what's there when it works; branch out when the UX wins.
4. Read the matching register reference: `reference/brand.md` for marketing/landing/campaign/portfolio work (design IS the product), or `reference/product.md` for app UI/admin/dashboard/tool work (design SERVES the product).
5. If the project is brand-new with no existing CSS tokens/theme/brand colors, compose a palette yourself in OKLCH around one anchor brand color (see Color guidance below) rather than running the upstream `palette.mjs` helper.

## Design guidance

Produce ready-to-ship, production-grade code, not prototypes. Don't stop until arriving at a complete implementation (beautiful, responsive, fast, precise, bug-free, on brand).

### General rules

#### Color

- **Verify contrast.** Body text must hit ≥4.5:1 against its background; large text (≥18px or bold ≥14px) needs ≥3:1. Placeholder text needs the same 4.5:1, not the muted-gray default. If the contrast is even close, bump the body color toward the ink end of the ramp; light gray "for elegance" is the single biggest reason AI designs feel hard to read.
- Gray text on a colored background looks washed out. Use a darker shade of the background's own hue, or a transparency of the text color.

#### Typography

- Cap body line length at 65–75ch.
- Don't pair fonts that are similar but not identical (two geometric sans-serifs, two humanist sans-serifs). Pair on a contrast axis (serif + sans, geometric + humanist) or use one family in multiple weights.
- Hero/display heading ceiling: `clamp()` max ≤ 6rem (~96px). Above that the page is shouting, not designing.
- Display heading letter-spacing floor: ≥ -0.04em. Anything tighter and letters touch; cramped, not "designed".
- Use `text-wrap: balance` on h1–h3 for even line lengths; `text-wrap: pretty` on long prose to reduce orphans.

#### Layout

- Vary spacing for rhythm.
- Cards are the lazy answer. Use them only when they're truly the best affordance. Nested cards are always wrong.
- Flexbox for 1D, Grid for 2D. Don't default to Grid when `flex-wrap` would be simpler.
- For responsive grids without breakpoints: `repeat(auto-fit, minmax(280px, 1fr))`.
- Build a semantic z-index scale (dropdown → sticky → modal-backdrop → modal → toast → tooltip). Never arbitrary values like 999 or 9999.

#### Motion

- Motion should be intentional, not an afterthought — consider it part of the build.
- Don't animate CSS layout properties unless truly needed.
- Ease out with exponential curves (ease-out-quart/quint/expo). No bounce, no elastic.
- Use libraries for more advanced motion needs (motion, gsap, anime.js, lenis, etc).
- Reduced motion is not optional. Every animation needs a `@media (prefers-reduced-motion: reduce)` alternative: typically a crossfade or instant transition.
- Staggering items within one list is legitimate. The tell is the uniform reflex (one identical entrance applied to every section), not motion itself; each reveal should fit what it reveals.
- Reveal animations must enhance an already-visible default. Don't gate content visibility on a class-triggered transition; it can fail to fire on hidden tabs and headless renderers, shipping a blank section.
- Premium motion materials are not just transform/opacity. Blur, backdrop-filter, clip-path, mask, and shadow/glow are part of the palette when they materially improve the effect and stay smooth.

#### Interaction

- Dropdowns rendered with `position: absolute` inside an `overflow: hidden`/`overflow: auto` container will be clipped. Use the native `<dialog>`/popover API, `position: fixed`, or a portal to escape the stacking context.

### New projects only (when no prior work exists)

#### Color & Theme

- Use OKLCH.
- **The cream/sand/beige body bg is the saturated AI default.** The whole warm-neutral band (OKLCH L 0.84–0.97, C < 0.06, hue 40–100) reads as cream/sand/paper/parchment regardless of what you call it. Token names like `--paper`, `--cream`, `--sand`, `--bone`, `--linen`, `--parchment`, `--ivory` are tells in themselves. Pick instead: (a) a saturated brand color as the body, (b) a true off-white at chroma 0 (or chroma toward the brand's own hue), or (c) a darker mid-tone tinted neutral that's clearly the brand's own.
- Tinted neutrals: add 0.005–0.015 chroma toward the brand's hue. Don't default-tint toward warm or cool "because the brand feels that way".
- Dark vs. light is never a default. Before choosing, write one sentence of physical scene: who uses this, where, under what ambient light, in what mood. If the sentence doesn't force the answer, it's not concrete enough.
- Pick a **color strategy** before picking colors:
  - **Restrained**: tinted neutrals + one accent ≤10%. Product default; brand minimalism.
  - **Committed**: one saturated color carries 30–60% of the surface. Brand default for identity-driven pages.
  - **Full palette**: 3–4 named roles, each used deliberately. Brand campaigns; product data viz.
  - **Drenched**: the surface IS the color. Brand heroes, campaign pages.

### Absolute bans

Match-and-refuse. If you're about to write any of these, rewrite the element with different structure.

- **Side-stripe borders.** `border-left`/`border-right` greater than 1px as a colored accent on cards, list items, callouts, or alerts. Rewrite with full borders, background tints, leading numbers/icons, or nothing.
- **Gradient text.** `background-clip: text` combined with a gradient background. Use a single solid color; emphasis via weight or size.
- **Glassmorphism as default.** Blurs and glass cards used decoratively. Rare and purposeful, or nothing.
- **The hero-metric template.** Big number, small label, supporting stats, gradient accent. SaaS cliché.
- **Identical card grids.** Same-sized cards with icon + heading + text, repeated endlessly.
- **Tiny uppercase tracked eyebrow above every section.** One named kicker as a deliberate brand system is voice; an eyebrow on every section is AI grammar.
- **Numbered section markers as default scaffolding (01/02/03).** Numbers earn their place when the section actually IS a sequence with real order information; numbered eyebrows on every section is AI grammar.
- **Text that overflows its container.** Test heading copy at every breakpoint; if it overflows, reduce the clamp max or rewrite the copy.

### The AI slop test

If someone could look at this interface and say "AI made that" without doubt, it's failed.

- **First-order:** if someone could guess the theme + palette from the category alone, it's the first training-data reflex. Rework the scene sentence and color strategy until the answer isn't obvious from the domain.
- **Second-order:** if someone could guess the aesthetic family from category-plus-anti-references, it's the trap one tier deeper. Rework until both answers are not obvious. See `reference/brand.md`'s reflex-reject aesthetic lanes for currently-saturated families.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | Shape, then build a feature end-to-end | [reference/craft.md](reference/craft.md) |
| `shape [feature]` | Build | Plan UX/UI before writing code | [reference/shape.md](reference/shape.md) |
| `init` | Build | Set up project context: PRODUCT.md, DESIGN.md | [reference/init.md](reference/init.md) |
| `document` | Build | Generate DESIGN.md from existing project code | [reference/document.md](reference/document.md) |
| `extract [target]` | Build | Pull reusable tokens and components into design system | [reference/extract.md](reference/extract.md) |
| `critique [target]` | Evaluate | UX design review with heuristic scoring | [reference/critique.md](reference/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) | [reference/audit.md](reference/audit.md) |
| `polish [target]` | Refine | Final quality pass before shipping | [reference/polish.md](reference/polish.md) |
| `bolder [target]` | Refine | Amplify safe or bland designs | [reference/bolder.md](reference/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs | [reference/quieter.md](reference/quieter.md) |
| `distill [target]` | Refine | Strip to essence, remove complexity | [reference/distill.md](reference/distill.md) |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | [reference/harden.md](reference/harden.md) |
| `onboard [target]` | Refine | Design first-run flows, empty states, activation | [reference/onboard.md](reference/onboard.md) |
| `animate [target]` | Enhance | Add purposeful animations and motion | [reference/animate.md](reference/animate.md) |
| `colorize [target]` | Enhance | Add strategic color to monochromatic UIs | [reference/colorize.md](reference/colorize.md) |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts | [reference/typeset.md](reference/typeset.md) |
| `layout [target]` | Enhance | Fix spacing, rhythm, and visual hierarchy | [reference/layout.md](reference/layout.md) |
| `delight [target]` | Enhance | Add personality and memorable touches | [reference/delight.md](reference/delight.md) |
| `overdrive [target]` | Enhance | Push past conventional limits | [reference/overdrive.md](reference/overdrive.md) |
| `clarify [target]` | Fix | Improve UX copy, labels, and error messages | [reference/clarify.md](reference/clarify.md) |
| `adapt [target]` | Fix | Adapt for different devices and screen sizes | [reference/adapt.md](reference/adapt.md) |
| `optimize [target]` | Fix | Diagnose and fix UI performance | [reference/optimize.md](reference/optimize.md) |

Not ported: `live` (needs a running dev server + browser session scripts), `pin`/`unpin`/`hooks` (need the CLI's project-file writers).

### Routing rules

1. **First word matches a command**: load its reference file and follow its instructions. Everything after the command name is the target.
2. **First word doesn't match, but the intent clearly maps to one command** (e.g. "fix the spacing" → `layout`, "rewrite this error message" → `clarify`, "the colors feel flat" → `colorize`): load that command's reference and proceed as if invoked. If two commands could fit, ask once which.
3. **No clear command match**: general design invocation. Apply the setup steps, the General rules, and the loaded register reference, using the full request as context.
