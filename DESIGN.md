# Design

## Theme

**Premium dark.** Near-black violet surfaces, purple glows, white text — purple, black, and white only (user-locked palette, June 2026). A fixed ambient violet halo bleeds from the top of every page (body::before). Never reintroduce a light theme without explicit direction.

## Color

| Token (tailwind) | Value | Role |
|---|---|---|
| `charcoal` | #0b0712 | Page void, input fills, image scrims |
| `charcoal-800` | #130d1f | Cards, panels, sidebar |
| `charcoal-700` | #241c38 | Hairline borders, soft fills, chart gridlines |
| `charcoal-600` | #332853 | Strong borders, dashed outlines |
| `lime` (accent) | #a78bfa | Accent text/borders on dark (violet-400) |
| `lime-dim` | #c4b5fd | Micro labels needing extra pop |
| `ink` | #f7f5fc | Primary text (white) |
| `ink-muted` | #beb4d6 | Secondary text (~9:1 on cards) |
| `ink-faint` | #8f85aa | Micro labels (~5:1) |
| Solid fills | `.bg-lime` CSS rule | 135° gradient #8b5cf6 → #6d28d9 → #321a5e (violet→black) on ALL primary buttons/active chips/badges; deeper gradient on hover |
| Status | light steps overridden: amber #fcd34d, sky #7dd3fc, red #f87171, rose #fda4af, emerald #6ee7b9 | Functional states only |

Premium contrast cards (AI strategist, report summary): `bg-[#100921]` + `border-lime/25` + corner violet glow; inner sheets are `bg-white/[0.04] border-white/10` (never solid white). Modal scrims: `bg-black/70`.

## Typography

Archivo 400–800 is the only text family (`font-mono` is remapped to it — no real monospace). Body base weight 500. Headings bold, -0.02em. Instrument Serif survives only in legacy font-serif slots (logo context).

## Shape & Depth

- Radius: rounded-lg controls, rounded-xl cards, rounded-full pills. 
- Cards: `shadow-card` = inset top white highlight (4%) + deep black drop. `shadow-pop` adds a violet ring.
- `.lift` hover: rise 2px + violet edge-glow ring (pointer devices only).

## Motion

- Strong ease-out `cubic-bezier(0.23,1,0.32,1)`, 150–250ms UI; `.press` scale(0.97).
- `animate-reveal` (opacity + 6px rise), chart line draw-in (pathLength), bar grow-in (scaleY, staggered 60ms).
- Reduced motion collapses everything.

## Brand

"Aifluencee Content Hub" — ΛI gradient glyph on dark tile (components/BrandMark.tsx, app/icon.svg).
