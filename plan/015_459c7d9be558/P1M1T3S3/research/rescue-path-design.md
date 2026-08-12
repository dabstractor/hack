# Research — P1.M1.T3.S3: Generation-timeout / SIGINT rescue path for `smartCommit`

PRD §5.1 "Commit Workflow Mechanics" → edge case "**Generation timeout / SIGINT**: the in-flight
generation is killed; the subsystem enters a rescue path that prints `TREE_SHA` + the manual recovery
command so the snapshotted work is never lost." Architecture: `system_context.md §2.1` (commit path) +
`§5.2` (pipeline owns its own `write-tree`).

This is the **rescue step** of the 3-subtask `smartCommit` rewrite. **S1** captures `PARENT_SHA` +
freezes the index → `TREE_SHA` pre-generation (landed — verified in `git-commit.ts:700-723`). **S2** (in
flight, CONTRACT) replaces `gitCommit` with `commit-tree` + CAS `update-ref` and adds
`CommitCasRefusedError` + `formatCommitRecoveryRecipe` for the **CAS-refusal** edge case. **S3 (THIS
task)** adds the **interrupt rescue**: if the process is interrupted (SIGINT / timeout / thrown escape)
AFTER `write-tree` succeeded but BEFORE the CAS advanced HEAD, emit `TREE_SHA` + the manual recovery
command so the snapshotted work is recoverable. `TREE_SHA` is an immutable git object — it survives any
crash (§5.2); the rescue just makes recovery *discoverable*.

---

## 1. The vulnerable window (where the rescue must fire)

After S1+S2 land, `smartCommit` has this shape (verified current code + S2 contract):

```
smartCommit():
  … gitStatus → gitAdd → restore_critical_files …
  [S1] parentSha = gitRevParseHead(); treeResult = gitWriteTree();  ← treeSha captured (write-tree SUCCEEDED)
       if (!treeResult.success) return null;                         ← BEFORE the window (no treeSha)
       treeSha = treeResult.treeSha;
  ┌───────────────────── VULNERABLE WINDOW STARTS (treeSha set, NOT committed) ─────────────────────┐
  │  [gen] generateCommitMessage(diff) [retry→fallback] → formatCommitMessage → formattedMessage    │  ← SLOW (LLM/stagecoach; seconds–minutes)
  │  [S2] commitTreeResult = gitCommitTree({treeSha, message, parentSha}) → newSha                   │
  │       casResult = gitUpdateRefCAS({newSha, expectedOldSha: parentSha})                            │
  │       if (!casResult.success) throw CommitCasRefusedError   ← S2's OWN recipe (NOT S3's rescue)   │
  └───────────────────── WINDOW ENDS (CAS success → committed=true; return newSha) ──────────────────┘
  catch: if (CommitCasRefusedError) throw; else return null;
```

**The rescue must fire when an interrupt occurs INSIDE the window with `committed === false`**, EXCLUDING
the S2 CAS-refusal path (S2 already logs its own recovery recipe — `formatCommitRecoveryRecipe` — with
`newSha` + the message before throwing; S3 must NOT double-emit).

### Interrupt vectors the rescue must cover
| Vector | Mechanism | Covered by |
| ------ | --------- | ---------- |
| **SIGINT (Ctrl-C)** during the slow generation | process-level signal | **phase-scoped SIGINT handler** (primary) |
| **SIGTERM** (kill) during generation | process-level signal | **phase-scoped SIGTERM handler** (mirror) |
| **Timeout / unexpected throw** escaping the gen span | thrown exception → finally | **try/finally complement** (testable) |
| **SIGKILL / OOM / power-loss** | none — no handler/finally runs | **best-effort only**; `treeSha` is an immutable git object (recoverable via `git fsck --lost-found`). Mirrors `temp-prompt-cleanup.ts` ("signal handlers do NOT fire there"). |

> **Normal generation failure is NOT an interrupt.** The retry loop exhausts → throws → the inner catch
> falls to `buildFallbackCommitMessage` → the placeholder commits via the SAME plumbing path →
> `committed = true` → **no rescue fires** (substance is committed). The rescue is for *genuine*
> interrupts that leave the snapshot uncommitted.

---

## 2. The canonical SIGINT-handler pattern in THIS codebase (mirror it EXACTLY)

`src/core/temp-prompt-cleanup.ts` and `src/core/file-lock.ts` both define the established, testable
signal-handler convention. S3's handlers MUST mirror it (verified verbatim in `file-lock.ts:611-641`):

```ts
// 1) A PURE signal/exit handler with an INJECTABLE mockExit (default re-resolves process.exit at call
//    time so vi.spyOn(process,'exit') tests are hit — keep that default EXACTLY):
export function onLockCleanupSignal(
  code: number,
  mockExit: (code: number) => void = c => process.exit(c),   // ← function EXPRESSION, not process.exit
): void {
  cleanupHeldLocks();   // the actual cleanup
  mockExit(code);       // pass-through exit (130=SIGINT, 143=SIGTERM — 128+signum, shell convention)
}
// 2) Named wrappers (NOT inline arrows) so the registration site is coverable:
export function onSIGINTCleanup(): void  { onLockCleanupSignal(130); }
export function onSIGTERMCleanup(): void { onLockCleanupSignal(143); }
// 3) Registration (file-lock/temp-prompt do it permanently at module load; prp-pipeline does it
//    PHASE-SCOPED via process.on + process.off — see §3 below).
```

**Key conventions S3 inherits:**
- **Exit codes:** `130` = SIGINT (`128+2`), `143` = SIGTERM (`128+15`) — shell convention. `src/index.ts`
  also documents `130: SIGINT (Ctrl+C)`.
- **Named, `@internal`-exported wrappers** (not inline arrows) → registration sites are coverable +
  the handler is directly unit-testable via the injectable `mockExit`.
- **`mockExit` default = `c => process.exit(c)`** (a function expression that re-resolves `process.exit`
  at call time) → a `vi.spyOn(process, 'exit')` test is actually hit. NEVER use `mockExit = process.exit`
  (a bound reference defeats the spy).
- **Best-effort for SIGKILL/OOM** — explicitly acknowledged ("signal handlers do NOT fire there").

---

## 3. Phase-scoped vs permanent registration (choose phase-scoped)

| File | Registration | Why |
| ---- | ------------ | --- |
| `temp-prompt-cleanup.ts:174-176` | **permanent** (module-load `process.on`, no `off`) | cleanup outlives every run; re-registering would leak |
| `file-lock.ts:639-641` | **permanent** | same |
| `prp-pipeline.ts:541-542` → `:2477-2516` | **PHASE-SCOPED** (`process.on` at run start, `process.off` at run end) | the graceful-shutdown handler is only relevant while the pipeline runs |

**S3 uses PHASE-SCOPED registration** (the prp-pipeline pattern): `process.on('SIGINT'/'SIGTERM',
handler)` right after `treeSha` is captured, `process.off(...)` in a `finally` after the commit completes.
**Why phase-scoped (not permanent):** the rescue is ONLY meaningful inside the vulnerable window (treeSha
set, not committed). A permanent handler that always exits 130 would add a redundant exit vote outside
the window; phase-scoping means S3's handler is active ONLY during the window and is a clean no-op-free
no-registration otherwise. The handler ALSO self-guards on the rescue context (§4) so even a stray signal
during the window-but-after-commit doesn't false-emit.

### Conflict analysis with the §5.1 graceful-shutdown handler (PRE-EXISTING, not S3-introduced)
`prp-pipeline.ts:512-542` registers a graceful-shutdown SIGINT handler ("first SIGINT → finish current
task; second SIGINT → force exit"). BUT `temp-prompt-cleanup.ts:175` and `file-lock.ts:640` **already**
register permanent SIGINT handlers that call `process.exit(130)`. So in the real pipeline a SIGINT
already terminates with 130 (Node dispatches ALL listeners for the signal synchronously; whichever calls
`process.exit` initiates termination after the listener pass). **S3 does not change this dynamic** — it
adds a phase-scoped handler that, during the commit window, ALSO prints rescue info before the (already
happening) 130 exit. The rescue is purely *additive information*; it neither introduces a new exit
behavior nor defeats anything that wasn't already governed by the existing exit-130 handlers.

---

## 4. The rescue-state design (module-scoped + self-guarding)

```ts
// Module-scoped (smartCommit is serial in the orchestrator — no concurrency). Mirrors
// temp-prompt-cleanup's module-scoped _trackedTempPromptFiles Set.
interface CommitRescueState {
  readonly treeSha: string;
  readonly parentSha?: string;   // undefined → rootless repo (§5.1); recipe omits -p
  committed: boolean;            // true ONLY after the CAS update-ref succeeds
}
let _commitRescue: CommitRescueState | null = null;
```

- **Set** `_commitRescue = { treeSha, parentSha, committed: false }` immediately after S1's `gitWriteTree`
  success (right where `logger().debug({parentSha, treeSha}, 'Captured pre-generation snapshot')` is).
- **Flip** `_commitRescue.committed = true` immediately after S2's `gitUpdateRefCAS` success (before
  `return newSha`).
- **Clear** `_commitRescue = null` in the `finally` (after the commit, on any path).
- The SIGINT/SIGTERM handlers read `_commitRescue`: if `null` OR `.committed === true` → no rescue (just
  exit); only emit when a snapshot is held and uncommitted.

---

## 5. The rescue recipe (DISTINCT from S2's CAS-refusal recipe)

**S2** added `formatCommitRecoveryRecipe({message, treeSha, parentSha, newSha, error})` — for the
CAS-refusal case (HEAD moved DURING generation; the dangling commit `newSha` exists + the message is
known). **S3's rescue is a DIFFERENT case** (generation INTERRUPTED before `commit-tree` ran — NO
`newSha`, NO message). S3 MUST add a SEPARATE helper and MUST NOT touch S2's (S2 is in flight).

```ts
/**
 * Format the §5.1 "Generation timeout / SIGINT" rescue recipe. Distinct from S2's
 * {@link formatCommitRecoveryRecipe} (the CAS-refusal recipe): the interrupt case has NO newSha and
 * NO generated message (generation was killed before commit-tree ran). The recipe hands the operator
 * the immutable TREE_SHA + the exact manual recovery command so the snapshotted work is recoverable.
 * Rootless repo (parentSha undefined) omits `-p` (root commit).
 * @internal
 */
export function formatCommitRescueRecipe(args: {
  treeSha: string;
  parentSha?: string;
}): string {
  const parentArg = args.parentSha ? `-p ${args.parentSha} ` : '';
  return [
    'Smart Commit interrupted (SIGINT/timeout/process kill) AFTER write-tree succeeded — '
      + 'the snapshotted work is safe as the immutable tree object below; HEAD/index are unchanged.',
    `  TREE_SHA:    ${args.treeSha}`,
    args.parentSha ? `  PARENT_SHA:  ${args.parentSha}` : '  PARENT_SHA:  (rootless repository — root commit)',
    '  The commit was NOT created (generation was killed). Recover manually (supply your own message):',
    `    git commit-tree ${parentArg}-m "<your message>" ${args.treeSha} | xargs git update-ref HEAD`,
    '  (Inspect the tree first if unsure: git ls-tree ' + '' + '${TREE_SHA}.)',
  ].join('\n');
}
```
The command matches the contract verbatim: `` git commit-tree -p <PARENT_SHA> -m "<your message>"
<TREE_SHA> | xargs git update-ref HEAD `` (rootless: no `-p`). The DOCS requirement (JSDoc citing the §5.1
sentence) lives on `emitCommitRescue` / the rescue path.

### `emitCommitRescue` (the testable emitter — writes stderr + log)
```ts
/** @internal — emit the rescue recipe to BOTH stderr and the logger so it survives a crashing process. */
export function emitCommitRescue(rescue: CommitRescueState | null): void {
  if (!rescue || rescue.committed) return;                 // no snapshot held, or already committed → no-op
  const recipe = formatCommitRescueRecipe({ treeSha: rescue.treeSha, parentSha: rescue.parentSha });
  process.stderr.write(`\n${recipe}\n`);                   // synchronous; survives a fast exit
  logger().error(recipe);                                  // structured log (same destination family as S2)
}
```
Writing to **both** `process.stderr.write` (synchronous, survives an imminent `process.exit`) AND
`logger()` is deliberate: the logger may be async/buffered (§9.6), but `process.stderr.write` is
synchronous and guarantees the recipe is visible even if the process exits 130 a millisecond later.

---

## 6. The `smartCommit` integration (copy-ready, builds on S1+S2)

Insert right after S1's `logger().debug({parentSha, treeSha}, 'Captured pre-generation snapshot')`:

```ts
// ── Generation-timeout / SIGINT rescue (PRD §5.1 "Generation timeout / SIGINT", P1.M1.T3.S3) ──
// treeSha (S1's write-tree) is an IMMUTABLE git object — it survives any crash (system_context §5.2).
// If the process is interrupted AFTER this point but BEFORE the CAS advances HEAD, emit treeSha + the
// manual recovery command so the snapshotted work is recoverable. Phase-scoped SIGINT/SIGTERM handlers
// (mirroring file-lock.ts/temp-prompt-cleanup.ts) + a try/finally complement for thrown escapes.
_commitRescue = { treeSha, parentSha, committed: false };
const rescueHandlers: Array<[NodeJS.Signals, () => void]> = [
  ['SIGINT', onCommitRescueSIGINT],
  ['SIGTERM', onCommitRescueSIGTERM],
];
for (const [sig, fn] of rescueHandlers) process.on(sig, fn);

let rescueEscape: unknown; // captures a thrown escape so the finally can distinguish it from a normal return
try {
  // …[EXISTING message-gen block: generateMessage? → retry/fallback → formattedMessage]…   (UNCHANGED)
  // …[S2 commit block: gitCommitTree → gitUpdateRefCAS]…                                    (S2 — UNCHANGED)
  //   on CAS {success:false} → S2 throws CommitCasRefusedError (S2 logs ITS recipe first)
  //   on CAS success:
  if (_commitRescue) _commitRescue.committed = true;   // ← window CLOSED
  logger().info(`Commit created: ${newSha}`);
  return newSha;
} catch (e) {
  rescueEscape = e;
  throw e; // re-throw: let the outer catch decide (S2 re-throws CommitCasRefusedError; others → null)
} finally {
  for (const [sig, fn] of rescueHandlers) process.off(sig, fn); // ALWAYS unregister (phase-scoped)
  // try/finally rescue: a genuine non-CAS escape with an uncommitted snapshot → emit rescue.
  // (CAS refusal already logged S2's recipe + carries newSha — do NOT double-emit.)
  if (_commitRescue && !_commitRescue.committed && !(rescueEscape instanceof CommitCasRefusedError)) {
    emitCommitRescue(_commitRescue);
  }
  _commitRescue = null; // ALWAYS clear
}
```

**Notes on the integration:**
- The `try/catch(e){rescueEscape=e; throw e;}` wrapper is INSIDE the existing outer try/catch — it only
  captures the escape for the `finally`'s guard, then re-throws so S2's outer-catch logic (re-throw
  CommitCasRefusedError / else return null) is UNCHANGED.
- The message-gen block and S2's commit block are UNCHANGED — S3 only WRAPS them + manages rescue state.
- `committed = true` is set ONLY on the CAS-success return path → the finally's rescue guard is true
  exactly when the window was open and the commit did NOT complete.
- `process.off` in the finally guarantees no handler leak even on throw (phase-scoped discipline).
- The SIGINT/SIGTERM handlers call `emitCommitRescue(_commitRescue)` then `mockExit(130/143)` — so on a
  real signal during the window, the recipe prints (synchronously via stderr) THEN the process exits,
  honoring "must NOT suppress the signal."

---

## 7. Reconciling "No new exports" with the testability convention

The contract §4 says "No new exports." That refers to **`smartCommit`'s public API surface** (signature +
return + the S2-added `CommitCasRefusedError` throw) — UNCHANGED by S3. The rescue helpers
(`formatCommitRescueRecipe`, `emitCommitRescue`, `onCommitRescueSignal`, `onCommitRescueSIGINT`,
`onCommitRescueSIGTERM`) are **`@internal`-exported** — the SAME convention `file-lock.ts` and
`temp-prompt-cleanup.ts` use for their signal handlers (`onSIGINTCleanup`, `onTempSIGINTCleanup` are all
`@internal`-exported so the registration sites are coverable + the handlers are unit-testable via the
injectable `mockExit`). S3 follows that established convention; `smartCommit` itself gains no new
parameter/return/export. **Recommendation: export the helpers `@internal` (matches convention + makes the
rescue unit-testable); keep `smartCommit`'s surface identical.**

---

## 8. Test strategy (all surfaces unit-testable; no real signal needed)

| Surface | Test | How |
| ------- | ---- | --- |
| `formatCommitRescueRecipe` (pure) | recipe contains `treeSha`, `parentSha`, the exact command; rootless omits `-p` | direct call, assert string |
| `emitCommitRescue` (pure-ish) | emits (stderr+log) iff `!committed` + state held; no-op when committed/null | spy `process.stderr.write` + `logger`; call with each state |
| `onCommitRescueSignal` (injectable mockExit) | calls `emitCommitRescue` + `mockExit(130)` / `(143)` | `const exit = vi.fn(); onCommitRescueSignal(130, exit); expect(exit).toHaveBeenCalledWith(130)` (mirror file-lock/temp-prompt tests) |
| **`smartCommit` try/finally rescue** (the integration test) | an escaping throw (non-CAS) during the window → rescue emitted + returns null | mock `gitCommitTree` to `.mockRejectedValue(new Error('boom'))` (escapes, committed stays false, not CommitCasRefusedError) → assert `logger().error` spy contains `treeSha` + the command, AND `smartCommit` returns `null` |
| **CAS refusal does NOT double-emit** (regression guard) | CAS `{success:false}` → only S2's recipe, NOT S3's rescue | mock `gitUpdateRefCAS` → `{success:false, casFailure:true}` → assert S3's rescue recipe string is NOT in the log (S2's is), and it `rejects.toThrow(CommitCasRefusedError)` |
| **normal path does NOT emit rescue** | happy path (commit succeeds) → no rescue; fallback path (gen fails → placeholder commits) → no rescue | happy: assert rescue spy NOT called; fallback: mock generateCommitMessage to reject (exhausts retry) → placeholder commits → committed=true → no rescue |
| handler registration hygiene | `process.on` called on window-open, `process.off` called on window-close (even on throw) | spy `process.on`/`process.off` (or grep-gate the finally) — optional; the named-handler direct-call tests are the primary cover |

### Existing-test impact (the migration hazard)
`git-commit.test.ts` (S1 added `gitRevParseHead`/`gitWriteTree` shared defaults; S2 is migrating ~10
`gitCommit` sites → `gitCommitTree`/`gitUpdateRefCAS`). **S3 adds the rescue wrapper AROUND the gen+commit
span — it does NOT change what the existing happy-path tests assert** (they still get a hash back, still
call commit-tree/update-ref). The rescue only fires on the interrupt/escape paths, which no existing test
exercises. So **S3 should NOT regress existing tests** — provided the `committed = true` flip happens
before the successful return (so the finally's guard skips emit on the happy path). The one new
shared-default consideration: tests that assert `process.on('SIGINT', …)` was called will see S3's
registration — but no existing test asserts that, so it's clean.

---

## 9. The validated commands (this codebase)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint             # eslint . --ext .ts — clean
npm run format:check     # prettier --check — clean
npm run test:run -- git-commit   # vitest run scoped to git-commit — the PRIMARY gate
```