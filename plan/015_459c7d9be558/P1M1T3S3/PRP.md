# PRP — P1.M1.T3.S3: Generation-timeout / SIGINT rescue path for `smartCommit`

> Plan 015, PRD §5.1 "Commit Workflow Mechanics" → edge case **"Generation timeout / SIGINT: the in-flight
> generation is killed; the subsystem enters a rescue path that prints `TREE_SHA` + the manual recovery
> command so the snapshotted work is never lost."** This is the **rescue step** of the 3-subtask
> `smartCommit` rewrite. **S1** (landed) captures `PARENT_SHA` + freezes the index → `TREE_SHA`
> pre-generation. **S2** (in flight, CONTRACT) replaces `gitCommit` with `commit-tree` + CAS `update-ref`
> and adds `CommitCasRefusedError` + `formatCommitRecoveryRecipe` for the **CAS-refusal** edge case. **S3
> (THIS task)** adds the **interrupt rescue**: if the process is interrupted (SIGINT / SIGTERM / thrown
> escape) AFTER `write-tree` succeeded but BEFORE the CAS advanced HEAD, emit `TREE_SHA` + the manual
> recovery command so the snapshotted work is recoverable. `TREE_SHA` is an immutable git object (§5.2) —
> it survives any crash; the rescue makes recovery *discoverable*. Architecture:
> `plan/015_459c7d9be558/architecture/system_context.md §2.1 + §5.2`.

---

## Goal

**Feature Goal**: Add a generation-timeout / SIGINT rescue path to `smartCommit`
(`src/utils/git-commit.ts`). After S1 captures `treeSha`/`parentSha` and before S2's CAS advances HEAD,
hold a **rescue-state** (`{treeSha, parentSha, committed}`); register **phase-scoped SIGINT/SIGTERM
handlers** (mirroring `file-lock.ts` / `temp-prompt-cleanup.ts` — named, `@internal`-exported, injectable
`mockExit`) that, on a signal during the window, print `TREE_SHA` + the manual recovery command
(`git commit-tree [-p <PARENT_SHA>] -m "<your message>" <TREE_SHA> | xargs git update-ref HEAD`) to
stderr + log and then exit `130`/`143` (NOT suppressing the signal). Add a **try/finally complement** so a
genuine non-CAS thrown escape (timeout/unexpected error) during the window also emits the rescue. Flip
`committed = true` only on CAS success so the rescue never false-fires on the happy or fallback paths.
Cite the §5.1 edge-case sentence in JSDoc. `smartCommit`'s public signature is UNCHANGED.

**Deliverable**:
1. **`src/utils/git-commit.ts`** — (a) module-scoped `CommitRescueState` + `_commitRescue`; (b) NEW
   `formatCommitRescueRecipe({treeSha, parentSha})` (DISTINCT from S2's CAS-refusal
   `formatCommitRecoveryRecipe` — interrupt case has no `newSha`/message); (c) NEW `emitCommitRescue`;
   (d) NEW `onCommitRescueSignal(code, mockExit)` + named `onCommitRescueSIGINT`/`onCommitRescueSIGTERM`
   (mirror `file-lock.ts` `onLockCleanupSignal`/`onSIGINTCleanup` exactly); (e) the rescue wiring in
   `smartCommit` (set state → register handlers → wrap gen+commit in try/catch(re-throw)/finally → flip
   `committed` → unregister + conditional emit + clear); (f) JSDoc citing §5.1.
2. **`tests/unit/utils/git-commit.test.ts`** — unit tests for the recipe/emitter/handler (pure +
   injectable-mockExit), an integration test that a thrown escape during the window emits the rescue +
   returns `null`, a regression guard that the CAS-refusal path does NOT double-emit, and a guard that the
   happy/fallback paths do NOT emit.

**Success Definition**:
- A SIGINT/SIGTERM arriving during the window (treeSha held, `committed === false`) prints the rescue
  recipe (treeSha + the exact command) to `process.stderr` + `logger()` and exits `130`/`143`.
- A thrown escape (non-`CommitCasRefusedError`) during the window prints the rescue recipe and
  `smartCommit` returns `null`.
- The S2 CAS-refusal path (`CommitCasRefusedError`) does **NOT** trigger S3's rescue (S2 already logs its
  own recipe with `newSha`+message — no double-emit).
- The happy path (CAS success) and the fallback path (gen fails → placeholder commits) do **NOT** emit the
  rescue (`committed` is `true`).
- `TREE_SHA` + the manual recovery command appear verbatim in the recipe; rootless repo (`parentSha ===
  undefined`) omits `-p`.
- `smartCommit`'s signature/return unchanged (still `(sessionPath, message, options?) => Promise<string |
  null>`, throws `CommitCasRefusedError` per S2).
- `npm run test:run -- git-commit` GREEN (new rescue tests + all existing smartCommit tests); `npm run
  typecheck` exit 0; `npm run lint` + `npm run format:check` clean.

## User Persona

N/A — internal commit-subsystem safety path. Indirect "users" are the human operator who, on Ctrl-C or a
generation timeout during a commit, receives the `TREE_SHA` + recovery command instead of silently
orphaned snapshotted work; and the pipeline's survival/recovery commits, whose staged substance is now
guaranteed recoverable across an interrupt in the slow generation window.

## Why

- **Closes the last §5.1 commit edge case.** §5.1 enumerates four edge cases; S1 owns "unresolved merge
  conflicts" (write-tree fails → abort), S2 owns "HEAD moved during generation" (CAS refuses → recipe +
  non-zero exit), and **S3 owns "Generation timeout / SIGINT."** Without S3, an interrupt in the (slow)
  generation window leaves the snapshotted `TREE_SHA` orphaned in git's object store — recoverable in
  principle (`git fsck --lost-found`) but undiscoverable in practice. S3 makes it discoverable.
- **`TREE_SHA` is immutable — recovery is always *possible*; S3 makes it *actionable*.** Per
  `system_context.md §5.2`, the pipeline runs its OWN `write-tree`; the resulting tree object is pure with
  respect to refs/index and survives any crash (including SIGKILL, where no handler runs). S3 guarantees
  that wherever a handler/finally *can* run (SIGINT/SIGTERM/thrown-escape), the operator sees the exact
  `TREE_SHA` + the copy-paste recovery command.
- **Best-effort by necessity for hard kills.** A SIGKILL/OOM/segfault cannot run any handler (acknowledged
  in `temp-prompt-cleanup.ts`); for those, the immutable `TREE_SHA` + S1's debug log are the safety net.
  S3 covers everything that *can* be covered, and degrades gracefully where it can't.
- **Does not regress S2's CAS-refusal semantics.** The rescue is gated to exclude `CommitCasRefusedError`
  (S2's recipe already carries `newSha`+message); the two recipes are complementary, never duplicated.

## What

### User-visible behavior
None at the API surface (`smartCommit` signature unchanged). Observable changes: (1) a SIGINT/SIGTERM
during commit-message generation now prints a rescue recipe (treeSha + recovery command) to stderr before
the process exits `130`/`143`; (2) an unexpected throw during the generation window now logs the rescue
recipe and returns `null` (was: logged "Unexpected error" + returned `null`). The happy/fallback paths are
unchanged.

### Technical requirements (exact contract)

**NEW rescue state + helpers in `git-commit.ts`** (research §4–§5 — copy-ready):
- `interface CommitRescueState { readonly treeSha: string; readonly parentSha?: string; committed: boolean }`
  + `let _commitRescue: CommitRescueState | null = null;` (module-scoped; smartCommit is serial).
- `export function formatCommitRescueRecipe({treeSha, parentSha?}): string` — renders the recipe: a header
  citing the §5.1 edge case, `TREE_SHA`, `PARENT_SHA` (or rootless note), and the command
  `git commit-tree [-p <PARENT_SHA>] -m "<your message>" <TREE_SHA> | xargs git update-ref HEAD`
  (`-p` omitted when `parentSha` undefined). **Distinct from S2's `formatCommitRecoveryRecipe`** (which
  takes `newSha`+`message` for the CAS-refusal case) — do NOT touch S2's helper.
- `export function emitCommitRescue(rescue: CommitRescueState | null): void` — no-op if `!rescue ||
  rescue.committed`; else `formatCommitRescueRecipe` → `process.stderr.write(\`\n${recipe}\n\`)` (SYNC —
  survives an imminent `process.exit`) + `logger().error(recipe)`.
- `export function onCommitRescueSignal(code: number, mockExit: (code:number)=>void = c => process.exit(c)):
  void` — `emitCommitRescue(_commitRescue); mockExit(code);` (mirror `file-lock.ts` `onLockCleanupSignal`
  EXACTLY — the default `mockExit` is a function EXPRESSION that re-resolves `process.exit` at call time so
  a `vi.spyOn(process,'exit')` test is hit; NEVER `mockExit = process.exit`).
- `export function onCommitRescueSIGINT(): void { onCommitRescueSignal(130); }` (128+2) and
  `export function onCommitRescueSIGTERM(): void { onCommitRescueSignal(143); }` (128+15) — named wrappers
  (not inline arrows) so registration sites are coverable.

**`smartCommit` wiring** (research §6 — copy-ready), inserted right after S1's
`logger().debug({parentSha, treeSha}, 'Captured pre-generation snapshot')`:
- Set `_commitRescue = { treeSha, parentSha, committed: false }`.
- `process.on('SIGINT', onCommitRescueSIGINT); process.on('SIGTERM', onCommitRescueSIGTERM);`
- Wrap the EXISTING [message-gen block → S2 commit-tree → S2 CAS] span in:
  `let rescueEscape: unknown; try { …existing gen… …existing S2 commit…; if (_commitRescue)
  _commitRescue.committed = true; logger().info('Commit created: …'); return newSha; } catch (e) {
  rescueEscape = e; throw e; } finally { process.off('SIGINT', onCommitRescueSIGINT);
  process.off('SIGTERM', onCommitRescueSIGTERM); if (_commitRescue && !_commitRescue.committed &&
  !(rescueEscape instanceof CommitCasRefusedError)) emitCommitRescue(_commitRescue); _commitRescue = null; }`
- The message-gen block and S2's commit block are UNCHANGED — S3 only WRAPS them + manages rescue state.
- The outer try/catch is UNCHANGED (S2's `if (error instanceof CommitCasRefusedError) throw error; … return
  null;` stays) — S3's inner `catch(e){rescueEscape=e; throw e;}` re-throws so S2's outer logic governs.

**JSDoc (Mode A):** on `emitCommitRescue`/the rescue wiring, cite the §5.1 sentence verbatim ("Generation
timeout / SIGINT: the in-flight generation is killed; the subsystem enters a rescue path that prints
TREE_SHA + the manual recovery command so the snapshotted work is never lost"). Note best-effort for
SIGKILL/OOM (treeSha is still recoverable via `git fsck --lost-found`). Note the phase-scoped
registration + the exclusion of the CAS-refusal path.

### Success Criteria
- [ ] `CommitRescueState` + `_commitRescue` module state added; `_commitRescue` set after S1's capture,
      cleared in the `finally`, `committed` flipped only on CAS success.
- [ ] `formatCommitRescueRecipe` emits `TREE_SHA` + the exact command (rootless omits `-p`); distinct from
      S2's `formatCommitRecoveryRecipe`.
- [ ] `emitCommitRescue` writes stderr (sync) + `logger().error`; no-op when `committed` or no state.
- [ ] `onCommitRescueSignal`/`onCommitRescueSIGINT`/`onCommitRescueSIGTERM` mirror `file-lock.ts` exactly
      (named, `@internal`, injectable `mockExit = c => process.exit(c)`, exit 130/143).
- [ ] SIGINT/SIGTERM handlers registered phase-scoped (process.on after treeSha capture; process.off in
      finally).
- [ ] Thrown escape (non-CAS) during the window → rescue emitted + `smartCommit` returns `null`.
- [ ] CAS refusal (`CommitCasRefusedError`) does NOT double-emit S3's rescue.
- [ ] Happy path + fallback path do NOT emit the rescue.
- [ ] JSDoc cites the §5.1 edge-case sentence.
- [ ] `smartCommit` signature/return unchanged.
- [ ] `npm run test:run -- git-commit` GREEN; `npm run typecheck` exit 0; lint + format:check clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
vulnerable window (after S1's treeSha capture → before S2's CAS success), the canonical SIGINT-handler
pattern to mirror (`file-lock.ts:611-641`, verbatim), the phase-scoped registration convention
(`prp-pipeline.ts:541 → :2477`), the copy-ready recipe/emitter/handler code, the copy-ready `smartCommit`
wiring (try/catch-re-throw/finally with the `committed` flip + CAS-refusal exclusion), the conflict
analysis (pre-existing exit-130 handlers; S3 is additive), the test plan (every surface unit-testable via
injectable `mockExit` + a thrown-escape integration test + the double-emit regression guard), and the
verified validation commands are all below.

### Documentation & References
```yaml
# MUST READ — copy-ready recipe/emitter/handler + smartCommit wiring + conflict analysis + test plan
- docfile: plan/015_459c7d9be558/P1M1T3S3/research/rescue-path-design.md
  section: "1. The vulnerable window", "2. The canonical SIGINT-handler pattern", "3. Phase-scoped vs permanent",
           "4. The rescue-state design", "5. The rescue recipe", "6. smartCommit integration", "8. Test strategy"
  why: Every code change is copy-ready; the window, the pattern to mirror, the recipe text, the wiring, and the
        test plan are all concrete.
  critical: S3's recipe is DISTINCT from S2's formatCommitRecoveryRecipe (interrupt case: no newSha/message) —
        do NOT touch S2's helper. The CAS-refusal path MUST be excluded from S3's rescue (double-emit guard).

# AUTHORITATIVE SPEC — §5.1 edge case + §5.2 (treeSha immutable)
- docfile: PRD.md   # (provided in selected_prd_content §5.1 "Commit Workflow Mechanics" → "Edge cases")
  section: §5.1 "Generation timeout / SIGINT" edge-case sentence (verbatim — cite it in JSDoc) + the snapshot mechanics
  why: The exact recipe contract (TREE_SHA + manual recovery command), and that treeSha is immutable (survives any crash).

# ARCHITECTURE — the commit path + the immutability guarantee
- docfile: plan/015_459c7d9be558/architecture/system_context.md
  section: "2.1 The commit path", "5.2 The pipeline retains ownership of the commit"
  why: §2.1 confirms smartCommit → generateCommitMessage(retry/fallback) → commit is the slow window S3 wraps.
        §5.2 confirms the pipeline runs its OWN write-tree → treeSha is immutable (the rescue's foundation).

# PATTERN TO MIRROR — the canonical SIGINT handler (verbatim reference)
- file: src/core/file-lock.ts
  section: onLockCleanupSignal (L608-620), onSIGINTCleanup (L627), onSIGTERMCleanup (L635), process.on registrations (L639-641)
  why: S3's onCommitRescueSignal/onCommitRescueSIGINT/onCommitRescueSIGTERM mirror this EXACTLY (named, @internal,
        injectable mockExit default `c => process.exit(c)`, exit 130/143). temp-prompt-cleanup.ts:131-166 is the twin.
  gotcha: the mockExit default MUST be the function expression `c => process.exit(c)` (re-resolves at call time so a
        vi.spyOn(process,'exit') test hits) — NEVER `mockExit = process.exit` (bound ref defeats the spy).

# PREDECESSORS (read as CONTRACTS) — S1 produces parentSha/treeSha; S2 owns the CAS-refusal recipe + CommitCasRefusedError
- docfile: plan/015_459c7d9be558/P1M1T3S1/PRP.md
  section: "What → Technical requirements" (the pre-generation capture block — VERIFIED LANDED at git-commit.ts:700-723)
  why: S3 sets _commitRescue right after S1's `logger().debug({parentSha, treeSha}, 'Captured pre-generation snapshot')`.
  critical: S3 CONSUMES treeSha/parentSha — do NOT re-capture. S1's shared test defaults (parent-sha-0001/tree-sha-0001) are in place.
- docfile: plan/015_459c7d9be558/P1M1T3S2/PRP.md
  section: "What → Technical requirements" (commit-tree → CAS; outer catch re-throws CommitCasRefusedError; formatCommitRecoveryRecipe)
  why: S3 wraps S2's commit block. The CAS success path is where committed flips true; the CAS-refusal throw is what S3 must EXCLUDE.
  critical: S3 must import CommitCasRefusedError (from './errors.js') for the `rescueEscape instanceof CommitCasRefusedError` guard.
        Do NOT modify S2's commit block, its outer catch, or formatCommitRecoveryRecipe.

# EDIT TARGET — the rescue wiring + helpers + JSDoc
- file: src/utils/git-commit.ts
  section: smartCommit (insert after S1's pre-generation debug log ~L723; wrap the gen+commit span); add helpers near
           buildFallbackCommitMessage/restore_critical_files; JSDoc on emitCommitRescue + the rescue wiring
  why: The core edits. Anchor the insert on S1's `Captured pre-generation snapshot` debug log (stable; unique).
  gotcha: locate the gen+commit span by grep (`generateCommitMessage` … `gitCommitTree`/`gitCommit`), not line number
        (S1+S2+T2.S1 shift lines). The current file STILL calls gitCommit (S2 in flight) — wrap whatever the commit call is.

# TEST FILE
- file: tests/unit/utils/git-commit.test.ts
  section: mock factory (L20-29); vi.mocked refs; shared beforeEach (S1/S2 defaults); add a rescue describe
  why: Unit tests for the recipe/emitter/handler (pure + injectable mockExit) + the thrown-escape integration test +
        the double-emit regression guard + the no-emit-on-happy/fallback guard.
  gotcha: to trigger the thrown-escape rescue, mock gitCommitTree (post-S2) or gitDiff to `.mockRejectedValue(new Error(...))`
        so it THROWS (escapes the span, committed stays false, not CommitCasRefusedError). Do NOT break existing happy-path tests.

# FORMAT GATE
- command: "npm run test:run -- git-commit && npm run typecheck && npm run lint && npm run format:check"
  why: The project's standard gates (vitest scoped; tsc --noEmit -p tsconfig.build.json; eslint; prettier).
```

### Current Codebase tree (edit surface)
```bash
src/utils/git-commit.ts            # EDIT — rescue state + helpers + smartCommit wiring + JSDoc
  ├─ [S1 region: pre-generation capture (parentSha/treeSha) — VERIFIED LANDED]  # UNCHANGED
  ├─ CommitRescueState + _commitRescue (module-scoped)            ← NEW
  ├─ formatCommitRescueRecipe / emitCommitRescue                  ← NEW (@internal-exported)
  ├─ onCommitRescueSignal / onCommitRescueSIGINT / onCommitRescueSIGTERM  ← NEW (mirror file-lock.ts)
  └─ smartCommit:
       ├─ after S1 debug log: set _commitRescue + process.on(SIGINT/SIGTERM)        ← NEW
       ├─ try { [gen block] [S2 commit-tree→CAS]; committed=true; return newSha; }  # WRAPPED
       ├─ catch (e) { rescueEscape = e; throw e; }                                  ← NEW (inner)
       └─ finally { process.off; conditional emitCommitRescue; _commitRescue=null; }← NEW
tests/unit/utils/git-commit.test.ts # EDIT — recipe/emitter/handler tests + thrown-escape + double-emit guard + no-emit guards
```

### Desired Codebase tree with files to be changed
```bash
src/utils/git-commit.ts            # EDIT — rescue state + 5 helpers + smartCommit wiring + JSDoc
tests/unit/utils/git-commit.test.ts # EDIT — rescue unit + integration tests
# (no new files; smartCommit signature unchanged; S2's CommitCasRefusedError/formatCommitRecoveryRecipe consumed, not modified)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (distinct from S2): S3's formatCommitRescueRecipe is for the INTERRUPT case (no newSha, no message —
//   generation was killed before commit-tree ran). S2's formatCommitRecoveryRecipe is for the CAS-REFUSAL case
//   (HEAD moved; newSha + message known). They are DIFFERENT helpers — do NOT merge or touch S2's. S2 is in flight.

// CRITICAL (exclude the CAS path): the try/finally rescue MUST NOT fire on CommitCasRefusedError — S2 already logs
//   its own recipe (with newSha+message) before throwing. Guard: `!(rescueEscape instanceof CommitCasRefusedError)`.
//   Import CommitCasRefusedError from './errors.js' (S2 adds it) for the instanceof check.

// CRITICAL (committed flip timing): set `_commitRescue.committed = true` ONLY on the CAS-success return path (before
//   `return newSha`). If you flip it too early (e.g., after commit-tree, before CAS), a CAS refusal would suppress the
//   rescue — but S2 handles CAS its own way, so that's acceptable; however the HAPPY/FALLBACK no-emit guarantee depends
//   on committed being false until CAS truly succeeds. The fallback path commits the placeholder via the SAME plumbing
//   → committed flips true → no rescue (correct).

// CRITICAL (mockExit default): the handler's mockExit MUST default to the function expression `c => process.exit(c)`,
//   NOT `process.exit` (bound reference). A vi.spyOn(process,'exit') test only hits the expression form. Mirror file-lock.ts.

// GOTCHA (phase-scoped registration): use process.on at window-open + process.off in the finally (prp-pipeline pattern),
//   NOT permanent module-load registration (file-lock/temp-prompt pattern). The rescue is only meaningful in the window;
//   phase-scoping avoids a redundant exit-130 vote outside it. The handler ALSO self-guards on _commitRescue.

// GOTCHA (stderr must be SYNC): use process.stderr.write (synchronous), NOT console.error or logger alone, for the recipe
//   — the process may exit 130 a millisecond later; async/buffered logs (§9.6) may not flush. Write stderr AND logger.

// GOTCHA (best-effort for SIGKILL/OOM): no handler/finally runs on SIGKILL/OOM/segfault/power-loss (temp-prompt-cleanup
//   acknowledges this). treeSha is still recoverable via `git fsck --lost-found` (immutable object). S3 covers what CAN run.

// GOTCHA (locate by grep, not line number): S1+S2+T2.S1 (parallel) shift lines. Anchor the insert on S1's
//   `Captured pre-generation snapshot` debug log; wrap the span from the message-gen block through the commit call.

// GOTCHA (don't widen scope): S3 does NOT modify S1's capture, S2's commit block, S2's outer catch, formatCommitRecoveryRecipe,
//   the message-gen/retry/fallback block, staging, restore_critical_files, or the smartCommit signature. It only ADDS rescue
//   state/helpers and WRAPS the gen+commit span.
```

## Implementation Blueprint

### Data models and structure
No new public data models. `CommitRescueState` (internal interface) + `_commitRescue` (module-scoped
mutable) + 5 `@internal` helpers. `smartCommit`'s signature/return unchanged. `CommitCasRefusedError`
(S2) is consumed (imported) for the instanceof guard, not modified.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/utils/git-commit.ts — imports + rescue state + helpers
  - (a) IMPORT: add CommitCasRefusedError to the existing errors import (S2 added it; S3 needs it for the
        instanceof guard). (If S2 hasn't exported it yet, the import resolves once S2 lands — treat S2 as landed.)
  - (b) STATE: add `interface CommitRescueState {…}` + `let _commitRescue: CommitRescueState | null = null;`
        (module-scoped, near buildFallbackCommitMessage).
  - (c) HELPERS: add `formatCommitRescueRecipe`, `emitCommitRescue`, `onCommitRescueSignal`,
        `onCommitRescueSIGINT`, `onCommitRescueSIGTERM` — COPY-READY in research §5 + §2. Mark `@internal`.
        onCommitRescueSignal mirrors file-lock.ts onLockCleanupSignal EXACTLY (injectable mockExit default
        `c => process.exit(c)`).
  - DO NOT: touch S2's formatCommitRecoveryRecipe; change smartCommit's signature.

Task 2: EDIT src/utils/git-commit.ts — the smartCommit rescue wiring
  - (a) Right after S1's `logger().debug({parentSha, treeSha}, 'Captured pre-generation snapshot')`:
        set `_commitRescue = { treeSha, parentSha, committed: false }`; `process.on('SIGINT', onCommitRescueSIGINT)`;
        `process.on('SIGTERM', onCommitRescueSIGTERM)`.
  - (b) WRAP the existing [message-gen block → S2 commit-tree → S2 CAS] span in:
        `let rescueEscape: unknown; try { …existing… ; if (_commitRescue) _commitRescue.committed = true;
        logger().info(\`Commit created: ${newSha}\`); return newSha; } catch (e) { rescueEscape = e; throw e; }
        finally { process.off('SIGINT', onCommitRescueSIGINT); process.off('SIGTERM', onCommitRescueSIGTERM);
        if (_commitRescue && !_commitRescue.committed && !(rescueEscape instanceof CommitCasRefusedError))
        emitCommitRescue(_commitRescue); _commitRescue = null; }`
        (COPY-READY in research §6.) The message-gen block + S2 commit block are UNCHANGED.
  - (c) JSDoc (Mode A): cite the §5.1 "Generation timeout / SIGINT" sentence on emitCommitRescue + the wiring;
        note best-effort for SIGKILL/OOM (treeSha recoverable via git fsck); note the CAS-refusal exclusion.
  - DO NOT: modify S1's capture, S2's commit block, S2's outer catch (the inner catch RE-THROWS so S2's outer
        logic governs), formatCommitRecoveryRecipe, the message-gen/retry/fallback block, or the signature.

Task 3: EDIT tests/unit/utils/git-commit.test.ts — rescue unit + integration tests
  - (a) UNIT — formatCommitRescueRecipe: assert the string contains treeSha, parentSha (or rootless note), and the
        exact command `git commit-tree -p <PARENT_SHA> -m "<your message>" <TREE_SHA> | xargs git update-ref HEAD`;
        rootless (parentSha undefined) omits `-p`.
  - (b) UNIT — emitCommitRescue: spy process.stderr.write + logger(); emits iff state held && !committed; no-op
        when committed===true or null.
  - (c) UNIT — onCommitRescueSignal: `const exit = vi.fn(); onCommitRescueSignal(130, exit);
        expect(exit).toHaveBeenCalledWith(130);` + assert rescue was emitted (set _commitRescue via a test
        helper or by exercising smartCommit). Mirror how file-lock/temp-prompt test their handlers.
  - (d) INTEGRATION — thrown-escape rescue: mock gitCommitTree (post-S2) or gitDiff to
        `.mockRejectedValue(new Error('boom'))` → smartCommit returns null AND logger().error spy contains treeSha
        + the command. (committed stays false; not CommitCasRefusedError → rescue fires.)
  - (e) REGRESSION — CAS refusal does NOT double-emit: mock gitUpdateRefCAS → {success:false, casFailure:true} →
        rejects.toThrow(CommitCasRefusedError) AND assert S3's rescue recipe string is NOT in the log (S2's is).
  - (f) GUARD — happy path + fallback path do NOT emit: happy (commit succeeds) → rescue spy NOT called; fallback
        (generateCommitMessage rejects → exhausts retry → placeholder commits) → committed=true → rescue NOT called.
  - PRESERVE: all existing smartCommit tests (they still get a hash / null as before; the wrapper is transparent on
        the happy path because committed flips true before return).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the handler mirrors file-lock.ts onLockCleanupSignal EXACTLY (research §2)
export function onCommitRescueSignal(
  code: number,
  mockExit: (code: number) => void = c => process.exit(c), // ← expression, re-resolves at call time (spy-friendly)
): void {
  emitCommitRescue(_commitRescue);
  mockExit(code); // 130=SIGINT, 143=SIGTERM (128+signum)
}
export function onCommitRescueSIGINT(): void  { onCommitRescueSignal(130); }
export function onCommitRescueSIGTERM(): void { onCommitRescueSignal(143); }

// PATTERN: the rescue wiring in smartCommit (research §6) — wrap gen+commit, flip committed, exclude CAS
_commitRescue = { treeSha, parentSha, committed: false };
process.on('SIGINT', onCommitRescueSIGINT);
process.on('SIGTERM', onCommitRescueSIGTERM);
let rescueEscape: unknown;
try {
  // …existing message-gen (generateMessage? retry/fallback → formattedMessage)…   UNCHANGED
  // …existing S2 commit-tree → CAS…                                              UNCHANGED
  if (_commitRescue) _commitRescue.committed = true; // window CLOSED only on CAS success
  logger().info(`Commit created: ${newSha}`);
  return newSha;
} catch (e) {
  rescueEscape = e;
  throw e; // re-throw → S2's outer catch governs (re-throws CommitCasRefusedError; else null)
} finally {
  process.off('SIGINT', onCommitRescueSIGINT);
  process.off('SIGTERM', onCommitRescueSIGTERM);
  if (_commitRescue && !_commitRescue.committed && !(rescueEscape instanceof CommitCasRefusedError)) {
    emitCommitRescue(_commitRescue); // SIGINT/timeout/unexpected-throw rescue (NOT CAS refusal)
  }
  _commitRescue = null;
}

// PATTERN: emitCommitRescue writes stderr (SYNC) + logger (research §5)
export function emitCommitRescue(rescue: CommitRescueState | null): void {
  if (!rescue || rescue.committed) return;
  const recipe = formatCommitRescueRecipe({ treeSha: rescue.treeSha, parentSha: rescue.parentSha });
  process.stderr.write(`\n${recipe}\n`); // synchronous — survives an imminent process.exit(130)
  logger().error(recipe);
}

// GOTCHA (above): S3's recipe ≠ S2's recipe (interrupt vs CAS-refusal). Don't merge.
// GOTCHA (above): exclude CommitCasRefusedError from the finally rescue or S2 + S3 both emit (double recipe).
// GOTCHA (above): mockExit default must be `c => process.exit(c)` (expression), not `process.exit` (bound ref).
```

### Integration Points
```yaml
IMPORTS (src/utils/git-commit.ts):
  - add: CommitCasRefusedError to the existing errors import (for the instanceof guard; S2 exports it)

NEW SYMBOLS (src/utils/git-commit.ts — all @internal-exported, matching file-lock.ts convention):
  - "interface CommitRescueState" + "let _commitRescue" (module-scoped)
  - "function formatCommitRescueRecipe({treeSha, parentSha?})"   # DISTINCT from S2's formatCommitRecoveryRecipe
  - "function emitCommitRescue(rescue)"
  - "function onCommitRescueSignal(code, mockExit?)" + "onCommitRescueSIGINT" + "onCommitRescueSIGTERM"

SMARTCOMMIT WIRING (after S1's treeSha capture; wraps the gen+commit span):
  - set _commitRescue + process.on(SIGINT/SIGTERM)
  - try { gen + S2-commit; committed=true; return newSha; }
  - catch (e) { rescueEscape=e; throw e; }
  - finally { process.off; conditional emitCommitRescue (exclude CAS); _commitRescue=null; }

DOWNSTREAM CONSUMERS: none — S3 is the final subtask of the smartCommit rewrite.

NONE OF: S1's capture, S2's commit block / outer catch / formatCommitRecoveryRecipe / CommitCasRefusedError class,
         the message-gen/retry/fallback block, formatCommitMessage, staging, restore_critical_files, the smartCommit
         signature, PRD.md, spec/**, **/tasks.json, src/core/{file-lock,temp-prompt-cleanup}.ts (the PATTERN sources — read-only).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0 (CommitCasRefusedError import resolves post-S2)
npm run lint             # eslint — clean
npm run format:check     # prettier — clean (run `npm run format` if it flags)
# Expected: zero errors.
```

### Level 2: Unit Tests (the PRIMARY gate)
```bash
npm run test:run -- git-commit
# EXPECTED: GREEN.
#   - formatCommitRescueRecipe: treeSha/parentSha + exact command; rootless omits -p.
#   - emitCommitRescue: emits iff !committed && state held.
#   - onCommitRescueSignal(130, vi.fn()): exit called with 130; rescue emitted.
#   - thrown-escape rescue: gitCommitTree/gitDiff rejects → null + rescue recipe logged.
#   - CAS refusal: rejects.toThrow(CommitCasRefusedError) + S3 rescue NOT in log (no double-emit).
#   - happy/fallback: rescue NOT emitted.
#   - ALL existing smartCommit tests GREEN (the wrapper is transparent on the happy path: committed flips before return).
# If an existing happy-path test regresses: committed is not flipped before the successful return (check Task 2b),
#   or the wrapper accidentally changed the gen/commit block (it must be byte-unchanged inside the try).
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm the rescue wiring is positioned + the helpers exist + the CAS exclusion is present.
grep -nE "_commitRescue|onCommitRescueSIGINT|onCommitRescueSIGTERM|emitCommitRescue|formatCommitRescueRecipe|CommitCasRefusedError" src/utils/git-commit.ts
# Expected: _commitRescue set after the snapshot debug log; onCommitRescueSIGINT/SIGTERM registered + unregistered;
#   emitCommitRescue called in the finally gated on `!(rescueEscape instanceof CommitCasRefusedError)`.
# Confirm S2's recipe helper is UNTOUCHED (distinct from S3's).
grep -nE "formatCommitRecoveryRecipe|formatCommitRescueRecipe" src/utils/git-commit.ts
# Expected: BOTH present (S2's recovery + S3's rescue) — neither modified by S3.
# Confirm smartCommit's signature is unchanged.
grep -nE "export async function smartCommit" src/utils/git-commit.ts
git status --porcelain | grep -E '^\s*[AM]\s+(PRD\.md|spec/|.*tasks\.json|prd_snapshot)' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no PRD/spec/tasks files modified"
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual rescue proof on a throwaway repo (no agent/LLM): set _commitRescue + invoke the handler with an injectable exit.
npx tsx -e "
import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { gitWriteTree, gitRevParseHead } from './src/tools/git-mcp.js';
const t = mkdtempSync(join(tmpdir(),'rescue-')); const g = (await import('simple-git')).default(t);
await g.init(); await g.add('.'); await g.commit('init'); writeFileSync(join(t,'f.txt'),'v2'); await g.add('.');
const parent = (await gitRevParseHead(t)).sha; const tree = (await gitWriteTree(t)).treeSha;
// Exercise the rescue path in isolation: format the recipe + verify the command is copy-paste-runnable.
const { formatCommitRescueRecipe } = await import('./src/utils/git-commit.js');
const recipe = formatCommitRescueRecipe({ treeSha: tree, parentSha: parent });
console.log(recipe);
// Prove the recipe's command ACTUALLY recovers the snapshot:
const cmd = recipe.split('\n').find(l => l.trim().startsWith('git commit-tree'))!.trim().replace('<your message>','rescued').replace('| xargs git update-ref HEAD','');
console.log('recovery command:', cmd);
"
# Expected: the recipe prints TREE_SHA + PARENT_SHA + the command; the command shape is exactly
#   `git commit-tree -p <PARENT_SHA> -m "<your message>" <TREE_SHA> | xargs git update-ref HEAD`.
#   (The full end-to-end SIGINT-during-smartCommit behavior is proven by the Level-2 integration test,
#   which mocks the thrown escape; the handler's exit-130 behavior is proven by the injectable-mockExit unit test.)
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 typecheck/lint/format:check clean.
- [ ] Level 2 `npm run test:run -- git-commit` GREEN (rescue unit + integration + double-emit guard + no-emit guards; all existing tests).
- [ ] Level 3 grep confirms rescue wiring positioned; S2's helper untouched; signature unchanged.
- [ ] Level 4 recipe renders the exact command; command shape is copy-paste-runnable.

### Feature Validation
- [ ] SIGINT/SIGTERM during the window → rescue recipe (treeSha + command) to stderr+log → exit 130/143 (not suppressed).
- [ ] Thrown escape (non-CAS) during the window → rescue emitted + smartCommit returns null.
- [ ] CAS refusal (`CommitCasRefusedError`) does NOT trigger S3's rescue (no double-emit; S2's recipe stands).
- [ ] Happy path + fallback path do NOT emit the rescue (`committed` flips true).
- [ ] Recipe contains TREE_SHA + the exact `git commit-tree … | xargs git update-ref HEAD` command; rootless omits `-p`.

### Code Quality Validation
- [ ] Handlers mirror `file-lock.ts` exactly (named, `@internal`, injectable `mockExit = c => process.exit(c)`, 130/143).
- [ ] `formatCommitRescueRecipe` is DISTINCT from S2's `formatCommitRecoveryRecipe`; S2's helper unmodified.
- [ ] Phase-scoped process.on/off (registered at window-open, unregistered in finally); handler self-guards on `_commitRescue`.
- [ ] stderr write is synchronous (survives imminent exit); logger ALSO called.
- [ ] `committed` flips true ONLY on CAS success; rescue state cleared in finally on every path.
- [ ] JSDoc cites the §5.1 "Generation timeout / SIGINT" sentence; notes best-effort for SIGKILL/OOM.

### Documentation & Deployment
- [ ] No docs files in this task (Mode-B sweep is P3 — separate milestone).
- [ ] No env-var / config additions.

---

## Anti-Patterns to Avoid
- ❌ Don't merge S3's `formatCommitRescueRecipe` with S2's `formatCommitRecoveryRecipe` — they're different cases (interrupt: no newSha/message vs CAS-refusal: newSha+message known). S2 is in flight; don't touch its helper.
- ❌ Don't let the try/finally rescue fire on `CommitCasRefusedError` — S2 already logs its own recipe before throwing. Guard with `!(rescueEscape instanceof CommitCasRefusedError)` or you double-emit.
- ❌ Don't flip `committed = true` at the wrong time — only on the CAS-success return path. Too early → the happy/fallback no-emit guarantee breaks; too late (after return) → unreachable.
- ❌ Don't default `mockExit` to `process.exit` (bound reference) — use the expression `c => process.exit(c)` so `vi.spyOn(process,'exit')` tests hit (mirror `file-lock.ts`).
- ❌ Don't use `console.error` or logger-only for the recipe — the process may exit 130 a millisecond later; use synchronous `process.stderr.write` (PLUS logger).
- ❌ Don't register the handlers permanently (module-load) — use phase-scoped process.on/off (prp-pipeline pattern); the rescue is only meaningful in the window.
- ❌ Don't modify S1's capture, S2's commit block, S2's outer catch, the message-gen/retry/fallback block, or the signature — S3 only ADDS rescue state/helpers and WRAPS the gen+commit span.
- ❌ Don't forget to `process.off` in the finally (on every path, including throw) — a leaked handler would fire on a later, unrelated SIGINT.
- ❌ Don't trust line numbers (S1+S2+T2.S1 shift them) — anchor on S1's `Captured pre-generation snapshot` debug log and grep for the gen/commit span.
- ❌ Don't treat SIGKILL/OOM as coverable — no handler runs there; treeSha's immutability (git object store) is the safety net. S3 covers what CAN run (SIGINT/SIGTERM/thrown-escape).
- ❌ Don't run the full TS test suite and treat unrelated pre-existing diagnostics as this task's failure — run the targeted `git-commit` suite (Level 2).

---

## Confidence Score
**8.5 / 10** — one-pass success. The rescue is additive (wraps the gen+commit span; touches nothing in
S1/S2's regions), the helpers are copy-ready, and every surface is unit-testable (pure recipe/emitter +
injectable-mockExit handler + a thrown-escape integration test). The main residual risks: (a) the
instanceof guard for `CommitCasRefusedError` depends on S2 landing that export — mitigated by treating S2
as a landed contract and the double-emit regression test; (b) the `committed`-flip timing must be exactly
on the CAS-success path — mitigated by the no-emit-on-happy/fallback guards; (c) the SIGINT-handler
interaction with the existing exit-130 handlers is a pre-existing dynamic S3 only adds information to —
mitigated by phase-scoped registration + the self-guarding rescue state. The §5.1 "Generation timeout /
SIGINT" mandate is satisfied mechanically by the stderr rescue emission + the non-suppressing exit.