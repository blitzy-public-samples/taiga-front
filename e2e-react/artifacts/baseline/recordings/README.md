# Baseline Motion Evidence — Recording Limitation

## Environment limitation: ffmpeg absent
The QA runtime container has **no ffmpeg binary** (confirmed in setup log:
"ffmpeg absent (no screencasts; use screenshots)"). Chrome DevTools
`screencast_start`/`screencast_stop` therefore cannot encode video in this
environment. This is an environment constraint, not an application defect.

## Alternative motion evidence provided (deterministic PNG frames)
Per-flow motion is captured as deterministic screenshot frames with detailed
step-by-step written observations recorded in the QA session, plus a
source-analysis DnD behavioral contract that is the authority the React pass
must match:

- Kanban single-card drag-and-drop (net-zero): `screenshots/70_kanban_dnd_drag_in_progress.png`
  - dragula `.gu-mirror` (elevated card clone, teal border + shadow) following
    cursor + `.gu-transit` faded source. Released at ORIGIN index 0 -> same-index
    short-circuit -> ZERO `bulk_update_kanban_order` (verified via network log).
- Backlog drag-and-drop (net-zero): `screenshots/71_backlog_dnd_drag_in_progress.png`
  - dragula `.gu-mirror` (elevated full-width row clone) + placeholder reflow
    (rows shift to preview drop). Moved back to ORIGIN index 0 before release ->
    ZERO `bulk_update_backlog_order` / `bulk_update_milestone` /
    `bulk_update_sprint_order` (verified via network log).

## DnD behavioral contract (source authority; React must reproduce exactly)
- Kanban (`app/coffee/modules/kanban/sortable.coffee`): gated by `modify_us` +
  archived_code; only `tg-card` draggable; dom-autoscroller margin:100; on drop
  broadcasts `kanban:us:move` {finalUsList,newStatus,newSwimlane,index,previousCard,nextCard}
  -> POST `/userstories/bulk_update_kanban_order`. Same-index/same-container drop
  short-circuits (no broadcast, no API call).
- Backlog (`app/coffee/modules/backlog/sortable.coffee`): gated by `modify_us`;
  moves `.row`; dom-autoscroller margin:20; on drop calls
  `moveUs('sprint:us:move', ...)` -> POST `/userstories/bulk_update_backlog_order`,
  and when dropped into a sprint `/userstories/bulk_update_milestone`, plus
  `/userstories/bulk_update_sprint_order`. Same-index/same-container drop
  short-circuits.

## Net-zero rationale (why committed drags are deliberately NOT performed)
`kanban_order`/`backlog_order` are large recomputed integers; a COMMITTED drag
recomputes them to different values, which would change US_STATE_MD5 and
invalidate the immutable baseline fingerprint required for the two-phase
before/after comparison. Therefore only the same-index short-circuit (origin
drop / cancel) is exercised — a true no-op that preserves the fingerprint.

## Multi-step flow frame sequences (key frames; see screenshots/ + session observations)
- login -> Kanban: 00_login_page_1280.png -> 10_kanban_p3_swimlane_initial_1280.png
- login -> Backlog: 00_login_page_1280.png -> 40_backlog_p3_initial_1280.png
- Kanban create/validation/edit/assign/delete: 19,20,18,28,29 (+17 action menu, 30 move-to-top)
- Backlog bulk create: 55; Sprint CRUD create/validation/datepicker/edit/delete: 56,57,58,59,60
