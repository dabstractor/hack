# Bug Fix Requirements

## Overview
Creative end-to-end QA of the 001 bugfix changeset against the PRD, focusing on whether the five 001 issues were actually fixed and on areas the 001 hunt under-covered (the delta-added-requirements path, classifier wiring, and commit-format compliance). The headline result: the 001 Critical (Issue 1 — added requirements dropped) is NOT actually fixed. The reorder + mergeBacklogs approach relocates the drop into the merge step: because the Architect numbers its output fresh from P1 (prompts.ts:134) with no view of the patched backlog, every added-requirement item collides by ID with the parent and is skipped by mergeBacklogs' ID-collision de-dup (backlog-merger.ts:217/153). I verified this empirically — a realistic architect output for a new 'Reporting' phase is dropped (`Reporting phase present? false`). The 001 integration test passes only because its fixture hand-crafts a non-colliding architect output (reused title + fresh milestone ID), masking the defect. Three further Major issues were found: (2) the COSMETIC/SUBSTANTIVE + CLEAN/DIRTY LLM classifiers (PRD §4.3 step 1) are fully implemented with correct protective defaults but are DEAD CODE — never invoked; detection is hash-only and the code's own JSDoc misrepresents this; (3) the §5.1 standardized task-prefix commit format and PRP_COMMIT_FORMAT toggle are entirely unimplemented and formatCommitMessage still prepends the explicitly-forbidden [PRP Auto] banner on every commit; (4) the test suite remains red (178 failing/21 files), so the §4.4 validation abort-on-failure gate cannot pass. Features verified CORRECT in this pass: executeBacklog hard-abort on empty backlog (001 Issue 5 — now throws a propagating SessionError above the try/catch), numbered bugfix/NNN_hash/ iterations + #detectInterruptedBugfix scanning (001 Issue 4), patchBacklog 'added' documented delegation (001 Issue 2 — though it delegates to the broken merge, BUG-001), the NO_ISSUES_FOUND.md marker fields (timestamp/session/tasks.json hash/agent), change-classifier protective defaults (in isolation), auth preflight invocation, and the include-resolver structure. Testing methods: empirical mergeBacklogs probes with realistic architect output, full `npx vitest run`, source control-flow tracing of handleDelta→spawnDeltaSession→decomposePRD and integrateIntoCurrentSessionResponse, and grep-based dead-code/contract verification.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

### Issue 1: Delta-session breakdown still drops ADDED requirements — mergeBacklogs treats architect ID collisions as duplicates
**Severity**: Critical
**ID**: BUG-001
**Location**: src/core/backlog-merger.ts:207 (main); skip branches at :217 (phase), :153 (milestone), :113 (task). Root cause is the architect's fresh ID numbering (src/agents/prompts.ts:134) combined with ID-collision de-dup. Consumers: src/workflows/prp-pipeline.ts:1345 (decomposePRD) and ~1050 (integrateIntoCurrentSessionResponse).

**Description**:
The 001 fix (Issue 1) reordered decomposePRD() and added mergeBacklogs() so delta sessions break down delta_prd.md and fold the architect's output into the patched backlog. But mergeBacklogs() de-duplicates Phase/Milestone items by ID collision (skipping any architect item whose ID already exists in the patched backlog), and the Architect agent assigns IDs fresh from P1/P1.M1 on every decomposition (TASK_BREAKDOWN_PROMPT format `"id": "P[#]"`, prompts.ts:134). The architect receives ONLY delta_prd.md and has no view of the patched backlog's ID space, so for any ADDED requirement it produces items numbered P1/P1.M1 that COLLIDE with the parent's existing P1/P1.M1. mergeBacklogs then SKIPS them (phase: backlog-merger.ts:217; milestone: backlog-merger.ts:153) — the added requirement is dropped (now with a warn, not silently, but the data loss is identical). This violates PRD §4.3 step 6 ('Identifies new requirements → Adds new tasks') and defeats the entire purpose of the 001 fix: new features added to a PRD are still never implemented. It affects BOTH response paths — the default delta session (decomposePRD → mergeBacklogs at prp-pipeline.ts:1345) and 'Integrate into current session' (integrateIntoCurrentSessionResponse → mergeBacklogs at prp-pipeline.ts:~1050) — because patchBacklog's 'added' case is now a documented no-op that delegates ALL added-requirement handling to this broken merge (task-patcher.ts). The 001 integration test (tests/integration/core/delta-breakdown-integration.test.ts) passes only because its fixture makeArchitectBacklog() is hand-crafted to avoid collisions: it reuses the patched phase TITLE 'Foundation' (so it merges by title) AND uses a *fresh* milestone ID 'P1.M2' (no collision). A real architect never produces that combination — it numbers from P1 and creates its own titles from the delta content. The existing mergeBacklogs unit test 'skips an architect phase whose id collides (despite a new title) and warns' even asserts the drop as 'correct', documenting the very behavior that loses added requirements.

**Steps to Reproduce**:
1. Build a patched (parent) backlog containing Phase P1 'Foundation' with milestone P1.M1.
2. Simulate the architect decomposing an ADDED requirement (a new 'Reporting' phase): it emits Phase id 'P1', title 'Reporting', milestone id 'P1.M1', title 'Reports' (architect has no knowledge of existing IDs → starts at P1 per prompts.ts:134).
3. Call mergeBacklogs(patched, architect) (src/core/backlog-merger.ts:207). Because title 'Reporting' is not in the patched phaseByTitle map AND id 'P1' already exists in existingIds, the architect phase hits the `else` branch at backlog-merger.ts:217 and is skipped with a warn. Result: 'Reporting' phase absent from merged backlog. (Verified empirically: a probe calling mergeBacklogs with this exact realistic input returned `Reporting phase present? false` and `New Reports milestone present? false`.) The same drop occurs for a new milestone under a title-matched phase when the architect's milestone ID collides (backlog-merger.ts:153).


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: COSMETIC/SUBSTANTIVE and CLEAN/DIRTY LLM change classifiers are dead code — never wired into PRD-change detection
**Severity**: Major
**ID**: BUG-002
**Location**: src/core/change-classifier.ts:206,257 (defined, uncalled); src/workflows/prp-pipeline.ts:784 (detection) + :846 (misleading JSDoc); src/core/session-manager.ts:1688 (hash-only hasSessionChanged)

**Description**:
PRD §4.3 step 1 requires detected PRD changes to be classified by an LLM-driven binary classifier (COSMETIC vs SUBSTANTIVE), with a parallel CLEAN/DIRTY classifier guarding generated artifacts (e.g. delta_prd.md), both failing to a protective default on exhaustion. classifyChangeWithRetry() and classifyArtifactWithRetry() are fully implemented with correct protective defaults (src/core/change-classifier.ts:206, 257), but they are NEVER CALLED anywhere in production code. The only references outside their own module are (a) a JSDoc comment in prp-pipeline.ts:846 that actively MISREPRESENTS the behavior — it claims 'a SUBSTANTIVE verdict from classifyChangeWithRetry() routes here. COSMETIC changes are skipped' — and (b) a constants.ts comment. The actual detection path is prp-pipeline.ts:784 `if (this.sessionManager.hasSessionChanged())` → handleDelta(), where hasSessionChanged() (session-manager.ts:1688) is a PURE HASH comparison. Consequently EVERY PRD change — including a whitespace-only COSMETIC edit — triggers a full delta session (DeltaAnalysisWorkflow + architect decomposition + task patching), wasting LLM tokens and, for a real COSMETIC change, pointlessly re-running the architect over a delta_prd.md. The CLEAN/DIRTY guard on delta_prd.md is likewise never applied, so a DIRTY/malformed delta PRD is consumed unprotected, contrary to PRD §4.3's protective requirement.

**Steps to Reproduce**:
1. `grep -rn 'classifyChangeWithRetry|classifyArtifactWithRetry' src/workflows src/core/session-manager.ts src/index.ts` — returns zero call sites (only the JSDoc comment at prp-pipeline.ts:846).
2. Read src/workflows/prp-pipeline.ts:784 and src/core/session-manager.ts:1688 — detection is hash-only, no classifier invocation.
3. Edit PRD.md with a whitespace-only change, run the pipeline → hasSessionChanged() returns true → handleDelta()/spawnDeltaSession() runs the full architect breakdown despite the change being COSMETIC (should have been skipped per the §4.3 contract the code claims to honor).

### Issue 2: Commit messages still carry the forbidden [PRP Auto] banner; PRP_COMMIT_FORMAT / task-prefix format (§5.1) is entirely unimplemented
**Severity**: Major
**ID**: BUG-003
**Location**: src/utils/git-commit.ts:108 (formatCommitMessage); smartCommit call sites at :508,:520,:525

**Description**:
PRD §5.1 'Commit Message Format (Standardized Task-Prefix)' explicitly states: 'The legacy [PRP Auto] banner and Conventional-Commit scope encoding MUST NOT be prepended. The task-prefix already encodes the item's position; layering both on top is redundant cruft and is the exact source of the [PRP Auto] … noise in the history.' It also mandates a standardized task-prefix `<phase>.<milestone>.<task>.<subtask>: <message>` with trailing-unused-level elision, and a PRP_COMMIT_FORMAT toggle (task-prefix default / plain). None of this is implemented: formatCommitMessage() (src/utils/git-commit.ts:108) UNCONDITIONALLY returns `[PRP Auto] ${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>` — prepending the exact banner the PRD forbids. `PRP_COMMIT_FORMAT` is referenced nowhere in src/, there is no task-prefix builder, and no trailing-level elision logic. Every smartCommit() path routes its message through this function (git-commit.ts:508, 520, 525), so the entire commit history carries the `[PRP Auto]` noise the PRD specifically tried to eliminate, and there is no way to opt into a clean hand-curated history (plain mode) or the machine-parseable task-prefix.

**Steps to Reproduce**:
1. `grep -rn 'PRP_COMMIT_FORMAT' src/` → no matches (configurability absent).
2. Read src/utils/git-commit.ts:108 — `return \`[PRP Auto] ${message}...\``.
3. Inspect git log: commits read `fix(pipeline): restore delta breakdown reachability via reorder` with no `<n.n.n.n>:` task-prefix, confirming the standardized format is not generated in practice.

### Issue 3: Test suite is still red (178 failing / 21 files) — the §4.4 validation abort-on-failure gate cannot pass
**Severity**: Major
**ID**: BUG-004
**Location**: Test suite root (vitest.config.ts); representative failures in tests/integration/prp-pipeline-shutdown.test.ts:117, tests/integration/coder-agent.test.ts:240, tests/integration/smart-commit.test.ts (PiHarness-not-initialized), tests/integration/pipeline-main-loop.test.ts

**Description**:
PRD §4.4 step 1 generates a validate.sh that runs the codebase's test suite and ABORTS the run on non-zero exit (before cleanup/commit/bug-hunt). The project's own suite currently fails: `npx vitest run` reports 178 failed | 6486 passed across 21 failed test files (exit 1). This is a continuation of 001 Issue 3 (297→178 after the P2.M3 fixture/mock fix), but it remains red, so any validate.sh that runs `npm test` aborts even when the production code is correct — making the validation gate unusable for its intended purpose and blocking the abort-on-failure path from ever reaching bug-hunt on a green build. The failures are a mix: some are environmental (integration suites failing with 'PiHarness not initialized. Call initialize() first.' and a non-linked node_modules/groundswell), some are test-rot (e.g. tests/integration/coder-agent.test.ts expecting pre-roles-refactor config like GLM-4.7 / maxTokens 4096 that the P2.M2 model-roles change invalidated), and some are genuine test bugs (tests/integration/prp-pipeline-shutdown.test.ts:117 spreading `process._events.SIGINT` which Node stores as a single function, throwing 'process._events.SIGINT is not iterable' and failing all 20 shutdown tests — so graceful-shutdown (§5.1) is effectively unvalidated). Regardless of cause, the suite as shipped is non-green.

**Steps to Reproduce**:
1. `npx vitest run --reporter=dot` → exits 1, 'Test Files 21 failed | 172 passed', 'Tests 178 failed | 6486 passed'.
2. Sample failing files: tests/integration/prp-pipeline-shutdown.test.ts (20/20), tests/integration/coder-agent.test.ts (24/30), tests/integration/pipeline-main-loop.test.ts (21/23), tests/integration/smart-commit.test.ts (7/15), tests/integration/core/task-orchestrator-e2e.test.ts (10/12).


## Minor Issues (Nice to Fix)
Small improvements or polish items.

None.

## Testing Summary
- Total bugs found: 4
- Critical: 1
- Major: 3
- Minor: 0

## Recommendations
- BUG-001 is the priority: fix mergeBacklogs so a new-TITLE architect item with a colliding ID is treated as a NEW item (re-map/renumber its ID against the patched ID space) rather than skipped — OR re-number the architect's output to avoid collisions before merging, OR pass the existing ID space into the architect prompt so it continues numbering. Add an integration test whose architect fixture numbers from P1 with a NEW title (the realistic case the current fixture avoids).
- Wire classifyChangeWithRetry() into the PRD-change detection path (prp-pipeline.ts:784) so COSMETIC changes skip the delta session, and wire classifyArtifactWithRetry() around delta_prd.md consumption; delete or correct the misleading JSDoc at prp-pipeline.ts:846.
- Implement PRP_COMMIT_FORMAT (task-prefix default with trailing-level elision, plain opt-out) and remove the unconditional [PRP Auto] prepend from formatCommitMessage per §5.1.
- Drive the test suite green: fix the prp-pipeline-shutdown process._events spreading, refresh coder-agent/roles-refactor expectations, and resolve the groundswell link / PiHarness-init setup so integration suites run — otherwise §4.4 validation can never pass.
