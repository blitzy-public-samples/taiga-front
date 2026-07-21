# Post-Test Fingerprint Re-Verification (Phase 5 net-zero gate)

Re-run AFTER all baseline capture + net-zero DnD tests, BEFORE completing Phase 5.
Same PostgreSQL volume (taiga-docker-taiga-db-1), NO reseed, NO recreate.

## PRIMARY PROOF — raw fingerprint dumps are BYTE-IDENTICAL to baseline
Each committed baseline dump was re-queried now and compared with `diff` and
file-level `md5sum`. All identical (0 differing bytes):

| Dump | Coverage | baseline == recheck md5 | Result |
|------|----------|--------------------------|--------|
| 02_projects.tsv | id,slug,name,is_private,kanban_act,backlog_act (7 rows) | feb6a28384fc62d7cce54709969e3247 | IDENTICAL |
| 03_milestones.tsv | id,project,name,est_start,est_finish,closed (11 rows) | 94d8c6603ec75b33654ae5a5e147930d | IDENTICAL |
| 05_userstories_full.tsv | id,ref,project,status,swimlane,milestone,kanban_order,backlog_order,sprint_order,is_closed (114 rows) | 85c3937b688d82bfbc3dd5cf9fe4508d | IDENTICAL |
| 07_status_config.tsv | id,project,name,wip_limit,is_closed,is_archived (42 rows) | d26ceee5333db4cdd7184e8935d1e400 | IDENTICAL |
| 09_swimlane_status_wip.tsv | swimlane,status,wip_limit (120 rows) | f0b79ea3622cdc42331ca407590376ef | IDENTICAL |

Row counts (00_counts.txt) IDENTICAL: projects=7 userstories=114 milestones=11
tasks=108 users=15 swimlanes=20 statuses=42.

## Relationship to the Phase-3 derived oracle hashes
The Phase-3 fingerprint also stored derived colon-projection hashes:
  US_STATE_MD5=d334920774948df7bf19ae80978b1705 (id:kanban_order:backlog_order:sprint_order:status_id:swimlane_id:milestone_id:is_closed)
  MILESTONES_STATE_MD5=20bfeecbbe46830695f0c85073dca6ab (id:name:est_start:est_finish:closed)
  STATUS_WIP_MD5=632069fa9388a397d0e4f10ed6c1864f
  SWIMLANE_STATUS_WIP_MD5=eb4cc802939f0275b66947e5f333712e
Every field in each oracle projection is a STRICT SUBSET of a raw dump proven
byte-identical above (US_STATE ⊂ 05, MILESTONES ⊂ 03, STATUS_WIP ⊂ 07,
SWIMLANE_WIP = 09). Because the underlying rows are byte-for-byte unchanged, the
oracle-covered state is unchanged by construction. (The exact oracle hash STRING
format — NULL/boolean rendering — was not reconstructed blind for a live
recompute; the byte-identical raw dumps are the authoritative equality proof and
are strictly stronger, pinpointing any changed field had one existed.)

## CORROBORATING PROOF — no mutation endpoints were ever called
Both net-zero DnD tests (Kanban card #28, Backlog row #71) captured the dragula
drag-in-progress mirror, then released at ORIGIN index 0 (same-index
short-circuit). Network logs after each drag showed ZERO calls to
bulk_update_kanban_order / bulk_update_backlog_order / bulk_update_milestone /
bulk_update_sprint_order, and DOM order was verified restored (#28 first in NEW;
rows #71,#72,#73,#74 in order). All lightboxes/dialogs were opened then
CANCELLED/✕ (never submitted). Zoom is a per-user user-storage preference, not
board data — not part of the fingerprint.

## CONCLUSION
Net-zero mutation gate PASSED. The database data state after baseline capture is
byte-for-byte identical to the pre-test baseline. The future React post-migration
pass can use the identical data state for a valid two-phase comparison.
