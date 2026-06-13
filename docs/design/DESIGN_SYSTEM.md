# Pfand Design System v2 — implementation spec

For the agent (Claude Code) building the Next.js app in `app/`. This refines the
look the team already liked into **one coherent light theme** built around a
single brand device: the **blinking prompt cursor**.

Reference: open `Pfand Design System.dc.html` for the living spec (every value,
component, and chart pattern is shown there). Tokens: `handoff/pfand-tokens.css`.

---

## What changes & why

The current build hard-codes `className="dark"` on `<html>` but renders on a
white page — so you get **white canvas fighting black cards**. v2 fixes this by
shipping **light only**, with a warm off-white canvas tuned for dense charts.

Three moves:
1. **One mode.** Light. Remove `dark` from `<html>` in `app/app/layout.tsx`.
2. **Coordinated color.** Never pure white / pure black. Deep lime is the one
   brand color; six harmonized hues carry charts.
3. **Cursor motif.** The blinking caret is the brand — logo, search, loaders,
   empty states.

## Step-by-step

1. **`app/app/layout.tsx`** — drop `dark` from the `<html>` className. Keep the
   three fonts (`Bricolage_Grotesque` display, `Hanken_Grotesk` body,
   `JetBrains_Mono` mono) exactly as-is.
2. **`app/app/globals.css`** — replace the `:root` block with the one in
   `handoff/pfand-tokens.css`; delete the `.dark` block. Lower the ledger-grid
   background alpha to ~3%. Add the `@keyframes pfand-blink` + `.pfand-cursor`
   rule. Add `--chart-6` to the `@theme inline` map alongside the existing
   `--color-chart-*` lines.
3. **Components** — most shadcn components inherit the tokens automatically.
   Spot changes below.

## Color tokens (see pfand-tokens.css for exact OKLCH)

| Role | Token |
|---|---|
| Canvas (page) | `--background` warm off-white |
| Surface (cards) | `--card` white |
| Inset / muted fill | `--muted` |
| Border | `--border` |
| Ink / muted ink | `--foreground` / `--muted-foreground` |
| Brand fill | `--signal` (= `--primary`) |
| Brand text on light | `--signal-ink` |
| Brand tint | `--signal-wash` (= `--accent`) |
| Deposit states | `--pfand-returned` / `--pfand-held` / `--pfand-forfeited` |
| Charts | `--chart-1..6` (green, blue, amber, coral, violet, teal) |

**Chart rules:** assign `--chart-1..6` in order; `--chart-1` (green) is always
the primary/brand series. Faint gridlines (`--border`). White card under every
chart. Heatmaps use the sequential lime ramp (wash → signal-ink) — see the DC's
`#ds-heatmap` script for the intensity→stop mapping.

## Typography

- **Display** Bricolage Grotesque 700/800, tight tracking (`-0.02` to `-0.035em`).
  Hero 52–60px / line-height ~1.0.
- **Body** Hanken Grotesk 400/500, 18px lead / 14–15px UI.
- **Mono** JetBrains Mono with `tnum` for ALL numbers, addresses, labels,
  ENS names, and uppercase eyebrow labels (10–11px, `letter-spacing 0.18em`).

## The cursor motif (signature)

Render a `<span class="pfand-cursor" />` (or inline equivalent):
- **Logo:** `Pfand` wordmark immediately followed by the cursor.
- **Search field:** cursor trails the query text.
- **Loading / "thinking":** cursor alone, blinking, in place of a spinner.
- **Empty states:** large cursor + "start typing…".
Respect `prefers-reduced-motion` (rule already does this).

## Component notes

- **Radius:** base `0.75rem`. Cards `rounded-2xl` (~18px), buttons/inputs
  `rounded-xl`, chips/badges `rounded-full`. Shadows: soft & neutral
  (`--shadow-sm/md/lg`) — never hard black drop-shadows.
- **Buttons:** primary = `--signal` bg + `--primary-foreground`, `rounded-xl`,
  `font-mono` label, `white-space: nowrap`. Secondary = white + border. Tonal =
  `--signal-wash` bg + `--signal-ink`. Destructive = white + `--forfeited`
  border/text.
- **Search field:** the front door. White, 1.5px `--signal`-mixed border, a
  4px `--signal-wash` focus ring (`box-shadow: 0 0 0 4px var(--signal-wash)`),
  trailing cursor, `font-mono` input.
- **Badges / deposit chips:** outline style, white bg, colored dot + label.
  `x402` uses the tonal wash chip.
- **AgentCard / StatTile:** white card, soft shadow, `rounded-2xl`; hover lifts
  border toward `--signal`. StatTiles may carry a mono sparkline (`--chart-*`).
- **DepositReceipt:** white card, `--shadow-lg`, dashed `--border` dividers,
  pfand line emphasized in `--signal-ink`; state dots use deposit semantics.

## Motion

Gentle and purposeful: the cursor blink, a slow float on hero accent dots,
quick `ease` on hover. Nothing bounces gratuitously.

## Do / don't

- ✅ Warm off-white + white cards; lime as the single accent; mono for all data.
- ✅ Color carries meaning in charts; keep chrome quiet.
- ❌ No pure `#fff` / `#000`. ❌ No reintroducing dark mode on the same page.
  ❌ No new hues outside the chart set. ❌ No emoji as UI (the ⚡ on x402 and ✦
  on suggestions are intentional and the only ones).
