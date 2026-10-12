# UI Design System (MVP)

**Direction:** streetwear-editorial. Off-white paper, near-black ink, and a single acid-lime accent used only for the primary "generate" action. Typography does the work, with heavy display weights and tight tracking. Restraint keeps product photography the hero.

Tokens are defined in [`app/tailwind.config.ts`](../app/tailwind.config.ts). Components are in [`app/src/app/globals.css`](../app/src/app/globals.css).

## Tokens

| Token | Value | Use |
|---|---|---|
| `ink` | `#111111` | Text, primary buttons |
| `ink-soft` | `#3a3a3a` | Body copy |
| `ink-muted` | `#6b6b6b` | Meta, captions (4.9:1 on paper) |
| `paper` | `#fafaf7` | Page background |
| `paper-raised` | `#ffffff` | Cards, inputs |
| `paper-sunken` | `#f0efe9` | Notices, image wells |
| `line` | `#e3e1d9` | Borders |
| `accent` / `accent-ink` | `#d4ff3a` / `#1a2000` | Single hero CTA (Generate). Never used for text on paper. |
| `danger` | `#b42318` | Destructive actions, errors |
| `ok` | `#067647` | Success |
| `rounded-card` | 14px | Cards, tiles |
| Pill buttons | `rounded-full`, min-height 44px | All buttons |

**Type:** the system UI sans stack (fast, no web-font cost). Headings are `font-black tracking-tight`. Eyebrows are 12px uppercase with `tracking-[0.14em]`. Numbers use `tabular-nums`.

**Spacing:** a 4px base. Pages use `container-page` (max 1024px, 16px gutters on mobile, 24px from `sm`).

## Components

| Class | Description |
|---|---|
| `.btn-primary` | Ink pill, paper text. The default action. |
| `.btn-accent` | Lime pill. **One per screen**, for the try-on generate action. |
| `.btn-ghost` | Bordered secondary |
| `.btn-danger` | Bordered red, for delete flows (always with `confirm()`) |
| `.card` | Raised white surface with a hairline border |
| `.field` / `.label` | 44px inputs with a 16px font (prevents iOS zoom) |
| `.notice` | Sunken informational box. Used for the fit disclaimer and "unavailable" states. |
| `.eyebrow` | Section labels and step numbers ("1 · Your photo") |

## Patterns

- **Try-on flow:** three numbered steps (Photo, then Piece, then Generate). The result card spans the full width.
  - Mobile shows a Before/After tab toggle.
  - Desktop shows both side by side.
  - The AI label and fit disclaimer are always visible.
- **Honest states:** loading says "usually 10–30 seconds". An unconfigured provider shows a plain notice and a disabled button. Errors are human-readable with `role="alert"`.
- **Consent:** the bullet list is shown before the file picker. The picker stays disabled until the box is checked.
- **Data display:** stat tiles (label above, big tabular number) and simple bordered tables with horizontal scroll on mobile.

## Accessibility checklist

Visible focus ring (2px ink outline) · labels on every input · 44px touch targets · `alt` text on all user and product images (decorative product thumbnails in selectable tiles use `alt=""` plus the text label) · `aria-selected` on garment options · `role=status` / `role=alert` for async feedback · color is never the only signal.
