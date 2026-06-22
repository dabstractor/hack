# Research Note — P5.M3.T1.S2: Reconcile WORKFLOWS.md + ARCHITECTURE.md resilience narrative

## Baseline (verified before any edit)

- `npm run docs:lint` → **exit 0** (green). Covers `docs/**/*.md` → **BOTH** WORKFLOWS.md AND ARCHITECTURE.md are linted (unlike README in S1).
- `npx prettier --check docs/WORKFLOWS.md docs/ARCHITECTURE.md` → **green**. `format:check` glob `**/*.{ts,js,json,md,yml,yaml}` also covers both.
- `.markdownlint.json` = `{ default: true, MD013: false, MD024: { siblings_only: true }, MD036: false }`.
  - MD013 OFF → long lines OK.
  - MD024 siblings_only → heading text must be unique among same-level siblings under same parent.
  - MD036 OFF → `**Bold lead-in:**` is NOT flagged as a heading. (Phase 4 uses this style already.)
- `.prettierrc` has **no `proseWrap`** → defaults to `preserve` (prose NOT reflowed; tables ARE aligned). No tables in our edits → prettier-safe.

## Current state of the two target docs (what already shipped)

### docs/WORKFLOWS.md

- `### Phase 4: Backlog Execution` (L334) — execution-loop narrative. Ends with `**Graceful Shutdown:**` + a `typescript` code block, immediately followed by `### Issue-Driven Re-planning` (L377).
  - Phase 4 mentions `TaskOrchestrator.processNextItem()`, graceful shutdown — but **does NOT mention** RESEARCH_TIMEOUT / synchronous fallback (R1), and does NOT cross-reference the Issue-Driven Re-planning subsection (R2). ← the gap.
- `### Issue-Driven Re-planning` (L377–425) — the **R2.S4** addition: tri-state table, 5-step re-planning flow, `ISSUE_RETRY_MAX` bounding, dependency/identity preservation, retry-dimension table. Complete. **NOT listed in the hand-maintained TOC** (R2 author omitted it).
- Hand-maintained `## Table of Contents` (L9) lists every `##` section + most `###` under `## PRPPipeline (Main Workflow)`. A new `##` section **must** get a TOC entry to stay non-stale.

### docs/ARCHITECTURE.md

- `## State Management and Persistence` (L542) — overview intro is one sentence: "The PRP Pipeline uses a robust state management system with immutable data structures and atomic persistence." It does **NOT** forward-link to the smart-recovery subsection. ← discoverability gap.
- `### tasks.json Protection & Smart Recovery` (L700–725) — the **R4.S2** addition: re-apply legitimate delta, git-history restore, preserve `Researching`/`Retrying`, non-fatal, no `Ready` status, `recoverTasksJson` code sample. Complete.
- The smart-recovery subsection IS a `###` under `## State Management` (so present in the doc body), but the ARCHITECTURE TOC (L11) lists only `##` sections → smart-recovery is **not in the TOC**. The intro forward-link is the fix (per contract: "discoverable from the state-management overview").

## Verified anchors (GitHub/markdownlint algorithm: lowercase → strip `.`/`&` → spaces→hyphens, no collapse)

| Target | Heading | Anchor |
| --- | --- | --- |
| WORKFLOWS.md | `### Phase 4: Backlog Execution` | `#phase-4-backlog-execution` |
| WORKFLOWS.md | `### Issue-Driven Re-planning` | `#issue-driven-re-planning` |
| WORKFLOWS.md (NEW) | `## Pipeline Resilience` | `#pipeline-resilience` (unique among `##` — verified) |
| ARCHITECTURE.md | `### tasks.json Protection & Smart Recovery` | `#tasksjson-protection--smart-recovery` (double hyphen — `&` strip leaves space-space) |
| CONFIGURATION.md | `### Resilience Tuning` | `#resilience-tuning` |

## Cross-doc link convention (from WORKFLOWS.md See Also, L1501–1507)

Same-dir (`docs/`) cross-doc links use the **`./`** prefix, e.g. `./CONFIGURATION.md`, `./user-guide.md#2-session-management`. → From WORKFLOWS.md to ARCHITECTURE.md smart-recovery use `[...](./ARCHITECTURE.md#tasksjson-protection--smart-recovery)`.

## Facts stated must be non-stale (all shipped)

- R1 (P5.M1.T1 ✅ Complete): `RESEARCH_TIMEOUT` default `300`s (src/config/constants.ts: `DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300`), deadline-wrap + synchronous re-research fallback. PRD §4.2.
- R2 (P5.M1.T2 ✅ Complete): `ISSUE_RETRY_MAX` default `3`. PRD §4.5. WORKFLOWS.md L377 has the deep dive.
- R4 (P5.M2.T1 ✅ Complete incl. wiring): `tasks.json` git-history smart recovery, automatic + non-fatal, no `Ready` status. ARCHITECTURE.md L700 has the narrative. PRD §5.1.

## Scope boundaries (the sibling S1 PRP)

- S1 owns **README.md only** (the high-level "Self-Healing & Resilience" blurb). S1 does NOT touch `docs/*.md`.
- **This PRP (S2) owns the `docs/` reconciliation**: WORKFLOWS.md + ARCHITECTURE.md. Must NOT touch README.md (S1), CONFIGURATION.md (Mode A done), PRD.md, tasks.json, code, config.
- Contract rule: "Do NOT restate full per-item detail — link." → overview = ≤1 line/mechanism + link; Phase 4 R1 = brief mention, R2 = cross-ref link only.
