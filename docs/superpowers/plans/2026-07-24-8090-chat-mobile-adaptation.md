# 8090 Chat Mobile Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 8090 Chat usable on iPhone and iPad Safari via progressive drawer sidebar, compact header + overflow sheets, and iOS viewport/keyboard fixes—without changing desktop layout above 1024px.

**Architecture:** `isCompact = matchMedia('(max-width: 1024px)')` drives React chrome. Compact uses a left session drawer, single-row header (☰ · title · status · model · ···), and a shared `MobileSheet` for overflow / cwd / context / tasks / artifacts. Desktop keeps docked sidebar and the existing two-row header. Shell uses `100dvh` + safe-area; compact also locks height to `visualViewport`.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind v4, existing shadcn/`@base-ui` primitives, CSS in `App.css`, Lucide icons. No frontend unit-test runner—verify with `npm run build` and the acceptance checklist.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-8090-chat-mobile-adaptation-design.md`
- Compact breakpoint: `max-width: 1024px` → `isCompact`
- Phone layout CSS band: `< 768px` where tighter padding/typography is needed
- Desktop `> 1024px` must match current behavior (docked sidebar, two-row header, right artifacts panel)
- Delete the `≤720px` 72px icon-rail sidebar rules
- Do not add a separate mobile route tree, bottom tabs, or PWA shell
- Do not change agent stream/API protocol or backend
- Do not kill/restart model_router on port 8088
- Primary path: read messages + composer + session switch
- Model stays on compact header; cwd/context/tasks/artifacts go through overflow/sheets
- Sheet mutex: only one primary sheet open; opening sidebar closes sheets
- Touch targets ≥ 44px where interactive on compact
- Honor `prefers-reduced-motion: reduce` (no slide transitions)
- After frontend changes: `cd dashboard/chat/frontend && npm run build`, then hard-refresh `/chat`

---

## File map

| Path | Role |
|------|------|
| Create `dashboard/chat/frontend/src/lib/useMediaQuery.ts` | `useMediaQuery(query: string): boolean` |
| Create `dashboard/chat/frontend/src/lib/useVisualViewportLock.ts` | Compact keyboard/viewport height lock on a ref element |
| Create `dashboard/chat/frontend/src/components/MobileSheet.tsx` | Shared bottom sheet (backdrop, title, heights, Esc, safe-area) |
| Modify `dashboard/chat/frontend/index.html` | `viewport-fit=cover` |
| Modify `dashboard/chat/frontend/src/App.css` | dvh/safe-area, drawer, sheet, compact header, remove 72px rail |
| Modify `dashboard/chat/frontend/src/App.tsx` | `isCompact`, `sidebarOpen`, wire Sidebar + ChatView |
| Modify `dashboard/chat/frontend/src/components/Sidebar.tsx` | `variant` / `open` / `onClose`; auto-close on navigate |
| Modify `dashboard/chat/frontend/src/components/ChatView.tsx` | Compact header, overflow, sheet mutex, panel presentation |
| Modify `dashboard/chat/frontend/src/components/Composer.tsx` | Touch sizing, compact hint, optional missing-cwd CTA |
| Modify `dashboard/chat/frontend/src/components/ArtifactsPanel.tsx` | `presentation?: 'dock' \| 'sheet'` |
| Modify `dashboard/chat/frontend/src/components/TasksPanel.tsx` | Compact: sheet body instead of header popover only |
| Modify `dashboard/chat/frontend/src/components/ContextUsage.tsx` | Export detail body usable inside sheet |
| Modify `dashboard/chat/frontend/src/components/CwdPicker.tsx` | Usable inside sheet (full width) |
| Modify `dashboard/chat/frontend/src/components/MessageList.tsx` | Compact/tap-visible message actions |
| Build output | `dashboard/chat/frontend/dist/**` via `npm run build` |

---

### Task 1: Viewport foundation + `useMediaQuery` + remove 72px rail

**Files:**
- Create: `dashboard/chat/frontend/src/lib/useMediaQuery.ts`
- Modify: `dashboard/chat/frontend/index.html`
- Modify: `dashboard/chat/frontend/src/App.css` (root height + delete `@media (max-width: 720px)` icon-rail block)

**Interfaces:**
- Consumes: none
- Produces:
  - `export function useMediaQuery(query: string): boolean`
  - Viewport meta includes `viewport-fit=cover`
  - Shell height tokens use `100dvh` with `100vh` fallback
  - No remaining CSS that sets `.sidebar { width: 72px }` at `max-width: 720px`

- [ ] **Step 1: Add `useMediaQuery`**

```ts
// dashboard/chat/frontend/src/lib/useMediaQuery.ts
import { useEffect, useState } from 'react'

/** Subscribe to a CSS media query. SSR-safe default: false. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
```

- [ ] **Step 2: Update viewport meta in `index.html`**

Replace the viewport meta line with:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover"
/>
```

Keep existing font preconnects/title/favicon as-is.

- [ ] **Step 3: Foundation CSS in `App.css`**

Near the top `:root` / `html, body, #root` rules, ensure:

```css
html,
body,
#root {
  height: 100%;
  height: 100dvh;
  margin: 0;
}

.app-shell {
  display: flex;
  height: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background-color: var(--bg);
  background-image: radial-gradient(circle at 1px 1px, var(--dot) 1px, transparent 0);
  background-size: 20px 20px;
}

.app-shell.center {
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.login-page {
  min-height: 100%;
  min-height: 100dvh;
  padding:
    max(1.5rem, env(safe-area-inset-top, 0px))
    max(1.5rem, env(safe-area-inset-right, 0px))
    max(1.5rem, env(safe-area-inset-bottom, 0px))
    max(1.5rem, env(safe-area-inset-left, 0px));
}
```

If older `min-height: 100vh` on `.app-shell` / `.login-page` remains, replace with the above so dvh wins.

- [ ] **Step 4: Delete the 72px icon-rail media block**

Remove the entire `@media (max-width: 720px) { ... }` block that sets:

- `.sidebar { width: 72px; }`
- `font-size: 0 !important` on sidebar labels
- `.sidebar-top .btn::before { content: '+'; }`
- `.session-actions { display: none; }`

Keep any still-useful rules from that block only if they are not the icon-rail behavior (prefer re-adding under a later compact section rather than keeping this block).

- [ ] **Step 5: Build check**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /home/eureka/baiqi-register-template
git add \
  dashboard/chat/frontend/src/lib/useMediaQuery.ts \
  dashboard/chat/frontend/index.html \
  dashboard/chat/frontend/src/App.css
git commit -m "feat(chat): viewport foundation and drop 72px mobile rail"
```

---

### Task 2: `MobileSheet` primitive

**Files:**
- Create: `dashboard/chat/frontend/src/components/MobileSheet.tsx`
- Modify: `dashboard/chat/frontend/src/App.css` (sheet styles)

**Interfaces:**
- Consumes: none beyond React/Lucide
- Produces:

```ts
export type MobileSheetHeight = 'auto' | 'half' | 'tall'

export type MobileSheetProps = {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  height?: MobileSheetHeight // default 'half'
  /** Extra class on panel */
  className?: string
}
export function MobileSheet(props: MobileSheetProps): JSX.Element | null
```

- [ ] **Step 1: Implement `MobileSheet.tsx`**

```tsx
// dashboard/chat/frontend/src/components/MobileSheet.tsx
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

export type MobileSheetHeight = 'auto' | 'half' | 'tall'

export type MobileSheetProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  height?: MobileSheetHeight
  className?: string
}

export function MobileSheet({
  open,
  onClose,
  title,
  children,
  height = 'half',
  className,
}: MobileSheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div className="mobile-sheet-root" role="presentation">
      <button
        type="button"
        className="mobile-sheet-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          'mobile-sheet-panel',
          `mobile-sheet-panel--${height}`,
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="mobile-sheet-handle" aria-hidden />
        <div className="mobile-sheet-head">
          <h2 id={titleId} className="mobile-sheet-title">
            {title}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mobile-sheet-close"
            onClick={onClose}
            aria-label="Close sheet"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mobile-sheet-body">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add sheet CSS to `App.css`**

Append:

```css
/* —— Mobile sheet —— */
.mobile-sheet-root {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.mobile-sheet-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  margin: 0;
  background: rgba(15, 23, 42, 0.4);
  cursor: pointer;
}

.mobile-sheet-panel {
  position: relative;
  z-index: 1;
  width: min(100%, 560px);
  max-height: min(92dvh, 920px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -8px 32px rgba(15, 23, 42, 0.14);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  outline: none;
  transform: translateY(0);
  animation: mobile-sheet-in 0.2s ease-out;
}

.mobile-sheet-panel--auto {
  max-height: min(70dvh, 640px);
}

.mobile-sheet-panel--half {
  height: min(52dvh, 480px);
}

.mobile-sheet-panel--tall {
  height: min(78dvh, 720px);
}

.mobile-sheet-handle {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: #e2e8f0;
  margin: 0.55rem auto 0.15rem;
  flex-shrink: 0;
}

.mobile-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.75rem 0.55rem 1rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.mobile-sheet-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

.mobile-sheet-close {
  min-width: 44px;
  min-height: 44px;
}

.mobile-sheet-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0.75rem 1rem 1rem;
}

@keyframes mobile-sheet-in {
  from {
    transform: translateY(12px);
    opacity: 0.85;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-sheet-panel {
    animation: none;
  }
}
```

- [ ] **Step 3: Build**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dashboard/chat/frontend/src/components/MobileSheet.tsx dashboard/chat/frontend/src/App.css
git commit -m "feat(chat): add MobileSheet bottom-sheet primitive"
```

---

### Task 3: Drawer sidebar + App wiring

**Files:**
- Modify: `dashboard/chat/frontend/src/components/Sidebar.tsx`
- Modify: `dashboard/chat/frontend/src/App.tsx`
- Modify: `dashboard/chat/frontend/src/App.css` (drawer layout)

**Interfaces:**
- Consumes: `useMediaQuery` from Task 1
- Produces Sidebar props extension:

```ts
// Sidebar
type Props = {
  // existing fields unchanged...
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onLogout: () => void
  /** docked = desktop flex child; drawer = off-canvas */
  variant?: 'docked' | 'drawer'
  open?: boolean
  onClose?: () => void
}
```

App produces:

```ts
const isCompact = useMediaQuery('(max-width: 1024px)')
const [sidebarOpen, setSidebarOpen] = useState(false)
// ChatView will receive isCompact + onOpenSidebar in Task 4; wire stubs now if needed
```

- [ ] **Step 1: Extend `Sidebar` props and close-on-navigate**

Update `Sidebar.tsx`:

```tsx
type Props = {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onLogout: () => void
  variant?: 'docked' | 'drawer'
  open?: boolean
  onClose?: () => void
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  onLogout,
  variant = 'docked',
  open = true,
  onClose,
}: Props) {
  // ...existing state...

  function selectAndClose(id: string) {
    onSelect(id)
    onClose?.()
  }

  function newAndClose() {
    onNew()
    onClose?.()
  }

  function logoutAndClose() {
    onLogout()
    onClose?.()
  }

  useEffect(() => {
    if (variant !== 'drawer' || !open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, open, onClose])

  const aside = (
    <aside
      className={cn(
        'sidebar',
        variant === 'drawer' && 'sidebar--drawer',
        variant === 'drawer' && open && 'is-open',
      )}
      id="chat-sidebar"
      aria-hidden={variant === 'drawer' && !open ? true : undefined}
    >
      {/* brand row: add close button when drawer */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-row">
          <a href="/" className="brand-link" title="Back to dashboard">
            <span className="brand-accent">8090</span> Chat
          </a>
          {variant === 'drawer' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sidebar-drawer-close"
              aria-label="Close sidebar"
              onClick={() => onClose?.()}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <div className="sidebar-sub muted">Agent workspace</div>
      </div>

      {/* replace onNew / onSelect / onLogout call sites with newAndClose / selectAndClose / logoutAndClose */}
      {/* keep rest of list UI; ensure session-actions visible (no hover-only hide in drawer CSS) */}
    </aside>
  )

  if (variant === 'drawer') {
    return (
      <div
        className={cn('sidebar-drawer-root', open && 'is-open')}
        aria-hidden={!open}
      >
        <button
          type="button"
          className="sidebar-drawer-backdrop"
          aria-label="Close sidebar"
          tabIndex={open ? 0 : -1}
          onClick={() => onClose?.()}
        />
        {aside}
      </div>
    )
  }

  return aside
}
```

Import `X` from `lucide-react`, `cn` from `../lib/utils`, and `useEffect` from React. Wire every existing `onSelect(` / `onNew(` / `onLogout(` in the component body to the close wrappers above.

- [ ] **Step 2: Drawer CSS**

```css
.sidebar-brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.sidebar-drawer-close {
  min-width: 44px;
  min-height: 44px;
}

.sidebar-drawer-root {
  position: fixed;
  inset: 0;
  z-index: 70;
  pointer-events: none;
}

.sidebar-drawer-root.is-open {
  pointer-events: auto;
}

.sidebar-drawer-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  margin: 0;
  padding: 0;
  background: rgba(15, 23, 42, 0.4);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.sidebar-drawer-root.is-open .sidebar-drawer-backdrop {
  opacity: 1;
}

.sidebar.sidebar--drawer {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(86vw, 320px);
  max-width: 320px;
  transform: translateX(-105%);
  transition: transform 0.2s ease;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-shadow: var(--shadow-lg);
  z-index: 1;
}

.sidebar.sidebar--drawer.is-open {
  transform: translateX(0);
}

/* Drawer: always show session action buttons (no hover gate) */
.sidebar--drawer .session-actions {
  opacity: 1;
}

.sidebar--drawer .session-item {
  min-height: 44px;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar.sidebar--drawer,
  .sidebar-drawer-backdrop {
    transition: none;
  }
}

/* Compact shell: chat column takes full width when sidebar is drawer */
@media (max-width: 1024px) {
  .app-shell {
    position: relative;
  }

  .chat-view {
    flex: 1;
    min-width: 0;
    width: 100%;
  }
}
```

- [ ] **Step 3: Wire `App.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useMediaQuery } from './lib/useMediaQuery'
// ...existing imports...

export default function App() {
  const isCompact = useMediaQuery('(max-width: 1024px)')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // ...existing auth/session state...

  useEffect(() => {
    if (!isCompact) setSidebarOpen(false)
  }, [isCompact])

  // When selecting/new from App handlers that Sidebar will also wrap:
  // Sidebar onClose already closes; App handlers stay as-is.

  // In render:
  return (
    <div className={cn('app-shell', isCompact && 'is-compact')}>
      <Sidebar
        sessions={sessions}
        activeId={draftMode ? null : activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={(id) => void handleDelete(id)}
        onRename={(id, title) => void handleRename(id, title)}
        onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
        onLogout={handleLogout}
        variant={isCompact ? 'drawer' : 'docked'}
        open={isCompact ? sidebarOpen : true}
        onClose={() => setSidebarOpen(false)}
      />
      <ChatView
        sessionId={draftMode ? null : activeId}
        draftMode={draftMode || !activeId}
        onSessionCreated={handleSessionCreated}
        onSessionUpdated={handleSessionUpdated}
        isCompact={isCompact}
        onOpenSidebar={() => setSidebarOpen(true)}
        onCloseSheetsRequest={() => setSidebarOpen(false)}
      />
    </div>
  )
}
```

Note: `ChatView` props `isCompact` / `onOpenSidebar` are added fully in Task 4. For this task, either:

1. Add temporary optional props on `ChatView` that are unused, or  
2. Finish Task 3 + Task 4 in one commit if you prefer not to break types mid-way.

**Recommended:** extend `ChatView` Props in the same task with optional:

```ts
isCompact?: boolean
onOpenSidebar?: () => void
```

and a hamburger button only when `isCompact` (full compact header in Task 4).

Minimal interim header control in `ChatView` header-title-row:

```tsx
{isCompact ? (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className="header-menu-btn"
    aria-label="Open sessions"
    aria-expanded={false}
    aria-controls="chat-sidebar"
    onClick={() => onOpenSidebar?.()}
  >
    <Menu className="h-5 w-5" />
  </Button>
) : null}
```

Import `Menu` from lucide-react.

- [ ] **Step 4: Build**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

- [ ] **Step 5: Manual smoke (desktop + narrow)**

- Width > 1024: sidebar docked, no backdrop.  
- Width < 1024: sidebar hidden until ☰; open/close via backdrop and session select.

- [ ] **Step 6: Commit**

```bash
git add \
  dashboard/chat/frontend/src/App.tsx \
  dashboard/chat/frontend/src/components/Sidebar.tsx \
  dashboard/chat/frontend/src/components/ChatView.tsx \
  dashboard/chat/frontend/src/App.css
git commit -m "feat(chat): compact drawer sidebar navigation"
```

---

### Task 4: Compact header + overflow action sheet

**Files:**
- Modify: `dashboard/chat/frontend/src/components/ChatView.tsx`
- Modify: `dashboard/chat/frontend/src/App.css`

**Interfaces:**
- Consumes: `MobileSheet`, `isCompact`, `onOpenSidebar`
- Produces ChatView props:

```ts
type Props = {
  sessionId: string | null
  draftMode: boolean
  onSessionCreated: (session: SessionSummary) => void
  onSessionUpdated: (session: SessionSummary) => void
  defaultModel?: string
  isCompact?: boolean
  onOpenSidebar?: () => void
}
```

Internal state:

```ts
const [overflowOpen, setOverflowOpen] = useState(false)
const [cwdSheetOpen, setCwdSheetOpen] = useState(false)
const [contextSheetOpen, setContextSheetOpen] = useState(false)
// tasksOpen / artifactsOpen already exist
```

Mutex helper inside ChatView:

```ts
function closeAllSheets() {
  setOverflowOpen(false)
  setCwdSheetOpen(false)
  setContextSheetOpen(false)
  setTasksOpen(false)
  setArtifactsOpen(false)
}

function openOnly(
  which: 'overflow' | 'cwd' | 'context' | 'tasks' | 'artifacts',
) {
  setOverflowOpen(which === 'overflow')
  setCwdSheetOpen(which === 'cwd')
  setContextSheetOpen(which === 'context')
  setTasksOpen(which === 'tasks')
  setArtifactsOpen(which === 'artifacts')
}
```

When `onOpenSidebar` is invoked from parent hamburger path, ChatView should call `closeAllSheets()` in the click handler before/after parent open—or App closes sheets by remount-independent state: **have the hamburger in ChatView call `closeAllSheets(); onOpenSidebar?.()`**.

- [ ] **Step 1: Compact header JSX structure**

When `isCompact`:

```tsx
<header className="chat-header chat-header--compact">
  <div className="header-top header-top--compact">
    <div className="header-title-row">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="header-menu-btn"
        aria-label="Open sessions"
        aria-controls="chat-sidebar"
        onClick={() => {
          closeAllSheets()
          onOpenSidebar?.()
        }}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <h1 className="chat-title">{title}</h1>
      {running ? (
        <Badge variant="accent" className="running-badge">
          <span className="pulse-dot" />
          Running
        </Badge>
      ) : null}
    </div>
    <div className="header-actions header-actions--compact">
      <div className="model-select-host">
        <ModelSelect
          value={headerModel}
          onChange={(v) => {
            setModel(v)
            if (!draftMode && sessionId) void applyModelCwd({ model: v })
          }}
          disabled={running}
          compact
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="header-overflow-btn"
        aria-label="More tools"
        aria-haspopup="dialog"
        aria-expanded={overflowOpen}
        onClick={() => openOnly('overflow')}
      >
        <MoreHorizontal className="h-5 w-5" />
      </Button>
    </div>
  </div>
  {/* no header-toolbar row on compact */}
</header>
```

When `!isCompact`, keep the existing two-row header (Context, Tasks, Artifacts, CwdPicker, ModelSelect) unchanged.

Import `Menu`, `MoreHorizontal` from lucide-react.

- [ ] **Step 2: Overflow sheet content**

```tsx
{isCompact ? (
  <MobileSheet
    open={overflowOpen}
    onClose={() => setOverflowOpen(false)}
    title="Workspace"
    height="auto"
  >
    <div className="overflow-sheet-list">
      <button
        type="button"
        className="overflow-sheet-row"
        onClick={() => openOnly('cwd')}
      >
        <span className="overflow-sheet-label">Working directory</span>
        <span className="overflow-sheet-meta mono">
          {headerCwd ? shortPath(headerCwd) : 'Not set'}
        </span>
      </button>
      <button
        type="button"
        className="overflow-sheet-row"
        onClick={() => openOnly('context')}
      >
        <span className="overflow-sheet-label">Context</span>
        <span className="overflow-sheet-meta">
          {contextUsage?.max_tokens
            ? `${Math.round(contextUsage.percentage ?? 0)}%`
            : '—'}
        </span>
      </button>
      <button
        type="button"
        className="overflow-sheet-row"
        onClick={() => openOnly('tasks')}
      >
        <span className="overflow-sheet-label">Tasks</span>
        <span className="overflow-sheet-meta">
          {tasks.filter((t) => (t.status || '') !== 'deleted').length}
        </span>
      </button>
      <button
        type="button"
        className="overflow-sheet-row"
        onClick={() => openOnly('artifacts')}
      >
        <span className="overflow-sheet-label">Artifacts</span>
        <span className="overflow-sheet-meta">{artifacts.length}</span>
      </button>
      <div className="overflow-sheet-note muted">
        Full auto · permission_mode=bypassPermissions
      </div>
    </div>
  </MobileSheet>
) : null}
```

Add a small local helper in ChatView (or import if already present):

```ts
function shortPath(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length <= 3) return path
  return `…/${parts.slice(-3).join('/')}`
}
```

- [ ] **Step 3: Compact header CSS**

```css
.header-menu-btn,
.header-overflow-btn {
  min-width: 44px;
  min-height: 44px;
  flex-shrink: 0;
}

.chat-header--compact {
  padding-top: max(0.55rem, env(safe-area-inset-top, 0px));
  padding-left: max(0.65rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.65rem, env(safe-area-inset-right, 0px));
}

.header-top--compact {
  gap: 0.5rem;
  min-height: 44px;
}

.header-actions--compact {
  flex-wrap: nowrap;
  gap: 0.25rem;
}

.header-actions--compact .model-select-host {
  max-width: min(46vw, 200px);
}

.overflow-sheet-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.overflow-sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-height: 48px;
  padding: 0.65rem 0.35rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.overflow-sheet-row:active {
  background: #f8fafc;
}

.overflow-sheet-label {
  font-weight: 650;
  font-size: 14px;
}

.overflow-sheet-meta {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overflow-sheet-meta.mono {
  font-family: var(--mono);
}

.overflow-sheet-note {
  font-size: 11px;
  padding: 0.75rem 0.25rem 0.25rem;
}
```

- [ ] **Step 4: Build + smoke**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

Manual: narrow viewport → ☰ + ··· visible; desktop → original header.

- [ ] **Step 5: Commit**

```bash
git add dashboard/chat/frontend/src/components/ChatView.tsx dashboard/chat/frontend/src/App.css
git commit -m "feat(chat): compact header and workspace overflow sheet"
```

---

### Task 5: Present cwd / context / tasks / artifacts as sheets on compact

**Files:**
- Modify: `dashboard/chat/frontend/src/components/CwdPicker.tsx` (optional className only if missing)
- Modify: `dashboard/chat/frontend/src/components/ContextUsage.tsx`
- Modify: `dashboard/chat/frontend/src/components/TasksPanel.tsx`
- Modify: `dashboard/chat/frontend/src/components/ArtifactsPanel.tsx`
- Modify: `dashboard/chat/frontend/src/components/ChatView.tsx`

**Interfaces:**

```ts
// ContextUsageMeter — keep existing props; also export detail body:
export function ContextUsageDetail(props: {
  usage?: ContextUsageType | null
  canCompact?: boolean
  compacting?: boolean
  onCompact?: () => void
}): JSX.Element

// ArtifactsPanel
type Props = {
  artifacts: Artifact[]
  open: boolean
  onClose: () => void
  activeId?: string | null
  onSelect?: (id: string) => void
  presentation?: 'dock' | 'sheet' // default 'dock'
}

// TasksPanel
type Props = {
  tasks: AgentTask[]
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  presentation?: 'popover' | 'sheet' // default 'popover'
}
```

- [ ] **Step 1: `ContextUsageDetail`**

Refactor `ContextUsage.tsx` so the popover/card body (percentage bar, categories, Compact button) is rendered by `ContextUsageDetail`. `ContextUsageMeter` continues to work on desktop; detail is reused in the sheet.

- [ ] **Step 2: `TasksPanel` sheet mode**

When `presentation === 'sheet'`:

- Do **not** render the header chip/popover chrome (or render chip hidden).
- Render list inside parent-provided sheet **or** wrap with `MobileSheet` when open:

Preferred (self-contained):

```tsx
if (presentation === 'sheet') {
  return (
    <MobileSheet
      open={open}
      onClose={() => onOpenChange(false)}
      title="Tasks"
      height="tall"
    >
      {/* existing list body only */}
    </MobileSheet>
  )
}
```

Keep popover path for desktop unchanged when `presentation !== 'sheet'`.

- [ ] **Step 3: `ArtifactsPanel` sheet mode**

When `presentation === 'sheet'`:

- Skip the right-dock motion panel.
- Use `MobileSheet` title `Artifacts` height `tall` with existing list + preview/code UI inside `.mobile-sheet-body` flex column.
- Ensure close calls `onClose`.

When `presentation === 'dock'` (default): keep current desktop/absolute behavior. On compact, ChatView must pass `presentation="sheet"` so the `≤1100px` absolute dock is not used.

- [ ] **Step 4: Wire sheets in `ChatView`**

```tsx
{/* compact cwd sheet */}
{isCompact ? (
  <MobileSheet
    open={cwdSheetOpen}
    onClose={() => setCwdSheetOpen(false)}
    title="Working directory"
    height="auto"
  >
    <CwdPicker
      value={headerCwd}
      onChange={handleCwdDraftChange}
      onCommit={(v) => {
        handleCwdCommit(v)
      }}
      disabled={running}
      className="cwd-picker--sheet"
    />
  </MobileSheet>
) : null}

{isCompact ? (
  <MobileSheet
    open={contextSheetOpen}
    onClose={() => setContextSheetOpen(false)}
    title="Context"
    height="auto"
  >
    <ContextUsageDetail
      usage={contextUsage}
      canCompact={
        !draftMode &&
        !!session?.sdk_session_id &&
        (session.messages?.length || messages.length) > 0
      }
      compacting={compacting}
      onCompact={
        running || compacting ? undefined : () => void handleCompact()
      }
    />
  </MobileSheet>
) : null}

<TasksPanel
  tasks={tasks}
  open={tasksOpen}
  onOpenChange={(v) => (v ? openOnly('tasks') : setTasksOpen(false))}
  presentation={isCompact ? 'sheet' : 'popover'}
/>

<ArtifactsPanel
  artifacts={artifacts}
  open={artifactsOpen}
  onClose={() => setArtifactsOpen(false)}
  activeId={activeArtifactId}
  onSelect={setActiveArtifactId}
  presentation={isCompact ? 'sheet' : 'dock'}
/>
```

Desktop header still mounts `ContextUsageMeter` + tasks chip + artifacts toggle as today when `!isCompact`.

- [ ] **Step 5: Sheet-friendly `CwdPicker` CSS**

```css
.cwd-picker--sheet {
  flex-direction: column;
  align-items: stretch;
  max-width: none;
  width: 100%;
  gap: 0.65rem;
}

.cwd-picker--sheet .field.inline {
  flex-direction: column;
  align-items: stretch;
}

.cwd-picker--sheet .cwd-recent-wrap {
  flex: 1 1 auto;
  max-width: none;
  width: 100%;
}
```

- [ ] **Step 6: Build + smoke**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

Manual compact: ··· → each row opens the right sheet; only one sheet visible; desktop artifacts still dock right.

- [ ] **Step 7: Commit**

```bash
git add \
  dashboard/chat/frontend/src/components/ChatView.tsx \
  dashboard/chat/frontend/src/components/ContextUsage.tsx \
  dashboard/chat/frontend/src/components/TasksPanel.tsx \
  dashboard/chat/frontend/src/components/ArtifactsPanel.tsx \
  dashboard/chat/frontend/src/components/CwdPicker.tsx \
  dashboard/chat/frontend/src/App.css
git commit -m "feat(chat): sheet presentation for tools on compact"
```

---

### Task 6: Composer touch, missing-cwd CTA, message actions

**Files:**
- Modify: `dashboard/chat/frontend/src/components/Composer.tsx`
- Modify: `dashboard/chat/frontend/src/components/ChatView.tsx`
- Modify: `dashboard/chat/frontend/src/components/MessageList.tsx`
- Modify: `dashboard/chat/frontend/src/App.css`

**Interfaces:**

```ts
// Composer Props extension
type Props = {
  // existing...
  disabled?: boolean
  streaming?: boolean
  imageBusy?: boolean
  onSend: (payload: SendPayload) => void
  onStop: () => void
  placeholder?: string
  seedText?: string
  onSeedConsumed?: () => void
  hint?: string
  resolvePath?: (path: string) => Promise<PathAttachment>
  uploadFile?: (file: File) => Promise<PathAttachment>
  /** Compact layout tweaks */
  compact?: boolean
  /** Shown when cwd missing on draft */
  missingCwd?: boolean
  onRequestCwd?: () => void
}

// MessageList
type Props = {
  // existing...
  compact?: boolean
}
```

- [ ] **Step 1: Composer CTA + compact UI**

```tsx
export function Composer({
  // ...
  compact = false,
  missingCwd = false,
  onRequestCwd,
}: Props) {
  // ...
  return (
    <div className={cn('composer-shell', compact && 'composer-shell--compact')}>
      {missingCwd ? (
        <button
          type="button"
          className="composer-cwd-cta"
          onClick={() => onRequestCwd?.()}
        >
          Set working directory to start chatting
        </button>
      ) : null}
      {hint && (!compact || missingCwd || error-like) ? (
        <div className="composer-hint muted">{hint}</div>
      ) : null}
      {/* existing composer main; ensure Send/Stop buttons have min 44px height */}
    </div>
  )
}
```

For compact hints: if `compact && !missingCwd && !imageBusy && !streaming`, omit the long default hint to save space; still show streaming/imageBusy/error hints.

Button sizing CSS:

```css
.composer-shell--compact {
  padding-bottom: calc(0.65rem + env(safe-area-inset-bottom, 0px));
  padding-left: max(0.75rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.75rem, env(safe-area-inset-right, 0px));
}

.composer-cwd-cta {
  display: block;
  width: 100%;
  max-width: 860px;
  margin: 0 auto 0.45rem;
  min-height: 44px;
  border: 1px dashed #7dd3fc;
  border-radius: 12px;
  background: #f0f9ff;
  color: #0369a1;
  font: inherit;
  font-weight: 650;
  font-size: 13px;
  cursor: pointer;
}

.composer-shell--compact .composer-actions .btn,
.composer-shell--compact .composer-actions button {
  min-height: 44px;
  min-width: 44px;
}

.composer-shell--compact .composer-attach-row {
  overflow-x: auto;
  flex-wrap: nowrap;
  -webkit-overflow-scrolling: touch;
}
```

- [ ] **Step 2: Wire Composer from ChatView**

```tsx
<Composer
  compact={!!isCompact}
  missingCwd={!!isCompact && draftMode && !cwd.trim()}
  onRequestCwd={() => openOnly('cwd')}
  disabled={loading || (draftMode && !cwd.trim()) || imageBusy}
  /* ...existing props; shorten hint when isCompact && cwd set && idle */
  hint={
    draftMode && !cwd.trim()
      ? isCompact
        ? undefined
        : 'Set an absolute cwd above before starting.'
      : imageBusy
        ? 'Generating image via grok-imagine-image-lite…'
        : isStreaming || session?.status === 'running'
          ? 'Agent is running in Full auto mode.'
          : isCompact
            ? undefined
            : 'Chat or switch to Image mode · paste/drop files in Chat mode.'
  }
/>
```

- [ ] **Step 3: Message actions on compact**

In `MessageList` / message footer CSS and/or props:

```css
/* Always show message actions on compact shell */
.app-shell.is-compact .msg-actions {
  opacity: 1;
}

.app-shell.is-compact .msg-action-btn {
  min-height: 44px;
}

.app-shell.is-compact .message-list {
  padding: 1rem 0.85rem 1.5rem;
}

.app-shell.is-compact .md pre {
  font-size: 0.8rem;
}

.app-shell.is-compact .md img {
  max-width: 100%;
}
```

Ensure `App.tsx` sets `className={cn('app-shell', isCompact && 'is-compact')}` (Task 3).

Optionally pass `compact={isCompact}` into `MessageList` if you need JS behavior; CSS via `.app-shell.is-compact` is enough for actions visibility.

- [ ] **Step 4: Build + smoke**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

Manual: new draft on phone width → CTA opens cwd sheet → set path → composer enables.

- [ ] **Step 5: Commit**

```bash
git add \
  dashboard/chat/frontend/src/components/Composer.tsx \
  dashboard/chat/frontend/src/components/ChatView.tsx \
  dashboard/chat/frontend/src/components/MessageList.tsx \
  dashboard/chat/frontend/src/App.tsx \
  dashboard/chat/frontend/src/App.css
git commit -m "feat(chat): compact composer CTA and tappable message actions"
```

---

### Task 7: `visualViewport` lock + scroll model polish

**Files:**
- Create: `dashboard/chat/frontend/src/lib/useVisualViewportLock.ts`
- Modify: `dashboard/chat/frontend/src/App.tsx` (attach ref to shell when compact)
- Modify: `dashboard/chat/frontend/src/App.css` (chat column flex scroll)

**Interfaces:**

```ts
/**
 * When enabled, sizes `el` to the visualViewport height and offsets for keyboard.
 * No-ops when enabled=false or visualViewport missing.
 */
export function useVisualViewportLock(
  elRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void
```

- [ ] **Step 1: Implement hook**

```ts
// dashboard/chat/frontend/src/lib/useVisualViewportLock.ts
import { useEffect, type RefObject } from 'react'

export function useVisualViewportLock(
  elRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) {
      const el = elRef.current
      if (el) {
        el.style.height = ''
        el.style.top = ''
        el.style.position = ''
      }
      return
    }

    const vv = window.visualViewport
    if (!vv) return

    const apply = () => {
      const el = elRef.current
      if (!el) return
      const height = vv.height
      const offsetTop = vv.offsetTop
      el.style.position = 'fixed'
      el.style.left = '0'
      el.style.right = '0'
      el.style.top = `${offsetTop}px`
      el.style.height = `${height}px`
    }

    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.removeEventListener('orientationchange', apply)
      const el = elRef.current
      if (el) {
        el.style.height = ''
        el.style.top = ''
        el.style.left = ''
        el.style.right = ''
        el.style.position = ''
      }
    }
  }, [elRef, enabled])
}
```

- [ ] **Step 2: Attach in `App.tsx`**

```tsx
const shellRef = useRef<HTMLDivElement>(null)
useVisualViewportLock(shellRef, isCompact)

// loading / login branches: leave as-is (login uses login-page)

return (
  <div
    ref={shellRef}
    className={cn('app-shell', isCompact && 'is-compact')}
  >
    ...
  </div>
)
```

- [ ] **Step 3: Flex scroll CSS**

```css
.chat-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.chat-main-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.chat-header {
  flex-shrink: 0;
}

.composer-shell {
  flex-shrink: 0;
}

/* compact: header need not be sticky if shell is fixed height */
.app-shell.is-compact .chat-header {
  position: static;
}
```

Reconcile with existing rules so you do not duplicate conflicting `display`/`flex` declarations—edit the existing `.chat-view` / `.chat-main-col` / `.chat-scroll` blocks in place.

- [ ] **Step 4: Build**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add \
  dashboard/chat/frontend/src/lib/useVisualViewportLock.ts \
  dashboard/chat/frontend/src/App.tsx \
  dashboard/chat/frontend/src/App.css
git commit -m "feat(chat): lock compact shell to visualViewport"
```

---

### Task 8: Acceptance pass + ship dist

**Files:**
- Build: `dashboard/chat/frontend/dist/**`
- Optional doc touch: none required (spec already exists)

- [ ] **Step 1: Production build**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/frontend && npm run build
```

Expected: success; `dist/index.html` references new hashed assets.

- [ ] **Step 2: Desktop regression (>1024 CSS px)**

- [ ] Sidebar docked 300px, no hamburger  
- [ ] Two-row header with cwd + model  
- [ ] Context / Tasks / Artifacts controls visible  
- [ ] Artifacts opens as side panel (dock), not forced sheet  
- [ ] Send / stream still works  

- [ ] **Step 3: Compact simulation (DevTools iPhone / width < 768)**

- [ ] Full-width chat; no 72px rail  
- [ ] ☰ opens drawer; select session closes drawer  
- [ ] ··· overflow rows open cwd/context/tasks/artifacts sheets  
- [ ] Mutex: opening one sheet closes another  
- [ ] Missing cwd shows CTA; setting cwd enables composer  
- [ ] Message actions visible without hover  

- [ ] **Step 4: Real device if available**

- [ ] iPhone Safari keyboard does not cover Send  
- [ ] Home indicator padding OK  
- [ ] iPad portrait drawer flow  

- [ ] **Step 5: Commit dist if repo tracks it**

```bash
cd /home/eureka/baiqi-register-template
git add dashboard/chat/frontend/dist
git status
git commit -m "build(chat): mobile adaptation frontend dist"
```

If dist is intentionally dirty with unrelated assets, only stage chat mobile-related dist files.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `viewport-fit=cover`, `100dvh`, safe-area | 1, 6, 7 |
| Remove 72px rail | 1 |
| `useMediaQuery` / `isCompact` | 1, 3 |
| Drawer sidebar + close behaviors | 3 |
| Compact header ☰ title status model ··· | 4 |
| Overflow action sheet | 4 |
| cwd/context/tasks/artifacts sheets | 5 |
| Sheet mutex | 4–5 (`openOnly` / `closeAllSheets`) |
| Model on primary compact header | 4 |
| Missing cwd CTA | 6 |
| Composer touch / compact hints | 6 |
| Message actions without hover | 6 |
| `visualViewport` lock | 7 |
| Single message scrollport | 7 |
| Desktop unchanged >1024 | 3–5, 8 |
| Reduced motion | 2, 3 (CSS) |
| Login safe-area / dvh | 1 |
| No separate mobile shell / tabs | Global constraints |
| Acceptance checklist | 8 |

## Placeholder / consistency scan

- No TBD steps; hooks and components named consistently: `useMediaQuery`, `useVisualViewportLock`, `MobileSheet`, `openOnly`, `presentation: 'dock' | 'sheet' | 'popover'`.
- `ChatView` props: `isCompact?: boolean`, `onOpenSidebar?: () => void` (no `onCloseSheetsRequest` required if hamburger closes sheets locally).
- Verification path is `npm run build` (no vitest in package).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-8090-chat-mobile-adaptation.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
