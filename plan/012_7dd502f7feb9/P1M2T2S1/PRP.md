# PRP — P1.M2.T2.S1: `matchStatus` with synonym table, prefix/substring matching, and ambiguity detection

> PRD §5.4 **"Loose status matching."** One new pure exported function in `src/utils/task-utils.ts` that
> fuzzy-matches a loose status string (e.g. `done`, `re`, `comp`, `ready`, `r`, `bogus`) to a canonical
> `Status`, implementing the 5-step matching order (synonym → exact → unique prefix → unique substring →
> ambiguous/unknown) over the 7 manually-settable statuses (`Retrying` excluded). Returns a discriminated
> union: `{ status }` on success, `{ error, candidates }` on failure. **Consumed by P1.M2.T4.S1** (the
> `hack update` handler prints the error + exits non-zero on the failure arm). Architecture pin:
> `implementation-status.md §F2.B`. **Additive only — `findItem`/`normalizeTaskId`/`findItemByLooseId` are
> NOT modified.** `Status` is already imported in both files → no import change → merge-safe with the
> parallel P1.M2.T1.S1.

---

## Goal

**Feature Goal**: Implement PRD §5.4 "Loose status matching" as one pure exported function in
`src/utils/task-utils.ts`:
`matchStatus(input: string): { status: Status } | { error: string; candidates: string[] }` —
match over the 7 manually-settable statuses (`Planned, Researching, Ready, Implementing, Complete,
Failed, Obsolete`; `Retrying` excluded) in the order: synonym table → canonical exact → unique prefix →
unique substring → ambiguous → unknown. Returns `{ status }` on a confident match, `{ error, candidates }`
on ambiguity (2+ matches) or unknown (0 matches).

**Deliverable**:
1. **`src/utils/task-utils.ts`** — EDIT (additive): add the exported `matchStatus` function (with
   Mode-A JSDoc) + a module-level `MATCHABLE` / `SYNONYMS` constant. `Status` is already imported
   (line 25) → NO import change. Place the function near `updateItemStatus` (~line 380) — physically
   away from `findItem` (~110) where the parallel P1.M2.T1.S1 adds its functions. No other function
   touched.
2. **`tests/unit/core/task-utils.test.ts`** — EDIT (additive): add `matchStatus` to the existing named
   import from `task-utils.js`; append a `describe('matchStatus', …)` block (inside the top-level
   `describe('utils/task-utils')`) covering all 5 steps + both error arms + the synonym-vs-ambiguous
   insight.

**Success Definition**:
- Synonyms: `'done'`/`'d'`/`'fin'`/`'finished'`/`'completed'` → Complete; `'re'`/`'rdy'` → Ready (step 1).
- Canonical exact (case-insensitive): `'ready'`, `'Complete'`, `'FAILED'` → that status (step 2).
- Unique prefix: `'comp'`→Complete, `'c'`→Complete, `'p'`→Planned, `'i'`→Implementing, `'o'`→Obsolete,
  `'f'`→Failed, `'res'`→Researching (step 3).
- Unique substring (not a prefix): `'search'`→Researching, `'lan'`→Planned (step 4).
- Ambiguous: `'r'` → `{ error: 'Ambiguous status "r": matches Ready, Researching', candidates: ['Ready','Researching'] }` (step 5 via prefix).
- Ambiguous (substring): `'ed'` → candidates `['Failed','Planned']` (step 5 via substring).
- Unknown: `'bogus'` → `{ error: 'Unknown status "bogus". Valid statuses: Planned, Researching, Ready, Implementing, Complete, Failed, Obsolete', candidates: [all 7] }` (step 6).
- `'re'` returns `{ status: 'Ready' }` (synonym preempts the `r`-prefix ambiguity); `'r'` is ambiguous.
- `findItem`/`normalizeTaskId`/`findItemByLooseId` UNCHANGED; all existing tests stay GREEN.
- `npm run typecheck && npm run lint && npm run format:check` clean; `task-utils.test.ts` GREEN;
  `src/utils/task-utils.ts` 100% covered.

---

## Why

- **Enables PRD §5.4 `hack update`.** The command's `<status>` argument is fuzzy-matched: `hack update
  1.2 done`, `hack update p1m1t1s1 re`, `hack update 2 comp`. P1.M2.T4.S1 (the CLI handler) calls
  `matchStatus(argv.status)`; on `{ status }` it proceeds with the cascade, on `{ error }` it prints
  `result.error` to stderr + exits non-zero. T2 provides the matcher; T4 wires it.
- **Pure + reusable + total.** `matchStatus` is pure (no I/O, no mutation) and total (never throws —
  every input yields a typed result). The discriminated union makes success/failure impossible to
  ignore at the call site (TS forces the `in`-based narrow). Independently testable + 100%-coverable.
- **The synonym-vs-ambiguity design is load-bearing.** `re` is a SYNONYM for Ready (step 1) so it
  resolves cleanly; without the synonym table, `re` would prefix-match both Ready AND Researching →
  ambiguous. Raw `r` is NOT a synonym → ambiguous by design. This matches PRD §5.4's "shorthands that
  would otherwise be ambiguous" rationale and the acceptance criterion `hack update 1.1.1.1 r →
  ambiguity message listing Ready and Researching`.
- **`Retrying` exclusion is deliberate.** `Retrying` is an internal transitional status set by the
  retry manager; letting a user set it by hand would fight the orchestrator. The matchable set is the
  7 lifecycle statuses. A stuck `Retrying` item is reset via `Planned`/`Ready` (both matchable).
- **Additive + merge-safe.** `Status` is ALREADY imported in task-utils.ts (line 25) and in the test
  (line 22) → this item adds NO import. It appends ONE export (`matchStatus`) + ONE describe block. It
  is file-disjoint from the parallel P1.M1.T4.S1 (`git-commit.ts`) and merge-safe with the parallel
  P1.M2.T1.S1 (same two files, but different exports/describes; the only shared edit is appending a
  name to the same multi-line named import — an additive text merge).
- **Out of scope (hard boundary):** the loose task-ID matcher `normalizeTaskId`/`findItemByLooseId`
  (P1.M2.T1.S1 — parallel), the cascade engine `cascadeCompleteDown`/`recomputeAncestorsUp`
  (P1.M2.T3.S1/S2 — sequenced after), the `hack update` CLI handler (P1.M2.T4.S1 — consumer), modifying
  `findItem`/`promoteIfAllComplete`/`rollupCompletion` or any existing function, any `docs/*.md`
  (DOCS: Mode A — JSDoc only), and the Status/StatusEnum types (read-only).

---

## What

### User-visible behavior
None directly (internal utility). Indirectly, via P1.M2.T4.S1: `hack update`'s `<status>` argument
will fuzzy-match. T2 only ships the matcher + its tests.

### Technical requirements (exact contract)

**`src/utils/task-utils.ts`** — add the module-level constants + the exported function. Place near
`updateItemStatus` (~line 380). `Status` is already imported (line 25) — do NOT add an import.
Verbatim:

```ts
/**
 * The statuses that are manually settable via `hack update` (PRD §5.4).
 *
 * @remarks
 * This is the §5.3 lifecycle set PLUS `Ready`, MINUS `Retrying`. `Retrying` is
 * an internal transitional status set by the retry manager; allowing a user to
 * set it by hand would fight the orchestrator, so it is intentionally excluded
 * from loose matching. A stuck `Retrying` item is reset via `Planned` or `Ready`.
 */
const MATCHABLE_STATUSES: Status[] = [
  'Planned',
  'Researching',
  'Ready',
  'Implementing',
  'Complete',
  'Failed',
  'Obsolete',
];

/**
 * Synonyms / aliases for statuses that are not derivable from the canonical word
 * or would otherwise be ambiguous (PRD §5.4 step 1). Keys are matched EXACT,
 * case-insensitive (NOT as prefixes). `re`/`rdy` → Ready preempts the `r`-prefix
 * ambiguity with Researching; `done`/`fin`/… → Complete are common shorthands.
 */
const STATUS_SYNONYMS: Readonly<Record<string, Status>> = {
  d: 'Complete',
  done: 'Complete',
  fin: 'Complete',
  finished: 'Complete',
  completed: 'Complete',
  re: 'Ready',
  rdy: 'Ready',
};

/**
 * Fuzzy-match a loose status string to a canonical {@link Status} (PRD §5.4 "Loose status matching").
 *
 * @remarks
 * Matches over the 7 manually-settable statuses
 * ({@link MATCHABLE_STATUSES} — `Retrying` excluded; see its doc). Matching order,
 * first hit wins:
 *
 * 1. **Synonym table** (exact, case-insensitive) — see {@link STATUS_SYNONYMS}.
 *    `done`/`d`/`fin`/`finished`/`completed` → Complete; `re`/`rdy` → Ready.
 * 2. **Canonical exact** (case-insensitive) — `input.toLowerCase()` equals one of the 7.
 * 3. **Unique prefix** — `input.toLowerCase()` is a prefix of exactly one status.
 * 4. **Unique substring** — `input.toLowerCase()` is a substring of exactly one status.
 * 5. **Ambiguous** — 2+ matches at the prefix OR substring level → `{ error, candidates }`.
 * 6. **Unknown** — 0 matches → `{ error, candidates: [all 7] }`.
 *
 * Steps 3 and 4 are separate, each with its own count + ambiguity check. Step 3
 * (prefix) is tried first and returns on a unique hit before step 4 (substring)
 * ever runs; substring matching is reached only when the input is not a prefix
 * of any status. The synonym table (step 1) preempts ambiguity: `re` resolves to
 * Ready there, so it never reaches prefix matching where it would also match
 * Researching. A raw `r` is NOT a synonym → prefix-matches both Ready and
 * Researching → ambiguous.
 *
 * @returns A discriminated union: `{ status }` on success, or `{ error, candidates }`
 *          on ambiguity/unknown. Narrow with `'status' in result` / `'error' in result`.
 *
 * @param input - The raw status string from the CLI (e.g. `done`, `re`, `comp`, `r`, `bogus`).
 *
 * @example
 * matchStatus('done');  // { status: 'Complete' }          — synonym (step 1)
 * matchStatus('re');    // { status: 'Ready' }             — synonym preempts ambiguity
 * matchStatus('ready'); // { status: 'Ready' }             — canonical exact (step 2)
 * matchStatus('comp');  // { status: 'Complete' }          — unique prefix (step 3)
 * matchStatus('search');// { status: 'Researching' }       — unique substring (step 4)
 * matchStatus('r');     // { error: 'Ambiguous status "r": matches Ready, Researching',
 *                       //   candidates: ['Ready','Researching'] }  — ambiguous (step 5)
 * matchStatus('bogus'); // { error: 'Unknown status "bogus". Valid statuses: …',
 *                       //   candidates: [<all 7>] }        — unknown (step 6)
 */
export function matchStatus(
  input: string
): { status: Status } | { error: string; candidates: string[] } {
  const lower = input.toLowerCase();

  // 1. SYNONYM (exact, case-insensitive)
  if (lower in STATUS_SYNONYMS) return { status: STATUS_SYNONYMS[lower] };

  // 2. CANONICAL EXACT (case-insensitive)
  const exact = MATCHABLE_STATUSES.find(s => s.toLowerCase() === lower);
  if (exact) return { status: exact };

  // 3. UNIQUE PREFIX
  const prefixMatches = MATCHABLE_STATUSES.filter(s =>
    s.toLowerCase().startsWith(lower)
  );
  if (prefixMatches.length === 1) return { status: prefixMatches[0] };
  if (prefixMatches.length >= 2) {
    return {
      error: `Ambiguous status "${input}": matches ${prefixMatches.join(', ')}`,
      candidates: [...prefixMatches],
    };
  }

  // 4. UNIQUE SUBSTRING (prefix matched 0 → try the broader match)
  const substringMatches = MATCHABLE_STATUSES.filter(s =>
    s.toLowerCase().includes(lower)
  );
  if (substringMatches.length === 1) return { status: substringMatches[0] };
  if (substringMatches.length >= 2) {
    return {
      error: `Ambiguous status "${input}": matches ${substringMatches.join(', ')}`,
      candidates: [...substringMatches],
    };
  }

  // 6. UNKNOWN
  return {
    error: `Unknown status "${input}". Valid statuses: ${MATCHABLE_STATUSES.join(', ')}`,
    candidates: [...MATCHABLE_STATUSES],
  };
}
```

**`tests/unit/core/task-utils.test.ts`** — additive tests (see Implementation Tasks). Add `matchStatus`
to the existing named import from `'../../../src/utils/task-utils.js'`. `Status` is already imported
(line 22) — no new type import needed.

### Success Criteria
- [ ] `matchStatus` exported from `src/utils/task-utils.ts`; `Status` already imported (no import change).
- [ ] All 5 steps + both error arms behave per the §F2.B worked examples (see research §4).
- [ ] `'re'` → Ready (synonym); `'r'` → ambiguous `[Ready, Researching]` (the headline distinction).
- [ ] `'bogus'` → unknown error with `candidates` = all 7 (canonical order).
- [ ] `findItem`/`normalizeTaskId`/`findItemByLooseId`/`promoteIfAllComplete`/`rollupCompletion` UNCHANGED.
- [ ] Mode-A JSDoc on `matchStatus` (synonym table + 5-step order + 7-status set + Retrying rationale + union + 4 @example).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `task-utils.test.ts` GREEN; `task-utils.ts` 100% covered.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim
function body + the two module-level constants, the verified fact that `Status` is ALREADY imported in both
files (no import change → parallel-safe), the precise prefix-vs-substring control-flow (step 3 returns on
unique-or-ambiguous; substring only when prefix=0), the synonym-preempts-ambiguity insight (`re` vs `r`),
the full worked-examples table (every branch), the discriminated-union narrowing pattern (`'status' in result`),
the placement guidance (near updateItemStatus ~380, away from findItem ~110), the test path
(`tests/unit/CORE/`, not `utils/`), the assertion style to mirror, the do-not-modify list, and the executable
validation commands. See `research/matchstatus-algorithm.md` for the grep evidence + per-claim proofs.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the architecture pin for this exact task
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F2.B — Loose status matcher (src/utils/task-utils.ts)"
  why: Pins the signature, the 7-status matchable set (Retrying excluded), the 5-step matching order,
        and the `re`-synonym-vs-`r`-ambiguous insight verbatim.
  critical: Steps 3 and 4 are SEPARATE (each its own count + ambiguity check); substring matching is
        reached ONLY when prefix matching yields 0. The synonym table preempts the `re` ambiguity.

# AUTHORITATIVE SPEC — the PRD text
- docfile: PRD.md   # (provided in selected_prd_content §5.4 "Loose status matching")
  section: §5.4 "Loose status matching" + the `hack update` examples block + the acceptance criteria
  why: Defines the synonym table, the 5-step order, the matchable set, and the acceptance criteria
        (`hack update 1.1.1.1 r` → ambiguity listing Ready + Researching; `… bogus` → list of valid statuses).

# CONTEXT — S1-of-T1 (parallel, same files) — read the CONTRACT, assume it landed
- docfile: plan/012_7dd502f7feb9/P1M2T1S1/PRP.md
  why: Adds normalizeTaskId + findItemByLooseId to task-utils.ts (near findItem ~110) + 2 describe blocks.
        This item adds matchStatus (near updateItemStatus ~380) + 1 describe block. Status is ALREADY
        imported → no import conflict. The only shared edit is appending a name to the same multi-line
        named import in the test file (additive text merge). Assume T1.S1 landed; confirm both names are
        present after merge.

# CONSUMER (read the CONTRACT, do NOT implement it) — P1.M2.T4.S1
- file: plan/012_7dd502f7feb9/tasks.json   # (or the T4.S1 PRP when it exists)
  why: T4.S1 (hack update handler in src/cli/index.ts) calls matchStatus(argv.status); on { status }
        proceeds with the cascade; on { error } prints result.error to stderr + exits non-zero. Narrow via
        `'status' in result`. T2 provides the matcher; T2 MUST NOT touch src/cli/index.ts.

# PATTERN FILE — the file being edited
- file: src/utils/task-utils.ts
  why: EDIT (additive). Status is imported @25 (alongside Backlog/Phase/Milestone/Task/Subtask) — NO import
        change. Place matchStatus + the two module-level consts near updateItemStatus (~380), AWAY from
        findItem (~110) where T1.S1 adds its functions (minimize textual diff overlap). findItem@90 (exact-id
        DFS — DO NOT MODIFY); promoteIfAllComplete@313 / rollupCompletion@343 (monotonic, orchestrator-facing
        — DO NOT MODIFY; T3's cascade is separate).
  pattern: "import type { Backlog, Phase, Milestone, Task, Subtask, Status } from '../core/models.js';"
  gotcha: Do NOT add a Status import (it's already there). Do NOT modify findItem or the promote/rollup fns.

# DATA SHAPES (read-only)
- file: src/core/models.ts
  why: Status union @175 (8 values incl. Retrying); StatusEnum @200 (Zod). matchStatus matches against
        the 7 MATCHABLE ones (Retrying excluded). READ-ONLY — do NOT edit.

# TEST PATTERN — the file being extended (NOTE the path: tests/unit/CORE/, not utils/)
- file: tests/unit/core/task-utils.test.ts
  why: EDIT (additive). Named import from '../../../src/utils/task-utils.js' (12-20) — ADD matchStatus.
        Status is imported @22 (from '../../../src/core/models.js') — NO new type import. Top-level
        describe('utils/task-utils')@~172. APPEND describe('matchStatus') INSIDE it (at the end).
  pattern: "expect(result).toEqual({ status: 'Complete' });  …  expect(result.candidates).toEqual(['Ready','Researching']);"
  gotcha: The ambiguous/unknown arms return { error, candidates } — assert BOTH result.error (contains the
        input + the candidates) AND result.candidates (the array, canonical order). Use toEqual on the whole
        result for exact-shape assertions where deterministic.
```

### Current Codebase tree (relevant slice)
```bash
src/utils/task-utils.ts                     # EDIT (additive): +matchStatus +MATCHABLE_STATUSES +STATUS_SYNONYMS (+Mode-A JSDoc)
src/core/models.ts                          # READ-ONLY (Status @175, StatusEnum @200)
src/cli/index.ts                            # UNCHANGED (P1.M2.T4.S1 consumes matchStatus later)
tests/unit/core/task-utils.test.ts          # EDIT (additive): +matchStatus import +1 describe block
```

### Desired Codebase tree with files to be added/edited
```bash
src/utils/task-utils.ts                     # MODIFIED (+1 exported function +2 module consts +Mode-A JSDoc)
tests/unit/core/task-utils.test.ts          # MODIFIED (+1 import name +1 additive describe block)
# No new files. No docs/*.md (DOCS: Mode A — JSDoc only).
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — Status is ALREADY imported in BOTH files (task-utils.ts:25, test:22). Do NOT add a Status
//   import. This is what makes this item merge-safe with the parallel P1.M2.T1.S1 (which also adds no
//   import). The ONLY shared edit is appending a name to the same multi-line named import in the test
//   file — an additive text merge (git auto-merges two distinct inserted lines in an import block).

// CRITICAL — Steps 3 (prefix) and 4 (substring) are SEPARATE, each with its own count + ambiguity check.
//   Step 3 returns on length===1 (unique) OR length>=2 (ambiguous); it FALLS THROUGH to step 4 ONLY when
//   length===0. So substring matching runs only when the input is not a prefix of ANY status. Do NOT
//   combine them into a single "find all matches then count" pass — the contract pins the order (prefix
//   is more specific, so it wins/aborts before the broader substring pass).

// CRITICAL — The synonym table is EXACT case-insensitive (step 1), NOT prefix. 'done' is a synonym;
//   'don' is NOT (it falls through → unknown). Do NOT change step 1 to a prefix/substring check.

// CRITICAL — 're' is a synonym for Ready (step 1) → returns { status: 'Ready' } IMMEDIATELY. It never
//   reaches prefix matching (where 're' would match Ready AND Researching → ambiguous). This preemption
//   is BY DESIGN (the PRD "shorthands that would otherwise be ambiguous" rationale). Raw 'r' is NOT a
//   synonym → ambiguous. Do NOT "fix" 're' to be ambiguous.

// CRITICAL — Return type is { status: Status } | { error: string; candidates: string[] } — a union with
//   NO shared discriminant field. Do NOT add a `kind`/`ok` field (the contract pins the exact shape). The
//   consumer narrows via `'status' in result` / `'error' in result`.

// CRITICAL — candidates is a COPY ([...matches] / [...MATCHABLE_STATUSES]), not the module-level array
//   reference. Defensive (the consumer never mutates it, but copying avoids sharing the const). Order is
//   MATCHABLE_STATUSES order (canonical lifecycle order) — .filter preserves source order.

// GOTCHA — MATCHABLE_STATUSES is typed Status[] (not `as const` / readonly). STATUS_SYNONYMS is
//   Readonly<Record<string, Status>>. The `lower in STATUS_SYNONYMS` check + `STATUS_SYNONYMS[lower]`
//   access typecheck cleanly (Record indexing). prefixMatches/substringMatches are Status[]; assigning
//   to candidates: string[] is fine (Status ⊂ string). No `as` casts needed.

// GOTCHA — Place matchStatus near updateItemStatus (~380), NOT near findItem (~110) where T1.S1 adds its
//   functions. This minimizes the textual diff overlap in the parallel merge (different regions of the
//   same file → clean auto-merge). In the test, append the matchStatus describe at the END of the
//   top-level describe (T1.S1 also appends at the end; the two appended blocks are independent).

// GOTCHA — The test file lives at tests/unit/CORE/task-utils.test.ts (NOT tests/unit/utils/). Import path
//   '../../../src/utils/task-utils.js'. Mirror the existing describe assertion style.

// GOTCHA — 100% coverage globally enforced (vitest.config.ts). Every branch must be hit: step-1 synonym
//   (true+false arms), step-2 exact (hit+miss), step-3 length===1 / length>=2 / fall-through, step-4
//   length===1 / length>=2 / fall-through, step-6 unknown. The worked-examples table (research §4) covers
//   all of them.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the JSDoc @example fences
//   + the multi-line union signature may reflow).

// GOTCHA — Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures). Gate
//   = typecheck + lint + format:check + the targeted tests/unit/core/task-utils.test.ts.

// CRITICAL — DO NOT modify findItem (~110), normalizeTaskId/findItemByLooseId (T1.S1's, ~110), or the
//   monotonic promoteIfAllComplete (~313) / rollupCompletion (~343) — those are orchestrator-facing and
//   T3's cascade engine is a SEPARATE pair of functions. matchStatus is a NEW standalone export.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. Two module-level constants (`MATCHABLE_STATUSES: Status[]`, `STATUS_SYNONYMS:
Readonly<Record<string, Status>>`) + one pure exported function whose return type is an inline
discriminated union (`{ status: Status } | { error: string; candidates: string[] }`). `Status` is
already imported.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/core/task-utils.test.ts  (RED — failing import/assertions FIRST)
  - IMPORT: add `matchStatus` to the existing named import from '../../../src/utils/task-utils.js'
    (lines 12-20). Status is already imported (line 22) — NO new type import.
  - APPEND `describe('matchStatus', () => { … })` INSIDE the top-level describe('utils/task-utils'),
    at the END (T1.S1 appends its describes at the end too; the blocks are independent):
      * it('synonym table (step 1)'):
          expect(matchStatus('done')).toEqual({ status: 'Complete' });
          expect(matchStatus('d')).toEqual({ status: 'Complete' });
          expect(matchStatus('fin')).toEqual({ status: 'Complete' });
          expect(matchStatus('finished')).toEqual({ status: 'Complete' });
          expect(matchStatus('completed')).toEqual({ status: 'Complete' });
          expect(matchStatus('re')).toEqual({ status: 'Ready' });
          expect(matchStatus('rdy')).toEqual({ status: 'Ready' });
      * it('canonical exact, case-insensitive (step 2)'):
          expect(matchStatus('ready')).toEqual({ status: 'Ready' });
          expect(matchStatus('Complete')).toEqual({ status: 'Complete' });
          expect(matchStatus('FAILED')).toEqual({ status: 'Failed' });
          expect(matchStatus('planned')).toEqual({ status: 'Planned' });
      * it('unique prefix (step 3)'):
          expect(matchStatus('comp')).toEqual({ status: 'Complete' });
          expect(matchStatus('c')).toEqual({ status: 'Complete' });
          expect(matchStatus('p')).toEqual({ status: 'Planned' });
          expect(matchStatus('i')).toEqual({ status: 'Implementing' });
          expect(matchStatus('o')).toEqual({ status: 'Obsolete' });
          expect(matchStatus('f')).toEqual({ status: 'Failed' });
          expect(matchStatus('res')).toEqual({ status: 'Researching' });
      * it('re is a synonym that preempts the r-prefix ambiguity'):
          expect(matchStatus('re')).toEqual({ status: 'Ready' });   // synonym, NOT ambiguous
      * it('unique substring, not a prefix of any (step 4)'):
          expect(matchStatus('search')).toEqual({ status: 'Researching' });
          expect(matchStatus('lan')).toEqual({ status: 'Planned' });
      * it('ambiguous via prefix (step 5)'):
          const r = matchStatus('r');
          expect('error' in r).toBe(true);
          expect(r.candidates).toEqual(['Ready', 'Researching']);
          expect(r.error).toContain('Ambiguous status "r"');
          expect(r.error).toContain('Ready');
          expect(r.error).toContain('Researching');
      * it('ambiguous via substring (step 5)'):
          const ed = matchStatus('ed');
          expect('error' in ed).toBe(true);
          expect(ed.candidates).toEqual(['Failed', 'Planned']);
      * it('unknown (step 6)'):
          const bogus = matchStatus('bogus');
          expect('error' in bogus).toBe(true);
          expect(bogus.candidates).toEqual(['Planned','Researching','Ready','Implementing','Complete','Failed','Obsolete']);
          expect(bogus.error).toContain('Unknown status "bogus"');
          expect(bogus.error).toContain('Valid statuses');
      * it('a non-synonym near-miss is unknown (synonym exactness)'):
          expect('error' in matchStatus('don')).toBe(true);   // 'done' is the synonym, not 'don'
      * it('Retrying is NOT matchable'):
          // 'ret' is a prefix of only 'Retrying' among the 8 Status values, but Retrying is EXCLUDED
          // from MATCHABLE_STATUSES → 'ret' matches nothing → unknown (candidates = the 7).
          const ret = matchStatus('ret');
          expect('error' in ret).toBe(true);
          expect(ret.candidates).not.toContain('Retrying');
  - DO NOT: edit the existing findItem/isSubtask/etc. describes or T1.S1's new describes.
  - EXPECTED NOW: the import FAILS (matchStatus doesn't exist) → RED.

Task 2: EDIT src/utils/task-utils.ts  (GREEN — the constants + function)
  - ADD MATCHABLE_STATUSES + STATUS_SYNONYMS (module-level consts, verbatim in "Technical requirements").
  - ADD matchStatus (verbatim body), with its Mode-A JSDoc, placed near updateItemStatus (~line 380) —
    AWAY from findItem (~110) where T1.S1 adds its functions.
  - DO NOT: add a Status import (already @25); modify findItem/normalizeTaskId/findItemByLooseId/
    promoteIfAllComplete/rollupCompletion or any existing function; use `as` casts (none needed); add a
    discriminant field to the return type.
  - EXPECTED: Task 1's tests turn GREEN; existing tests stay GREEN.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/task-utils.test.ts   # new describe + all existing — GREEN.
  - RUN: npx vitest run tests/unit/core/task-utils.test.ts --coverage   # task-utils.ts 100%.
  - DO NOT run the full `npm run test:run` (orthogonal pre-existing failures — not this item's concern).
  - EXPECTED: typecheck/lint/format clean; task-utils.test.ts green; task-utils.ts 100% covered. If a
    branch is uncovered, add the missing case (synonym-false, exact-miss, prefix 0/1/2+, substring 0/1/2+).
```

### Implementation Patterns & Key Details
```ts
// ---- the two module-level consts (place above matchStatus, near updateItemStatus ~380) ----
const MATCHABLE_STATUSES: Status[] = ['Planned','Researching','Ready','Implementing','Complete','Failed','Obsolete'];
const STATUS_SYNONYMS: Readonly<Record<string, Status>> = {
  d: 'Complete', done: 'Complete', fin: 'Complete', finished: 'Complete', completed: 'Complete',
  re: 'Ready', rdy: 'Ready',
};

// ---- matchStatus (5 steps; prefix tried before substring; candidates are copies) ----
export function matchStatus(input: string): { status: Status } | { error: string; candidates: string[] } {
  const lower = input.toLowerCase();
  if (lower in STATUS_SYNONYMS) return { status: STATUS_SYNONYMS[lower] };                 // 1
  const exact = MATCHABLE_STATUSES.find(s => s.toLowerCase() === lower);
  if (exact) return { status: exact };                                                     // 2
  const prefixMatches = MATCHABLE_STATUSES.filter(s => s.toLowerCase().startsWith(lower));  // 3
  if (prefixMatches.length === 1) return { status: prefixMatches[0] };
  if (prefixMatches.length >= 2) return { error: `Ambiguous status "${input}": matches ${prefixMatches.join(', ')}`, candidates: [...prefixMatches] };
  const substringMatches = MATCHABLE_STATUSES.filter(s => s.toLowerCase().includes(lower)); // 4
  if (substringMatches.length === 1) return { status: substringMatches[0] };
  if (substringMatches.length >= 2) return { error: `Ambiguous status "${input}": matches ${substringMatches.join(', ')}`, candidates: [...substringMatches] };
  return { error: `Unknown status "${input}". Valid statuses: ${MATCHABLE_STATUSES.join(', ')}`, candidates: [...MATCHABLE_STATUSES] }; // 6
}

// ---- the headline distinction: synonym preempts ambiguity ----
matchStatus('re');  // { status: 'Ready' }    — synonym (step 1); never reaches prefix matching
matchStatus('r');   // { error: 'Ambiguous status "r": matches Ready, Researching', candidates: ['Ready','Researching'] } — prefix (step 3, length 2)

// ---- the consumer narrowing pattern (P1.M2.T4.S1) ----
const result = matchStatus(argv.status);
if ('status' in result) { /* result.status: Status — proceed */ } else { console.error(result.error); process.exit(1); }
```

### Integration Points
```yaml
TASK-UTILS.TS (src/utils/task-utils.ts):
  - +const MATCHABLE_STATUSES: Status[] (7 statuses; Retrying excluded)
  - +const STATUS_SYNONYMS: Readonly<Record<string, Status>> (done/d/fin/finished/completed→Complete; re/rdy→Ready)
  - +export function matchStatus(input): { status } | { error, candidates }
  - PRESERVE: findItem, normalizeTaskId (T1.S1), findItemByLooseId (T1.S1), isSubtask, getDependencies,
    getAllSubtasks, updateItemStatus, filterByStatus, getNextPendingItem, promoteIfAllComplete,
    rollupCompletion, HierarchyItem. NO existing function edited. NO import added (Status already @25).

DOWNSTREAM CONSUMER (P1.M2.T4.S1 — NOT T2):
  - src/cli/index.ts `hack update` handler: matchStatus(argv.status) → if { status } proceed with cascade
    (T3); if { error } print result.error + exit non-zero. T2 MUST NOT touch src/cli/index.ts.

SIBLING P1.M2 SUBTASKS:
  - P1.M2.T1.S1 (parallel): adds normalizeTaskId + findItemByLooseId to the same file. Merge-safe
    (different exports/regions; Status already imported; the only shared edit is appending a name to the
    test file's multi-line named import — additive text merge).
  - P1.M2.T3.S1/S2 (sequenced after): cascadeCompleteDown + recomputeAncestorsUp (other functions). Do NOT
    implement them here; do NOT modify promoteIfAllComplete/rollupCompletion (orchestrator-facing).

DOCS (Mode A — JSDoc rides with the work):
  - JSDoc on matchStatus (synonym table + 5-step order + 7-status set + Retrying rationale + union + 4
    @example) is the only doc artifact. NO docs/*.md.
  - Commit message notes: PRD §5.4 loose status matcher; 5-step order; re-synonym vs r-ambiguous; Retrying
    excluded; discriminated union; consumed by P1.M2.T4.S1 (hack update); merge-safe with T1.S1.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — JSDoc @example fences + union sig may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (no casts needed; Record indexing typechecks)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. If lint flags an unused const or a `prefer-const`, prune/fix it.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — new describe + ALL existing findItem/isSubtask/etc. tests:
npx vitest run tests/unit/core/task-utils.test.ts
# Coverage on the touched source file (confirm 100% — every branch hit):
npx vitest run tests/unit/core/task-utils.test.ts --coverage
# Expected: green; task-utils.ts 100%. If a branch is uncovered, add the missing case (synonym-false,
#   exact-miss, prefix 0/1/2+, substring 0/1/2+). If an equivalence case fails, recheck the 5-step order
#   (esp. prefix-before-substring + the synonym preemption).
# Do NOT run the full `npm run test:run` (orthogonal pre-existing failures — not this item's concern).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm ONLY the 2 files changed (T2 must not touch cli/models/other utils):
git diff --name-only   # Expect ONLY src/utils/task-utils.ts + tests/unit/core/task-utils.test.ts.
# Confirm matchStatus is exported + no existing function changed + no new import line for Status:
grep -n "export function matchStatus\|MATCHABLE_STATUSES\|STATUS_SYNONYMS" src/utils/task-utils.ts   # Expect the 3.
grep -n "import type {" src/utils/task-utils.ts   # Status already in the existing import — NO new import line added.
# Sibling regression — if T1.S1 landed, confirm BOTH sets of exports are present (parallel-merge check):
grep -n "export function normalizeTaskId\|export function findItemByLooseId\|export function matchStatus" src/utils/task-utils.ts
# Expected: all three present (T1.S1's two + T2's one); git diff shows only ADDITIONS (no existing fn edited).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (pure function). Domain checks (record in commit message):
#   1. The 5-step order: synonym → exact → unique prefix → unique substring → ambiguous/unknown.
#   2. re (synonym) → Ready; r (not synonym) → ambiguous [Ready, Researching]. The synonym table preempts.
#   3. Retrying is EXCLUDED — 'ret' matches nothing (Retrying not in MATCHABLE_STATUSES) → unknown.
#   4. candidates are copies in canonical lifecycle order; unknown lists all 7.
#   5. The function is total (never throws); every input yields { status } or { error, candidates }.
#   6. findItem/normalizeTaskId/findItemByLooseId/promoteIfAllComplete/rollupCompletion UNCHANGED.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/task-utils.test.ts` GREEN (new + existing).
- [ ] `src/utils/task-utils.ts` at 100% coverage.
- [ ] `git diff --name-only` shows ONLY `src/utils/task-utils.ts` + `tests/unit/core/task-utils.test.ts`.

### Feature Validation
- [ ] Synonyms (step 1): `done`/`d`/`fin`/`finished`/`completed`→Complete; `re`/`rdy`→Ready.
- [ ] Canonical exact (step 2): `ready`/`Complete`/`FAILED`/`planned` (case-insensitive).
- [ ] Unique prefix (step 3): `comp`/`c`→Complete, `p`→Planned, `i`→Implementing, `o`→Obsolete, `f`→Failed, `res`→Researching.
- [ ] Unique substring (step 4): `search`→Researching, `lan`→Planned.
- [ ] Ambiguous (step 5): `r`→[Ready,Researching] (prefix); `ed`→[Failed,Planned] (substring).
- [ ] Unknown (step 6): `bogus`→error + all 7 candidates (canonical order).
- [ ] `re`→Ready (synonym preempts ambiguity); `r`→ambiguous; `don`→unknown (synonym exactness); `ret`→unknown (Retrying excluded).

### Code Quality Validation
- [ ] `matchStatus` exported; `MATCHABLE_STATUSES`/`STATUS_SYNONYMS` module-level consts; NO new import (Status already @25).
- [ ] Steps 3+4 separate (prefix tried first; substring only when prefix=0); candidates are copies in canonical order.
- [ ] Return type is exactly `{ status } | { error, candidates }` (no discriminant field added).
- [ ] `findItem`/`normalizeTaskId`/`findItemByLooseId`/`promoteIfAllComplete`/`rollupCompletion` UNCHANGED.
- [ ] Mode-A JSDoc (synonym table + 5-step order + 7-status set + Retrying rationale + union + 4 @example).
- [ ] New describe APPENDED inside the top-level describe; existing describes untouched.

### Documentation & Deployment
- [ ] JSDoc on matchStatus is the only doc artifact (Mode A — rides with the code).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: PRD §5.4 loose status matcher; 5-step order; re-synonym vs r-ambiguous;
      Retrying excluded; discriminated union; consumed by P1.M2.T4.S1; merge-safe with T1.S1 (Status already imported).

---

## Anti-Patterns to Avoid

- ❌ Don't add a `Status` import — it's ALREADY imported (task-utils.ts:25, test:22). Adding a duplicate
      import is a lint/typecheck error and the ONE thing that would create a real merge conflict with T1.S1.
- ❌ Don't combine steps 3+4 into a single "find all matches then count" pass. The contract pins prefix
      FIRST (more specific): step 3 returns on unique-or-ambiguous and falls through to step 4 ONLY on 0
      prefix matches. Merging them changes the semantics (e.g. an input that's a unique prefix but also a
      substring of others would behave differently).
- ❌ Don't make the synonym table a prefix/substring check. Step 1 is EXACT case-insensitive (`lower in
      STATUS_SYNONYMS`). `'don'` is NOT a synonym (`'done'` is) → unknown.
- ❌ Don't "fix" `'re'` to be ambiguous. `'re'` is a synonym for Ready (step 1) → returns immediately,
      preempting the `r`-prefix ambiguity with Researching. This preemption is the PRD's design. Raw `'r'`
      (not a synonym) IS ambiguous.
- ❌ Don't add a `kind`/`ok` discriminant field to the return type. The contract pins the exact shape
      `{ status } | { error, candidates }`; the consumer narrows via `'status' in result`.
- ❌ Don't return the module-level `MATCHABLE_STATUSES` array directly as `candidates` — return a COPY
      (`[...MATCHABLE_STATUSES]`) so the consumer can never mutate the module const.
- ❌ Don't include `Retrying` in `MATCHABLE_STATUSES`. It's an internal transitional status; manually
      setting it would fight the orchestrator. The 7-status set is the contract.
- ❌ Don't modify `findItem` (~110), `normalizeTaskId`/`findItemByLooseId` (T1.S1's), or the monotonic
      `promoteIfAllComplete`/`rollupCompletion` (orchestrator-facing; T3's cascade is separate). matchStatus
      is a NEW standalone export.
- ❌ Don't place matchStatus on top of `findItem` (~110) — T1.S1 adds its functions there. Place near
      `updateItemStatus` (~380) to keep the parallel diffs in different file regions (clean auto-merge).
- ❌ Don't edit the existing `findItem`/`isSubtask`/etc. test describes or T1.S1's new describes — APPEND
      the `matchStatus` describe inside the top-level `describe('utils/task-utils')`.
- ❌ Don't touch `src/cli/index.ts` (the `hack update` handler is P1.M2.T4.S1) or `src/core/models.ts`
      (read-only).
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Gate on
      typecheck + lint + format:check + the targeted `tests/unit/core/task-utils.test.ts`.
- ❌ Don't forget the coverage branches — every `if (length === 1)` / `if (length >= 2)` / fall-through
      (for both prefix and substring) + the synonym true/false + exact hit/miss must be hit (the
      worked-examples table covers them all).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, pure-function addition. The function body + both module-level
constants are pinned verbatim (architecture §F2.B + the item contract), the 5-step algorithm with the
prefix-vs-substring control-flow is unambiguous, and the synonym-preempts-ambiguity insight (`re` vs `r`)
is documented with worked examples. The single biggest merge-safety fact — `Status` is ALREADY imported in
both files, so this item adds NO import — eliminates the one realistic conflict vector with the parallel
P1.M2.T1.S1 (the only remaining shared edit is appending a name to the test file's multi-line named import,
an additive text merge). The change is strictly additive (one export + one describe block; no existing
function modified), 100%-coverable with the enumerated branch cases, and consumed by a known downstream
caller (P1.M2.T4.S1) via a documented `in`-based narrowing pattern. Residual risks: (a) an implementer
combining steps 3+4 or making the synonym check a prefix check (enumerated as anti-patterns with the exact
correct behavior); (b) a prettier reflow of the JSDoc `@example` fences / multi-line union signature
(auto-fixed via `npm run fix`); (c) an uncovered branch if a worked example is skipped (each branch has a
specified test). No runtime/network/LLM unknowns — matchStatus is pure.