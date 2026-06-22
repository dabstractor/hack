# Research Notes — P5.M1.T2.S4 (Orchestrator issue-handling flow)

## Upstream contracts (S1/S2/S3 — treated as COMPLETE when S4 runs)

| Subtask | Status | Provides (consumed by S4) | File |
|---------|--------|---------------------------|------|
| S1 | Complete | `getIssueRetryMax(): number` (default 3) | `src/config/constants.ts` L252 (verified) |
| S2 | parallel→done | `ExecutionResult.outcome?: 'success'\|'fail'\|'issue'` + `ExecutionResult.issueMessage?: string`; `success === (outcome === 'success')` | `src/agents/prp-executor.ts` + `prp-runtime.ts` (pass-through) |
| S3 | parallel→done | `PRPGenerator.generate(task, backlog, issueFeedback?)` — bypasses cache READ when feedback present; `createPRPBlueprintPrompt(...,issueFeedback?)` | `src/agents/prp-generator.ts` + `prompts/prp-blueprint-prompt.ts` |

## Key code facts verified by reading the tree

### `TaskOrchestrator.executeSubtask` (src/core/task-orchestrator.ts)
- Current execution site (~L680-747): `waitForPRP` (deadline-guarded, P5.M1.T1.S3 done) → `executeWithRetry(subtask, () => prpRuntime.executeSubtask(...))` → `if (result.success) setStatus Complete else setStatus Failed` → smartCommit → flushUpdates.
- `retryManager.executeWithRetry` wraps the runtime call for **transient infra** retries (delta_impact §3) — it does NOT retry on `success===false`. So an `issue` result passes through unchanged. The issue loop wraps AROUND executeWithRetry.
- `this.sessionManager.currentSession.metadata.path` = the session dir (confirmed in prp-runtime.ts constructor — same access pattern).
- `this.researchQueue` is a public readonly field (test overrides it via `orchestrator.researchQueue as any`).

### `ResearchQueue` (src/core/research-queue.ts) — S4 edits here (S3 PRP green-lit it)
- `researchNow(task, backlog)` (P5.M1.T1.S3) exists; calls `this.#prpGenerator.generate(task, backlog)` and caches in `results` Map. **S4 extends signature to `researchNow(task, backlog, issueFeedback?)`** → thread to `.generate(task, backlog, issueFeedback)`.
- `results: Map<string, PRPDocument>` = in-memory cache; `getPRP(taskId)` reads it; `clearCache()` clears ALL (too broad — need per-task).
- `#prpGenerator` is private but has PUBLIC `getCachePath(taskId)` (L229) = `{sessionPath}/prps/{sanitized}.md` (`sanitized = taskId.replace(/\./g,'_')`) and `getCacheMetadataPath(taskId)` (L243) = `{sessionPath}/prps/.cache/{sanitized}.json`.
- **S4 adds `deletePRP(taskId)`**: `results.delete(taskId)` + `unlink(getCachePath)` + `unlink(getCacheMetadataPath)`, ENOENT-tolerant.

### `atomicWrite(targetPath, data)` (src/core/session-utils.ts)
- Public, temp-file+rename atomic pattern. S4 uses it to write `<sessionDir>/issue_feedback.md`.

### Retry-dimension discipline (implementation_notes.md §3)
- `ISSUE_RETRY_MAX` (orchestrator re-planning) ≠ `TaskRetryManager.maxAttempts` (executor transient-infra). Do NOT reuse TaskRetryManager for issue counting. Use a per-item `Map<string, number>` on the orchestrator.

## Boundary semantics (RESOLVED)
PRD §4.5 "Re-planning retries up to ISSUE_RETRY_MAX times before hard-fail" → exactly N re-plans permitted; the (N+1)-th issue hard-fails.
- Implementation: `attempts++; if (attempts > getIssueRetryMax()) { setStatus Failed; break; } else { re-plan; continue; }`
- Test (stubEnv ISSUE_RETRY_MAX='2'): 'issue'×2 then 'success' → Complete; 'issue'×3 → Failed (3rd issue: 3>2). Satisfies every concrete case in the MOCKING spec.

## Test fragility — MUST-UPDATE assertions (implementation_notes.md §7, same-commit)
1. `tests/unit/core/research-queue.test.ts` L~1976: `expect(mockGenerate).toHaveBeenCalledWith(task, backlog)` → must become `(task, backlog, undefined)` after researchNow passes a 3rd arg (vitest is strict on arg count).
2. `tests/unit/core/task-orchestrator.test.ts`: the existing fallback test asserts `researchNow` called with `(subtask, backlog)` (2 args) → update to 3 args.

## Mocking summary (no network — all vi.fn)
- Stub `orchestrator.researchQueue` (deletePRP, researchNow, waitForPRP) + `orchestrator.prpRuntime.executeSubtask` (return controlled outcome sequence via `mockResolvedValueOnce` chain: issue×N then success/fail).
- Stub `atomicWrite` (vi.mock session-utils) + assert called with `<sessionDir>/issue_feedback.md` + message.
- `vi.stubEnv(ISSUE_RETRY_MAX, '2')` + `afterEach(vi.unstubAllEnvs)`.
- Use a temp session dir OR a fake path string (atomicWrite is mocked, so no real FS needed).

## Scope guardrails (files NOT touched)
- prp-executor.ts, prp-runtime.ts (S2), prp-generator.ts, prp-blueprint-prompt.ts, prompts.ts (S3), constants.ts (S1), task-retry-manager.ts (different dimension).

## Files S4 edits (5)
1. `src/core/research-queue.ts` — `researchNow(+issueFeedback?)`, `+deletePRP(taskId)`.
2. `src/core/task-orchestrator.ts` — `+#issueAttempts: Map`, issue-bounded loop in executeSubtask, atomicWrite import.
3. `tests/unit/core/task-orchestrator.test.ts` — issue-flow + exhaustion + fail-path tests.
4. `tests/unit/core/research-queue.test.ts` — researchNow-feedback test + deletePRP tests + UPDATE existing arg assertion.
5. `docs/WORKFLOWS.md` — "Issue-Driven Re-planning" subsection (Mode A, under Phase 4).
