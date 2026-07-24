# PRP — P4.M1.T3.S1: Bind breakdown prompt to delta_prd.md after generation

---

## Goal

**Feature Goal**: Implement PRD §4.3 (h3.5) step 5 — *"Delta PRD Generation (with retry
logic)"* AND the binding note *"Breakdown MUST consume the delta PRD."* The task
breakdown/decomposition for a delta session MUST run over `delta_prd.md` (the diffs), NOT
the full PRD. This requires TWO coordinated changes: (1) **generate** `delta_prd.md` in the
delta-session spawn flow (it is currently NEVER written by any code — `DELTA_PRD_PROMPT` is
dead code per `architecture/phase_findings.md` §PHASE 4), and (2) **rebind** `decomposePRD()`
so that on a delta session it sources the breakdown input from `delta_prd.md` instead of
`currentSession.prdSnapshot` (which is the FULL resolved new PRD on a delta session).

**Generation mechanism = DETERMINISTIC JSON→Markdown render** of the structured
`DeltaAnalysis` that `DeltaAnalysisWorkflow` already produces (no second LLM call). The
semantic diff is already done inside `DeltaAnalysisWorkflow.analyzeDelta()` (wrapped in
`retryAgentPrompt`, `maxAttempts:3`); a pure `renderDeltaPRD()` turns that JSON into the
focused delta-PRD markdown. The retry/fail-fast contract (PRD §4.3 "retry then fail fast")
is INHERITED from the upstream retried LLM step — if the LLM exhausts retries,
`spawnDeltaSession` throws before the render runs. (Rationale + the rejected
second-LLM-call alternative are documented in the Context section.)

**This is a focused artifact-generation + breakdown-binding change — NOT** a change to
`patchBacklog`, NOT a deletion of `DELTA_PRD_PROMPT`, NOT a CLI/config/docs change, NOT an
overlap with S1 (response-selection/dispatcher/marker) or S2 (validate/bug-hunt reuse).

**Deliverable** (3 modified production modules + 1 new test file + 0 doc edits; **no** CLI
flag, **no** new dependency, **no** `SessionState`/`DeltaAnalysis`/`RequirementChange` model
change, **no** deletion of `DELTA_PRD_PROMPT`, **no** overlap with S1/S2):

1. **`src/core/session-utils.ts`** (MODIFY — ADD three exports) —
   - `renderDeltaPRD(delta: DeltaAnalysis, completedTaskIds: string[], parentSessionId: string): string`
     — pure function producing focused delta-PRD markdown (Added/Modified/Removed sections +
     completed-work-preserved list + patch instructions + tasks-to-re-execute). No LLM.
   - `writeDeltaPRD(sessionPath: string, content: string): Promise<void>` — `atomicWrite`
     to `<sessionPath>/delta_prd.md`, re-thrown as `SessionFileError`. Mirrors `writePRP`
     (`:986`).
   - `loadDeltaPRD(sessionPath: string): Promise<string>` — `readUTF8FileStrict` over
     `<sessionPath>/delta_prd.md`. Mirrors `loadSnapshot` (`:1150`). Throws
     `SessionFileError` on ENOENT (doubles as missing-file detector).
2. **`src/workflows/prp-pipeline.ts`** (MODIFY — ADD one render+write step + one delta
   branch) —
   - In `spawnDeltaSession()`, immediately AFTER `createDeltaSession()` (sets
     `currentSession!.metadata.path` to the new delta dir) and BEFORE/AFTER `saveBacklog()`,
     call `writeDeltaPRD(deltaSessionPath, renderDeltaPRD(delta, completedTaskIds, parentRef))`.
     `delta` + `completedTaskIds` are already in scope; capture the parent session id
     BEFORE `createDeltaSession` reassigns `currentSession`.
   - In `decomposePRD()`, between `createArchitectAgent()` (`:976`) and the
     `const prdContent = …` source (`:979`), add a delta branch: if
     `currentSession?.metadata.parentSession != null` → `prdContent = await
     loadDeltaPRD(sessionPath)` (throws a clear error on missing file — NEVER silently fall
     back to `prdSnapshot`); else `prdContent = currentSession?.prdSnapshot ?? ''` (unchanged).
     Hoist `sessionPath` above the branch.
3. **`tests/unit/core/delta-prd.test.ts`** (NEW) — unit suite for `renderDeltaPRD`
   (all change types, empty changes, completed-task list, parent ref), `writeDeltaPRD`
   (writes file, `SessionFileError` on bad path), `loadDeltaPRD` (round-trip with
   `writeDeltaPRD`, `SessionFileError` on missing), and the `decomposePRD` delta branch
   via the `prp-pipeline.test.ts` mock block (delta session → `loadDeltaPRD` called,
   `createArchitectPrompt` receives delta content not full PRD; missing `delta_prd.md` →
   clear thrown error).

**Success Definition**:
- When a delta session is spawned (`spawnDeltaSession`), `delta_prd.md` is written to the
  delta session directory, containing a focused markdown render of the `DeltaAnalysis`
  (only Added/Modified/Removed + preserved-work + patch instructions + re-execute tasks) —
  NOT the full PRD.
- When `decomposePRD()` runs on a delta session (`metadata.parentSession != null`) with an
  empty backlog, the Architect prompt is built from `delta_prd.md` content — NOT from
  `prdSnapshot` (the full new PRD). If `delta_prd.md` is missing on a delta session,
  `decomposePRD` throws a clear, descriptive error and does NOT silently fall back to the
  full PRD (satisfying PRD §4.3's "must consume the delta" + the missing-file resume guard).
- Non-delta sessions are UNCHANGED (`prdContent = prdSnapshot`).
- The "not built at load time" invariant holds: `createArchitectPrompt` is still only ever
  invoked at runtime inside `decomposePRD()`; the delta content is sourced AFTER
  `delta_prd.md` exists (run() ordering: `initializeSession()` → `decomposePRD()`).
- `DELTA_PRD_PROMPT` is left in place (its string-content integration tests keep passing);
  it is simply no longer the generation mechanism (deterministic render is).
- `npm run validate` GREEN; `npm run test:coverage` shows ~100% on the new code.
- `git diff --name-only` shows EXACTLY the 3 files above — **no** `patchBacklog`/
  `task-patcher.ts` edits, **no** `DELTA_PRD_PROMPT` deletion, **no** `handleDelta`/
  dispatcher/marker edits (S1), **no** `initializeSession`/`loadSessionAsCurrent` edits (S2),
  **no** CLI/docs/model edits.

---

## User Persona (if applicable)

**Target User**: A developer using the pipeline who edits `PRD.md` mid-project and lets the
system spawn a **delta session** to handle the change. They expect the delta session's task
breakdown to reflect ONLY what changed (the delta), not a full re-decomposition of the
entire (now larger) PRD.

**Use Case**: "I added a small new requirement to PRD.md. The delta session should break
down ONLY that new requirement — reusing my completed work — instead of re-architecting the
whole project from the full PRD."

**User Journey**: edit PRD.md → pipeline detects change → SUBSTANTIVE →
`spawnDeltaSession()` runs `DeltaAnalysisWorkflow` (structured diff) → **NEW**: renders +
writes `delta_prd.md` → `createDeltaSession` + `saveBacklog` → later, if
`decomposePRD()` runs on this delta session (empty backlog / resume), it reads
`delta_prd.md` → Architect breaks down the DELTA, not the full PRD.

**Pain Points Addressed**: PRD §4.3 step 5 — today the breakdown silently embeds the FULL
new PRD (because `prdSnapshot` is the full new PRD on a delta session), so a delta session's
"breakdown" is indistinguishable from a fresh full-PRD decomposition, wasting tokens and
ignoring the delta. And `delta_prd.md` is never generated at all today.

---

## Why

- **PRD compliance**: PRD §4.3 (h3.5) step 5 mandates verbatim (see selected_prd_content):
  *"Agent generates `delta_prd.md` focusing only on differences. If delta PRD not created on
  first attempt, system demands agent retry. Session fails fast if delta PRD cannot be
  generated after retry. Incomplete delta sessions detect and regenerate missing delta PRDs
  on resume. **Breakdown MUST consume the delta PRD:** The task breakdown/decomposition for
  a delta session MUST run over `delta_prd.md` (the diffs), not the full PRD. Implementations
  that build the breakdown prompt once at load time risk embedding the full PRD and silently
  ignoring the delta; the breakdown input MUST be (re)bound to the delta content after
  `delta_prd.md` is generated."*
- **Work-item CONTRACT mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — *"`DELTA_PRD_PROMPT` (prompts.ts:710) is dead code —
    `delta_prd.md` is NOT generated by any workflow. The active delta path uses
    `DeltaAnalysisWorkflow` returning structured JSON."* → confirmed (`architecture/
    phase_findings.md` §PHASE 4; `DELTA_PRD_PROMPT` `:770` is imported by NO workflow).
    T3.S1 ADDS generation via deterministic render of the existing `DeltaAnalysis`.
    *"PRD §4.3 specifies delta-session task breakdown MUST run over `delta_prd.md`, not the
    full PRD. Building the breakdown prompt once at load time risks embedding the full PRD
    and silently ignoring the delta."* → THIS PRP (the `decomposePRD` rebind). *"Not built at
    load time"* → confirmed invariant (see Context §"Not built at load time").
  - **CONTRACT (2) INPUT** — *"Classifiers from P4.M1.T1.S2."* → T3.S1 does NOT call
    classifiers; it is downstream of the SUBSTANTIVE verdict that routes into
    `spawnDeltaSession()`. T3.S1 treats the delta-session spawn as its input seam.
  - **CONTRACT (3) LOGIC** — *"(a) ensure `delta_prd.md` is generated (revive/activate the
    generation path — possibly using `DELTA_PRD_PROMPT` or a new mechanism)."* → Task 1
    (`renderDeltaPRD` + `writeDeltaPRD`) + Task 2 (wire into `spawnDeltaSession`). The
    "new mechanism" chosen is the deterministic render (NOT reviving the shell-template
    `DELTA_PRD_PROMPT` — see Context §"Why deterministic render, not DELTA_PRD_PROMPT").
    *"(b) The breakdown input MUST be (re)bound to the delta content AFTER `delta_prd.md` is
    generated."* → Task 3 (`decomposePRD` delta branch reads `loadDeltaPRD`). Ordering
    guarantee: `spawnDeltaSession` writes `delta_prd.md` during `initializeSession()`'s
    delta branch; `decomposePRD()` runs AFTER in `run()`. *"(c) In `decomposePRD()` or the
    delta-specific breakdown path, read `delta_prd.md` and pass its content to
    `createArchitectPrompt` instead of the full PRD."* → Task 3 (exactly this). *"(d) Ensure
    the breakdown prompt is NOT built at load time but after `delta_prd.md` exists."* →
    confirmed invariant; the rebind is runtime-only.
  - **CONTRACT (4) OUTPUT** — *"Breakdown consumes `delta_prd.md`. Completes P4.M1."* →
    this PRP delivers both generation + binding; it is the last subtask of P4.M1.T3 (and the
    last task of P4.M1).
  - **CONTRACT (5) DOCS** — *"none — no user-facing/config/API surface change."* → **no doc
    edits.** `delta_prd.md` is an internal artifact; `renderDeltaPRD`/`writeDeltaPRD`/
    `loadDeltaPRD` are internal helpers.
- **No overlap with sibling/parallel PRPs**: S1 owns `handleDelta()`/dispatcher/marker/
  `acceptPrdChangesResponse`/`integrateIntoCurrentSessionResponse`/`spawnDeltaSession`
  (analysis+patch+create+save). S1's `spawnDeltaSession()` does NOT write `delta_prd.md`.
  T3.S1 adds ONE step to `spawnDeltaSession()` (render+write after `createDeltaSession`) +
  the `decomposePRD()` delta branch + the three `session-utils.ts` helpers. DISJOINT regions
  within `prp-pipeline.ts` (S1: `handleDelta`/dispatcher `:619-865` + session-utils marker
  functions; T3.S1: `spawnDeltaSession` `:823-905` + `decomposePRD` `:975-985`). S2
  (`P4.M1.T2.S2`, parallel) owns validate/bug-hunt reuse in `initializeSession()`; T3.S1 is
  downstream of the delta spawn path only; S2 bypasses `handleDelta()`. No overlap.

---

## What

A deterministic `delta_prd.md` generation step in `spawnDeltaSession()` plus a delta-session
branch in `decomposePRD()` that reads `delta_prd.md` for the breakdown input. Three new
internal helpers in `session-utils.ts`. **No** new CLI flag, **no** model change, **no**
`DELTA_PRD_PROMPT` deletion, **no** `patchBacklog` change, **no** doc change, **no**
dependency.

### Success Criteria

- [ ] **`src/core/session-utils.ts`** — ADD `renderDeltaPRD(delta, completedTaskIds,
      parentSessionId): string` (pure), `writeDeltaPRD(sessionPath, content): Promise<void>`
      (`atomicWrite`-based), `loadDeltaPRD(sessionPath): Promise<string>`
      (`readUTF8FileStrict`-based) per the Implementation Blueprint. Export all three.
- [ ] **`src/workflows/prp-pipeline.ts`** — (a) in `spawnDeltaSession()`, after
      `createDeltaSession()`, call `writeDeltaPRD(currentSession!.metadata.path,
      renderDeltaPRD(delta, completedTaskIds, parentRef))` where `parentRef` is the parent
      session id captured BEFORE `createDeltaSession` reassigns `currentSession`. (b) in
      `decomposePRD()`, add the delta branch (`parentSession != null` → `loadDeltaPRD`;
      missing → clear thrown error; never fall back to `prdSnapshot`).
- [ ] **`tests/unit/core/delta-prd.test.ts`** (NEW) — `renderDeltaPRD` (all change types,
      empty, completed-list, parent ref, no `prdSnapshot` leak), `writeDeltaPRD`+`loadDeltaPRD`
      round-trip + `SessionFileError` cases, and the `decomposePRD` delta branch (delta
      session → `loadDeltaPRD` called, `createArchitectPrompt` gets delta content; missing
      file → clear error; non-delta → unchanged `prdSnapshot` path).
- [ ] `npm run validate` GREEN.
- [ ] `npm run test:coverage` shows ~100% on the new branches (the `isDelta` true/false,
      the missing-file throw, every `renderDeltaPRD` section, `writeDeltaPRD`/`loadDeltaPRD`
      error paths).
- [ ] `git diff --name-only` shows EXACTLY the 3 files above.
- [ ] `DELTA_PRD_PROMPT` is UNCHANGED (still present in `prompts.ts`; its string-content
      integration tests still pass).

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?" — YES. This PRP names: the EXACT defect (two halves — no
generation + full-PRD embedding at `decomposePRD` `:979`); the EXACT generation mechanism
(deterministic render of `DeltaAnalysis`, NOT a second LLM call); the EXACT insertion point
(after `createDeltaSession()` in `spawnDeltaSession`); the EXACT rebind seam (between
`createArchitectAgent` `:976` and `prdContent` `:979` in `decomposePRD`); the EXACT
delta-session signal (`metadata.parentSession != null`); the EXACT helpers to mirror
(`writePRP` `:986`, `loadSnapshot` `:1150`, `atomicWrite` `:110`, `readUTF8FileStrict`
`:212`); the EXACT reachability nuance (the patchBacklog path usually makes decomposePRD
skip — the rebind is a correctness/safety guard, NOT a forced flow change); and the EXACT
scope boundary (no S1/S2 overlap, no `DELTA_PRD_PROMPT` deletion, no patchBacklog change).

### Why deterministic render, not DELTA_PRD_PROMPT

`DELTA_PRD_PROMPT` (`src/agents/prompts.ts:770`) is a **shell template** — its body uses
`$(cat "$PREV_SESSION_DIR/prd_snapshot.md")`, `$(cat "$PRD_FILE")`,
`$(cat "$PREV_SESSION_DIR/tasks.json")`, `$SESSION_DIR`. These require a **shell-capable
agent** to expand, and the prompt instructs the agent to WRITE `delta_prd.md` itself. Reviving
it means:
- a SECOND LLM call that re-ingests the same old/new PRD + tasks.json — duplicating the
  semantic diff `DeltaAnalysisWorkflow.analyzeDelta()` already performed (cost + latency,
  no new information);
- a heavier shell-capable agent harness;
- a SECOND flakiness point needing its own retry boundary.

The deterministic render instead consumes the `DeltaAnalysis` JSON that the retried QA call
ALREADY produced. The retry/fail-fast contract (PRD §4.3 "retry then fail fast") is owned by
`retryAgentPrompt` wrapping that QA call (`delta-analysis-workflow.ts:124-130`,
`maxAttempts:3`, transient-only). A deterministic render built AFTER that step INHERITS
fail-fast: if the LLM exhausts retries, `spawnDeltaSession` throws before the render runs.
The render itself cannot "fail to generate the delta PRD on first attempt" — there is no
second LLM. The only failure mode is a filesystem error on `atomicWrite` (disk/permissions),
which surfaces as `SessionFileError` and aborts the session under `spawnDeltaSession`'s
fatal-error check (a genuine infra failure, not a retryable semantic one).

Trade-off: the render is thinner than the narrative hand-authored `plan/008_*/delta_prd.md`,
but it carries the complete diff + impact + patch instructions — which IS "the diffs" for
breakdown consumption. Richness (e.g. per-item doc-impact lines) can be added later by
extending `RequirementChange` + `createDeltaAnalysisPrompt`, keeping a single LLM source of
truth. That extension is OUT OF SCOPE for T3.S1.

### Not built at load time (the invariant)

`run()` (`prp-pipeline.ts:2022`) calls `initializeSession()` → (debug logging) →
`decomposePRD()` (`:2032`). `createArchitectPrompt` is **dynamically imported and invoked
ONLY inside `decomposePRD()`** (`:960-966`, `:985`) — an instance method, freshly built from
`prdContent` each run. There is NO module-level caching of `prdContent` or the architect
prompt (grep-confirmed: `createArchitectPrompt` has exactly one production call site,
`prp-pipeline.ts:985`). For a delta session, `initializeSession()` → `handleDelta()` →
`spawnDeltaSession()` writes `delta_prd.md` BEFORE `decomposePRD()` runs — so by the time
the rebind sources `loadDeltaPRD()`, the file EXISTS. The rebind is a runtime sourcing
change; it fully satisfies "the breakdown input MUST be (re)bound to the delta content AFTER
`delta_prd.md` is generated."

### Reachability — the patchBacklog path (READ CAREFULLY)

**CONTRACT LOGIC (b)** says breakdown must run over delta content. BUT `spawnDeltaSession()`
(current code + S1's version) does `patchBacklog(backlog, delta)` then
`saveBacklog(patchedBacklog)` — so the delta session usually has a NON-empty backlog, and
`decomposePRD()` early-returns at `hasBacklog` (`:946`), never reaching the rebind.

**T3.S1 design decision (minimal, in-scope):** the rebind + clear-error guard is correct and
complete REGARDLESS of reachability. It is the seam PRD §4.3 step 5 mandates, and it protects
against: (a) a future flow that generates the delta backlog from `delta_prd.md`; (b) resume
of an interrupted delta session whose backlog was not yet saved (empty backlog reaches line
`786`); (c) any delta session reaching `decomposePRD` with an empty backlog. The
`patchBacklog` path (including its unimplemented `'added'` case — `task-patcher.ts`) is a
SEPARATE concern and is OUT OF SCOPE. **Do NOT** change `spawnDeltaSession` to skip
`patchBacklog`, and **do NOT** force decomposition on delta sessions — that would be a
behavior change beyond this item. The rebind is a SAFETY + CORRECTNESS guard: when
`decomposePRD` DOES run on a delta session (empty backlog), it reads `delta_prd.md` (not the
full PRD) OR throws a clear error — never silently embeds the full PRD. This satisfies the
work-item's LOGIC (c) + (d) exactly.

### Resume-regeneration contract

PRD §4.3: "Incomplete delta sessions detect and regenerate missing delta PRDs on resume."
There is NO resume hook in `SessionManager.initialize()`/`loadSession()` that detects a
delta session with a missing `delta_prd.md`. So:
- The **missing-file guard** lives in `decomposePRD()` (throws a clear error → the next run
  regenerates via the delta spawn path).
- The **regeneration mechanism** = re-run `DeltaAnalysisWorkflow` + re-render, which is
  exactly what `spawnDeltaSession()` does. `DeltaAnalysis` is NOT persisted, so resume
  re-derives it from the recoverable inputs (parent `prd_snapshot.md` + current PRD +
  completed tasks).
- This matches the existing test contract (`tests/integration/delta-resume-regeneration.test.ts`
  asserts only the missing-file STATE, commenting "Actual regeneration is triggered by
  PRPPipeline, not SessionManager").

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M1T3S1/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the two-half defect analysis, the
        deterministic-render rationale, the insertion point, the rebind seam, the
        delta-session signal, the reachability nuance, the resume contract, the S1/S2
        non-overlap proof, and verified file:line references. READ FIRST.

- file: src/workflows/prp-pipeline.ts
  section: |
    decomposePRD() :940-1050 (rebind seam at :979 prdContent source + :985 createArchitectPrompt
      call; hasBacklog early-return :946; createArchitectAgent :976; dynamic imports :960-966);
    spawnDeltaSession() :823-905 (DeltaAnalysisWorkflow.run :866 → delta; createDeltaSession
      :881 → sets currentSession!.metadata.path; saveBacklog :884 — INSERT render+write
      BETWEEN createDeltaSession and saveBacklog); run() :2022 initializeSession → :2032
      decomposePRD ordering; parent-session id capture point = currentSession.metadata.id
      read BEFORE createDeltaSession reassigns currentSession.
  why: THE FILE THIS PRP MODIFIES (two regions). The render+write step goes right after
        createDeltaSession() in spawnDeltaSession. The rebind goes between createArchitectAgent
        and the prdContent source in decomposePRD. Hoist sessionPath above the branch.
  pattern: |
    // spawnDeltaSession — current (:881-:884):
    await this.sessionManager.createDeltaSession(this.sessionManager.prdPath);
    // NEW: render + write delta_prd.md deterministically from the DeltaAnalysis (delta)
    const deltaSessionPath = this.sessionManager.currentSession!.metadata.path;
    await writeDeltaPRD(
      deltaSessionPath,
      renderDeltaPRD(delta, completedTaskIds, parentSessionIdRef)
    );
    await this.sessionManager.saveBacklog(patchedBacklog);
    // (parentSessionIdRef = the parent id captured BEFORE createDeltaSession — see Task 2.)

    // decomposePRD — current (:976-:985):
    const architectAgent = createArchitectAgent();
    const prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';   // ← REBIND
    const sessionPath = this.sessionManager.currentSession!.metadata.path;
    const architectPrompt = createArchitectPrompt(prdContent, sessionPath);
    // REFACTOR to:
    const architectAgent = createArchitectAgent();
    const sessionPath = this.sessionManager.currentSession!.metadata.path;      // hoisted
    const isDelta = this.sessionManager.currentSession?.metadata.parentSession != null;
    let prdContent: string;
    if (isDelta) {
      // PRD §4.3 step 5: delta breakdown runs over delta_prd.md, NOT the full PRD.
      // prdSnapshot on a delta session is the FULL new PRD — MUST NOT use it.
      try {
        prdContent = await loadDeltaPRD(sessionPath);
      } catch (err) {
        throw new Error(
          `Delta session has no delta_prd.md at ${sessionPath} — cannot break down ` +
            'the delta. Re-run to regenerate it via the delta spawn path.'
        );
      }
    } else {
      prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
    }
    const architectPrompt = createArchitectPrompt(prdContent, sessionPath);
  gotcha: |
    1. Capture the PARENT session id BEFORE createDeltaSession() in spawnDeltaSession —
       createDeltaSession reassigns #currentSession to the new delta session, after which
       currentSession.metadata.id is the DELTA id (wrong) and .parentSession is what you want.
       Use: const parentSessionIdRef = currentSession.metadata.id; (before the call) OR read
       currentSession!.metadata.parentSession AFTER the call — both work; pick one.
    2. The decomposePRD delta branch MUST throw on missing delta_prd.md — NEVER fall back to
       prdSnapshot (that re-introduces the exact full-PRD-embedding bug PRD §4.3 forbids).
    3. Do NOT change patchBacklog or the hasBacklog early-return — see Reachability above.

- file: src/core/session-utils.ts
  section: atomicWrite :110 (temp+rename, throws SessionFileError); readUTF8FileStrict :212
           (throws SessionFileError on ENOENT — the missing-file detector); SessionFileError
           :67; writePRP :986 (TEMPLATE for writeDeltaPRD — validate/convert → atomicWrite);
           loadSnapshot :1150 (TEMPLATE for loadDeltaPRD — readUTF8FileStrict over a named
           session file); prpToMarkdown :898 (TEMPLATE for renderDeltaPRD — pure string
           builder); existing imports (readFile, writeFile, resolve from node:path already
           present).
  why: WHERE the three new helpers go + what to mirror. atomicWrite gives crash-safety;
        readUTF8FileStrict gives the ENOENT-as-SessionFileError behavior for free.
  critical: writeDeltaPRD/loadDeltaPRD must re-throw non-SessionFileError errors AS
        SessionFileError (mirror writePRP :1006-1014). renderDeltaPRD is a PURE function
        (no I/O, no imports beyond types) — trivially unit-testable. Do NOT add Zod
        validation to writeDeltaPRD (input is already-built markdown). loadDeltaPRD resolves
        `<sessionPath>/delta_prd.md` (NOT prd_snapshot.md — loadSnapshot reads the wrong
        file; do not reuse it directly).
  pattern: |
    // === additions to src/core/session-utils.ts ===
    import type { DeltaAnalysis } from './models.js';   // type-only; add to existing imports

    /** Render a focused delta-PRD markdown from a structured DeltaAnalysis (PRD §4.3 step 5). */
    export function renderDeltaPRD(
      delta: DeltaAnalysis,
      completedTaskIds: string[],
      parentSessionId: string
    ): string {
      const added = delta.changes.filter(c => c.type === 'added');
      const modified = delta.changes.filter(c => c.type === 'modified');
      const removed = delta.changes.filter(c => c.type === 'removed');
      const lines: string[] = [];
      lines.push(`# Delta PRD`);
      lines.push('');
      lines.push(`> Focused on differences vs parent session \`${parentSessionId}\`.`);
      lines.push(`> This is NOT the full PRD — only added/modified/removed requirements.`);
      lines.push('');
      if (completedTaskIds.length > 0) {
        lines.push('## Completed Work (preserved — do NOT re-implement)');
        for (const id of completedTaskIds) lines.push(`- ${id}`);
        lines.push('');
      }
      const section = (title: string, items: typeof added) => {
        if (items.length === 0) return;
        lines.push(`## ${title}`);
        for (const c of items) {
          lines.push(`### ${c.itemId}`);
          lines.push(`- **What changed:** ${c.description}`);
          lines.push(`- **Impact:** ${c.impact}`);
          lines.push('');
        }
      };
      section('Added', added);
      section('Modified', modified);
      if (removed.length > 0) {
        lines.push('## Removed (for awareness — no implementation tasks)');
        for (const c of removed) lines.push(`- **${c.itemId}:** ${c.description}`);
        lines.push('');
      }
      lines.push('## Patch Instructions');
      lines.push(delta.patchInstructions);
      lines.push('');
      if (delta.taskIds.length > 0) {
        lines.push('## Tasks to Re-execute');
        for (const id of delta.taskIds) lines.push(`- ${id}`);
        lines.push('');
      }
      return lines.join('\n');
    }

    /** Write delta_prd.md to a session directory (atomic; PRD §4.3 step 5). */
    export async function writeDeltaPRD(
      sessionPath: string,
      content: string
    ): Promise<void> {
      const deltaPrdPath = resolve(sessionPath, 'delta_prd.md');
      try {
        await atomicWrite(deltaPrdPath, content);
      } catch (error) {
        if (error instanceof SessionFileError) throw error;
        throw new SessionFileError(deltaPrdPath, 'write delta PRD', error as Error);
      }
    }

    /** Read delta_prd.md from a session directory (throws SessionFileError if missing). */
    export async function loadDeltaPRD(sessionPath: string): Promise<string> {
      return readUTF8FileStrict(
        resolve(sessionPath, 'delta_prd.md'),
        'read delta PRD'
      );
    }

- file: src/workflows/delta-analysis-workflow.ts
  section: class :39; analyzeDelta :116 (returns DeltaAnalysis via retryAgentPrompt :124-130);
           run :181
  why: CONFIRMS the structured DeltaAnalysis is already produced (with retry/fail-fast) BEFORE
        spawnDeltaSession reaches the render step. The render consumes this.deltaAnalysis /
        the `delta` return value. Do NOT modify this file.

- file: src/core/models.ts
  section: SessionMetadata.parentSession :890 (string | null; non-null only for delta
           sessions); RequirementChange :1576 (itemId, type:'added'|'modified'|'removed',
           description, impact); DeltaAnalysis :1670 (changes[], patchInstructions, taskIds)
  why: THE TYPES renderDeltaPRD consumes + the delta-session signal field. READ-ONLY (no
        model change in T3.S1).

- file: src/core/session-manager.ts
  section: createDeltaSession :631-707 (prdSnapshot=newPRD :689 — the FULL new PRD, hence the
           bug; parentSession set :670-683; reassigns #currentSession :701); loadSession
           :569-607 (reconstructs parentSession from parent_session.txt)
  why: PROVES prdSnapshot is the wrong source on a delta session (the defect) and that
        metadata.parentSession is the correct delta signal. READ-ONLY.

- file: src/agents/prompts/architect-prompt.ts
  section: createArchitectPrompt :58 (user field = `${PRD_PREMERGED_DECLARATION}\n\n${prdContent}`)
  why: CONFIRMS prdContent is embedded verbatim into the Architect prompt's user turn — so
        sourcing the full PRD there IS the leak. READ-ONLY.

- file: src/agents/prompts.ts
  section: DELTA_PRD_PROMPT :770 (DEAD CODE — shell template)
  why: DO NOT DELETE in T3.S1. Leave it in place (its string-content integration tests in
        tests/integration/delta-prd-generation.test.ts + delta-resume-regeneration.test.ts
        keep passing). The deterministic render is ADDED alongside; DELTA_PRD_PROMPT simply
        stops being the (non-existent) generation mechanism. Removing it would be a larger
        blast radius (two test files + PROMPTS index + agents/prompts/index.ts) outside this
        item's scope.

- file: tests/unit/workflows/prp-pipeline.test.ts
  section: vi.mock() block (12 mocked modules); createMockSessionManager helper; the
           "decomposePRD" / delta tests if present; data factories (createTestSubtask/Task/
           Milestone/Phase/Backlog/Session)
  why: THE TEST TEMPLATE for the decomposePRD delta-branch unit tests. Copy the mock block +
        createMockSessionManager; build a delta SessionState (metadata.parentSession set,
        empty backlog) and a non-delta SessionState. Spy createArchitectPrompt (via the
        architect-prompt mock) to assert its first arg is the delta content vs prdSnapshot.

- file: tests/unit/core/  (directory)
  why: PLACEMENT for the new delta-prd.test.ts. Mirror an existing tests/unit/core/*.test.ts
        for import style + vitest patterns. loadDeltaPRD/writeDeltaPRD are tested with a real
        tmp dir (mkdtempSync) like tests/integration/delta-resume-regeneration.test.ts does.

- file: PRD.md   # §4.3 (h3.5) step 5 — the source of truth
  section: §4.3 step 5 ("Delta PRD Generation" + "Breakdown MUST consume the delta PRD")
  why: THE REQUIREMENT. Verbatim text is in the selected_prd_content. Quote it in JSDoc on
        renderDeltaPRD/writeDeltaPRD and the decomposePRD delta branch.
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/
  prp-pipeline.ts            # MODIFY — spawnDeltaSession render+write step; decomposePRD delta branch.
  delta-analysis-workflow.ts # READ-ONLY — produces the DeltaAnalysis the render consumes.
src/core/
  session-utils.ts           # MODIFY (ADD) — renderDeltaPRD, writeDeltaPRD, loadDeltaPRD.
  session-manager.ts         # READ-ONLY — createDeltaSession/loadSession (parentSession signal).
  models.ts                  # READ-ONLY — SessionMetadata.parentSession, DeltaAnalysis, RequirementChange.
src/agents/
  prompts.ts                 # READ-ONLY — DELTA_PRD_PROMPT left in place (dead code).
  prompts/architect-prompt.ts# READ-ONLY — createArchitectPrompt (confirms prdContent embedding).
tests/unit/core/
  delta-prd.test.ts          # NEW — render/write/load + decomposePRD delta-branch tests.
tests/unit/workflows/
  prp-pipeline.test.ts       # READ-ONLY — mock template + factories.
tests/integration/
  delta-prd-generation.test.ts        # READ-ONLY — asserts DELTA_PRD_PROMPT string (left intact).
  delta-resume-regeneration.test.ts   # READ-ONLY — asserts missing-file state (left intact).
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/core/session-utils.ts  # + renderDeltaPRD(delta, completedTaskIds, parentSessionId): string
                           #   (pure markdown builder from DeltaAnalysis — Added/Modified/Removed
                           #   + preserved-work + patch instructions + re-execute tasks).
                           # + writeDeltaPRD(sessionPath, content): Promise<void>
                           #   (atomicWrite to <sessionPath>/delta_prd.md; SessionFileError on failure).
                           # + loadDeltaPRD(sessionPath): Promise<string>
                           #   (readUTF8FileStrict over <sessionPath>/delta_prd.md; SessionFileError
                           #   on ENOENT — the missing-file detector).
src/workflows/prp-pipeline.ts # + in spawnDeltaSession(): after createDeltaSession(), call
                              #   writeDeltaPRD(currentSession!.metadata.path,
                              #     renderDeltaPRD(delta, completedTaskIds, parentRef)).
                              # + in decomposePRD(): delta branch — parentSession != null →
                              #   prdContent = loadDeltaPRD(sessionPath) (clear throw on missing;
                              #   never fall back to prdSnapshot); else prdSnapshot (unchanged).
tests/unit/core/
  delta-prd.test.ts        # NEW — renderDeltaPRD (all change types, empty, completed-list,
                           #   parent ref, no full-PRD leak); writeDeltaPRD+loadDeltaPRD round-trip
                           #   + SessionFileError cases; decomposePRD delta branch (delta →
                           #   loadDeltaPRD called + createArchitectPrompt gets delta content;
                           #   missing file → clear error; non-delta → prdSnapshot unchanged).
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (prdSnapshot is the FULL new PRD on a delta session): createDeltaSession()
//   (session-manager.ts:689) sets prdSnapshot: newPRD. So decomposePRD()'s current source
//   (currentSession?.prdSnapshot) embeds the ENTIRE new PRD into the Architect prompt on a
//   delta session — exactly the hazard PRD §4.3 step 5 forbids. The delta branch MUST source
//   loadDeltaPRD() instead, and MUST throw (not fall back) if delta_prd.md is missing.

// CRITICAL (capture parent id BEFORE createDeltaSession): createDeltaSession() reassigns
//   #currentSession to the NEW delta session (session-manager.ts:701). After the call,
//   currentSession.metadata.id is the DELTA id and currentSession.metadata.parentSession is
//   the parent id. For renderDeltaPRD's parentSessionId arg, either capture
//   `const parentRef = currentSession.metadata.id` BEFORE the call, OR read
//   `currentSession!.metadata.parentSession` AFTER the call. Both are correct; pick one and
//   be consistent.

// CRITICAL (the delta branch must THROW on missing delta_prd.md): never silently fall back
//   to prdSnapshot. A missing delta_prd.md on a delta session means the session is incomplete
//   (interrupted during/after spawn). Throwing a clear error halts the pipeline; the next run
//   regenerates delta_prd.md via spawnDeltaSession() (the resume-regeneration contract).

// CRITICAL (reachability — do NOT change patchBacklog): spawnDeltaSession() patches the
//   parent backlog and saves it, so decomposePRD() usually early-returns at hasBacklog and
//   never reaches the rebind. This is EXPECTED. The rebind is a correctness/safety guard for
//   when decomposePRD DOES run on a delta session (empty backlog / resume). Do NOT remove
//   patchBacklog, do NOT force decomposition on delta sessions — out of scope. See Context
//   §"Reachability".

// CRITICAL (do NOT delete DELTA_PRD_PROMPT): it is dead code but its string content is
//   asserted by tests/integration/delta-prd-generation.test.ts +
//   delta-resume-regeneration.test.ts. Removing it would break those tests and expand the
//   diff outside this item's scope. Leave it; the deterministic render is added alongside.

// CRITICAL (no second LLM call): the semantic diff is ALREADY done by
//   DeltaAnalysisWorkflow.analyzeDelta() (retried via retryAgentPrompt, maxAttempts:3). The
//   render is a PURE function over the returned DeltaAnalysis. Do NOT call DELTA_PRD_PROMPT
//   or any agent to generate delta_prd.md — that duplicates the diff and adds flakiness.

// GOTCHA (DeltaAnalysis is NOT persisted): only patchBacklog's output (tasks.json) survives.
//   So resume-regeneration = re-run DeltaAnalysisWorkflow + re-render, which is exactly what
//   spawnDeltaSession does. No extra persistence needed.

// GOTCHA (ESM .js imports): all intra-project imports use .js extensions in .ts source
//   (e.g. '../core/session-utils.js'). renderDeltaPRD's DeltaAnalysis param is a type-only
//   import: `import type { DeltaAnalysis } from './models.js'` in session-utils.ts.

// GOTCHA (import style in prp-pipeline.ts): session-utils helpers are imported STATICALLY at
//   the top (resolvePRD is already imported at :43). ADD loadDeltaPRD to that same static
//   import. Do NOT use dynamic `await import(...)` for loadDeltaPRD (the architect-prompt
//   dynamic import at :960-966 is a pre-existing pattern for the agent modules only).
//   renderDeltaPRD + writeDeltaPRD are used in spawnDeltaSession — add them to the static
//   import too.

// GOTCHA (afterEach signal cleanup): if the new test constructs a PRPPipeline for the
//   decomposePRD delta-branch cases, its constructor registers SIGINT/SIGTERM handlers.
//   afterEach MUST process.removeAllListeners('SIGINT') + 'SIGTERM' (precedent:
//   prp-pipeline.test.ts).

// GOTCHA (npm run validate does NOT run coverage): it runs lint + format:check + typecheck +
//   test:run. The coverage gate is only `npm run test:coverage`. Run it explicitly to verify
//   ~100% on the new branches.

// GOTCHA (loadDeltaPRD vs loadSnapshot): loadSnapshot (session-utils.ts:1150) reads
//   prd_snapshot.md, NOT delta_prd.md. Do NOT reuse it. loadDeltaPRD is a NEW sibling that
//   reads delta_prd.md. Both use readUTF8FileStrict.
```

---

## Implementation Blueprint

### Data models and structure

**No new data models.** The render consumes existing `DeltaAnalysis` / `RequirementChange`
(`models.ts:1576`, `:1670`) and produces a `string`. The three new units are functions:

```typescript
// === additions to src/core/session-utils.ts ===
// (DeltaAnalysis type-only import added to existing imports from './models.js'.)
// (atomicWrite :110, readUTF8FileStrict :212, SessionFileError :67 already exist.)

/**
 * Render a focused delta-PRD markdown from a structured DeltaAnalysis.
 *
 * PRD §4.3 step 5: the delta PRD focuses ONLY on differences (added/modified/removed)
 * and references completed work. This is a DETERMINISTIC render of the semantic diff
 * that DeltaAnalysisWorkflow.analyzeDelta() already produced (retried via
 * retryAgentPrompt) — no second LLM call. The retry/fail-fast contract is inherited
 * from that upstream retried step.
 *
 * The output is the breakdown input for delta sessions (consumed by decomposePRD via
 * loadDeltaPRD) — it is NOT the full PRD.
 */
export function renderDeltaPRD(
  delta: DeltaAnalysis,
  completedTaskIds: string[],
  parentSessionId: string
): string {
  const added = delta.changes.filter(c => c.type === 'added');
  const modified = delta.changes.filter(c => c.type === 'modified');
  const removed = delta.changes.filter(c => c.type === 'removed');
  const lines: string[] = [];
  lines.push('# Delta PRD');
  lines.push('');
  lines.push(`> Focused on differences vs parent session \`${parentSessionId}\`.`);
  lines.push('> This is NOT the full PRD — only added/modified/removed requirements.');
  lines.push('');
  if (completedTaskIds.length > 0) {
    lines.push('## Completed Work (preserved — do NOT re-implement)');
    for (const id of completedTaskIds) lines.push(`- ${id}`);
    lines.push('');
  }
  const section = (title: string, items: typeof added): void => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    for (const c of items) {
      lines.push(`### ${c.itemId}`);
      lines.push(`- **What changed:** ${c.description}`);
      lines.push(`- **Impact:** ${c.impact}`);
      lines.push('');
    }
  };
  section('Added', added);
  section('Modified', modified);
  if (removed.length > 0) {
    lines.push('## Removed (for awareness — no implementation tasks)');
    for (const c of removed) lines.push(`- **${c.itemId}:** ${c.description}`);
    lines.push('');
  }
  lines.push('## Patch Instructions');
  lines.push(delta.patchInstructions);
  lines.push('');
  if (delta.taskIds.length > 0) {
    lines.push('## Tasks to Re-execute');
    for (const id of delta.taskIds) lines.push(`- ${id}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Write delta_prd.md to a session directory (atomic). PRD §4.3 step 5. */
export async function writeDeltaPRD(
  sessionPath: string,
  content: string
): Promise<void> {
  const deltaPrdPath = resolve(sessionPath, 'delta_prd.md');
  try {
    await atomicWrite(deltaPrdPath, content);
  } catch (error) {
    if (error instanceof SessionFileError) throw error;
    throw new SessionFileError(deltaPrdPath, 'write delta PRD', error as Error);
  }
}

/**
 * Read delta_prd.md from a session directory.
 * Throws SessionFileError if the file is missing — used by decomposePRD's delta branch
 * as the missing-file detector (PRD §4.3: incomplete delta sessions must not silently
 * fall back to the full PRD).
 */
export async function loadDeltaPRD(sessionPath: string): Promise<string> {
  return readUTF8FileStrict(resolve(sessionPath, 'delta_prd.md'), 'read delta PRD');
}
```

The two `prp-pipeline.ts` edits:

```typescript
// === spawnDeltaSession() — render+write step (insert AFTER createDeltaSession, near :881) ===
// (delta + completedTaskIds already in scope from Steps 3-4. capture parent id BEFORE the call.)
const parentSessionIdRef = this.sessionManager.currentSession!.metadata.id; // parent, before reassign
await this.sessionManager.createDeltaSession(this.sessionManager.prdPath);
const deltaSessionPath = this.sessionManager.currentSession!.metadata.path;
// PRD §4.3 step 5: generate delta_prd.md (deterministic render of the DeltaAnalysis).
await writeDeltaPRD(
  deltaSessionPath,
  renderDeltaPRD(delta, completedTaskIds, parentSessionIdRef)
);
await this.sessionManager.saveBacklog(patchedBacklog);   // existing Step 7

// === decomposePRD() — delta branch (replace the prdContent source at :979) ===
const architectAgent = createArchitectAgent();
const sessionPath = this.sessionManager.currentSession!.metadata.path;   // hoisted from :980
const isDelta =
  this.sessionManager.currentSession?.metadata.parentSession != null;
let prdContent: string;
if (isDelta) {
  // PRD §4.3 step 5: delta breakdown runs over delta_prd.md, NOT the full PRD.
  // prdSnapshot on a delta session is the FULL new PRD — MUST NOT use it.
  try {
    prdContent = await loadDeltaPRD(sessionPath);
  } catch {
    throw new Error(
      `Delta session has no delta_prd.md at ${sessionPath} — cannot break down ` +
        'the delta. Re-run to regenerate it via the delta spawn path.'
    );
  }
} else {
  prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
}
const architectPrompt = createArchitectPrompt(prdContent, sessionPath);
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/session-utils.ts — ADD renderDeltaPRD + writeDeltaPRD + loadDeltaPRD
  - IMPLEMENT the three functions per the Data models block.
    * renderDeltaPRD: pure; filters changes by type; emits Added/Modified/Removed sections,
      a Completed-Work-preserved list (only if completedTaskIds non-empty), Patch
      Instructions, and Tasks-to-Re-execute (only if taskIds non-empty). Header notes it is
      NOT the full PRD and names the parent session.
    * writeDeltaPRD: atomicWrite(resolve(sessionPath,'delta_prd.md'), content); re-throw
      SessionFileError, wrap others (mirror writePRD :1006-1014).
    * loadDeltaPRD: readUTF8FileStrict(resolve(sessionPath,'delta_prd.md'), 'read delta PRD').
  - FOLLOW pattern: writePRP (:986) for writeDeltaPRD; loadSnapshot (:1150) for loadDeltaPRD;
    prpToMarkdown (:898) for renderDeltaPRD (pure string builder).
  - NAMING: renderDeltaPRD / writeDeltaPRD / loadDeltaPRD (verb-first, match writePRP/
    loadSnapshot).
  - PLACEMENT: src/core/session-utils.ts near the other file writers (after loadSnapshot
    ~:1150 is a natural spot, or near writePRP :986).
  - IMPORT: add `import type { DeltaAnalysis } from './models.js'` (type-only). atomicWrite,
    readUTF8FileStrict, SessionFileError, resolve already imported.
  - JSDOC: cite PRD §4.3 step 5 on all three.

Task 2: MODIFY src/workflows/prp-pipeline.ts — spawnDeltaSession render+write step
  - In spawnDeltaSession(), IMMEDIATELY AFTER `await this.sessionManager.createDeltaSession(
    this.sessionManager.prdPath)` (and BEFORE `await this.sessionManager.saveBacklog(
    patchedBacklog)`), add: capture parentSessionIdRef BEFORE createDeltaSession; then
    `await writeDeltaPRD(deltaSessionPath, renderDeltaPRD(delta, completedTaskIds,
    parentSessionIdRef))`.
  - FOLLOW pattern: the existing step comments (Step 4/5/6/7). Add a "Step 6b" comment
    citing PRD §4.3 step 5.
  - IMPORT: add renderDeltaPRD + writeDeltaPRD to the existing static import from
    '../core/session-utils.js' (:43-49 — resolvePRD is already there). Do NOT use dynamic import.
  - GOTCHA: capture parentSessionIdRef = currentSession!.metadata.id BEFORE createDeltaSession
    reassigns #currentSession (it becomes the delta id after). Alternatively read
    currentSession!.metadata.parentSession AFTER — pick one.
  - GOTCHA: delta + completedTaskIds are already in scope (Steps 3-4 of spawnDeltaSession).
    Do NOT recompute them.

Task 3: MODIFY src/workflows/prp-pipeline.ts — decomposePRD delta branch
  - In decomposePRD(), replace the `const prdContent = …` source (:979) + hoist sessionPath
    (:980) per the Data models block. Add the `isDelta` branch: parentSession != null →
    loadDeltaPRD (try/catch → clear thrown error); else prdSnapshot (unchanged).
  - FOLLOW pattern: the existing JSDoc + try/catch structure of decomposePRD.
  - IMPORT: add loadDeltaPRD to the static import from '../core/session-utils.js'.
  - JSDOC: cite PRD §4.3 step 5 ("Breakdown MUST consume the delta PRD") on the new branch.
  - GOTCHA: the branch MUST throw on missing delta_prd.md — NEVER fall back to prdSnapshot.
  - GOTCHA: do NOT touch the hasBacklog early-return (:946) or patchBacklog — see Reachability.

Task 4: CREATE tests/unit/core/delta-prd.test.ts
  - IMPORT: describe, expect, it, vi, beforeEach, afterEach from 'vitest'; mkdtempSync,
    rmSync from 'node:fs'; join, tmpdir from 'node:os'/'node:path'; renderDeltaPRD,
    writeDeltaPRD, loadDeltaPRD from '../../../src/core/session-utils.js'; DeltaAnalysis type.
  - describe('renderDeltaPRD'):
      * all three change types present → output has ## Added / ## Modified / ## Removed with
        each itemId + description + impact.
      * only 'added' → no Modified/Removed sections.
      * empty changes[] → no change sections; still has header + patch instructions.
      * completedTaskIds non-empty → "## Completed Work" section lists them; empty → section
        omitted.
      * taskIds non-empty → "## Tasks to Re-execute"; empty → omitted.
      * parentSessionId appears in the header note.
      * output does NOT contain any "full PRD" leakage (it is built solely from delta fields).
  - describe('writeDeltaPRD + loadDeltaPRD'):
      * round-trip: writeDeltaPRD(tmpDir, md) then loadDeltaPRD(tmpDir) === md; file exists at
        <tmpDir>/delta_prd.md.
      * loadDeltaPRD on missing file → throws SessionFileError.
      * writeDeltaPRD to a non-existent dir → throws SessionFileError (atomicWrite fails).
  - describe('decomposePRD delta branch') — use the prp-pipeline.test.ts mock block +
    createMockSessionManager; spy createArchitectPrompt (mock architect-prompt module) to
    capture its first arg:
      * CASE A (delta session, delta_prd.md present): metadata.parentSession set, empty
        backlog; pre-write delta_prd.md via writeDeltaPRD; call decomposePRD(); VERIFY
        loadDeltaPRD path taken (createArchitectPrompt's first arg === the delta content, NOT
        prdSnapshot). Assert prdSnapshot was NOT used.
      * CASE B (delta session, delta_prd.md MISSING): metadata.parentSession set, empty
        backlog, no delta_prd.md; call decomposePRD(); VERIFY it throws an error mentioning
        delta_prd.md; VERIFY createArchitectPrompt was NOT called.
      * CASE C (non-delta session): metadata.parentSession null, empty backlog; call
        decomposePRD(); VERIFY createArchitectPrompt's first arg === prdSnapshot (unchanged
        path); loadDeltaPRD NOT called.
  - COVERAGE: ~100% of renderDeltaPRD (every section conditional), writeDeltaPRD (success +
    SessionFileError wrap + re-throw), loadDeltaPRD (success + ENOENT), and the
    decomposePRD isDelta true/false + missing-file throw. Run `npm run test:coverage`.
  - GOTCHA: afterEach process.removeAllListeners('SIGINT'/'SIGTERM') if a PRPPipeline is
    constructed (constructor registers handlers).
  - GOTCHA: the decomposePRD cases must mock createArchitectAgent (agent-factory) +
    createArchitectPrompt (architect-prompt) + retryAgentPrompt (retry) so no real LLM runs;
    mirror prp-pipeline.test.ts.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: deterministic render — pure function over the already-produced DeltaAnalysis.
//   No LLM, no I/O. The retry/fail-fast is inherited from DeltaAnalysisWorkflow's retried
//   QA call. (See Context §"Why deterministic render, not DELTA_PRD_PROMPT".)
export function renderDeltaPRD(delta, completedTaskIds, parentSessionId): string { … }

// PATTERN: the spawnDeltaSession step — write delta_prd.md right after the delta dir exists.
const parentSessionIdRef = this.sessionManager.currentSession!.metadata.id; // BEFORE reassign
await this.sessionManager.createDeltaSession(this.sessionManager.prdPath);
await writeDeltaPRD(
  this.sessionManager.currentSession!.metadata.path,
  renderDeltaPRD(delta, completedTaskIds, parentSessionIdRef)
);

// PATTERN: the decomposePRD rebind — delta branch sources loadDeltaPRD; never prdSnapshot.
const isDelta = this.sessionManager.currentSession?.metadata.parentSession != null;
let prdContent: string;
if (isDelta) {
  try { prdContent = await loadDeltaPRD(sessionPath); }
  catch { throw new Error(`Delta session has no delta_prd.md …`); }   // NEVER fall back
} else {
  prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
}

// PATTERN: the test asserts the delta branch does NOT embed the full PRD.
const promptSpy = vi.fn();
vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
  createArchitectPrompt: (content: string) => { promptSpy(content); return {}; },
}));
// … build a delta session with delta_prd.md pre-written, call decomposePRD() …
expect(promptSpy).toHaveBeenCalledWith(deltaContent);          // NOT prdSnapshot
```

### Integration Points

```yaml
DELTA SESSION SPAWN (generation seam):
  - step in: src/workflows/prp-pipeline.ts spawnDeltaSession() — after createDeltaSession(),
    before saveBacklog().
  - pattern: "writeDeltaPRD(currentSession!.metadata.path, renderDeltaPRD(delta,
              completedTaskIds, parentRef))"
  - preserved: DeltaAnalysisWorkflow.run(), patchBacklog, createDeltaSession, saveBacklog
               are all unchanged. The new step is purely additive.

BREAKDOWN (binding seam):
  - branch in: src/workflows/prp-pipeline.ts decomposePRD() — replaces the prdContent source.
  - pattern: "if (parentSession != null) loadDeltaPRD else prdSnapshot; throw on missing"
  - preserved: the hasBacklog early-return, createArchitectAgent, createArchitectPrompt call,
               retryAgentPrompt, the tasks.json read + saveBacklog are all unchanged.

SESSION UTILS (helpers):
  - add to: src/core/session-utils.ts (near writePRP/loadSnapshot, ~:986-:1150)
  - exports: renderDeltaPRD, writeDeltaPRD, loadDeltaPRD

NO OTHER INTEGRATION POINTS:
  - CLI: none. CONFIG: none. ROUTES/MIGRATIONS: none. MODELS: none (read-only).
  - DELTA_PRD_PROMPT: left in place (dead code; its string-content tests keep passing).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after each file creation - fix before proceeding
npm run lint               # ESLint (project-wide; fix any new-file issues)
npm run format:check       # Prettier check (run `npm run format` to fix)
npm run typecheck          # tsc --noEmit -p tsconfig.build.json

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
# (The project uses `npm run validate` = lint + format:check + typecheck + test:run.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new helpers + the decomposePRD delta branch
npx vitest run tests/unit/core/delta-prd.test.ts

# Full unit suite for affected areas
npx vitest run tests/unit/core/ tests/unit/workflows/

# Coverage validation on the new code
npm run test:coverage
# Expected: ~100% on renderDeltaPRD (every section conditional), writeDeltaPRD/loadDeltaPRD
# (success + error paths), and the decomposePRD isDelta true/false + missing-file throw.
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the existing delta-prd integration tests still pass (DELTA_PRD_PROMPT left intact)
npx vitest run tests/integration/delta-prd-generation.test.ts
npx vitest run tests/integration/delta-resume-regeneration.test.ts

# Confirm delta-analysis-workflow tests still pass (unmodified)
npx vitest run tests/unit/workflows/delta-analysis-workflow.test.ts

# End-to-end delta path (if run in this env): edit PRD.md, run the pipeline, and verify
# plan/<delta-session>/delta_prd.md exists and contains Added/Modified/Removed sections
# (NOT the full PRD). Then verify decomposePRD (if it runs on the delta session) sources it.
# Expected: delta_prd.md is focused on the diffs; no full-PRD embedding in the breakdown.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Inspect a generated delta_prd.md by reading the render output directly:
node --input-type=module -e "
import { renderDeltaPRD } from './src/core/session-utils.js';
const delta = { changes: [
  { itemId: 'P4.M2.T1.S1', type: 'added', description: 'New validation config', impact: 'Add env vars' },
  { itemId: 'P4.M1.T3.S1', type: 'modified', description: 'Bind breakdown to delta', impact: 'Re-read delta_prd.md' },
  { itemId: 'P6.M1.T1.S3', type: 'removed', description: 'Dropped requirement', impact: 'None' },
], patchInstructions: 'Re-execute P4.M1.T3.S1', taskIds: ['P4.M1.T3.S1'] };
console.log(renderDeltaPRD(delta, ['P4.M1.T1.S1','P4.M1.T1.S2'], '007_8783a1f5e14a'));
"
# Expected: focused markdown with ## Added / ## Modified / ## Removed + Completed Work +
# Patch Instructions + Tasks to Re-execute. No full-PRD content.

# Security/blast-radius check: confirm DELTA_PRD_PROMPT is untouched.
git diff src/agents/prompts.ts | grep -E '^\-' | grep -i 'DELTA_PRD' || echo "DELTA_PRD_PROMPT intact"
# Expected: "DELTA_PRD_PROMPT intact" (no removal).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully.
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run test:coverage` shows ~100% on the new code.
- [ ] `git diff --name-only` shows EXACTLY: `src/core/session-utils.ts`,
      `src/workflows/prp-pipeline.ts`, `tests/unit/core/delta-prd.test.ts`.

### Feature Validation

- [ ] `spawnDeltaSession()` writes `delta_prd.md` to the delta session dir (deterministic
      render of the `DeltaAnalysis`).
- [ ] `decomposePRD()` on a delta session (`parentSession != null`) sources the Architect
      prompt from `loadDeltaPRD()`, NOT `prdSnapshot`.
- [ ] Missing `delta_prd.md` on a delta session → `decomposePRD` throws a clear error
      (never falls back to the full PRD).
- [ ] Non-delta sessions unchanged (`prdContent = prdSnapshot`).
- [ ] The generated `delta_prd.md` contains ONLY Added/Modified/Removed + preserved work +
      patch instructions + re-execute tasks — never the full PRD.

### Code Quality Validation

- [ ] Follows existing `session-utils.ts` helper conventions (writePRP/loadSnapshot/atomicWrite).
- [ ] File placement matches the desired tree.
- [ ] No second LLM call; no `DELTA_PRD_PROMPT` revival; no `patchBacklog` change.
- [ ] Anti-patterns avoided (see below).
- [ ] ESM `.js` import convention followed; type-only import for `DeltaAnalysis`.

### Scope & Non-Overlap Validation

- [ ] No edits to `handleDelta()`/dispatcher/marker (S1).
- [ ] No edits to `initializeSession()`/`loadSessionAsCurrent()` (S2).
- [ ] No edits to `task-patcher.ts` / `patchBacklog`.
- [ ] No deletion of `DELTA_PRD_PROMPT` (its integration tests still pass).
- [ ] No CLI/config/docs/model (`models.ts`) edits.

### Documentation & Deployment

- [ ] JSDoc on `renderDeltaPRD`/`writeDeltaPRD`/`loadDeltaPRD` cites PRD §4.3 step 5.
- [ ] JSDoc on the `decomposePRD` delta branch cites PRD §4.3 step 5 ("Breakdown MUST
      consume the delta PRD").
- [ ] No new env vars.

---

## Anti-Patterns to Avoid

- ❌ Don't add a SECOND LLM call (DELTA_PRD_PROMPT or otherwise) to generate `delta_prd.md` —
  the semantic diff is already done by the retried `DeltaAnalysisWorkflow`. Use the
  deterministic render.
- ❌ Don't fall back to `prdSnapshot` on the delta branch when `delta_prd.md` is missing —
  that re-introduces the exact full-PRD-embedding bug. Throw.
- ❌ Don't delete `DELTA_PRD_PROMPT` — it's dead but its string-content integration tests
  would break and expand the diff outside scope. Leave it.
- ❌ Don't change `patchBacklog` or the `hasBacklog` early-return to "reach" the rebind —
  the rebind is a correctness/safety guard; the patchBacklog path is a separate concern
  (out of scope, including its unimplemented `'added'` case).
- ❌ Don't capture the parent session id AFTER `createDeltaSession()` thinking
  `currentSession.metadata.id` is the parent — it's the DELTA id after the reassign. Capture
  before, or read `.parentSession` after.
- ❌ Don't use dynamic `await import(...)` for `loadDeltaPRD`/`renderDeltaPRD`/`writeDeltaPRD`
  — add them to the static `session-utils.js` import (consistent with `resolvePRD` at `:43`).
- ❌ Don't add Zod validation to `writeDeltaPRD` — its input is already-built markdown, not a
  domain object.
- ❌ Don't reuse `loadSnapshot` for `loadDeltaPRD` — `loadSnapshot` reads `prd_snapshot.md`,
  not `delta_prd.md`.
- ❌ Don't skip validation because "it should work" — run `npm run validate` AND
  `npm run test:coverage`.