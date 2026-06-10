# Design

## Theme

Light. White working surfaces (#FFFFFF) on a faint violet-tinted field (#F8F7FC). One dark inverse treatment reserved for rare CTA/footer moments. Never dark-mode by default.

## Color

Single accent system — violet carries actions, selection, and accents. Everything else is tinted neutral.

| Token (tailwind) | Value | Role |
|---|---|---|
| `charcoal` | #F8F7FC | Page field, input fills, image scrims |
| `charcoal-800` | #FFFFFF | Cards, panels, sidebar |
| `charcoal-700` | #EDEBF5 | Hairline borders, soft fills, table heads |
| `charcoal-600` | #DFDCEC | Strong borders, dashed outlines, disabled fills |
| `lime` (accent) | #7C3AED | Primary actions, links, active nav, accents (violet-600) |
| `lime-dim` | #5B21B6 | Small accent labels needing more contrast (violet-800) |
| `ink` | #17141F | Headings, primary text |
| `ink-muted` | #5D5869 | Body/secondary text (≥6:1 on white) |
| `ink-faint` | #757085 | Micro labels, captions (≥4.6:1 on white) |
| Status | amber-700 text on amber-400/10 · sky-700 on sky-400/10 · red-600 on red-400/10 | Warnings, scheduled, errors |

Note: the `lime` token name is historical — it now holds the violet accent. One accent across the app, no exceptions.

## Typography

- **UI sans**: Inter (`--font-display`) — headings, body, buttons, labels. Fixed rem scale, ratio ~1.2.
- **Data mono**: Geist Mono (`--font-mono`) — metrics, micro-labels, uppercase trackers.
- **Display serif**: Instrument Serif italic (`--font-serif`) — ONE flourish only: the final word of page titles and the login headline. Never in labels, buttons, or data.
- `text-wrap: balance` on headings.

## Shape & Depth

- Radius system: rounded-lg (10px) controls, rounded-xl (14px) cards, rounded-full pills/chips. No other radii.
- Cards: white + 1px `charcoal-700` border + soft ambient shadow (`0 1px 2px 4%, 0 8px 24px -12px 10%` of ink). Modals: `shadow-2xl` + dark `ink/30` scrim.
- No nested cards. No side-stripe accent borders. No gradient text.

## Motion

- Strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; 150–250ms for UI.
- `.press` → scale(0.97) on :active for all pressables.
- `animate-reveal`: opacity + 6px rise + scale(0.98→1), 240ms, staggered ≤30ms/item on grids.
- Reduced motion: all transforms/animations collapse to near-instant.

## Components

- Buttons: violet solid (white text) for primary; bordered neutral for secondary; red-tinted outline for destructive.
- Chips/status: tinted `/10` backgrounds + 700-grade text, rounded-full, mono 10px uppercase.
- Inputs: white/field fill, `charcoal-600` border, violet border on focus, visible focus ring.
- Nav: white sidebar, active item = violet text on violet/10 pill.
