# Research Summary — P4.M1.T3.S1: Bind breakdown prompt to delta_prd.md after generation

Scope: PRD §4.3 (h3.5) step 5 — Delta PRD Generation + "Breakdown MUST consume the
delta PRD." This item owns (a) generating `delta_prd.md` and (b) rebinding the task
breakdown (`decomposePRD`) to consume it instead of the full PRD.

## 1. The core defect (two halves)

1. **`delta_prd.md` is NEVER generated.** `architecture/phase_findings.md` §PHASE 4
   confirms `DELTA_PRD_PROMPT` (prompts.ts:770) is dead code. The active delta path is
   `DeltaAnalysisWorkflow` (delta-analysis-workflow.ts:39) which returns structured JSON
   `DeltaAnalysis` and writes NOTHING to disk. `delta_prd.md` exists in `plan/008_*` only
   as a hand-authored artifact.
2. **The breakdown embeds the FULL PRD on delta sessions.** `decomposePRD()`
   (prp-pipeline.ts:747) sources `const prdContent = this.sessionManager.currentSession?.prdSnapshot ?? ''`
   (line ~786). For a delta session `createDeltaSession()` sets `prdSnapshot: newPRD`
   (session-manager.ts:689) — the **full resolved new PRD**. So `createArchitectPrompt(prdContent, …)`
   (line ~792) embeds the entire new PRD, silently ignoring the delta. This is exactly the
   hazard PRD §4.3 step 5 calls out.

## 2. Delta-session signal

`SessionMetadata.parentSession: string | null` (models.ts:890) — non-null ONLY for delta
sessions. Set by `createDeltaSession()` (session-manager.ts:670-683); null for initial
sessions (`createSessionDirectory` session-manager.ts:502); reconstructed by `loadSession()`
from `parent_session.txt` (session-manager.ts:581-600). Detect:
`this.sessionManager.currentSession?.metadata.parentSession != null`.

`prd_changed.marker` / `.pending_delta_hash` is a SEPARATE marker (S1) — do not confuse.

## 3. Generation mechanism — DETERMINISTIC RENDER (recommended)

The LLM semantic diff already happened inside `DeltaAnalysisWorkflow.analyzeDelta()`
(delta-analysis-workflow.ts:116-153) — it returns `DeltaAnalysis`:

```ts
interface DeltaAnalysis {                       // models.ts:1670
  readonly changes: RequirementChange[];        // the added/modified/removed set
  readonly patchInstructions: string;           // NL guide for task patching
  readonly taskIds: string[];                   // tasks needing re-execution
}
interface RequirementChange {                   // models.ts:1576
  readonly itemId: string;                      // e.g. 'P1.M2.T3.S1'
  readonly type: 'added' | 'modified' | 'removed';
  readonly description: string;                 // what changed
  readonly impact: string;                      // implementation impact
}
```

A pure render function `renderDeltaPRD(delta, completedTaskIds, parentSessionId): string`
produces a focused markdown delta PRD from these fields (Added/Modified/Removed sections +
completed-work-preserved list + patch instructions + tasks to re-execute). **No second LLM
call.** Rationale:
- A second `DELTA_PRD_PROMPT` call would DUPLICATE the semantic diff (it re-ingests the same
  old/new PRD), cost +1 LLM round-trip, require a shell-capable agent (the prompt uses
  `$(cat …)`), and reintroduce a second flakiness point.
- The retry + fail-fast contract (PRD §4.3 "retry then fail fast") is already owned by
  `retryAgentPrompt` wrapping the QA call (delta-analysis-workflow.ts:124-130,
  `maxAttempts:3`). A deterministic render built AFTER that step INHERITS fail-fast: if the
  LLM exhausts retries, `spawnDeltaSession` throws before the render is reached.

Trade-off: the deterministic render is thinner than the narrative `plan/008/delta_prd.md`,
but it carries the complete diff + impact + patch instructions, which is what "the diffs"
means for breakdown consumption. Richness (e.g. doc-impact lines) can be added later by
extending `RequirementChange` — NOT by a second LLM pass.

## 4. Insertion point for generation

`spawnDeltaSession()` (prp-pipeline.ts ~810-900). After Step 4 `DeltaAnalysisWorkflow.run()`
(returns `delta`) and Step 6 `createDeltaSession()` (sets `currentSession!.metadata.path` to
the new delta dir), BEFORE/AFTER Step 7 `saveBacklog()`:

```ts
// Step 6: Create delta session
await this.sessionManager.createDeltaSession(this.sessionManager.prdPath);
const deltaSessionPath = this.sessionManager.currentSession!.metadata.path;
// Step 6b (NEW): render + write delta_prd.md deterministically from DeltaAnalysis
await writeDeltaPRD(
  deltaSessionPath,
  renderDeltaPRD(delta, completedTaskIds, parentSessionIdRef)
);
// Step 7: Save patched backlog
await this.sessionManager.saveBacklog(patchedBacklog);
```

`delta` and `completedTaskIds` are both already in scope (Steps 3-4). `parentSessionIdRef`
= `currentSession.metadata.id` captured BEFORE createDeltaSession reassigns currentSession
(use the captured parent ID).

## 5. New helpers in session-utils.ts

- `writeDeltaPRD(sessionPath, content): Promise<void>` — `atomicWrite(resolve(sessionPath,
  'delta_prd.md'), content)` wrapped to re-throw as `SessionFileError`. Mirrors `writePRP`
  (session-utils.ts:986) / `writeTasksJSON` (session-utils.ts:746). No Zod (input is built
  markdown).
- `loadDeltaPRD(sessionPath): Promise<string>` — `readUTF8FileStrict(resolve(sessionPath,
  'delta_prd.md'), 'read delta PRD')`. Mirrors `loadSnapshot` (session-utils.ts:1150) but for
  delta_prd.md. Throws `SessionFileError` on ENOENT → doubles as missing-file detector.
- `renderDeltaPRD(delta, completedTaskIds, parentSessionId): string` — pure string builder.
  Place near `prpToMarkdown` (session-utils.ts:898) OR in a new tiny `delta-prd-renderer.ts`.
  (Recommend session-utils.ts for discoverability + co-located unit test.)

`atomicWrite` (session-utils.ts:110), `readUTF8FileStrict` (session-utils.ts:212),
`SessionFileError` (session-utils.ts:67) all already exist.

## 6. The breakdown rebind (decomposePRD)

Edit `src/workflows/prp-pipeline.ts` `decomposePRD()` between `createArchitectAgent()`
(line ~782) and `const prdContent = …` (line ~786). Hoist `sessionPath` up. New delta
branch:

```ts
const isDelta =
  this.sessionManager.currentSession?.metadata.parentSession != null;
const sessionPath = this.sessionManager.currentSession!.metadata.path;
let prdContent: string;
if (isDelta) {
  // PRD §4.3 step 5: delta breakdown runs over delta_prd.md, NOT the full PRD.
  // prdSnapshot on a delta session is the FULL new PRD — must NOT use it.
  try {
    prdContent = await loadDeltaPRD(sessionPath);
  } catch {
    throw new Error(
      `Delta session ${…} has no delta_prd.md — cannot break down. Re-run to ` +
        'regenerate via the delta spawn path.'
    );
  }
} else {
  prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
}
```

NOT built at load time: confirmed — `createArchitectPrompt` is dynamically imported and
invoked only inside this instance method (run() calls `initializeSession()` →
`decomposePRD()` at prp-pipeline.ts:1826/1839). No module-level caching of `prdContent`
or the prompt. The rebind is a runtime sourcing change, satisfying the invariant.

## 7. Reachability — the empty-backlog delta session (RESIDUAL RISK, design decision)

CONTRACT LOGIC (b): "breakdown input MUST be (re)bound to the delta content AFTER
delta_prd.md is generated." But `spawnDeltaSession()` (current + S1) does
`patchBacklog(backlog, delta)` then `saveBacklog(patchedBacklog)` — so the delta session
has a NON-empty backlog, and `decomposePRD()` early-returns at `hasBacklog` (line ~755),
NEVER reaching the rebind.

**Design decision for T3.S1 (minimal, in-scope):** the rebind + clear-error guard is
correct and complete REGARDLESS of reachability — it is the seam PRD §4.3 step 5 mandates,
and it protects against: (a) a future flow that generates the delta backlog from delta_prd.md,
(b) resume of an interrupted delta session whose backlog was not yet saved, and (c) any
delta session reaching decomposePRD with an empty backlog. The patchBacklog path is owned
by `task-patcher.ts` (the `'added'` case is unimplemented — phase_findings.md §PHASE 4) and
is a SEPARATE concern; T3.S1 does NOT change how patchBacklog produces the delta backlog.

The rebind is a SAFETY + CORRECTNESS guard: when decomposePRD DOES run on a delta session
(empty backlog), it now reads delta_prd.md (not the full PRD) OR throws a clear error
(never silently falls back to prdSnapshot). This fully satisfies the work-item's stated
LOGIC (c)+(d). The PRP must document this reachability nuance explicitly so the
implementer does not "fix" it by removing patchBacklog (out of scope) or by forcing
decomposition (behavior change).

## 8. Resume-regeneration contract (PRD §4.3: "Incomplete delta sessions detect and
regenerate missing delta PRDs on resume")

There is NO resume hook in `SessionManager.initialize()` / `loadSession()` that detects a
delta session (parentSession != null) with missing delta_prd.md. So:
- The **missing-file guard** lives in `decomposePRD()` (throws clear error → next run
  regenerates via the delta spawn path).
- The **regeneration mechanism** = re-run `DeltaAnalysisWorkflow` + re-render, which is
  exactly what `spawnDeltaSession()` does. Since `DeltaAnalysis` is NOT persisted, resume
  re-derives it from the recoverable inputs (parent snapshot + current PRD + completed
  tasks).
- This matches the existing test contract in `tests/integration/delta-resume-regeneration.test.ts`
  which only asserts the MISSING-file STATE (never real regeneration) and comments
  "Actual regeneration is triggered by PRPPipeline, not SessionManager" (lines ~1119-1124).

## 9. Existing tests — coverage gap

Both `tests/integration/delta-prd-generation.test.ts` and
`tests/integration/delta-resume-regeneration.test.ts` assert ONLY (a) `DELTA_PRD_PROMPT`
string content and (b) `retryAgentPrompt`/`retry` util behavior. They do NOT exercise:
- real `delta_prd.md` generation by the pipeline,
- `decomposePRD()` rebinding,
- `renderDeltaPRD` output,
- `writeDeltaPRD`/`loadDeltaPRD` file contract.

These tests will need UPDATING if `DELTA_PRD_PROMPT` is removed/deprecated. **Decision for
T3.S1: do NOT delete `DELTA_PRD_PROMPT`** (avoid blast radius across two test files + the
PROMPTS index + `agents/prompts/index.ts`/`prompts.ts:1258`). The deterministic render is
ADDED alongside; `DELTA_PRD_PROMPT` is left as-is (still dead, but its string-content tests
keep passing). New unit tests cover `renderDeltaPRD` + `writeDeltaPRD`/`loadDeltaPRD` + the
`decomposePRD` delta branch. This keeps `git diff` minimal and focused.

## 10. S1 vs T3.S1 non-overlap — CONFIRMED

S1 (P4.M1.T2.S1) owns: `--accept-prd-changes` CLI flag, `handleDelta()` →
response-selection dispatcher, `prd_changed.marker`/`.pending_delta_hash` primitive trio,
`acceptPrdChangesResponse()`, `integrateIntoCurrentSessionResponse()`, and `spawnDeltaSession()`
(the extracted original handleDelta body: analysis + patch + create + save). S1's
`spawnDeltaSession()` does NOT write `delta_prd.md`.

T3.S1 owns: `delta_prd.md` generation (render + write) + `decomposePRD()` breakdown binding.
Overlap surface: both edit `prp-pipeline.ts`. S1 edits `handleDelta()`/dispatcher
(~:619-865) + session-utils marker functions; T3.S1 edits `spawnDeltaSession()`
(~:810-900, adding the render+write step after createDeltaSession) + `decomposePRD()`
(~:780-790, the delta branch) + adds helpers to `session-utils.ts`. DISJOINT regions within
each file.

S2 (P4.M1.T2.S2, parallel) owns: validate/bug-hunt session reuse in `initializeSession()`.
T3.S1 is downstream of the delta-session spawn path only; S2 bypasses `handleDelta()`
entirely. No overlap.

## 11. Key file:line references (verified)

- `src/workflows/prp-pipeline.ts`:
  - `decomposePRD()` :747-850 (rebind seam at :786 prdContent source / :792 prompt call;
    hasBacklog early-return :755; createArchitectAgent :782)
  - `spawnDeltaSession()` :810-900 (DeltaAnalysisWorkflow.run :~861; createDeltaSession
    :~872; saveBacklog :~878 — insertion point after createDeltaSession)
  - `run()` :1826 (initializeSession) → :1839 (decomposePRD) ordering
  - imports `resolvePRD` from `'../core/session-utils.js'` :43 (static — add
    loadDeltaPRD here)
- `src/workflows/delta-analysis-workflow.ts`: :39 class, :116 analyzeDelta, :124-130
  retryAgentPrompt wrap, :181 run()
- `src/core/session-utils.ts`: atomicWrite :110, readUTF8FileStrict :212, SessionFileError
  :67, writePRP :986, loadSnapshot :1150 (template for loadDeltaPRD), prpToMarkdown :898
- `src/core/session-manager.ts`: createDeltaSession :631-707 (prdSnapshot=newPRD :689;
  parentSession set :670-683), loadSession :569-607 (reads parent_session.txt)
- `src/core/models.ts`: SessionMetadata.parentSession :890; RequirementChange :1576;
  DeltaAnalysis :1670
- `src/agents/prompts.ts`: DELTA_PRD_PROMPT :770 (dead code — DO NOT delete in T3.S1)
- `src/agents/prompts/architect-prompt.ts`: createArchitectPrompt :58 (user field = prdContent)
- `architecture/phase_findings.md` §PHASE 4 (the research note cited in the CONTRACT)
- `tests/integration/delta-prd-generation.test.ts`, `delta-resume-regeneration.test.ts`
  (assert DELTA_PRD_PROMPT string content only — leave intact)
- `tests/unit/workflows/prp-pipeline.test.ts` (mock template for new unit tests)