# 8090 Chat Mobile Adaptation Design

**Date:** 2026-07-24  
**Status:** Approved for planning  
**Scope:** Progressive mobile adaptation of `dashboard/chat` for iPhone and iPad Safari (and other mobile browsers)  
**Non-goals:** Separate mobile app shell, native PWA install flow, redesign of agent data model, desktop visual re-theme

## 1. Problem

8090 Chat is a desktop-first agent workspace:

- Fixed 300px sidebar; at `≤720px` it collapses to a **72px icon rail** that hides titles/search and is effectively unusable.
- Header stacks title, Context, Tasks, Artifacts, full `CwdPicker`, and model controls — overflows or wraps badly on small viewports.
- Artifacts become absolutely positioned under `≤1100px` but are not a true mobile sheet.
- No `safe-area`, `100dvh`, or `visualViewport` handling for iOS Safari keyboard / home indicator.

Primary mobile job (confirmed): **read replies and continue the conversation**, with session switching close at hand. Full agent chrome (cwd, context, tasks, artifacts) must remain reachable, not always on-screen.

## 2. Goals & success criteria

### Goals

1. Usable **iPhone Safari** and **iPad Safari** layouts without breaking desktop (`>1024px`).
2. Main path always: **message list + composer + session switching**.
3. Drawer session list; overflow + bottom sheets for secondary tools.
4. Correct iOS viewport behavior: safe areas, dynamic viewport height, keyboard not covering Send.

### Success criteria

1. iPhone Safari: can read full replies, type, and send; keyboard does not cover Send.
2. Session drawer opens/closes; selecting a session or New chat returns to the transcript.
3. cwd / model / context / tasks / artifacts reachable within ~3 taps.
4. iPad portrait and landscape usable (drawer; no requirement for permanent dual-pane).
5. Desktop `>1024px` matches current behavior and visual density.
6. `prefers-reduced-motion: reduce` disables slide animations (instant show/hide).

## 3. Constraints & product choices

| Choice | Decision |
|--------|----------|
| Approach | **A — Progressive enhancement** (not separate Mobile Shell, not pure CSS-only) |
| Session list | **Left drawer**, default closed on compact; not bottom switcher or list-first route |
| Header density | **Minimal primary chrome + overflow menu** |
| Model control | Stays on primary header (high-frequency before send) |
| cwd / Context / Tasks / Artifacts | Secondary: `···` menu and/or bottom sheets |
| Desktop | Keep existing two-row header and docked sidebar |

## 4. Breakpoints

| Token | Width | Intent | Layout |
|-------|-------|--------|--------|
| `phone` | `< 768px` | iPhone, narrow portrait | Single-column chat; drawer sidebar; minimal header |
| `tablet` | `768px–1024px` | iPad portrait/landscape | Single-column; drawer (optional pin later); slightly richer header allowed |
| `desktop` | `> 1024px` | Current desktop | Docked 300px sidebar; current header/toolbar |

Implementation:

- CSS media queries for layout chrome.
- `matchMedia('(max-width: 1024px)')` → `isCompact` in React so drawer/overflow/sheet toggles are not CSS-only (focus & a11y).

**Remove** the existing `≤720px` rule that forces sidebar width to 72px and hides labels via `font-size: 0`.

## 5. Information architecture

Three layers:

1. **Primary (always):** transcript (`.chat-scroll`) + `Composer`.
2. **Navigation:** left session drawer (hamburger).
3. **Tools (on demand):** overflow action sheet and feature sheets (cwd, context, tasks, artifacts).

### Compact header (default visible)

```
☰   Title…   [Running?]    [model ▾]   ···
```

| Control | Compact | Desktop |
|---------|---------|---------|
| Open sidebar | Yes | N/A (docked) |
| Title (ellipsis) | Yes | Yes |
| Running badge | Yes when running | Yes |
| Full-auto badge | Prefer overflow on phone; optional on tablet | Yes |
| Model select (compact pill) | Yes | Yes (toolbar row) |
| Context / Tasks / Artifacts / cwd | Overflow + sheets | Header / toolbar as today |

### Overflow (`···`) action sheet

Bottom sheet rows with live summaries, e.g.:

- **Working directory** — truncated cwd · action: Change  
- **Context** — `62% · 124k/200k` · Details / Compact  
- **Tasks** — `2 running · 5 total` · Open  
- **Artifacts** — `N files` · Open  
- **Full auto** — read-only note when useful  

Tap row action → close overflow → open the corresponding sheet/panel.  
Backdrop / Cancel / Escape closes. Only one primary sheet at a time.

## 6. Sidebar drawer

### Behavior

| Context | Behavior |
|---------|----------|
| Desktop | `variant="docked"` — always in flex flow, no overlay |
| Compact | `variant="drawer"` — default **closed** |
| Open | Slide from left + dimmed backdrop |
| Close | Backdrop tap, Escape, close control, **select session**, **New chat**, **Logout** |

### Chrome

- Width: `min(86vw, 320px)`, full height, `safe-area` aware.
- Animation: transform ~200ms; reduced motion → no transition.
- While open: lock background scroll (`overflow: hidden` on shell/body as appropriate).
- Focus: move into drawer on open; restore to ☰ on close.
- A11y: `aria-expanded` on ☰; drawer labeled as navigation/dialog; backdrop as dismiss control.

### State ownership

- `sidebarOpen` in **`App.tsx`** (compact-only meaning).
- `ChatView` receives `onOpenSidebar` / `isCompact`.
- `Sidebar` receives `open`, `onClose`, `variant`.

### Touch

- Session rows ≥ 44px tall.
- Pin / rename / delete: must be reachable without hover (always visible in drawer or via explicit affordance).

### Out of scope (v1)

- Edge-swipe to open (optional later).
- iPad pinned dual-pane sidebar (optional later).
- Separate session-list route or bottom tab bar.

## 7. Feature panels on compact

| Panel | Desktop | Compact |
|-------|---------|---------|
| TasksPanel | Header chip + popover | Bottom sheet (~70vh max), scrollable list |
| ContextUsageMeter | Chip + popover + Compact | Overflow row + dedicated detail sheet (meter, categories, Compact action) |
| ArtifactsPanel | Right 360px dock / absolute under 1100px | Bottom or near-full sheet; **do not** use right absolute dock on compact |
| CwdPicker | Full toolbar field | Full editor inside sheet; overflow row shows truncated path |

Prefer wrapping existing panel bodies in a shared **`MobileSheet`** rather than forking list logic.

### Empty cwd (draft)

Keep composer disabled until cwd is set (existing rule), but:

- Show an explicit **“Set working directory”** CTA that opens the cwd sheet.
- Do not leave users with only a disabled textarea and no visible cwd field.

## 8. Composer, transcript, iOS viewport

### Viewport

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

- Shell height: `100dvh` with `100vh` fallback.
- Padding uses `env(safe-area-inset-top/bottom/...)`.
- Compact only: subscribe to **`visualViewport`** to size/offset the shell so the composer stays in the visible area above the keyboard.

### Scroll model

```
app-shell (fixed height, overflow hidden)
  chat-main-col (flex column, min-height 0)
    header (flex-shrink 0)
    chat-scroll (flex 1, overflow-y auto)  ← only scrollport for messages
    composer-shell (flex-shrink 0, safe-area bottom)
```

Avoid document-level scrolling for the main chat chrome.

### Composer

- Keep Enter-to-send / Shift+Enter newline for hardware keyboards; primary mobile send is the **Send button ≥ 44px**.
- Shorten or gate `hint` on phone (errors / missing cwd only when possible).
- Attachment chips: horizontal scroll, no layout blowout.
- Drag-drop remains desktop-oriented; mobile uses file picker / paste.

### Transcript

- Horizontal padding ~12–16px on phone.
- Code blocks: `overflow-x: auto`; images `max-width: 100%`.
- Message actions that are hover-only on desktop must be **tappable on compact** (always visible or reveal on message focus/tap).
- Tool cards stay collapsed by default with ellipsis summaries.

### Login

- Centered card with safe-area and `100dvh`.
- Inputs/buttons ≥ 44px touch height.

## 9. Component & file impact

| Unit | Responsibility |
|------|----------------|
| `useMediaQuery` (new) | `isCompact` from `max-width: 1024px` |
| `MobileSheet` (new) | Shared bottom sheet: open/close, title, backdrop, height variants, safe-area |
| `useVisualViewportLock` (new helper) | Compact keyboard/viewport height sync (behavior required; helper extraction optional) |
| `App.tsx` | `isCompact`, `sidebarOpen`, wire Sidebar + ChatView |
| `Sidebar.tsx` | `variant` / `open` / `onClose`; auto-close on navigate actions |
| `ChatView.tsx` | Compact header, overflow sheet, sheet mutex, cwd CTA |
| `Composer.tsx` | Touch sizing, compact hints, cwd CTA hook |
| `ArtifactsPanel` / `TasksPanel` / `ContextUsage` / `CwdPicker` | Sheet presentation adapter; reuse internals |
| `App.css` | Drawer/sheet/breakpoints/safe-area; remove 72px rail |
| `index.html` | `viewport-fit=cover`; `lang` already `zh-CN` |

### State sketch

```
App
  isCompact
  sidebarOpen
  Sidebar({ variant, open, onClose, ...sessionHandlers })
  ChatView({ isCompact, onOpenSidebar, ... })
    tasksOpen, artifactsOpen, activeArtifactId  // existing
    overflowOpen, cwdSheetOpen, contextSheetOpen
    mutex: one primary sheet (overflow counts); opening sidebar closes sheets
```

### Suggested implementation order

1. Viewport foundation (`viewport-fit`, `100dvh`, safe-area) + delete 72px rail + `useMediaQuery`
2. Drawer sidebar + hamburger
3. Compact header + overflow sheet
4. Tasks / Context / cwd / Artifacts → sheet presentation
5. Composer touch + missing-cwd CTA
6. `visualViewport` keyboard lock
7. Desktop regression + mobile acceptance pass

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| CSS-only hiding breaks focus/a11y | React-controlled drawer/overflow; real open state |
| iOS keyboard covers input | `visualViewport` + single message scrollport |
| Hover-only actions | Compact always-visible or tap-to-reveal |
| Stacked drawer + sheets | Mutex; documented z-index |
| Artifacts absolute right pane on tablet widths | Compact forces sheet path |
| Desktop regressions | No behavior change when `!isCompact`; manual >1024 check |
| Animation jank | Transform/opacity only; honor reduced motion |

## 11. Testing / acceptance checklist

**iPhone Safari**

- [ ] Login, open chat, send message
- [ ] Keyboard open: Send visible and tappable
- [ ] Home indicator does not cover composer
- [ ] Drawer: open, search, select session, auto-close
- [ ] `···` → cwd set on new draft → composer enables
- [ ] Tasks / Artifacts / Context sheets open and dismiss
- [ ] Long code block scrolls horizontally without page blowout

**iPad Safari**

- [ ] Portrait drawer flow
- [ ] Landscape usable; desktop layout only above 1024 CSS px
- [ ] Touch targets on session actions

**Desktop**

- [ ] Sidebar docked, two-row header, artifacts side panel behavior unchanged for wide widths
- [ ] No permanent hamburger / forced sheets

**A11y / motion**

- [ ] Escape closes topmost overlay
- [ ] Reduced motion: no slide transitions

## 12. Explicit non-goals (v1)

- Independent `MobileApp` route tree or list → chat page stack  
- Bottom tab bar  
- PWA install / offline shell  
- Full gesture system (only optional later: edge-swipe drawer)  
- iPad pinned dual sidebar as default  
- Redesign of streaming/tool protocol or sky-geek visual language  

## 13. Related code (current)

- UI shell: `dashboard/chat/frontend/src/App.tsx`, `App.css`
- Chat chrome: `components/ChatView.tsx`, `Sidebar.tsx`, `Composer.tsx`
- Panels: `ArtifactsPanel.tsx`, `TasksPanel.tsx`, `ContextUsage.tsx`, `CwdPicker.tsx`, `ModelSelect.tsx`
- Served at `/chat` (local 8090 and `kaggleyes.top/chat` via proxy)

---

## Approval

Design sections §1–§5 were reviewed conversationally and approved before this document was written.  
Next step after human review of this file: implementation plan via `writing-plans`.
