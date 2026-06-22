# PRP — P5.M1.T2.S4: Orchestrator issue-handling flow bounded by ISSUE_RETRY_MAX

## Goal

**Feature Goal**: Wire the full PRD §4.5 issue-driven re-planning loop into `TaskOrchestrator.executeSubtask`. Today the orchestrator only branches on `result.success` (→ `Complete`) vs `!result.success` (→ `Failed`). After S2, the `ExecutionResult` carries an explicit tri-state `outcome: 'success' | 'fail' | 'issue'`. This subtask adds the **third branch**: when `outcome === 'issue'` (a *recoverable planning gap* — the PRP was insufficient but the work is valid), the orchestrator (1) writes `result.issueMessage` to `<sessionDir>/issue_feedback.md` (atomic), (2) deletes the offending PRP file so it cannot be reused, (3) resets the item to `Planned` (NOT `Failed`), (4) re-researches synchronously with the feedback injected (via the S3 generator path), and (5) bounds the whole loop by `getIssueRetryMax()` (S1) using a per-item in-memory counter — when exceeded the item HARD-fails (`Failed` + log) and exits. Real `fail` outcomes stay on the existing fix-and-retry path (`TaskRetryManager`); the item's original ID + dependency links are unchanged.

**Deliverable**:
1. `src/core/research-queue.ts` — extend `researchNow(task, backlog, issueFeedback?)` to thread the feedback to `#prpGenerator.generate(task, backlog, issueFeedback)` (the S3 generator path); add `deletePRP(taskId): Promise<void>` that clears the in-memory `results` entry AND unlinks the disk PRP file + its cache-metadata JSON (ENOENT-tolerant). Mode-A JSDoc on both.
2. `src/core/task-orchestrator.ts` — add a `#issueAttempts: Map<string, number>` field; refactor the execution section of `executeSubtask` into an issue-bounded `while` loop that, on `outcome === 'issue'`, runs the §4.5 sequence (atomicWrite feedback → deletePRP → setStatus Planned → researchNow-with-feedback → increment counter → hard-fail-or-continue). Import `atomicWrite` + `getIssueRetryMax`. Success/`fail` paths and the existing smart-commit/flush tail are preserved.
3. Failing-first TDD tests in `tests/unit/core/task-orchestrator.test.ts` (issue→feedback-written + PRP-deleted + Planned + researchNow-with-feedback; `ISSUE_RETRY_MAX` exhaustion→Failed; `fail` outcome still uses the existing Failed path) and `tests/unit/core/research-queue.test.ts` (researchNow forwards feedback as the 3rd arg; deletePRP clears cache + unlinks files; **UPDATE** the one existing 2-arg `toHaveBeenCalledWith` to 3 args).
4. `docs/WORKFLOWS.md` — a new "Issue-Driven Re-planning" subsection (Mode A doc-with-work) describing the success/fail/issue tri-state and the reset→delete-PRP→re-research-with-feedback→`ISSUE_RETRY_MAX`-bound flow.

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) both green; a stubbed `prpRuntime` returning `outcome:'issue'` N times then `'success'` (with `ISSUE_RETRY_MAX='2'`, N≤2) ends at `Complete` after exactly N re-plans (each writing `issue_feedback.md`, calling `deletePRP`, setting `Planned`, and calling `researchNow(subtask, backlog, feedback)`); returning `outcome:'issue'` 3 times hard-fails the item (`Failed`); an `outcome:'fail'` result still goes straight to `Failed` WITHOUT invoking any re-planning step.

## Why

- **Business value**: PRD §4.5 turns a Coder-Agent `issue` result into a **self-correcting retry**. Without it, every PRP gap (missing context, wrong assumption, ambiguous requirement) becomes a permanent dead item that forces human intervention, while real implementation failures stay on the fix-and-retry path. This subtask is the **capstone** of the 4-subtask R2 chain: S1 (config) → S2 (signal) → S3 (feedback injection) → **S4 (the loop)**. S1/S2/S3 each shipped a seam; S4 is the only consumer that actually drives the re-planning behavior.
- **Scope boundary**: S4 owns the **orchestrator control flow** + the two small `ResearchQueue` helpers it needs (`researchNow` feedback threading + `deletePRP`). It does NOT change `ExecutionResult` (S2), the prompt/generator cache logic (S3), the config default (S1), or `TaskRetryManager` (a *different* retry dimension — transient infra errors, implementation_notes.md §3). It reuses each upstream seam verbatim.
- **Scope cohesion**: This is the final step of the issue-driven re-planning chain. It is the FIRST and only caller of `getIssueRetryMax()` (S1), the only branch on `result.outcome === 'issue'` + reader of `result.issueMessage` (S2), and the only caller of `generator.generate(task, backlog, issueFeedback)` via `researchNow` (S3). Closing R2.
- **Why reset to `Planned` (not `Failed`)**: PRD §4.5 — an `issue` is recoverable; the work is still valid, only the plan was wrong. Resetting to `Planned` keeps the item in the active queue. Dependents are NOT cancelled — they simply block until the re-planned item completes (the existing `waitForDependencies` already handles this).
- **Why a per-item `Map` counter (not `TaskRetryManager`)**: implementation_notes.md §3 is explicit — `ISSUE_RETRY_MAX` is an **orchestrator-level** counter (re-planning attempts), structurally separate from `TaskRetryManager.maxAttempts` (executor-level transient-infra retries with exponential backoff). Reusing `TaskRetryManager` would conflate the two dimensions.

## What

### User-visible behavior

None directly — this is internal orchestrator control flow. The observable effect is that a Coder-Agent `issue` outcome no longer permanently fails the item; instead the item is re-planned up to `ISSUE_RETRY_MAX` times (capturing the gap as `issue_feedback.md`, deleting the stale PRP, re-researching with the feedback injected) before hard-failing. A real `fail` outcome behaves exactly as before (`Failed`, fix-and-retry already attempted inside `executeWithRetry`).

### Technical requirements (the CONTRACT)

1. **The issue branch is additive and wraps the existing execution.** The success path (`result.success` → `Complete`) and the hard-fail path (`outcome === 'fail'`/`!result.success` without issue → `Failed`) are UNCHANGED in semantics. Only a NEW `outcome === 'issue'` branch is added, and the execution call is wrapped in an issue-bounded loop.
2. **`executeWithRetry` stays INSIDE the loop; the issue counter is OUTSIDE.** Each loop iteration calls `this.#retryManager.executeWithRetry(subtask, () => this.#prpRuntime.executeSubtask(subtask, this.#backlog))` (transient-infra retries happen per-iteration). The issue counter (`#issueAttempts` Map) accumulates across iterations. Do NOT move retry logic or change `TaskRetryManager`.
3. **The §4.5 sequence on `outcome === 'issue'` is, in order**: (a) increment the per-item counter; (b) **boundary check** — if `attempts > getIssueRetryMax()` → `setStatus(id, 'Failed', reason)` + log + `break` (hard-fail, NO re-plan); (c) else write `<sessionDir>/issue_feedback.md` via `atomicWrite` with `result.issueMessage` (fall back to a non-empty placeholder if undefined); (d) `await this.researchQueue.deletePRP(id)`; (e) `await this.setStatus(id, 'Planned', 'Issue-driven re-planning')`; (f) `await this.researchQueue.researchNow(subtask, this.#backlog, feedback)`; (g) `continue` (next loop iteration re-executes against the fresh, feedback-aware PRP).
4. **Boundary semantics (RESOLVED — see "Known Gotchas")**: `attempts++; if (attempts > getIssueRetryMax()) { hard-fail }`. With default 3, exactly 3 re-plans are permitted and the 4th issue hard-fails. With `ISSUE_RETRY_MAX='2'`, 2 re-plans permitted, 3rd issue hard-fails.
5. **`fail` outcomes do NOT route through re-planning.** When `result.outcome === 'fail'` (or `!result.success && outcome !== 'issue'`), keep the existing behavior: `setStatus(id, 'Failed', result.error)` and exit the loop. Do NOT write `issue_feedback.md`, do NOT delete the PRP, do NOT reset to `Planned`, do NOT call `researchNow`.
6. **Item identity + dependencies are preserved.** The item keeps its original `id`, `dependencies`, and all other fields. Only its PRP file (on disk + in-memory cache) and its `status` are reset. No background research on dependents is cancelled (they block via `waitForDependencies`).
7. **`ResearchQueue.researchNow(task, backlog, issueFeedback?)`** — optional 3rd param (LAST, optional). Thread to `this.#prpGenerator.generate(task, backlog, issueFeedback)`. The existing 2-arg behavior is byte-identical (issueFeedback `undefined`). Cache-write stays unconditional (overwrites with the feedback-aware PRP); cache-READ bypass is handled inside the generator (S3) — do NOT re-implement it here.
8. **`ResearchQueue.deletePRP(taskId): Promise<void>`** — (a) `this.results.delete(taskId)`; (b) `unlink(this.#prpGenerator.getCachePath(taskId))` ENOENT-tolerant; (c) `unlink(this.#prpGenerator.getCacheMetadataPath(taskId))` ENOENT-tolerant. Deleting BOTH the `.md` and the `.cache/*.json` guarantees the stale plan "cannot be reused" even if a later no-feedback generate runs; the metadata is also overwritten by the subsequent feedback re-research (belt-and-suspenders with S3's cache-read bypass). Never throws on a missing file.
9. **TDD + same-commit test updates** (implementation_notes.md §7): write the failing tests first; **UPDATE** the one existing `expect(mockGenerate).toHaveBeenCalledWith(task, backlog)` in `research-queue.test.ts` (~L1976) to `(task, backlog, undefined)` (vitest is strict on arg count — researchNow will now forward 3 args); update the existing orchestrator fallback test's `researchNow` 2-arg assertion to 3 args.
10. **Mode A docs**: the `docs/WORKFLOWS.md` "Issue-Driven Re-planning" subsection rides WITH this work (no standalone doc subtask). JSDoc on `researchNow`/`deletePRP` and on the new orchestrator loop explains the §4.5 semantics.

### Success Criteria

- [ ] `outcome === 'issue'` writes `<sessionDir>/issue_feedback.md` containing `result.issueMessage` (via `atomicWrite`).
- [ ] `outcome === 'issue'` calls `researchQueue.deletePRP(subtask.id)` (which unlinks the PRP `.md` + cache metadata + clears the in-memory `results` entry).
- [ ] `outcome === 'issue'` sets the item status to `Planned` (NOT `Failed`).
- [ ] `outcome === 'issue'` calls `researchQueue.researchNow(subtask, backlog, feedback)` — feedback forwarded as the 3rd arg.
- [ ] The item then re-executes (the loop continues); a subsequent `outcome === 'success'` ends at `Complete`.
- [ ] With `ISSUE_RETRY_MAX='2'`: `'issue'×2 then 'success'` → `Complete` (exactly 2 re-plans); `'issue'×3` → `Failed` (3rd issue: `3 > 2`); the failing iteration does NOT write feedback/deletePRP/Planned/researchNow.
- [ ] `outcome === 'fail'` (or `!success && outcome !== 'issue'`) → `setStatus Failed`, NO re-planning steps invoked.
- [ ] `TaskRetryManager` (`executeWithRetry`) is unchanged and still wraps each runtime call inside the loop.
- [ ] The item's original `id` + `dependencies` are unchanged across re-plans.
- [ ] `ResearchQueue.researchNow(task, backlog)` (no feedback) behaves byte-identically to today.
- [ ] `ResearchQueue.deletePRP(taskId)` is ENOENT-tolerant (no throw on a missing file).
- [ ] The existing `executeSubtask` success/fail tests + smart-commit tests still pass.
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all green, new + updated tests included).
- [ ] RED step observed before GREEN (failing test written before implementation — TDD).

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from the exact current `executeSubtask` execution block quoted below (the site to wrap), the exact `researchNow` body to extend (quoted), the exact generator/cache-path accessors (`getCachePath`/`getCacheMetadataPath`, quoted), the `atomicWrite` import, the upstream seam signatures (S1/S2/S3 — quoted), the verified test-mock wiring (the existing fallback test is a near-exact template), and the verified validation commands. Every reference resolves to a real file/line in the tree today. No inference required — it is a control-flow loop + two small helpers + a doc subsection.

### Documentation & References

```yaml
# MUST READ — the PRIMARY file edited (orchestrator loop)
- file: src/core/task-orchestrator.ts
  why: Contains executeSubtask (the method to extend). The execution section (~L680-747) is the exact site to wrap in the issue-bounded loop. setStatus(id, status, reason), #retryManager.executeWithRetry, #prpRuntime.executeSubtask, researchQueue.waitForPRP/researchNow, sessionManager.currentSession.metadata.path, and the smart-commit/flush tail are all already wired here.
  pattern: |
    # CURRENT execution section of executeSubtask (the block to refactor into a loop):
    try {
      try {
        await this.researchQueue.waitForPRP(subtask.id);
      } catch (error) {
        if (error instanceof ResearchTimeoutError) {
          this.#logger.info({ subtaskId: subtask.id }, 'Background research abandoned ...');
          await this.researchQueue.researchNow(subtask, this.#backlog);   // <-- S4 threads feedback here on re-plan
          ...
        } else { throw error; }
      }
      const result = await this.#retryManager.executeWithRetry(subtask, async () => {
        return await this.#prpRuntime.executeSubtask(subtask, this.#backlog);
      });
      ...
      if (result.success) {
        await this.setStatus(subtask.id, 'Complete', 'Implementation completed successfully');
      } else {
        await this.setStatus(subtask.id, 'Failed', result.error ?? 'Execution failed');
      }
      // smart-commit block + flushUpdates (UNCHANGED — runs after the loop)
    } catch (error) { /* setStatus Failed + rethrow — UNCHANGED */ }
    # The loop wraps ONLY from `const result = await this.#retryManager.executeWithRetry(...)`
    # through the if/else status block. waitForPRP/researchNow at the top stays (initial research).
  gotcha: |
    - Keep waitForPRP (initial research) OUTSIDE the loop — re-research on issue is done by researchNow inside the loop.
    - The smart-commit + flushUpdates tail runs AFTER the loop (once), keyed on the final result.
    - The outer try/catch (exception → Failed + rethrow) stays; the loop body is inside it.

# MUST READ — the second file edited (research-queue helpers)
- file: src/core/research-queue.ts
  why: researchNow (S4 extends with issueFeedback) + getCachePath/getCacheMetadataPath (via #prpGenerator) are here. S4 adds deletePRP.
  pattern: |
    # CURRENT researchNow (EXTEND — add optional 3rd param, thread to generate):
    async researchNow(task: TaskOrSubtask, backlog: Backlog): Promise<PRPDocument> {
      const cached = this.results.get(task.id);
      if (cached) return cached;
      const prp = await this.#prpGenerator.generate(task, backlog);   // <-- add issueFeedback as 3rd arg
      this.results.set(task.id, prp);
      return prp;
    }
    # NEW deletePRP (add): clears in-memory cache + unlinks disk PRP + metadata, ENOENT-tolerant.
  gotcha: |
    - researchNow's issueFeedback MUST be the LAST optional param (2-arg callers stay valid).
    - #prpGenerator is private but its getCachePath(taskId)/getCacheMetadataPath(taskId) are PUBLIC.
    - Cache-READ bypass on feedback is owned by the generator (S3) — do NOT re-implement in researchNow.
    - vitest with ToHaveBeenCalledWith is strict on arg COUNT → the existing researchNow test
      (`toHaveBeenCalledWith(task, backlog)`) MUST be updated to `(task, backlog, undefined)`.

# MUST READ — atomic write helper (import target)
- file: src/core/session-utils.ts
  why: atomicWrite(targetPath, data) is the public atomic write (temp + rename). S4 writes issue_feedback.md through it. PRD §5.1 + implementation_notes.md §8 confirm issue_feedback.md is IMPLICITLY protected (catch-all "$SESSION_DIR root" rule) — do NOT add it to PROTECTED_FILES.
  pattern: |
    import { atomicWrite } from './session-utils.js';   // in task-orchestrator.ts
    ...
    const sessionDir = this.sessionManager.currentSession!.metadata.path;
    await atomicWrite(join(sessionDir, 'issue_feedback.md'), feedback);
  gotcha: Use node:path `join` (already imported in many files) for the path. currentSession is guaranteed non-null here (executeSubtask already runs under an active session).

# MUST READ — the upstream config seam (S1, COMPLETE in tree)
- file: src/config/constants.ts
  why: getIssueRetryMax(): number (L252, verified) is the bound. Default 3; honors process.env[ISSUE_RETRY_MAX]; NaN/non-positive → default.
  pattern: |
    import { getIssueRetryMax } from '../config/constants.js';   // in task-orchestrator.ts
    const maxRetries = getIssueRetryMax();   // call once at loop entry (or per-check — it's cheap/pure)

# REFERENCE — the upstream signal (S2, treated complete) — what result.outcome/issueMessage look like
- file: plan/005_d32a2ecf61cd/P5M1T2S2/PRP.md
  why: Defines ExecutionResult.outcome?: 'success'|'fail'|'issue' + issueMessage?: string; invariant success === (outcome === 'success'). S4 branches on result.outcome === 'issue' and reads result.issueMessage.
  section: "What → Technical requirements (the CONTRACT)"

# REFERENCE — the upstream generator seam (S3, treated complete) — what researchNow forwards to
- file: plan/005_d32a2ecf61cd/P5M1T2S3/PRP.md
  why: Defines PRPGenerator.generate(task, backlog, issueFeedback?) — bypasses cache READ when feedback present, threads to the blueprint prompt. S4 calls this via researchNow(task, backlog, feedback). Confirms S4 edits research-queue.ts ("S4 will plumb feedback into the .generate(task, backlog, feedback) calls").
  section: "What → Technical requirements"

# MUST READ — test patterns to clone (orchestrator)
- file: tests/unit/core/task-orchestrator.test.ts
  why: (1) The vi.mock of ResearchQueue (L62) + PRPRuntime (L87) already stub enqueue/getPRP/processNext/waitForPRP/researchNow/executeSubtask — S4 ADDS deletePRP to the queue mock and overrides executeSubtask per-test with a mockResolvedValueOnce chain for the outcome sequence. (2) The "falls back to synchronous inline re-research" test (~L707) is the EXACT template: it grabs `orchestrator.researchQueue as any`, overrides waitForPRP/researchNow, executes, and asserts call counts + the final status via `(mockManager.updateItemStatus as any).mock.calls.at(-1)`.
  pattern: |
    # CLONE the fallback test structure for the issue-flow test:
    const queue = orchestrator.researchQueue as any;
    queue.waitForPRP = vi.fn().mockResolvedValue(undefined);
    queue.deletePRP = vi.fn().mockResolvedValue(undefined);
    queue.researchNow = vi.fn().mockResolvedValue({ id: 'fresh-prp' });
    const rt = orchestrator.prpRuntime as any;
    rt.executeSubtask = vi.fn()
      .mockResolvedValueOnce({ success:false, outcome:'issue', issueMessage:'missing /health contract', validationResults:[], artifacts:[], error:'missing /health contract', fixAttempts:0 })
      .mockResolvedValueOnce({ success:true, outcome:'success', validationResults:[], artifacts:[], fixAttempts:0 });
    await orchestrator.executeSubtask(subtask);
    expect(queue.deletePRP).toHaveBeenCalledWith(subtask.id);
    expect(queue.researchNow).toHaveBeenCalledWith(subtask, testBacklog, 'missing /health contract');
    expect(mockAtomicWrite).toHaveBeenCalledWith(expect.stringContaining('issue_feedback.md'), 'missing /health contract');
    expect((mockManager.updateItemStatus as any).mock.calls.at(-1)).toEqual([subtask.id, 'Complete']);
  gotcha: |
    - The default ResearchQueue mock (L62) does NOT include deletePRP — ADD it to the mock object (mockResolvedValue(undefined)).
    - vi.mock('../../../src/core/session-utils.js', ...) to stub atomicWrite (else it touches real FS). OR pass a fake path + mock atomicWrite.
    - Use mockResolvedValueOnce CHAINS to script the outcome sequence (issue×N then success/fail).
    - Stub ISSUE_RETRY_MAX via vi.stubEnv('ISSUE_RETRY_MAX','2') + afterEach(vi.unstubAllEnvs).

# MUST READ — test patterns to clone (research-queue) + the ONE assertion to UPDATE
- file: tests/unit/core/research-queue.test.ts
  why: (1) The researchNow block (L1944) is the template: MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate })); assert `mockGenerate).toHaveBeenCalledWith(task, backlog)`. S4 ADDS a feedback-forwarding test (assert 3rd arg) and UPDATES the existing 2-arg assertion to `(task, backlog, undefined)`. (2) Add a deletePRP describe block: seed results + stub getCachePath/getCacheMetadataPath on the mocked generator + assert unlink called + results cleared.
  pattern: |
    # UPDATE existing (L~1976) — researchNow now forwards 3 args:
    expect(mockGenerate).toHaveBeenCalledWith(task, backlog, undefined);
    # NEW forwarding test:
    it('should forward issueFeedback to generate as the 3rd arg', async () => {
      const mockGenerate = vi.fn().mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));
      const queue = new ResearchQueue(mockManager, DEFAULT_MAX_SIZE, DEFAULT_NO_CACHE, DEFAULT_CACHE_TTL_MS);
      const task = createTestSubtask('P1.M1.T1.S1','Test','Planned');
      await queue.researchNow(task, createTestBacklog([]), 'feedback forcing re-research');
      expect(mockGenerate).toHaveBeenCalledWith(task, createTestBacklog([]), 'feedback forcing re-research');
    });
  gotcha: The mock factory `() => ({ generate: mockGenerate })` must ALSO expose getCachePath + getCacheMetadataPath for the deletePRP tests (else deletePRP throws on undefined method).

# REFERENCE — the retry-dimension rule (do NOT conflate)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §3 — ISSUE_RETRY_MAX (orchestrator re-planning) ≠ TaskRetryManager.maxAttempts (executor transient infra). §7 — same-commit test updates. §8 — issue_feedback.md implicitly protected (no PROTECTED_FILES edit). §10 — validation gates.
  section: "§3, §7, §8, §10"

# REFERENCE — the feature cluster + R2 boundary
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R2 confirms S4 = orchestrator flow (delete PRP → Planned → re-research with feedback → bound by ISSUE_RETRY_MAX). Confirms issue_feedback.md implicit protection + the per-item counter in the orchestrator.
  section: "R2 (Issue-Driven Re-planning)"

# REFERENCE — PRD source of truth
- file: PRD.md
  why: §4.5 defines the 5-step issue-driven loop + "retries up to ISSUE_RETRY_MAX times before hard-fail" + "keep original ID + dependency links; dependents not cancelled". §9.2.2 defines ISSUE_RETRY_MAX default 3.
  section: "§4.5 The Issue-Driven Re-planning Loop" + "§9.2.2 Required Environment Variables"

# MUST READ — docs Mode A target (add the subsection here)
- file: docs/WORKFLOWS.md
  why: The "### Phase 4: Backlog Execution" section (~L334-375) is where execution-loop behavior is documented. Add a new "### Issue-Driven Re-planning" subsection immediately AFTER Phase 4's "Graceful Shutdown" block (before "### Phase 5: QA Cycle"). prettier checks docs/*.md — run `npm run format` then `npm run validate`.
  section: "### Phase 4: Backlog Execution (~L334) — insert after Graceful Shutdown, before Phase 5"
```

### Current Codebase tree (relevant slice)

```bash
src/core/
├── task-orchestrator.ts   # <-- EDIT: +#issueAttempts Map; issue-bounded loop in executeSubtask; +atomicWrite +getIssueRetryMax imports; private #handleIssueReplan helper (or inline)
├── research-queue.ts      # <-- EDIT: researchNow(+issueFeedback?); +deletePRP(taskId)
├── session-utils.ts       # <-- DO NOT TOUCH (import atomicWrite)
├── task-retry-manager.ts  # <-- DO NOT TOUCH (different retry dimension; §3)
└── session-manager.ts     # <-- DO NOT TOUCH

src/agents/
├── prp-executor.ts        # <-- DO NOT TOUCH (S2: ExecutionResult)
├── prp-runtime.ts         # <-- DO NOT TOUCH (S2: pass-through)
├── prp-generator.ts       # <-- DO NOT TOUCH (S3: generate(+issueFeedback?), getCachePath, getCacheMetadataPath)
└── prompts/prp-blueprint-prompt.ts  # <-- DO NOT TOUCH (S3: <issue_feedback> block)

src/config/
└── constants.ts           # <-- DO NOT TOUCH (S1: getIssueRetryMax)

tests/unit/core/
├── task-orchestrator.test.ts  # <-- EDIT: +issue-flow test, +exhaustion test, +fail-path test; UPDATE researchNow 2-arg→3-arg in fallback test; ADD deletePRP to queue mock; vi.mock session-utils (atomicWrite)
└── research-queue.test.ts     # <-- EDIT: +researchNow-feedback test, +deletePRP tests; UPDATE existing with ToHaveBeenCalledWith (2→3 args)

docs/
└── WORKFLOWS.md           # <-- EDIT: +"Issue-Driven Re-planning" subsection under Phase 4 (Mode A)
```

### Desired Codebase tree with files to be added/modified

```bash
src/core/
├── task-orchestrator.ts   # MODIFIED: issue-bounded loop + per-item counter + re-plan sequence
└── research-queue.ts      # MODIFIED: researchNow(+issueFeedback?), +deletePRP(taskId)

tests/unit/core/
├── task-orchestrator.test.ts  # MODIFIED: +issue/exhaustion/fail tests; mock + assertion updates
└── research-queue.test.ts     # MODIFIED: +feedback-forwarding + deletePRP tests; UPDATE arg assertion

docs/
└── WORKFLOWS.md           # MODIFIED: +"Issue-Driven Re-planning" subsection
```

> **File-placement decision**: All edits land in existing files — no new modules. The per-item counter is a private `Map` field on `TaskOrchestrator` (no new class). `deletePRP` lives on `ResearchQueue` (it owns `#prpGenerator.getCachePath`). No new types.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Boundary semantics. PRD §4.5 "retries up to N times" → exactly N re-plans permitted;
//   the (N+1)-th issue hard-fails. Implement: attempts++; if (attempts > getIssueRetryMax()) { hardFail }.
//   Default 3 → fail on 4th issue. stubEnv '2' → fail on 3rd issue. Do NOT use `>=` (that would allow only N-1 re-plans).

// CRITICAL: Keep executeWithRetry INSIDE the loop; the issue counter OUTSIDE (accumulates across iterations).
//   TaskRetryManager (transient infra) and ISSUE_RETRY_MAX (re-planning) are DIFFERENT dimensions (§3).

// CRITICAL: fail outcomes do NOT route through re-planning. outcome==='fail' (or !success && outcome!=='issue')
//   → setStatus Failed, break. No feedback file, no deletePRP, no Planned, no researchNow.

// CRITICAL: issueFeedback MUST be the LAST optional param on researchNow (2-arg callers stay valid).
//   vitest with ToHaveBeenCalledWith is strict on arg COUNT → UPDATE the existing researchNow test
//   (research-queue.test.ts ~L1976) AND the orchestrator fallback test's researchNow assertion to 3 args.

// CRITICAL: deletePRP must be ENOENT-tolerant. unlink throws ENOENT if the file is already gone
//   (e.g. no PRP was ever written, or re-research already replaced it). Catch and swallow ONLY ENOENT.
//   Pattern: try { await unlink(p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }

// CRITICAL: Delete BOTH the .md (getCachePath) AND the .cache/*.json (getCacheMetadataPath).
//   A stale metadata file could make #isCacheRecent return true on a later no-feedback generate even
//   after the .md is gone. Deleting both fully guarantees "cannot be reused". The subsequent feedback
//   re-research overwrites both anyway (S3 cache-write is unconditional) — belt-and-suspenders.

// CRITICAL: issue_feedback.md is IMPLICITLY protected (implementation_notes.md §8). Do NOT edit
//   PROTECTED_FILES in git-commit.ts. Writing it via atomicWrite is fine (it's a pipeline-owned artifact).

// GOTCHA: TS ESM source uses `.js` import specifiers in `.ts` files.
//   WRONG: import { atomicWrite } from './session-utils';
//   RIGHT: import { atomicWrite } from './session-utils.js';
//   WRONG: import { getIssueRetryMax } from '../config/constants';
//   RIGHT: import { getIssueRetryMax } from '../config/constants.js';

// GOTCHA: The default ResearchQueue mock in task-orchestrator.test.ts (L62) does NOT include deletePRP.
//   ADD `deletePRP: vi.fn().mockResolvedValue(undefined)` to the mock object, else the issue-flow test
//   throws on undefined method.

// GOTCHA: vi.mock('../../../src/core/session-utils.js', ...) to stub atomicWrite so the issue-flow test
//   does not touch the real filesystem. Assert `mockAtomicWrite` called with (pathContaining('issue_feedback.md'), feedback).
//   Pair with vi.unstubAllEnvs() in afterEach for the vi.stubEnv(ISSUE_RETRY_MAX,'2').

// GOTCHA: result.issueMessage may be undefined in edge cases. Use a non-empty fallback
//   (e.g. `result.issueMessage ?? 'Unspecified planning gap reported by Coder Agent'`) so atomicWrite
//   always writes meaningful content AND the researchNow feedback is never empty-string (which S3 treats
//   as "no feedback" — byte-identical normal path).

// GOTCHA: eslint requires JSDoc (@remarks/@param/@returns) on the new exported method deletePRP and on
//   the extended researchNow. Mirror the existing researchNow JSDoc style. Mode A docs live in WORKFLOWS.md.

// GOTCHA: prettier (npm run format:check) checks docs/*.md. After editing WORKFLOWS.md, run
//   `npm run format` (writes) then `npm run validate`. markdownlint (npm run docs:lint) also runs.
```

## Implementation Blueprint

### Data models and structure

No new data models. This subtask adds **one private `Map` field** on the orchestrator and **two small `ResearchQueue` methods**. Type safety comes from the existing `ExecutionResult.outcome` literal-union (S2) and `string` feedback.

```typescript
// === TaskOrchestrator: the per-item re-planning counter (private field) ===
/** Per-item issue-driven re-planning attempt counts (PRD §4.5). Bounded by getIssueRetryMax(). */
#issueAttempts: Map<string, number> = new Map();

// === TaskOrchestrator: the issue-bounded loop (inside executeSubtask, replacing the single execute) ===
// (The waitForPRP/researchNow initial-research block above this stays unchanged.)
const maxIssueRetries = getIssueRetryMax();
let finalResult: ExecutionResult;
// eslint-disable-next-line no-constant-condition -- bounded by internal break/continue
while (true) {
  const result = await this.#retryManager.executeWithRetry(subtask, async () => {
    return await this.#prpRuntime.executeSubtask(subtask, this.#backlog);
  });
  finalResult = result;

  if (result.success) {
    await this.setStatus(subtask.id, 'Complete', 'Implementation completed successfully');
    break;
  }

  if (result.outcome === 'issue') {
    // PRD §4.5 — recoverable planning gap. Bound by ISSUE_RETRY_MAX.
    const attempts = (this.#issueAttempts.get(subtask.id) ?? 0) + 1;
    this.#issueAttempts.set(subtask.id, attempts);

    if (attempts > maxIssueRetries) {
      this.#logger.warn(
        { subtaskId: subtask.id, attempts, maxIssueRetries },
        'Issue-driven re-planning exhausted; hard-failing item'
      );
      await this.setStatus(
        subtask.id,
        'Failed',
        `Issue-driven re-planning exhausted after ${maxIssueRetries} attempts: ${result.issueMessage ?? 'unspecified planning gap'}`
      );
      break;
    }

    // Re-plan sequence (PRD §4.5 steps 1-4):
    const feedback =
      result.issueMessage ?? 'Unspecified planning gap reported by Coder Agent';
    const sessionDir = this.sessionManager.currentSession!.metadata.path;
    // (1) Capture feedback
    await atomicWrite(join(sessionDir, 'issue_feedback.md'), feedback);
    this.#logger.info({ subtaskId: subtask.id }, 'Wrote issue_feedback.md for re-planning');
    // (2) Invalidate stale plan
    await this.researchQueue.deletePRP(subtask.id);
    // (3) Reset state (NOT Failed)
    await this.setStatus(subtask.id, 'Planned', 'Issue-driven re-planning');
    // (4) Re-research with feedback injected (S3 generator path, via researchNow)
    await this.researchQueue.researchNow(subtask, this.#backlog, feedback);
    this.#logger.info(
      { subtaskId: subtask.id, attempts },
      'Re-planning complete; re-executing with feedback-aware PRP'
    );
    continue; // next loop iteration re-executes against the fresh PRP
  }

  // outcome === 'fail' (real implementation failure) — existing path, NO re-planning
  await this.setStatus(subtask.id, 'Failed', result.error ?? 'Execution failed');
  break;
}
// (The existing smart-commit block + flushUpdates run here, keyed on finalResult — UNCHANGED.)

// === ResearchQueue: extend researchNow + add deletePRP ===
async researchNow(
  task: TaskOrSubtask,
  backlog: Backlog,
  issueFeedback?: string        // NEW (last, optional) — forwarded to generate (S3)
): Promise<PRPDocument> {
  const cached = this.results.get(task.id);
  if (cached) return cached;
  const prp = await this.#prpGenerator.generate(task, backlog, issueFeedback);
  this.results.set(task.id, prp);
  return prp;
}

async deletePRP(taskId: string): Promise<void> {
  // (a) clear in-memory cache
  this.results.delete(taskId);
  // (b) unlink the disk PRP file (ENOENT-tolerant)
  const prpPath = this.#prpGenerator.getCachePath(taskId);
  try {
    await unlink(prpPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // (c) unlink the cache-metadata JSON (ENOENT-tolerant) — prevents stale #isCacheRecent hits
  const metaPath = this.#prpGenerator.getCacheMetadataPath(taskId);
  try {
    await unlink(metaPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  this.#logger.debug({ taskId }, 'Deleted PRP file + cache metadata (issue-driven re-plan)');
}
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE failing tests in tests/unit/core/research-queue.test.ts  (RED — before Task 3)
  - UPDATE the existing "should generate synchronously inline and cache the result" test (~L1976):
      change `expect(mockGenerate).toHaveBeenCalledWith(task, backlog)` →
             `expect(mockGenerate).toHaveBeenCalledWith(task, backlog, undefined)`.
      (vitest is strict on arg count; researchNow will now forward 3 args.)
  - ADD a feedback-forwarding test inside `describe('researchNow', ...)`:
      it('should forward issueFeedback to generate as the 3rd arg', async () => {
        const mockGenerate = vi.fn().mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
        MockPRPGenerator.mockImplementation(() => ({
          generate: mockGenerate,
          getCachePath: (id: string) => `/plan/x/prps/${id.replace(/\./g,'_')}.md`,
          getCacheMetadataPath: (id: string) => `/plan/x/prps/.cache/${id.replace(/\./g,'_')}.json`,
        }));
        const queue = new ResearchQueue(createMockSessionManager(currentSession), DEFAULT_MAX_SIZE, DEFAULT_NO_CACHE, DEFAULT_CACHE_TTL_MS);
        const task = createTestSubtask('P1.M1.T1.S1', 'Test', 'Planned');
        await queue.researchNow(task, createTestBacklog([]), 'feedback forcing re-research');
        expect(mockGenerate).toHaveBeenCalledWith(task, createTestBacklog([]), 'feedback forcing re-research');
      });
  - ADD a `describe('deletePRP', ...)` block with ≥2 tests:
      (a) "should clear the in-memory results entry and unlink the PRP + metadata files":
          seed `(queue as any).results.set(task.id, prp)`; stub `vi.mock('node:fs/promises')` unlink OR spy on it;
          call `await queue.deletePRP(task.id)`; assert `queue.getPRP(task.id)` is null + unlink called with both paths.
      (b) "should not throw when the PRP file does not exist (ENOENT-tolerant)":
          make unlink reject with `{ code: 'ENOENT' }`; assert deletePRP resolves (no throw).
  - FOLLOW pattern: the existing researchNow tests (MockPRPGenerator.mockImplementation; SETUP/EXECUTE/VERIFY rhythm).
  - MOCKING: PRPGenerator is vi.mock'd; expose generate + getCachePath + getCacheMetadataPath on the mock impl.
      For unlink, either `vi.mock('node:fs/promises', ...)` at top (may be heavy) OR use vi.spyOn on the real
      module — prefer a focused `vi.mock` of fs/promises returning `{ unlink: vi.fn() }` and import the mocked unlink.
      NO network.
  - VERIFY IT FAILS FIRST: `npm run test:run -- research-queue` BEFORE Task 3 — the forwarding test fails (3rd arg
      not passed) + deletePRP tests fail (method missing). RED step.
  - PLACEMENT: tests/unit/core/research-queue.test.ts.

Task 2: WRITE failing tests in tests/unit/core/task-orchestrator.test.ts  (RED — before Task 4)
  - ADD `deletePRP: vi.fn().mockResolvedValue(undefined)` to the ResearchQueue mock object (~L75).
  - ADD `vi.mock('../../../src/core/session-utils.js', () => ({ atomicWrite: vi.fn().mockResolvedValue(undefined) }))`
      near the top + `import { atomicWrite } from '../../../src/core/session-utils.js'; const mockAtomicWrite = atomicWrite as any;`.
  - ADD `vi.stubEnv` discipline: the new tests call `vi.stubEnv('ISSUE_RETRY_MAX','2')`; add an `afterEach(() => vi.unstubAllEnvs())` (or per-test).
  - UPDATE the existing "falls back to synchronous inline re-research" test's researchNow assertion (~L758)
      `expect(queue.researchNow).toHaveBeenCalledWith(subtask, testBacklog)` → `(subtask, testBacklog, undefined)`.
  - ADD 3 tests inside `describe('executeSubtask', ...)`:
      (1) it('re-plans on outcome:issue — writes feedback, deletes PRP, resets to Planned, re-researches with feedback, then completes (PRD §4.5)', async () => {
            vi.stubEnv('ISSUE_RETRY_MAX','2');
            const queue = orchestrator.researchQueue as any;
            queue.waitForPRP = vi.fn().mockResolvedValue(undefined);
            queue.deletePRP = vi.fn().mockResolvedValue(undefined);
            queue.researchNow = vi.fn().mockResolvedValue({ id: 'fresh' });
            const rt = orchestrator.prpRuntime as any;
            rt.executeSubtask = vi.fn()
              .mockResolvedValueOnce({ success:false, outcome:'issue', issueMessage:'missing /health contract', validationResults:[], artifacts:[], error:'missing /health contract', fixAttempts:0 })
              .mockResolvedValueOnce({ success:true, outcome:'success', validationResults:[], artifacts:[], fixAttempts:0 });
            await orchestrator.executeSubtask(subtask);
            expect(mockAtomicWrite).toHaveBeenCalledWith(expect.stringContaining('issue_feedback.md'), 'missing /health contract');
            expect(queue.deletePRP).toHaveBeenCalledWith(subtask.id);
            expect(queue.researchNow).toHaveBeenCalledWith(subtask, testBacklog, 'missing /health contract');
            const statuses = (mockManager.updateItemStatus as any).mock.calls.map((c:any)=>c[1]);
            expect(statuses).toContain('Planned');            // reset happened
            expect(statuses.at(-1)).toBe('Complete');          // eventually completed
            expect(rt.executeSubtask).toHaveBeenCalledTimes(2);// re-executed once after re-plan
          });
      (2) it('hard-fails the item after ISSUE_RETRY_MAX issue outcomes are exceeded (PRD §4.5)', async () => {
            vi.stubEnv('ISSUE_RETRY_MAX','2');
            // 3 issues → 3 > 2 → hard-fail on the 3rd (2 re-plans done, no 3rd re-plan)
            const queue = orchestrator.researchQueue as any;
            queue.waitForPRP = vi.fn().mockResolvedValue(undefined);
            queue.deletePRP = vi.fn().mockResolvedValue(undefined);
            queue.researchNow = vi.fn().mockResolvedValue({ id:'fresh' });
            const rt = orchestrator.prpRuntime as any;
            const issue = { success:false, outcome:'issue', issueMessage:'gap', validationResults:[], artifacts:[], error:'gap', fixAttempts:0 };
            rt.executeSubtask = vi.fn().mockResolvedValue(issue); // always issue
            await orchestrator.executeSubtask(subtask);
            const statuses = (mockManager.updateItemStatus as any).mock.calls.map((c:any)=>c[1]);
            expect(statuses.at(-1)).toBe('Failed');             // hard-failed
            expect(queue.deletePRP).toHaveBeenCalledTimes(2);    // exactly 2 re-plans (issues 1 & 2)
            expect(queue.researchNow).toHaveBeenCalledTimes(2);
            expect(rt.executeSubtask).toHaveBeenCalledTimes(3);  // 3rd issue → fail, no further execute
          });
      (3) it('routes a fail outcome through the existing Failed path without re-planning', async () => {
            const queue = orchestrator.researchQueue as any;
            queue.waitForPRP = vi.fn().mockResolvedValue(undefined);
            queue.deletePRP = vi.fn();
            queue.researchNow = vi.fn();
            const rt = orchestrator.prpRuntime as any;
            rt.executeSubtask = vi.fn().mockResolvedValue({ success:false, outcome:'fail', validationResults:[], artifacts:[], error:'boom', fixAttempts:2 });
            await orchestrator.executeSubtask(subtask);
            expect((mockManager.updateItemStatus as any).mock.calls.at(-1)).toEqual([subtask.id,'Failed']);
            expect(queue.deletePRP).not.toHaveBeenCalled();
            expect(queue.researchNow).not.toHaveBeenCalled();
            expect(mockAtomicWrite).not.toHaveBeenCalled();
          });
  - FOLLOW pattern: the existing "falls back to synchronous inline re-research" test (L707) — same mock-wiring +
      `mock.calls.at(-1)` status assertion rhythm. createMockSessionManager + createTestSubtask helpers already exist.
  - MOCKING: orchestrator.researchQueue + orchestrator.prpRuntime overridden per-test; atomicWrite mocked at module
      level; ISSUE_RETRY_MAX via vi.stubEnv. NO network, NO real FS.
  - VERIFY IT FAILS FIRST: `npm run test:run -- task-orchestrator` BEFORE Task 4 — the issue-flow test fails (no
      issue branch yet → item goes straight to Failed) + the existing fallback researchNow assertion fails (arg count).
      RED step.
  - PLACEMENT: tests/unit/core/task-orchestrator.test.ts.

Task 3: MODIFY src/core/research-queue.ts  (makes Task 1 GREEN)
  - STEP 3a: EXTEND `researchNow(task, backlog, issueFeedback?: string)` — add the optional LAST param; change the
      generate call to `this.#prpGenerator.generate(task, backlog, issueFeedback)`. Update the JSDoc `@param issueFeedback`.
  - STEP 3b: ADD `async deletePRP(taskId: string): Promise<void>` per "Data models and structure" above: results.delete
      + ENOENT-tolerant unlink of getCachePath + getCacheMetadataPath. Import `unlink` from `node:fs/promises`.
      Add Mode-A JSDoc (@remarks: clears in-memory + disk PRP + metadata; ENOENT-tolerant; PRD §4.5 step 2).
  - GOTCHA: Do NOT touch the generator's cache logic (S3) — researchNow only forwards issueFeedback.
  - GOTCHA: Do NOT change waitForPRP/processNext/enqueue (P5.M1.T1.x territory).
  - PLACEMENT: src/core/research-queue.ts.

Task 4: MODIFY src/core/task-orchestrator.ts  (makes Task 2 GREEN)
  - STEP 4a: ADD imports: `import { atomicWrite } from './session-utils.js';`, `import { getIssueRetryMax } from '../config/constants.js';`,
      and `join` from `node:path` (add to existing path import if not present), and `ExecutionResult` type from
      `../agents/prp-executor.js` (for the finalResult typing — type-only import).
  - STEP 4b: ADD the private field `#issueAttempts: Map<string, number> = new Map();` (with JSDoc).
  - STEP 4c: REFACTOR the execution section of `executeSubtask`: keep the `waitForPRP`/`researchNow` initial-research
      block UNCHANGED at the top of the try; REPLACE the single `const result = await this.#retryManager.executeWithRetry(...)`
      + the `if (result.success) {...} else {...}` block with the issue-bounded `while(true)` loop from "Data models
      and structure". The smart-commit block + flushUpdates (which reference `result`) must now reference `finalResult`.
      The outer try/catch is UNCHANGED.
  - STEP 4d: Ensure the smart-commit + flushUpdates tail runs ONCE after the loop (success, hard-fail, or fail all
      reach it). Verify the commit message still uses `${subtask.id}: ${subtask.title}`.
  - GOTCHA: waitForPRP stays OUTSIDE the loop (initial research only). Re-research on issue is `researchNow(...,feedback)` INSIDE the loop.
  - GOTCHA: Do NOT change executePhase/executeMilestone/executeTask/processNextItem.
  - GOTCHA: Use `result.issueMessage ?? '<fallback>'` so atomicWrite content + researchNow feedback are never ''.
  - PLACEMENT: src/core/task-orchestrator.ts.

Task 5: MODIFY docs/WORKFLOWS.md  (Mode A doc-with-work)
  - ADD a new "### Issue-Driven Re-planning" subsection immediately AFTER Phase 4's "Graceful Shutdown" block
      (~L375, before "### Phase 5: QA Cycle"). Content (~40-60 lines):
      - A short intro: the Coder Agent reports a tri-state outcome per subtask — `success`, `fail`, or `issue`.
        An `issue` is a RECOVERABLE PLANNING GAP (PRP insufficient but work valid), deliberately distinct from a
        hard `fail` (implementation problem → existing fix-and-retry path). Cross-ref PRD §4.5.
      - The 5-step flow as a numbered/ordered list: (1) Capture feedback → `<sessionDir>/issue_feedback.md`;
        (2) Invalidate stale plan → delete the PRP file + cache metadata; (3) Reset state → `Planned` (NOT Failed);
        (4) Re-research with feedback injected → the blueprint prompt carries a `<issue_feedback>` block;
        (5) Bound the loop → up to `ISSUE_RETRY_MAX` (default 3) re-plans before hard-fail.
      - A note on status interaction: the item keeps its original ID + dependency links; dependents are NOT
        cancelled — they block until the re-planned item completes (existing `waitForDependencies`).
      - A note distinguishing `ISSUE_RETRY_MAX` (orchestrator re-planning) from `TaskRetryManager.maxAttempts`
        (executor transient-infra retries) — two independent retry dimensions.
      - Cross-ref §9.2.2 for the env var + the CONFIGURATION.md row (S1).
  - GOTCHA: prettier + markdownlint check docs/*.md. Run `npm run format` then `npm run validate` then `npm run docs:lint`.
  - PLACEMENT: docs/WORKFLOWS.md (under "### Phase 4: Backlog Execution").

Task 6: VERIFY (validation gates — run after Tasks 3, 4, 5)
  - RUN: `npm run validate` (eslint . --ext .ts + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier --check fails on WORKFLOWS.md or new code, run `npm run format` (writes) then re-run `npm run validate`.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the new issue/exhaustion/fail/deletePRP/feedback tests
      + the updated arg-count assertions.
  - RUN: `npm run docs:lint` — expect zero markdownlint errors on WORKFLOWS.md.
  - GREP-VERIFY scope: `git diff --stat` must show ONLY the 5 files (task-orchestrator.ts, research-queue.ts, their 2
      unit tests, WORKFLOWS.md). `git diff src/agents/prp-executor.ts src/agents/prp-runtime.ts src/agents/prp-generator.ts
      src/agents/prompts/prp-blueprint-prompt.ts src/agents/prompts.ts src/config/constants.ts src/core/task-retry-manager.ts`
      must be EMPTY.
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the issue-bounded loop skeleton (the core of this subtask) ===
// waitForPRP/researchNow initial research STAYS above this loop (unchanged).
const maxIssueRetries = getIssueRetryMax();
let finalResult: ExecutionResult;
// eslint-disable-next-line no-constant-condition
while (true) {
  const result = await this.#retryManager.executeWithRetry(subtask, async () => {
    return await this.#prpRuntime.executeSubtask(subtask, this.#backlog);
  });
  finalResult = result;

  if (result.success) { /* Complete; break */ }
  if (result.outcome === 'issue') {
    const attempts = (this.#issueAttempts.get(subtask.id) ?? 0) + 1;
    this.#issueAttempts.set(subtask.id, attempts);
    if (attempts > maxIssueRetries) { /* hard-fail; break */ }
    const feedback = result.issueMessage ?? 'Unspecified planning gap reported by Coder Agent';
    await atomicWrite(join(this.sessionManager.currentSession!.metadata.path, 'issue_feedback.md'), feedback);
    await this.researchQueue.deletePRP(subtask.id);
    await this.setStatus(subtask.id, 'Planned', 'Issue-driven re-planning');
    await this.researchQueue.researchNow(subtask, this.#backlog, feedback);
    continue; // re-execute against the fresh, feedback-aware PRP
  }
  // outcome === 'fail' → existing Failed path; break (NO re-planning)
}
// smart-commit + flushUpdates here, keyed on finalResult.

// === PATTERN: ENOENT-tolerant unlink (deletePRP) ===
try { await unlink(path); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

// === PATTERN: outcome sequence stubbing (test) ===
rt.executeSubtask = vi.fn()
  .mockResolvedValueOnce({ success:false, outcome:'issue', issueMessage:'gap', validationResults:[], artifacts:[], error:'gap', fixAttempts:0 })
  .mockResolvedValueOnce({ success:true,  outcome:'success', validationResults:[], artifacts:[], fixAttempts:0 });
```

### Integration Points

```yaml
ORCHESTRATOR (the change):
  - extend: src/core/task-orchestrator.ts executeSubtask → issue-bounded loop + #issueAttempts Map + re-plan sequence
  - imports: atomicWrite (session-utils.js), getIssueRetryMax (config/constants.js), join (node:path), ExecutionResult type

RESEARCH QUEUE (the helpers the loop calls):
  - extend: src/core/research-queue.ts researchNow(+issueFeedback?) → threads to #prpGenerator.generate(task, backlog, issueFeedback)
  - add: src/core/research-queue.ts deletePRP(taskId) → results.delete + ENOENT-tolerant unlink(getCachePath + getCacheMetadataPath)

DOCUMENTATION (Mode A, rides with the work):
  - add to: docs/WORKFLOWS.md → "### Issue-Driven Re-planning" subsection under Phase 4

NOT TOUCHED (scope guardrails):
  - src/agents/prp-executor.ts, src/agents/prp-runtime.ts                              # S2: ExecutionResult tri-state
  - src/agents/prp-generator.ts, src/agents/prompts/prp-blueprint-prompt.ts, prompts.ts # S3: feedback injection + cache-read bypass
  - src/config/constants.ts                                                            # S1: getIssueRetryMax
  - src/core/task-retry-manager.ts                                                     # different retry dimension (§3)
  - src/core/session-utils.ts, src/core/session-manager.ts                             # import targets only
  - src/utils/git-commit.ts                                                            # issue_feedback.md implicitly protected (§8)

CONSUMES (upstream seams — treated complete):
  - S1: getIssueRetryMax(): number (default 3)
  - S2: ExecutionResult.outcome + ExecutionResult.issueMessage; success === (outcome === 'success')
  - S3: PRPGenerator.generate(task, backlog, issueFeedback?) (cache-read bypass on feedback)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 3 (research-queue) + Task 4 (task-orchestrator) + Task 5 (WORKFLOWS.md):
npm run validate
# = eslint . --ext .ts && prettier --check "**/*.{ts,js,json,md,yml,yaml}" && tsc --noEmit
# Expected: zero errors. If prettier --check fails on WORKFLOWS.md or the new code, run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: missing JSDoc on the new deletePRP / extended researchNow — add @remarks/@param.
# Common failure: `join` not imported from node:path in task-orchestrator.ts — add to the existing import.

npm run docs:lint     # markdownlint on docs/**/*.md (WORKFLOWS.md)
# Expected: zero errors.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 3) — MUST fail first (TDD):
npm run test:run -- research-queue
# Expected: the forwarding test fails (3rd arg not passed) + deletePRP tests fail (method missing).

# RED step (after Task 2, before Task 4) — MUST fail first (TDD):
npm run test:run -- task-orchestrator
# Expected: the issue-flow test fails (no issue branch → item goes straight Failed), the exhaustion test fails,
#   and the existing fallback researchNow assertion fails (arg count mismatch).

# GREEN step (after Task 3 + Task 4):
npm run test:run -- research-queue
npm run test:run -- task-orchestrator
# Expected: all green incl. the new tests + the updated arg-count assertions.

# Full suite (confirm no backward-compat regression — esp. smart-commit + fallback + parallel-executor tests):
npm run test:run
# Expected: all green. If smart-commit tests fail, the loop's finalResult plumbing broke the commit/flush tail.
#   If the fallback test fails, the researchNow 3-arg update was missed.
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the existing execution-loop integration tests still pass (success/fail paths unchanged):
npm run test:run -- task-orchestrator
npm run test:run -- research-queue
npm run test:run -- prp-runtime
npm run test:run -- prp-generator
# Expected: all green (S2/S3 seams consumed correctly; no behavioral regression on success/fail).

# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/core/task-orchestrator.ts, src/core/research-queue.ts,
#           tests/unit/core/task-orchestrator.test.ts, tests/unit/core/research-queue.test.ts, docs/WORKFLOWS.md.

git diff src/agents/prp-executor.ts src/agents/prp-runtime.ts src/agents/prp-generator.ts src/agents/prompts/prp-blueprint-prompt.ts src/agents/prompts.ts src/config/constants.ts src/core/task-retry-manager.ts src/utils/git-commit.ts
# Expected: EMPTY (all untouched — S1/S2/S3 territory + retry-manager + protected-files).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Boundary-exhaustiveness check — the loop branches on all three outcomes:
grep -n "outcome === 'issue'\|result.success\|outcome === 'fail'" src/core/task-orchestrator.ts
# Expected: all three branches present (success → Complete; issue → re-plan-or-hard-fail; fail → Failed).

# Counter-check — the per-item Map + the boundary use the > comparator:
grep -n "#issueAttempts\|attempts > maxIssueRetries\|getIssueRetryMax" src/core/task-orchestrator.ts
# Expected: the field decl + the read/increment + the boundary check all present.

# ENOENT-tolerance check — deletePRP swallows only ENOENT:
grep -n "ENOENT" src/core/research-queue.ts
# Expected: two guards (one per unlink) — both `(error as NodeJS.ErrnoException).code !== 'ENOENT'`.

# Docs check — the subsection exists + cross-refs PRD §4.5 + ISSUE_RETRY_MAX:
grep -n "Issue-Driven Re-planning\|§4.5\|ISSUE_RETRY_MAX" docs/WORKFLOWS.md
# Expected: ≥3 matches — the heading, the §4.5 cross-ref, the ISSUE_RETRY_MAX mention.

# End-to-end smoke via the test harness (no network — mocks only): the Task 2 tests script the full
# issue→re-plan→success and issue→exhaustion→fail flows. Running them is the integration validation:
npm run test:run -- task-orchestrator 2>&1 | grep -c "issue"
# Expected: ≥3 (the three new tests reference "issue" in their titles/assertions).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; new + updated tests included).
- [ ] `npm run docs:lint` passes (WORKFLOWS.md markdownlint clean).
- [ ] RED step observed before GREEN (issue/deletePRP tests failed before Tasks 3+4 — TDD).

### Feature Validation

- [ ] `outcome === 'issue'` writes `<sessionDir>/issue_feedback.md` (via `atomicWrite`) with `result.issueMessage`.
- [ ] `outcome === 'issue'` calls `researchQueue.deletePRP(subtask.id)` (clears results + unlinks `.md` + `.cache/*.json`).
- [ ] `outcome === 'issue'` sets status to `Planned` (NOT `Failed`).
- [ ] `outcome === 'issue'` calls `researchQueue.researchNow(subtask, backlog, feedback)` (feedback as 3rd arg).
- [ ] The loop re-executes after a re-plan; a subsequent `success` ends at `Complete`.
- [ ] With `ISSUE_RETRY_MAX='2'`: `'issue'×2 then 'success'` → `Complete` (2 re-plans); `'issue'×3` → `Failed` (3rd issue: 3>2); the failing iteration performs NO re-plan steps.
- [ ] `outcome === 'fail'` → `setStatus Failed`, NO feedback/deletePRP/Planned/researchNow.
- [ ] `TaskRetryManager.executeWithRetry` still wraps each runtime call inside the loop (unchanged).
- [ ] Item's original `id` + `dependencies` unchanged across re-plans.
- [ ] `researchNow(task, backlog)` (no feedback) is byte-identical to today.
- [ ] `deletePRP(taskId)` is ENOENT-tolerant.

### Code Quality Validation

- [ ] Boundary uses `attempts > getIssueRetryMax()` (not `>=`); exactly N re-plans permitted.
- [ ] `#issueAttempts` is a private `Map<string, number>` on the orchestrator (not TaskRetryManager).
- [ ] `researchNow`'s `issueFeedback` is the LAST optional param (2-arg callers stay valid).
- [ ] `deletePRP` unlinks BOTH `getCachePath` and `getCacheMetadataPath` (cannot be reused).
- [ ] `result.issueMessage ?? '<fallback>'` — atomicWrite content + researchNow feedback are never `''`.
- [ ] File placement matches the desired tree (only the 5 files touched).
- [ ] ESM import specifiers use `.js` extensions in source/tests; `join` from `node:path`.
- [ ] JSDoc on `researchNow`, `deletePRP`, and the `#issueAttempts` field follows the file's existing style.

### Documentation & Deployment

- [ ] `docs/WORKFLOWS.md` "Issue-Driven Re-planning" subsection describes the tri-state + the 5-step flow + the `ISSUE_RETRY_MAX` bound + the retry-dimension distinction + cross-refs PRD §4.5/§9.2.2.

---

## Anti-Patterns to Avoid

- ❌ Don't use `attempts >= getIssueRetryMax()` — that allows only N-1 re-plans, violating PRD §4.5 "retries up to N times". Use `attempts > max` (fail on the (N+1)-th issue).
- ❌ Don't route `fail` outcomes through re-planning — `fail` = real implementation failure → existing `Failed` path + `TaskRetryManager` (implementation_notes.md §3). Only `issue` triggers re-planning.
- ❌ Don't conflate `ISSUE_RETRY_MAX` with `TaskRetryManager.maxAttempts` — they are DIFFERENT retry dimensions (re-planning vs transient infra). Keep `executeWithRetry` INSIDE the loop; the counter OUTSIDE.
- ❌ Don't reset the item to `Failed` on `issue` — PRD §4.5 mandates `Planned` (recoverable). `Failed` is only for hard-fail (exhaustion) or real `fail`.
- ❌ Don't cancel background research on dependents — they block via `waitForDependencies` until the re-planned item completes. Only the offending item's PRP is deleted.
- ❌ Don't make `deletePRP` throw on a missing file — unlink's ENOENT must be swallowed (the PRP may never have been written, or re-research already replaced it).
- ❌ Don't delete only the `.md` — also unlink the `.cache/*.json` metadata, else a stale `#isCacheRecent` could resurrect the stale plan on a later no-feedback generate.
- ❌ Don't forget the `with ToHaveBeenCalledWith` arg-count updates — vitest is strict; `researchNow` now forwards 3 args. Update `research-queue.test.ts` (~L1976) AND the orchestrator fallback test.
- ❌ Don't add `issue_feedback.md` to `PROTECTED_FILES` — it's implicitly protected by the catch-all `$SESSION_DIR root` rule (implementation_notes.md §8). Editing `git-commit.ts` is out of scope.
- ❌ Don't re-implement the cache-read bypass in `researchNow` — that's owned by the generator (S3). `researchNow` only forwards `issueFeedback`.
- ❌ Don't move `waitForPRP` inside the loop — it's the INITIAL research only. Re-research on issue is `researchNow(...,feedback)`.
- ❌ Don't write the implementation before the failing tests (breaks implicit-TDD; implementation_notes.md §7).
- ❌ Don't touch `src/agents/*` (S2/S3), `src/config/constants.ts` (S1), `src/core/task-retry-manager.ts` (§3), or `src/utils/git-commit.ts` (§8).
- ❌ Don't use `.ts` import specifiers in source/test — ESM requires `.js` (tsc/vitest resolve via moduleResolution).
- ❌ Don't hand-edit WORKFLOWS.md without running `npm run format` + `npm run validate` + `npm run docs:lint` (prettier + markdownlint check docs/*.md).

---

## Success Metrics

**Confidence Score: 8/10** — This is the most behaviorally complex subtask in the R2 chain (a control-flow loop with a boundary, four re-plan steps, and three outcome branches), but every reference resolves to a real file/line in the tree today and the contract is explicit about each step. The upstream seams (S1 `getIssueRetryMax`, S2 `outcome`/`issueMessage`, S3 `generate(+issueFeedback)`) are all implemented/in-flight with verbatim signatures. The existing "falls back to synchronous inline re-research" test is a near-exact template for the new issue-flow tests (same mock-wiring via `orchestrator.researchQueue as any` + `mock.calls.at(-1)` status assertions + `mockResolvedValueOnce` outcome sequences). Residual risks are bounded and explicitly guarded: (a) the boundary `>` vs `>=` semantics — resolved against PRD §4.5 and locked by the `ISSUE_RETRY_MAX='2'` exhaustion test (Level 4 grep + the exhaustion test catch a slip); (b) the two `with ToHaveBeenCalledWith` arg-count updates — Level 2 RED on both test files surfaces them immediately; (c) the smart-commit/flush tail plumbing from the removed `result` var to `finalResult` — Level 2's smart-commit tests + the full `npm run test:run` catch a regression; (d) `deletePRP` ENOENT-tolerance — the dedicated ENOENT test covers it; (e) the parallel subtasks S2/S3 edit disjoint files (prp-executor/prp-runtime vs prp-generator/blueprint-prompt) — zero overlap with task-orchestrator/research-queue. The retry-dimension discipline (§3) and the implicit-protection rule (§8) are called out to prevent the two most likely scope-creep mistakes. One-pass success is likely with careful attention to the loop/tail refactor and the boundary comparator.
