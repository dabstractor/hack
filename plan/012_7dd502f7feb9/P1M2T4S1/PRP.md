# PRP — P1.M2.T4.S1: Register `update` command + implement `updateAction` handler in `src/cli/index.ts`

---

## Goal

**Feature Goal**: Ship PRD §5.4's **`hack update <task-id> <status>`** CLI command —
the manual status-rewrite UX that fuzzy-matches BOTH the task ID and the target
status, then performs a **serialized, atomic, schema-validated** read-modify-write
of `tasks.json` that applies the §5.4 cascade (downward `Complete` cascade +
upward min-status ancestor recompute, including DOWNGRADE). Implemented as ONE new
inline action handler `updateAction` + ONE new `.command('update')` registration in
`src/cli/index.ts`, mirroring the existing inline `taskAction` shared handler.
This item CONSUMES the four landed helpers (`normalizeTaskId`/`findItemByLooseId`,
`matchStatus`, `cascadeCompleteDown`, `recomputeAncestorsUp`) and the existing
locked-RMW primitive (`withLockedTasksJSON`) — it adds NO new utility logic.

**Deliverable**:
1. **`src/cli/index.ts`** — EDIT (additive):
   - NEW top-level imports: `findItemByLooseId`, `matchStatus`, `cascadeCompleteDown`,
     `recomputeAncestorsUp`, `findItem`, `type HierarchyItem` from `../utils/task-utils.js`;
     `withLockedTasksJSON`, `TasksLockAcquisitionError` from `../core/file-lock.js`;
     `type Backlog`, `type Status` from `../core/models.js`.
   - NEW module-private `replaceItemById(backlog, id, newItem): Backlog` immutable
     splice (~10 lines) — the only new logic; mirrors `updateItemStatus`'s nested-map
     rebuild. (Documented in Implementation Patterns.)
   - NEW top-level `const updateAction = async (taskId, status, options) => { … }`
     handler (Mode-A JSDoc) — file discovery (HARD-ERROR variant), parse, lock+RMW,
     output, error handling — mirroring `taskAction`.
   - NEW `program.command('update')…action(updateAction)` registration (sibling to
     the `task`/`status` registrations).
2. **`tests/unit/cli/update-command.test.ts`** — NEW: handler-logic unit tests
   (discovery hard-error, status not-found/ambiguous/unknown, success text/json,
   lock-timeout) with `withLockedTasksJSON` mocked to run the REAL mutator on a
   fixture backlog (so the cascade composition is exercised).
3. **`tests/integration/cli-update.test.ts`** — NEW: end-to-end RMW against a real
   temp `plan/` dir + real tasks.json + real file-lock + real atomic write; read the
   file back and assert the cascade + ancestor recompute (promote AND demote) landed.

**Success Definition** (the contract from the work item + PRD §5.4 acceptance):
- `hack update 1.1.1.1 done` → `P1.M1.T1.S1` = Complete + success line; `hack task`
  shows it Complete.
- `hack update p1m1t1s1 re` → `P1.M1.T1.S1` = Ready (synonym, case-insensitive).
- `hack update 1 done` → cascades `Complete` to EVERY item under `P1`.
- `hack update <last-incomplete-subtask> comp` → promotes Task/Milestone/Phase to
  `Complete` via ancestor recompute.
- `hack update <a-subtask> p` → DOWNGRADES ancestors to the least-progressed child.
- `hack update 9.9.9.9 done` → exit non-zero + "not found".
- `hack update 1.1.1.1 r` → exit non-zero + ambiguity (Ready + Researching).
- `hack update 1.1.1.1 bogus` → exit non-zero + valid-statuses list.
- A missing *discovered* tasks.json is a HARD ERROR (exit 1), NOT `awaiting_breakdown`;
  an explicit `--file` to a missing file is also a hard error.
- Lock timeout → exit non-zero with a clear message; the write is atomic (temp+rename)
  under the §5.1 lock.
- `npm run validate` (lint + format:check + typecheck + test:run) GREEN; coverage
  stays above the regression floor.

---

## User Persona (if applicable)

**Target User**: A **developer/operator** driving the pipeline by hand — re-running
after a flaky test (`hack update 1.1.1.1 done`), un-blocking a stuck `Retrying` item
(`hack update 1.1.1.1 ready`), or force-marking a whole phase done
(`hack update 1 done`). Successor to the reference `tsk update` UX.

**Use Case**: Rewrite any item's status from the shell with the loosest possible
typing (loose task ID + loose status), and have the hierarchy stay consistent
(cascade + ancestor recompute) with concurrency-safe atomic persistence.

**User Journey**: `hack update 1.1.1.1 done` → CLI resolves the file → parses the
loose id (`1.1.1.1`→`P1.M1.T1.S1`) + status (`done`→`Complete`) → acquires the
session lock → sets the subtask Complete → recomputes ancestors → writes atomically
→ prints `Updated P1.M1.T1.S1 status to Complete`.

**Pain Points Addressed**: Today there is NO `hack update` command — manual status
edits require hand-editing `tasks.json` (race-prone, schema-risky, no cascade).
§5.4 mandates the `tsk update`-style fuzzy UX with serialized RMW.

---

## Why

- **PRD §5.4 is the contract.** It specifies the command surface, loose ID/status
  matching, cascade semantics (downward `Complete` + upward min recompute with
  downgrade), task-file discovery priority, and concurrency/integrity (lock +
  atomic write). This item wires the command end-to-end.
- **Pure composition of landed helpers.** The four `src/utils/task-utils.ts`
  helpers (P1.M2.T1.S1 `normalizeTaskId`/`findItemByLooseId`, P1.M2.T2.S1
  `matchStatus`, P1.M2.T3.S1 `cascadeCompleteDown`, P1.M2.T3.S2
  `recomputeAncestorsUp`) and `src/core/file-lock.ts`'s `withLockedTasksJSON` are
  all landed/contracted. This item ADDS NO new utility logic — it only composes
  them inside the CLI handler + a 10-line immutable splice. That keeps the change
  small and one-pass-safe.
- **Write-path discipline.** `hack update` is the FIRST user-facing WRITE of
  `tasks.json` (the orchestrator/research-supervisor write internally). It MUST
  reuse the exact serialized-RMW primitive (`withLockedTasksJSON`) so it can never
  corrupt `tasks.json` or race a concurrent writer (PRD §5.1). It MUST NOT soft-fail
  on a missing discovered file (unlike the read-only `status` command) — a write
  against a missing target is a real mistake.
- **Out of scope (hard boundary):** any change to `src/utils/task-utils.ts`,
  `src/core/file-lock.ts`, `src/core/session-utils.ts`, `src/core/models.ts`, any
  `docs/*.md` (Mode-B docs are P1.M3.T1's job — this item ships ONLY JSDoc on the
  handler), and any other command (taskAction / inspect / cache / …).

---

## What

### User-visible behavior

```bash
hack update P1.M1.T1.S1 ready        # full canonical form
hack update p1m1.t1.s1 ready         # case-insensitive, dotted
hack update p1m1t1s1 ready           # concatenated, no dots
hack update 1.1.1.1 re               # numeric + 2-letter status
hack update 1.2 done                 # milestone + synonym
hack update 2 comp                   # phase + prefix status
hack update 1.1.1.1 done -f path/to/tasks.json
hack update 1.1.1.1 done --session abc
hack update 1.1.1.1 done -o json     # → { "id": …, "status": …, "title": … }
```
- Success (text): `Updated <canonicalId> status to <Status>` on **stdout**.
- Success (json): `{ "id": "<canonicalId>", "status": "<Status>", "title": "<title>" }`
  on **stdout**.
- Errors (task not found, ambiguous/unknown status, file not found, lock timeout):
  clear message on **stderr**, exit non-zero.

### Technical requirements (exact contract)

**Registration** (architecture §F2.D — mirror `taskAction` inline pattern):
```ts
program
  .command('update')
  .description('Manually update a task status (PRD §5.4)')
  .argument('<task-id>', 'Task ID (loose: P1.M1.T1.S1, 1.1.1.1, p1m1t1s1, 1.2)')
  .argument('<status>', 'Status (loose: done, re, comp, ready)')
  .option('-f, --file <path>', 'Override tasks.json file path')
  .option('--session <hash>', 'Target specific session by hash')
  .option('-o, --output <format>', 'Output format (text, json)', 'text')
  .action(updateAction);
```

**`updateAction(taskId, status, options)` handler** (mirrors `taskAction`:
626–830):
1. **Status match FIRST (pure, no I/O):** `const sr = matchStatus(status);`
   `if ('error' in sr) { process.stderr.write(\`${sr.error}\\n\`); process.exit(1); }`
   The `sr.error` string is already human-readable (`Ambiguous status "r": matches …`
   / `Unknown status "bogus". Valid statuses: …`). Use it verbatim.
2. **File discovery** — IDENTICAL ladder to `taskAction` (lines ~638–688):
   `options.file` → resolve; else resolve target session (`options.session` →
   `SessionManager.listSessions` + `.find(s => s.hash.startsWith(session))`, throw
   `Session not found: …`; else `SessionManager.findLatestSession`, throw
   `No sessions found…`); then prefer `findLatestBugfixTasksFile(sessionPath)`,
   else `resolve(sessionPath,'tasks.json')`. Use the SAME dynamic imports
   (`readFile` from `node:fs/promises`, `SessionManager`, `findLatestBugfixTasksFile`).
   **BUT** — a missing *discovered* tasks.json is a **HARD ERROR**, not the
   `awaiting_breakdown` notice: after discovery, if `!existsSync(tasksFile)` →
   `process.stderr.write(\`[hack] tasks.json not found at ${tasksFile}. Wait for PRD breakdown to finish, or pass an explicit --file.\\n\`); process.exit(1);`
   (An explicit `--file` to a missing file is also caught below as ENOENT → exit 1.)
   Do NOT emit `awaiting_breakdown` anywhere in `updateAction`.
3. **Pre-lock loose lookup (fail fast before acquiring the lock):**
   `const raw = JSON.parse(await readFile(tasksFile, 'utf-8'));`
   `const found = findItemByLooseId(raw as Backlog, taskId);`
   `if (!found) { process.stderr.write(\`Task not found: ${taskId}\\n\`); process.exit(1); }`
   `const canonicalId = found.canonicalId;`
4. **Lock + RMW:**
   ```ts
   const sessionDir = dirname(tasksFile);
   const updated = await withLockedTasksJSON(sessionDir, (backlog: Backlog): Backlog => {
     const target = findItem(backlog, canonicalId);
     if (!target) throw new Error(`Task not found: ${taskId}`); // defensive
     const newItem: HierarchyItem =
       sr.status === 'Complete' ? cascadeCompleteDown(target) : { ...target, status: sr.status };
     const spliced = replaceItemById(backlog, canonicalId, newItem);
     return recomputeAncestorsUp(spliced, canonicalId);
   });
   ```
   (the `replaceItemById` splice is the module-private helper below).
5. **Output:**
   - text: `console.log(\`Updated ${canonicalId} status to ${sr.status}\`);`
   - json: `console.log(JSON.stringify({ id: canonicalId, status: sr.status,
     title: (findItem(updated, canonicalId)?.title ?? '') }, null, 2));`
   - then `process.exit(0);`
6. **Error/catch tail** (mirror `taskAction`:821–825):
   ```ts
   } catch (error) {
     if (error instanceof TasksLockAcquisitionError) {
       logger().error(`Could not acquire tasks.json lock: ${error.message}`);
       process.stderr.write(`[hack] tasks.json is locked by another process; try again shortly.\n`);
     } else {
       const errorMessage = error instanceof Error ? error.message : String(error);
       logger().error(`Update command failed: ${errorMessage}`);
       process.stderr.write(`[hack] ${errorMessage}\n`);
     }
     process.exit(1);
   }
   ```
   NOTE: status-not-found and unknown-status short-circuit with explicit
   `process.exit(1)` BEFORE the lock (steps 1 & 3); only lock/parse/write errors
   reach the catch. Keep the explicit short-circuits for the precise PRD messages.

### Success Criteria

- [ ] `program.command('update')` registered with the exact surface above; routed
      to `updateAction` (Commander auto-dispatches — no manual switch; verified
      there is no `parseSubcommand` dispatcher in index.ts).
- [ ] Loose task-ID matching (`1.1.1.1`, `p1m1t1s1`, `1.2`, `2`) via
      `findItemByLooseId`; loose status matching (`done`, `re`, `comp`, `r`,
      `bogus`) via `matchStatus`.
- [ ] `Complete` target cascades down the whole subtree (`cascadeCompleteDown`).
- [ ] Ancestors recomputed bottom-up via `recomputeAncestorsUp` (PROMOTE and
      DOWNGRADE both work).
- [ ] Write is serialized + atomic + schema-validated via `withLockedTasksJSON`
      (no direct `writeFile` of tasks.json anywhere in the handler).
- [ ] Missing discovered tasks.json → HARD ERROR (exit 1), never `awaiting_breakdown`.
- [ ] Not-found / ambiguous / unknown status / lock-timeout → stderr + exit 1.
- [ ] text + json output formats correct; success exits 0.
- [ ] Mode-A JSDoc on `updateAction` (and `replaceItemById`).
- [ ] `npm run validate` GREEN; new unit + integration tests GREEN; coverage above floor.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — the exact file, the exact registration
block, the exact handler body (6 ordered steps with reference code), the exact
signatures of every consumed helper (verified exports + discriminated-union return
for `matchStatus`), the exact `withLockedTasksJSON` contract (in-place OR pure
mutator, validates+writes atomically, throws `TasksLockAcquisitionError`), the exact
file-discovery ladder to mirror (with line refs), the HARD-ERROR vs
`awaiting_breakdown` distinction, the exact 10-line `replaceItemById` splice, the
exact catch tail pattern, the exact CLI test harness (mocks + spies + the
file-lock mock), the exact integration-test template, and all PRD §5.4 acceptance
criteria. Non-obvious facts (matchStatus returns a discriminated union NOT throws;
recomputeAncestorsUp assumes the leaf is already set; NO manual dispatcher; update
must NOT emit awaiting_breakdown; functional mutator preferred over in-place
mixing) are all in `research/update-command-facts.md`.

### Documentation & References

```yaml
# MUST READ — PRD section this item implements (the contract)
- docfile: PRD.md
  section: "5.4 Manual Status Updates (hack update)" (h3.12)
  why: >
    The authoritative command surface, loose ID/status matching rules, cascade
    semantics (downward Complete + upward min recompute with downgrade), task-file
    discovery, concurrency/integrity (lock + atomic write), output format, and the
    9 acceptance criteria. Every behavior in updateAction traces to a sentence here.
  critical: "update is a WRITE: a missing discovered tasks.json is a HARD ERROR,
    NOT the calm awaiting_breakdown notice (distinct from the read-only status
    command). The status arg is fuzzy-matched via matchStatus (discriminated union).
    Complete cascades DOWN; ancestors recompute UP and CAN downgrade."

# MUST READ — architecture pin (registration block + handler steps + boundaries)
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F2.D — hack update CLI command (src/cli/index.ts)"
  why: >
    Gives the EXACT .command('update') registration block, the 5-step handler logic,
    "Session dir resolution: dirname(tasksFile)", "Schema validation: writeTasksJSON
    already validates via BacklogSchema.parse()", and the error list (not found /
    ambiguous / unknown / file not found / lock timeout).
  critical: Mirror the taskAction inline handler pattern (NOT a class module under
            src/cli/commands/). The mutator runs inside withLockedTasksJSON.

# MUST READ — this item's research (THE load-bearing facts)
- docfile: plan/012_7dd502f7feb9/P1M2T4S1/research/update-command-facts.md
  section: "1 (§F2.D contract)", "2 (taskAction ladder + awaiting_breakdown block to
    REPLACE + catch tail)", "3 (all dependency signatures incl matchStatus union +
    setItemStatus in-place)", "4 (withLockedTasksJSON contract + TasksLockAcquisitionError)",
    "5 (recommended functional mutator + replaceItemById splice)", "6 (CLI test harness +
    file-lock mock)", "7 (imports to ADD vs already-present)", "8 (validate scripts)",
    "9 (acceptance criteria)", "10 (hard boundaries)"
  why: >
    Proves matchStatus returns {status}|{error,candidates} (narrow with 'error' in result,
    NOT try/catch); recomputeAncestorsUp assumes the leaf status is already set; there is
    NO parseSubcommand dispatcher (Commander auto-routes); the functional mutator composes
    the landed pure helpers; replaceItemById is ~10 lines mirroring updateItemStatus.

# MUST READ — the file being edited (mirror taskAction's structure + reuse its imports)
- file: src/cli/index.ts
  why: >
    THE edit target (1476 lines). taskAction (626–830) = the handler to MIRROR (dynamic
    imports of readFile/SessionManager/findLatestBugfixTasksFile; the file-discovery
    ladder 638–688; the awaiting_breakdown block 690–715 to REPLACE with a hard error;
    the source-note block 717–724; the catch tail 821–825). The task|status registrations
    (829–847) = where to add the update registration as a sibling. Top imports (31–60)
    already provide dirname/basename/resolve/relative/existsSync/chalk/logger — DO NOT
    re-add them. main()/parseCLIArgs() (324+, 857+ hook) are NOT touched.
  pattern: "const taskAction = async (action, options) => { try { const { readFile } =
    await import('node:fs/promises'); … } catch (error) { … logger().error(…); process.exit(1); } };"
  gotcha: updateAction takes (taskId, status, options) — TWO positional args + options
          (taskAction takes (action, options)). The awaiting_breakdown block must NOT be
          copied into updateAction; replace it with a hard error.

# MUST READ — the consumed helpers (verify signatures/contracts before composing)
- file: src/utils/task-utils.ts
  why: >
    CONSUME (read-only; siblings own it). findItemByLooseId (166) → {item, canonicalId}|null.
    matchStatus (979) → {status}|{error,candidates} (DISCRIMINATED UNION). cascadeCompleteDown
    (landed, sibling S1) → pure deep-Complete clone. recomputeAncestorsUp (sibling S2, assume
    landed) → pure ancestor min-recompute; ASSUMES the leaf is already set; no-op for a Phase.
    findItem (90) → pure exact-id lookup. setItemStatus (1058) → IN-PLACE root set (alt idiom).
    HierarchyItem (47) + AnyItem (1030) exported.
  pattern: "const r = matchStatus(status); if ('error' in r) { …exit 1 } /* else r.status */"
  gotcha: Do NOT call normalizeTaskId directly (findItemByLooseId calls it internally). Do NOT
          use setItemStatus for the Complete case (it sets only the root, not descendants) —
          use cascadeCompleteDown + replaceItemById.

# MUST READ — the locked-RMW primitive (the ONLY sanctioned tasks.json writer)
- file: src/core/file-lock.ts
  why: >
    CONSUME (read-only). withLockedTasksJSON (492): (sessionDir, mutator: (backlog)=>Backlog|
    Promise<Backlog>, opts?, readFallback?) => Promise<Backlog>. Acquires the sibling lockfile,
    readTasksJSON (validated), runs mutator, writeTasksJSON (BacklogSchema.parse + atomic
    temp+rename), releases lock (finally). Mutator may mutate in place OR return new (both valid).
    Throws TasksLockAcquisitionError (140) on lock timeout — detect with instanceof.
  pattern: "await withLockedTasksJSON(sessionDir, (backlog) => { …; return backlog; });"
  gotcha: Pass sessionDir = dirname(tasksFile), NOT the tasks.json path. The returned backlog
          is the PERSISTED one (use it for the json title field).

# MUST READ — the model shapes (Backlog/Status for the mutator typing)
- file: src/core/models.ts
  why: >
    Backlog = { readonly backlog: Phase[] }. Status has 8 values
    (Planned|Researching|Ready|Implementing|Retrying|Complete|Failed|Obsolete) — Retrying is
    NOT manually settable (matchStatus never returns it). Import `type Backlog` + `type Status`.

# PATTERN FILES — copy these test conventions exactly
- file: tests/unit/cli/index.test.ts
  section: "describe('breakdown-in-progress (PRD §5.3)')" (line 964+)
  why: >
    THE unit-test harness template. Drives parseCLIArgs(); vi.mock node:fs (existsSync per-test),
    node:fs/promises (readFile), ../core/session-manager.js + ../core/session-utils.js
    (mockFindLatestSession/mockListSessions/mockFindLatestBugfixTasksFile), ../utils/logger.js,
    ../utils/repo-root.js (no-op bootstrapRepoRoot); process.exit = vi.fn() NO-OP; spyOn
    console.log + process.stderr.write; await new Promise(r=>setImmediate(r)). For update ADD a
    vi.mock of ../core/file-lock.js ({ withLockedTasksJSON, TasksLockAcquisitionError }).
  pattern: "process.exit = bdExit as any; … setArgv(['update','1.1.1.1','done']); parseCLIArgs();
    await new Promise(r => setImmediate(r)); expect(bdExit).toHaveBeenCalledWith(0);"

- file: tests/integration/cli-task-status.test.ts
  why: >
    THE integration-test template. Real temp plan/ dir (mkdtemp) + real tasks.json (writeFile) +
    real file-lock + real writeTasksJSON; mock only ../utils/logger.js; drive parseCLIArgs against
    it via _resetBootstrap + a repo root; read the file back and assert. Mirror this for the
    end-to-end cascade/ancestor/atomic-write proof.
  pattern: "const dir = await mkdtemp(join(tmpdir(),'hack-update-')); … writeFile(join(dir,
    'plan/001_abc/tasks.json'), JSON.stringify(BACKLOG)); … setArgv(['update','1','done']);
    parseCLIArgs(); await flush; const after = JSON.parse(await readFile(…));"

# DEPENDENCY CONTRACTS (assume implemented as-specified — do not duplicate)
- docfile: plan/012_7dd502f7feb9/P1M2T3S2/PRP.md   # recomputeAncestorsUp — RUNNING IN PARALLEL
  why: >
    Defines recomputeAncestorsUp(backlog, changedId): Backlog — pure, recomputes ancestors as the
    min-status of children, CAN DOWNGRADE, assumes the changed item is already set, no-op for a
    Phase-level change. THIS item composes it as the LAST step of the mutator (after the splice).
- docfile: plan/012_7dd502f7feb9/P1M2T3S1/PRP.md   # cascadeCompleteDown — LANDED
  why: >
    Defines cascadeCompleteDown(item): HierarchyItem — pure deep-Complete clone of the subtree.
    THIS item applies it to the target when sr.status === 'Complete', before splicing.
- docfile: plan/012_7dd502f7feb9/P1M2T1S1/PRP.md   # normalizeTaskId + findItemByLooseId — LANDED
- docfile: plan/012_7dd502f7feb9/P1M2T2S1/PRP.md   # matchStatus — LANDED
```

### Current Codebase tree (relevant slice)

```bash
src/cli/index.ts                       # ← THE EDIT TARGET (1476 lines): +updateAction +.command('update') +replaceItemById +imports +JSDoc
src/utils/task-utils.ts                # CONSUME (read-only) — findItemByLooseId/matchStatus/cascadeCompleteDown/recomputeAncestorsUp/findItem/HierarchyItem
src/core/file-lock.ts                  # CONSUME (read-only) — withLockedTasksJSON + TasksLockAcquisitionError
src/core/session-utils.ts              # CONSUME (dynamic import) — findLatestBugfixTasksFile
src/core/session-manager.ts            # CONSUME (dynamic import) — SessionManager.listSessions/findLatestSession
src/core/models.ts                     # CONSUME (type-only) — Backlog, Status
tests/unit/cli/index.test.ts           # PATTERN (read-only) — breakdown-in-progress block = the unit harness template
tests/integration/cli-task-status.test.ts # PATTERN (read-only) — the integration harness template
package.json                           # READ-ONLY — npm scripts (fix/validate/typecheck/lint/format:check/test:run)
plan/012_7dd502f7feb9/architecture/implementation-status.md  # §F2.D (contract) + §F2.E (test surfaces)
plan/012_7dd502f7feb9/P1M2T4S1/research/update-command-facts.md  # THIS ITEM'S RESEARCH NOTE
```

### Desired Codebase tree with files to be added

```bash
src/cli/index.ts                                   # EDIT (additive): +imports, +replaceItemById (module-private), +updateAction (Mode-A JSDoc), +.command('update') registration
tests/unit/cli/update-command.test.ts              # NEW — handler-logic unit tests (mock withLockedTasksJSON to run the real mutator)
tests/integration/cli-update.test.ts               # NEW — end-to-end RMW + cascade + ancestor recompute + atomic write against a real temp dir
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — matchStatus returns a DISCRIMINATED UNION, it does NOT throw.
//   const r = matchStatus(status);  //  { status: Status } | { error: string; candidates: string[] }
//   if ('error' in r) { stderr(r.error); exit 1 }   // r.error is ALREADY human-readable
//   else { /* r.status */ }
//   Narrow with 'error' in r / 'status' in r. Do NOT try/catch it. (research §3.)

// CRITICAL — recomputeAncestorsUp ASSUMES the changed item's status is ALREADY set in
//   the backlog (it only recomputes ANCESTORS). So in the mutator: splice the new target
//   (status set, and — if Complete — subtree cascaded via cascadeCompleteDown) FIRST, THEN
//   call recomputeAncestorsUp(spliced, canonicalId). For a Phase-level Complete, recompute
//   is a no-op (Phase has no ancestor) — correct. (research §3/§5.)

// CRITICAL — hack update is a WRITE. A missing DISCOVERED tasks.json is a HARD ERROR
//   (exit 1), NOT the calm awaiting_breakdown notice. Do NOT copy taskAction's
//   awaiting_breakdown block into updateAction. An explicit --file to a missing file is
//   also a hard error (readFile ENOENT → catch → exit 1). (research §2; PRD §5.4.)

// CRITICAL — there is NO parseSubcommand dispatcher in index.ts. Commander auto-routes
//   program.command('update').action(updateAction). Do NOT add a manual switch/case.
//   (Verified by grep — research §6.)

// CRITICAL — pass sessionDir = dirname(tasksFile) to withLockedTasksJSON, NOT the
//   tasks.json path. The lock is on <sessionDir>/tasks.json.lock. (research §4.)

// CRITICAL — DO NOT write tasks.json directly (no writeFile of tasks.json in the handler).
//   The ONLY sanctioned writer is withLockedTasksJSON → writeTasksJSON (validates via
//   BacklogSchema.parse + atomic temp+rename). (PRD §5.1/§5.4; research §4.)

// CRITICAL — DO NOT modify src/utils/task-utils.ts, src/core/file-lock.ts,
//   src/core/session-utils.ts, or src/core/models.ts. Those helpers are the contract;
//   this item CONSUMES them. The ONLY new logic is the ~10-line module-private
//   replaceItemById splice in index.ts. (research §10.)

// GOTCHA — withLockedTasksJSON's mutator may mutate in place OR return a new backlog
//   (both valid). The RECOMMENDED approach here is FUNCTIONAL/immutable (return a new
//   backlog) so it composes cleanly with the pure cascadeCompleteDown + recomputeAncestorsUp
//   — avoids mixing in-place mutation with pure helpers. (research §5.)

// GOTCHA — setItemStatus mutates IN PLACE (casts away readonly) and sets ONLY the root
//   item. It does NOT cascade descendants. For the Complete cascade use cascadeCompleteDown
//   (pure) + the replaceItemById splice instead. (research §3/§5.)

// GOTCHA — findItemByLooseId is pure and takes a Backlog; the pre-lock read gives a raw
//   parsed object — cast `raw as Backlog` for the lookup (duck-typed walk works at runtime;
//   TypeScript wants Backlog). Inside the lock, withLockedTasksJSON gives a real validated
//   Backlog. Use findItem (exact canonicalId) inside the mutator. (research §3/§5.)

// GOTCHA — process.exit inside the handler is captured by the test's NO-OP exit mock, so
//   the async tail may continue. Mirror taskAction: after each exit(1) short-circuit the
//   logic is done; after the success output call exit(0). Tests `await setImmediate` to let
//   the async finish. (research §6.)

// GOTCHA — the preAction hook (cli/index.ts:857) chdir's to the repo root BEFORE the
//   action runs, so `resolve('plan')` resolves against the repo root (not INVOCATION_CWD),
//   matching taskAction. Do not re-resolve. (research §2.)

// GOTCHA — prettier owns formatting; run `npm run fix` then `npm run format:check`.
//   eslint covers .ts only. Coverage is a REGRESSION FLOOR (statements 89 / branches 90 /
//   functions 94 / lines 89) — the new tests keep the handler well-covered. (research §8.)
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The handler consumes the existing `Backlog`/`Status`
(`src/core/models.ts`) and the existing `HierarchyItem` (`src/utils/task-utils.ts:47`).
The only new construct is the module-private `replaceItemById` immutable splice.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the target regions of src/cli/index.ts + the consumed helpers
  - READ cli/index.ts:31–60 (top imports — confirm what is ALREADY imported so you
    do not duplicate), 624–830 (taskAction — the handler to mirror), 829–847
    (task|status registrations — where the update registration goes), 857+ (preAction
    hook + main — NOT touched).
  - READ src/utils/task-utils.ts:90 (findItem), 135–195 (normalizeTaskId +
    findItemByLooseId), 979–1040 (matchStatus + the discriminated union),
    cascadeCompleteDown (landed), recomputeAncestorsUp (sibling S2 — assume landed),
    461–498 (updateItemStatus's nested-map rebuild = the pattern for replaceItemById).
  - READ src/core/file-lock.ts:140–160 (TasksLockAcquisitionError), 492–560
    (withLockedTasksJSON contract + example).
  - CONFIRM: no parseSubcommand/switch exists (Commander auto-routes).

Task 2: ADD top-level imports to src/cli/index.ts (alongside the existing block, ~line 31–45)
  - ADD to a new or existing import from '../utils/task-utils.js':
    findItemByLooseId, matchStatus, cascadeCompleteDown, recomputeAncestorsUp, findItem,
    type HierarchyItem.  (normalizeTaskId is OPTIONAL — findItemByLooseId calls it.)
  - ADD: import { withLockedTasksJSON, TasksLockAcquisitionError } from '../core/file-lock.js';
  - ADD: import { type Backlog, type Status } from '../core/models.js';
  - DO NOT re-add dirname/basename/resolve/relative/existsSync/chalk/getLogger (already present).

Task 3: ADD the module-private replaceItemById splice (place near updateAction)
  - IMPLEMENT (reference code in "Implementation Patterns"): a ~10-line immutable
    "replace item at exact id" rebuild mirroring updateItemStatus's nested map.
  - Mode-A JSDoc stating it returns a new Backlog (structural sharing — only the
    ancestor path to the target is copied; non-path nodes shared by reference).
  - DO NOT: export it (module-private, like the taskAction const); import anything new.

Task 4: ADD the updateAction handler (Mode-A JSDoc) — mirror taskAction's try/catch shell
  - STEPS 1–6 exactly as in "What → Technical requirements" above.
  - Dynamic-import readFile + SessionManager + findLatestBugfixTasksFile (mirror taskAction).
  - File discovery = taskAction's ladder; REPLACE the awaiting_breakdown block with a
    HARD ERROR (exit 1) for a missing discovered tasks.json.
  - Lock+RMW mutator = the functional compose (findItem → cascade/spread → replaceItemById
    → recomputeAncestorsUp). Catch TasksLockAcquisitionError → lock-timeout message.
  - Output: text 'Updated <id> status to <Status>' / json {id,status,title}; then exit(0).
  - DO NOT: emit awaiting_breakdown; write tasks.json directly; modify taskAction.

Task 5: REGISTER the update command (sibling to task|status, ~line 848)
  - program.command('update').description(…).argument('<task-id>',…).argument('<status>',…)
    .option('-f, --file <path>',…).option('--session <hash>',…)
    .option('-o, --output <format>', 'Output format (text, json)', 'text').action(updateAction);
  - DO NOT: add a manual dispatcher (Commander auto-routes).

Task 6: CREATE tests/unit/cli/update-command.test.ts (mirror index.test.ts breakdown block)
  - vi.mock node:fs (existsSync per-test), node:fs/promises (readFile),
    ../core/session-manager.js + ../core/session-utils.js (mockFindLatestSession/
    mockListSessions/mockFindLatestBugfixTasksFile), ../utils/logger.js,
    ../utils/repo-root.js (no-op bootstrapRepoRoot), AND ../core/file-lock.js
    ({ withLockedTasksJSON: vi.fn((dir, mutator) => mutator(REAL_FIXTURE_BACKLOG)),
       TasksLockAcquisitionError: class extends Error {} }) — so the mutator runs for real.
  - CASES:
      1. success text:  argv ['update','1.1.1.1','done'] → exit 0, stdout 'Updated P1.M1.T1.S1 status to Complete'.
      2. success json:  ['update','1.1.1.1','done','-o','json'] → stdout {id:'P1.M1.T1.S1',status:'Complete',title:…}.
      3. synonym status: ['update','p1m1t1s1','re'] → 'Updated P1.M1.T1.S1 status to Ready'.
      4. not found:     ['update','9.9.9.9','done'] → exit 1, stderr 'Task not found: 9.9.9.9'.
      5. ambiguous:     ['update','1.1.1.1','r']   → exit 1, stderr matches /Ambiguous status "r".*(Ready|Researching)/.
      6. unknown:       ['update','1.1.1.1','bogus'] → exit 1, stderr matches /Unknown status "bogus"/.
      7. missing discovered file: existsSync(tasksFile)=false, dir=true → exit 1, stderr /not found/ (NO awaiting_breakdown).
      8. explicit --file missing: readFile rejects ENOENT → exit 1 (catch arm), stderr /no such file|not found/.
      9. lock timeout: mockWithLocked rejects new TasksLockAcquisitionError(…) → exit 1, stderr /locked/.
     10. (optional) cascade composition: a fixture backlog where update 1 done runs the REAL
         mutator → assert the mock's mutator was called + the returned backlog has P1+descendants Complete.
  - NAMING: it('<scenario>'); expect(bdExit).toHaveBeenCalledWith(0|1); spyOn console.log/process.stderr.write.

Task 7: CREATE tests/integration/cli-update.test.ts (mirror cli-task-status.test.ts)
  - Real temp plan/ dir + real tasks.json + real file-lock + real writeTasksJSON; mock ONLY logger.
  - CASES (read the file back after parseCLIArgs + flush):
      1. update 1 done → P1 + every milestone/task/subtask under P1 = Complete (cascade).
      2. update <last-incomplete-subtask> comp → its Task/Milestone/Phase = Complete (promote).
      3. update <a-complete-subtask> p → its Task/Milestone/Phase drop to least-progressed (DOWNGRADE).
      4. update 1.1.1.1 done -o json → stdout JSON {id,status,title} + file written.
      5. update 9.9.9.9 done → exit 1 + not found (file UNCHANGED — prove no partial write).
      6. (optional) atomic-write: assert no tasks.json.tmp left behind after a successful write.
  - NAMING: it('<scenario>'); JSON.parse(readFile(…)) → assert statuses at each level.

Task 8: FORMAT + VERIFY
  - RUN: npm run fix            (lint:fix + prettier --write)
  - RUN: npm run typecheck      (tsc --noEmit -p tsconfig.build.json)
  - RUN: npm run lint           (eslint . --ext .ts)
  - RUN: npm run format:check   (prettier --check)
  - RUN: npm run validate       (the gate: lint && format:check && typecheck && test:run) — MUST be GREEN
  - RUN: npx vitest run tests/unit/cli/update-command.test.ts tests/integration/cli-update.test.ts  (targeted)
  - EXPECTED: all green; taskAction/task/status + every other command's tests still green; coverage above floor.
```

### Implementation Patterns & Key Details

```ts
// ---- src/cli/index.ts — module-private immutable splice (NEW, ~10 lines) ----
// Mirrors updateItemStatus's nested-map rebuild, but injects `newItem` at the target.
// Pure: returns a new Backlog (structural sharing — only the path to the target is copied).

/**
 * Immutably replace the hierarchy item whose `id` equals `id` with `newItem`
 * (used by the `hack update` handler to splice a status-changed — and, for
 * `Complete`, cascadeCompleteDown-cascaded — item back into the locked backlog).
 *
 * @remarks
 * Walks the tree and rebuilds only the path from the root to the target node;
 * every other node is shared by reference (structural sharing). The target node
 * is replaced by `newItem` verbatim. Pure: the input `backlog` is never mutated.
 *
 * @param backlog - The backlog tree.
 * @param id - The EXACT (canonical) hierarchy id to replace.
 * @param newItem - The replacement item (already status-set; subtree already
 *   cascaded if the caller used {@link cascadeCompleteDown}).
 * @returns A new `Backlog` with `newItem` at the target position.
 */
function replaceItemById(
  backlog: Backlog,
  id: string,
  newItem: HierarchyItem
): Backlog {
  const rebuild = <T extends HierarchyItem>(items: T[]): T[] =>
    items.map(it => {
      if (it.id === id) return newItem as T;
      if ('subtasks' in it) return { ...it, subtasks: rebuild(it.subtasks) } as T;
      if ('tasks' in it) return { ...it, tasks: rebuild(it.tasks) } as T;
      if ('milestones' in it)
        return { ...it, milestones: rebuild(it.milestones) } as T;
      return it; // Subtask leaf that is not the target
    });
  return { ...backlog, backlog: rebuild(backlog.backlog) };
}
```

```ts
// ---- src/cli/index.ts — updateAction handler (NEW; Mode-A JSDoc; mirror taskAction) ----
// Two positional args (taskId, status) + options — NOTE: taskAction takes (action, options).

/**
 * Action handler for `hack update <task-id> <status>` (PRD §5.4).
 *
 * @remarks
 * Manually rewrites an item's status with loose task-ID + loose-status matching,
 * then performs a serialized, atomic, schema-validated read-modify-write of
 * `tasks.json` that applies the §5.4 cascade: if the target becomes `Complete`,
 * {@link cascadeCompleteDown} marks the whole subtree `Complete`; then
 * {@link recomputeAncestorsUp} recomputes every ancestor bottom-up as the
 * minimum-status of its children (which CAN demote ancestors on a regression).
 *
 * File discovery mirrors `hack task`/`hack status` (`--file` → `--session` → latest
 * session → prefer bugfix child), BUT `update` is a WRITE: a missing *discovered*
 * `tasks.json` is a HARD ERROR (exit 1), NOT the read-only `awaiting_breakdown`
 * notice. Every write goes through {@link withLockedTasksJSON} (exclusive sibling
 * lockfile + `BacklogSchema.parse` + atomic temp+rename), so it can never corrupt
 * `tasks.json` or race a concurrent writer. A lock that cannot be acquired within
 * the timeout fails fast (exit 1) with a clear message.
 *
 * Output: `Updated <id> status to <Status>` (text) or `{ id, status, title }` (json).
 *
 * @param taskId - Loose task ID (`P1.M1.T1.S1`, `1.1.1.1`, `p1m1t1s1`, `1.2`, …).
 * @param status - Loose status (`done`, `re`, `comp`, `ready`, …).
 * @param options - `{ file?, session?, output? }`.
 */
const updateAction = async (
  taskId: string,
  status: string,
  options: { file?: string; output?: string; session?: string }
): Promise<void> => {
  try {
    // 1. STATUS MATCH (pure, fail fast before any I/O).
    const statusResult = matchStatus(status);
    if ('error' in statusResult) {
      process.stderr.write(`${statusResult.error}\n`);
      process.exit(1);
    }
    const newStatus: Status = statusResult.status;

    // 2. FILE DISCOVERY (mirror taskAction; HARD ERROR on missing discovered file).
    const { readFile } = await import('node:fs/promises');
    const { SessionManager } = await import('../core/session-manager.js');
    const { findLatestBugfixTasksFile } =
      await import('../core/session-utils.js');
    const planDir = resolve('plan');

    let tasksFile: string;
    if (options.file) {
      tasksFile = resolve(options.file);
    } else {
      let sessionPath: string;
      if (options.session) {
        const sessions = await SessionManager.listSessions(planDir);
        const session = sessions.find(s => s.hash.startsWith(options.session!));
        if (!session) {
          throw new Error(`Session not found: ${options.session}`);
        }
        sessionPath = session.path;
      } else {
        const latest = await SessionManager.findLatestSession(planDir);
        if (!latest) {
          throw new Error(
            'No sessions found. Run the pipeline first or use --file / --session.'
          );
        }
        sessionPath = latest.path;
      }
      const bugfixTasks = await findLatestBugfixTasksFile(sessionPath);
      tasksFile = bugfixTasks ?? resolve(sessionPath, 'tasks.json');
    }

    // update is a WRITE: a missing discovered tasks.json is a HARD ERROR.
    if (!existsSync(tasksFile)) {
      process.stderr.write(
        `[hack] tasks.json not found at ${tasksFile}. Wait for PRD breakdown to finish, or pass an explicit --file.\n`
      );
      process.exit(1);
    }

    // 3. PRE-LOCK LOOSE LOOKUP (fail fast before acquiring the lock).
    const raw = JSON.parse(await readFile(tasksFile, 'utf-8'));
    const found = findItemByLooseId(raw as Backlog, taskId);
    if (!found) {
      process.stderr.write(`Task not found: ${taskId}\n`);
      process.exit(1);
    }
    const canonicalId = found.canonicalId;

    // 4. LOCK + RMW (serialized, atomic, schema-validated).
    const sessionDir = dirname(tasksFile);
    const updated = await withLockedTasksJSON(
      sessionDir,
      (backlog: Backlog): Backlog => {
        const target = findItem(backlog, canonicalId);
        if (!target) throw new Error(`Task not found: ${taskId}`); // defensive
        const newItem: HierarchyItem =
          newStatus === 'Complete'
            ? cascadeCompleteDown(target)
            : { ...target, status: newStatus };
        const spliced = replaceItemById(backlog, canonicalId, newItem);
        return recomputeAncestorsUp(spliced, canonicalId);
      }
    );

    // 5. OUTPUT.
    if (options.output === 'json') {
      const title = findItem(updated, canonicalId)?.title ?? '';
      console.log(
        JSON.stringify(
          { id: canonicalId, status: newStatus, title },
          null,
          2
        )
      );
    } else {
      console.log(`Updated ${canonicalId} status to ${newStatus}`);
    }
    process.exit(0);
  } catch (error) {
    if (error instanceof TasksLockAcquisitionError) {
      logger().error(`Could not acquire tasks.json lock: ${error.message}`);
      process.stderr.write(
        `[hack] tasks.json is locked by another process; try again shortly.\n`
      );
    } else {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger().error(`Update command failed: ${errorMessage}`);
      process.stderr.write(`[hack] ${errorMessage}\n`);
    }
    process.exit(1);
  }
};

// ---- registration (sibling to task|status) ----
program
  .command('update')
  .description('Manually update a task status (PRD §5.4)')
  .argument('<task-id>', 'Task ID (loose: P1.M1.T1.S1, 1.1.1.1, p1m1t1s1, 1.2)')
  .argument('<status>', 'Status (loose: done, re, comp, ready)')
  .option('-f, --file <path>', 'Override tasks.json file path')
  .option('--session <hash>', 'Target specific session by hash')
  .option('-o, --output <format>', 'Output format (text, json)', 'text')
  .action(updateAction);
```

```ts
// ---- tests/unit/cli/update-command.test.ts — harness sketch (mirrors index.test.ts:964) ----
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks (logger, repo-root no-op, session-manager, session-utils, file-lock).
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(),
    fatal: vi.fn(), child: vi.fn(function () { return mockLogger; }) },
}));
vi.mock('../../../src/utils/logger.js', () => ({ getLogger: vi.fn(() => mockLogger) }));
const { mockBootstrapRepoRoot } = vi.hoisted(() => ({ mockBootstrapRepoRoot: vi.fn() }));
vi.mock('../../../src/utils/repo-root.js', () => ({
  resolveRepositoryRoot: vi.fn(() => ({ repoRoot: '/mock-repo', invocationCwd: '/mock' })),
  bootstrapRepoRoot: mockBootstrapRepoRoot, getRepoRoot: vi.fn(() => '/mock-repo'),
  getInvocationCwd: vi.fn(() => process.cwd()),
}));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

const { mockFindLatestSession, mockListSessions, mockFindLatestBugfixTasksFile } = vi.hoisted(() => ({
  mockFindLatestSession: vi.fn(), mockListSessions: vi.fn(), mockFindLatestBugfixTasksFile: vi.fn(),
}));
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: { findLatestSession: mockFindLatestSession, listSessions: mockListSessions },
}));
vi.mock('../../../src/core/session-utils.js', () => ({
  findLatestBugfixTasksFile: mockFindLatestBugfixTasksFile,
}));

// file-lock mock: run the REAL mutator on a fixture backlog (so cascade composition is exercised).
import { type Backlog } from '../../../src/core/models.js';
const FIXTURE: Backlog = /* a small P1.M1.T1.S1(+S2) tree, P1 Planned */;
const { mockWithLocked, LockErr } = vi.hoisted(() => ({
  mockWithLocked: vi.fn(async (_dir: string, mutator: (b: Backlog) => Backlog) => mutator(/*FIXTURE*/)),
  LockErr: class extends Error {},
}));
vi.mock('../../../src/core/file-lock.js', () => ({
  withLockedTasksJSON: mockWithLocked,
  TasksLockAcquisitionError: LockErr,
}));

import { parseCLIArgs } from '../../../src/cli/index.js';

describe('hack update (PRD §5.4)', () => {
  const setArgv = (a: string[]) => { process.argv = ['node', 'script.js', ...a]; };
  let exit: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFindLatestSession.mockResolvedValue({ path: '/plan/001_abc', id: '001_abc', hash: 'abc' });
    mockListSessions.mockResolvedValue([{ path: '/plan/001_abc', id: '001_abc', hash: 'abc' }]);
    mockFindLatestBugfixTasksFile.mockResolvedValue(null);
    // tasks.json present by default
    (vi.mocked(await import('node:fs')).existsSync as any) = vi.fn(() => true);
    exit = vi.fn(); process.exit = exit as any;
  });
  // … per-case setup of readFile JSON + existsSync, then setArgv(['update', …]) + parseCLIArgs()
  //   + await new Promise(r => setImmediate(r)) + assertions on exit / console.log / stderr.
});
```

### Integration Points

```yaml
SOURCE (src/cli/index.ts — additive only):
  - + import { findItemByLooseId, matchStatus, cascadeCompleteDown, recomputeAncestorsUp, findItem, type HierarchyItem } from '../utils/task-utils.js'
  - + import { withLockedTasksJSON, TasksLockAcquisitionError } from '../core/file-lock.js'
  - + import { type Backlog, type Status } from '../core/models.js'
  - + function replaceItemById(backlog, id, newItem): Backlog   (module-private)
  - + const updateAction = async (taskId, status, options) => { … }   (Mode-A JSDoc)
  - + program.command('update')…action(updateAction)   (sibling to task|status)
  - NO change to taskAction / task|status registrations / main() / parseCLIArgs() / other commands

NEW TESTS:
  - tests/unit/cli/update-command.test.ts      (handler logic; withLockedTasksJSON mocked to run the real mutator)
  - tests/integration/cli-update.test.ts       (end-to-end RMW + cascade + ancestor + atomic write)

NO CHANGES TO (hard boundary):
  - src/utils/task-utils.ts, src/core/file-lock.ts, src/core/session-utils.ts, src/core/models.ts
  - any docs/*.md (DOCS = Mode B, handled by P1.M3.T1; this item ships ONLY JSDoc)
  - PRD.md, plan/** (except this PRP's own dir), tasks.json, package.json
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix              # lint:fix + prettier --write (aligns the new code)
npm run typecheck        # tsc --noEmit -p tsconfig.build.json
npm run lint             # eslint . --ext .ts
npm run format:check     # prettier --check "**/*.{ts,js,json,md,yml,yaml}"

# Targeted:
npx eslint src/cli/index.ts
npx prettier --check src/cli/index.ts

# Expected: Zero errors. Most likely nit: prettier formatting (re-run `npm run fix`).
# Type errors would arise from: a wrong import path, a missing `type` import (Backlog/Status
# are type-only), or mishandling the matchStatus discriminated union (narrow with
# `'error' in statusResult`). The reference handler above is type-correct.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new handler-logic suite (must pass):
npx vitest run tests/unit/cli/update-command.test.ts

# Expected: all 10 cases green — success text/json, synonym, not-found, ambiguous,
#   unknown, missing-discovered-file hard error, explicit --file missing, lock-timeout,
#   and the cascade-composition assertion. A failure means the handler emitted the wrong
#   channel/message/exit-code — re-read the matchStatus union + the hard-error distinction.
```

### Level 3: Integration Testing (System Validation)

```bash
# The new end-to-end suite (real temp dir + real lock + real atomic write):
npx vitest run tests/integration/cli-update.test.ts

# Expected: cascade (update 1 done → whole P1 tree Complete), promote (last subtask comp
#   → ancestors Complete), DOWNGRADE (subtask p → ancestors demote), json output + file
#   written, not-found exits 1 WITHOUT mutating the file (no partial write), no leftover
#   .tmp file after a successful atomic write.

# Manual smoke (optional, against a real session):
#   hack update 1.1.1.1 done && hack task      # subtask shows Complete
#   hack update 1 done && hack task            # whole phase tree Complete
#   hack update 9.9.9.9 done; echo $?          # non-zero + not found
#   hack update 1.1.1.1 r;     echo $?         # non-zero + ambiguity
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Full gate — MUST stay green. Proves the additive edit did NOT regress taskAction,
# task|status, inspect, cache, config, or any other command/parse test, and that
# coverage stays above the regression floor (89/90/94/89).
npm run validate         # = lint && format:check && typecheck && test:run
npm run test:coverage    # optional: confirm src/cli/index.ts updateAction region is covered

# Build emits dist/ cleanly (proves the edit compiles via tsc):
npx tsc -p tsconfig.build.json

# Expected: full suite green; coverage above floor; build succeeds.
# Domain-specific reasoning (record in commit message):
#   1. PRD §5.4 compliance: every acceptance criterion maps to a test (research §9).
#   2. Write-path discipline: the ONLY tasks.json writer is withLockedTasksJSON
#      (no direct writeFile) → serialized + atomic + schema-validated (§5.1).
#   3. Cascade correctness: downward cascadeCompleteDown + upward recomputeAncestorsUp
#      compose inside the mutator (recompute assumes the leaf is already set).
#   4. Hard-error vs awaiting_breakdown: update NEVER soft-fails a missing discovered file.
#   5. Boundary discipline: task-utils.ts / file-lock.ts / models.ts untouched.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck + test:run).
- [ ] `npx vitest run tests/unit/cli/update-command.test.ts tests/integration/cli-update.test.ts` exits 0.
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.
- [ ] Coverage stays above the regression floor (statements 89 / branches 90 /
      functions 94 / lines 89); `src/cli/index.ts` updateAction region well-covered.

### Feature Validation (PRD §5.4 acceptance criteria)

- [ ] `hack update 1.1.1.1 done` → `P1.M1.T1.S1` Complete + success line; `hack task` shows it.
- [ ] `hack update p1m1t1s1 re` → `P1.M1.T1.S1` Ready (synonym, case-insensitive).
- [ ] `hack update 1 done` → cascades `Complete` to EVERY item under `P1`.
- [ ] `hack update <last-incomplete-subtask> comp` → promotes Task/Milestone/Phase Complete.
- [ ] `hack update <a-subtask> p` → DOWNGRADES ancestors to least-progressed child.
- [ ] `hack update 9.9.9.9 done` → exit non-zero + "not found".
- [ ] `hack update 1.1.1.1 r` → exit non-zero + ambiguity (Ready + Researching).
- [ ] `hack update 1.1.1.1 bogus` → exit non-zero + valid-statuses list.
- [ ] Missing discovered tasks.json → HARD ERROR exit 1 (never `awaiting_breakdown`).
- [ ] Explicit `--file` missing → hard error (ENOENT → catch → exit 1).
- [ ] Lock timeout → exit non-zero + lock message.
- [ ] Write is atomic (temp+rename) under the §5.1 lock (integration test proves it).
- [ ] text + json output formats correct; success exits 0.

### Code Quality Validation

- [ ] Mirrors the inline `taskAction` pattern (NOT a class module under commands/).
- [ ] The ONLY tasks.json writer is `withLockedTasksJSON` (no direct `writeFile`).
- [ ] matchStatus handled as a discriminated union (`'error' in result`), not try/catch.
- [ ] recomputeAncestorsUp called AFTER the splice (leaf already set); no-op-safe for Phase.
- [ ] New imports are additive; no duplicate of existing top-level imports.
- [ ] `replaceItemById` is module-private + Mode-A JSDoc; `updateAction` has Mode-A JSDoc.
- [ ] Additive to index.ts — taskAction / task|status / main() / other commands untouched.

### Documentation & Deployment

- [ ] Mode-A JSDoc on `updateAction` (command semantics, cascade, hard-error, output, lock).
- [ ] Mode-A JSDoc on `replaceItemById` (immutable splice, structural sharing).
- [ ] NO user-facing docs/*.md edited (Mode B = P1.M3.T1's job).
- [ ] Commit message notes: §5.4 contract; composition of the 4 landed helpers +
      withLockedTasksJSON; the hard-error-vs-awaiting_breakdown distinction; the
      functional mutator choice; boundary discipline.

---

## Anti-Patterns to Avoid

- ❌ Don't write `tasks.json` directly (`writeFile`/`rename` of tasks.json in the
  handler). The ONLY sanctioned writer is `withLockedTasksJSON` → `writeTasksJSON`
  (serialized + atomic + schema-validated). (PRD §5.1/§5.4.)
- ❌ Don't emit `awaiting_breakdown` in `updateAction` — `update` is a WRITE; a
  missing discovered tasks.json is a HARD ERROR (exit 1), not the calm read-only notice.
- ❌ Don't `try/catch` `matchStatus` — it returns a discriminated union
  (`{status}` | `{error, candidates}`). Narrow with `'error' in result`. (research §3.)
- ❌ Don't call `recomputeAncestorsUp` BEFORE setting the target's status — it
  assumes the changed item is already set. Splice the new target first, then recompute.
- ❌ Don't use `setItemStatus` for the Complete case — it sets only the root in place,
  not descendants. Use `cascadeCompleteDown` (pure) + `replaceItemById`.
- ❌ Don't modify `src/utils/task-utils.ts`, `src/core/file-lock.ts`,
  `src/core/session-utils.ts`, or `src/core/models.ts` — those are the consumed
  contract (siblings' files). The only new logic is `replaceItemById` in index.ts.
- ❌ Don't create a `src/cli/commands/update.ts` class module — the architecture §F2.D
  says to mirror the INLINE `taskAction` pattern. task/status are also inline.
- ❌ Don't add a manual `parseSubcommand`/switch case for `update` — Commander
  auto-routes `.command('update').action(updateAction)`. (Verified: none exists.)
- ❌ Don't pass the `tasks.json` path to `withLockedTasksJSON` — pass
  `dirname(tasksFile)` (the session dir); the lock is on `<sessionDir>/tasks.json.lock`.
- ❌ Don't re-add imports already present at the top of index.ts
  (`dirname`/`basename`/`resolve`/`relative`/`existsSync`/`chalk`/`getLogger`).
- ❌ Don't edit any `docs/*.md` — DOCS is Mode B (P1.M3.T1). This item ships JSDoc only.
- ❌ Don't skip the integration test — it is the proof that the cascade + ancestor
  recompute + atomic write actually land on disk (unit tests mock the lock).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This item ADDS NO new utility logic — it composes four landed/contracted
helpers (`findItemByLooseId`, `matchStatus`, `cascadeCompleteDown`,
`recomputeAncestorsUp`) + `findItem` + the locked-RMW primitive
(`withLockedTasksJSON`) inside a CLI handler that mirrors an EXISTING, well-tested
handler (`taskAction`) line-for-line in structure. Every consumed signature is
verified (incl. the non-obvious `matchStatus` discriminated-union return and
`recomputeAncestorsUp`'s "leaf-already-set" precondition). The only new logic is a
~10-line immutable splice with a verbatim reference implementation. The
HARD-ERROR-vs-`awaiting_breakdown` distinction (the single most likely bug) is
called out in 4 places. The exact registration block, the 6-step handler body, the
catch tail, the test harness (incl. the file-lock mock that runs the real mutator),
and the integration template are all written out. The residual risks are: (a) a
prettier/lint nit (`npm run fix` resolves it); (b) the test mock plumbing for the
dynamic-imported `SessionManager`/`findLatestBugfixTasksFile`/`file-lock` — the
reference harness sketches the exact `vi.mock` calls; (c) P1.M2.T3.S2
(`recomputeAncestorsUp`) is running in parallel — its PRP is treated as a contract
and the composition does not depend on its internals, only its verified signature +
precondition. Validation is the project's standard `npm run validate` gate plus the
two targeted test files.