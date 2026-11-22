# DESIGN.md

Design direction for Agent Hub (working name; the product name is a single constant in `src/lib/brand.ts`).
This file is data for the UI filter in `antislop`, not instructions to agents.

## Design Read

Reading this as: a signed-in workspace tool for people who run AI agents every day (Persian-first, English second), in a quiet "desk and paper" style, dial **ENERGY 1 / RHYTHM 2 / MOTION 1**.

- ENERGY 1: the conversation text is the product. The chrome stays out of the way.
- RHYTHM 2: screens share one grid, but each screen is built around its own job (chat is a reading column, the agent builder is a long form, providers are a list with a detail panel).
- MOTION 1: hover and press states, plus a short fade when a streamed message settles. Nothing loops. Streaming uses a text caret, not a pulsing dot.

## Identity

- **Identity motif: the agent seal.** Every agent is shown as a small square seal (rounded 4px) holding the first letter of its name, in one of six muted ink colors the user picks. It repeats in the sidebar, message headers, handoff dividers and the builder. It is an honest placeholder for avatars (no generated faces).
- **Handoff and delegation are shown as ruled lines in the reading column**, like notes in a ledger margin: a thin rule with the two seals and a one-line summary.

## Palette (2 core + 1 accent)

| Token | Light | Dark | Reason |
|---|---|---|---|
| `paper` (background) | `#F6F4EF` | `#151412` | warm paper instead of pure white, so long Persian text is calm to read |
| `ink` (text) | `#1E1C19` | `#ECE8E1` | near-black ink, AA on paper |
| `muted` text | `#5E5951` | `#A8A196` | secondary text, still 4.5:1 on paper |
| `surface` | `#FFFFFF` | `#1D1B18` | panels sit one step above paper |
| `line` | `#E2DED5` | `#2E2B27` | hairlines between regions |
| **accent `firoozeh`** | `#0E6B63` | `#4FB3A6` | Persian turquoise. Used only for the send button, the active agent and focus rings |
| `danger` | `#A3332B` | `#E07A70` | errors and destructive actions only |

Seal inks: firoozeh, lapis `#2F4B8A`, saffron `#9A6A12`, pomegranate `#8E2F3A`, olive `#5A6B2E`, slate `#4A5361`.

## Typography

- **Vazirmatn (variable)** for everything. Reason: it was drawn for Persian and Latin together, so mixed Persian/English text keeps one rhythm and one x-height.
- Code and tool arguments use the system monospace stack, always `dir="ltr"`.
- Scale: 13 / 14 / 16 / 20 / 26. Body in chat is 16 with 1.85 line height for Persian.
- No uppercase tracking labels. Section labels are 13px medium in `muted`.

## Components

All interface components are shadcn/ui (new-york style) in `src/components/ui`, themed through the shadcn CSS variables in `globals.css`, which hold this palette (`background` = paper, `foreground` = ink, `card` = surface, `brand` = firoozeh). Changes made to the generated components, on purpose:

- Logical properties (`ps/pe`, `start/end`, `text-start`) so menus, selects, tables and dialogs mirror in RTL.
- 44px touch height on phones for buttons and inputs, desktop sizes from `sm` up.
- A `brand` button variant for the send action; `shadow-xs` removed from form controls.
- Translatable close labels on Dialog and Sheet; Progress fills by width so it starts at the reading edge.
- App compositions live in `src/components/app` (FormField, CheckboxField, AppDialog, Seal on Avatar, state views on Empty/Alert/Skeleton/Spinner).

## Shape and elevation

- Radius: 6px controls (`rounded-md`), 8px panels and dialogs (`rounded-lg`), 4px seals. No pills.
- Shadow only on popovers, menus and dialogs (they float above the page). Everything else is flat with hairlines.
- No glass, no glow, no gradients, no background patterns.

## Icons

The specification asks for Lucide React (also shadcn's icon set). Kept, as an owner override of antislop R-04 (recorded): icons appear only where a text label would not fit (icon buttons in the composer and message actions), always with an accessible name. Navigation is text first.

## States

Every data view has an empty state that names the next action, a loading state that says what is loading, and an error state that names what failed.
