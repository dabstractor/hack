# matchStatus — §F2.B algorithm, ambiguity semantics, parallel-safety

Authoritative reference for P1.M2.T2.S1. Pins the §F2.B spec, the precise
5-step algorithm with the prefix-vs-substring ambiguity semantics, the
discriminated-union return type, and the parallel-safety story with
P1.M2.T1.S1 (same file, same test file — but `Status` is already imported).

## 1. The authoritative spec (architecture/implementation-status.md §F2.B)

**Signature:** `matchStatus(input: string): { status: Status } | { error: string; candidates: string[] }`

**Matchable set (7):** `Planned, Researching, Ready, Implementing, Complete,
Failed, Obsolete`. (`Retrying` is EXCLUDED — it is an internal transitional
status set by the retry manager; manually setting it would fight the
orchestrator. A stuck `Retrying` item is reset via `Planned`/`Ready`.)

**Matching order (first hit wins):**
1. **Synonym table** (exact, case-insensitive): `d, done, fin, finished,
   completed → Complete`; `re, rdy → Ready`.
2. **Canonical exact** (case-insensitive): input matches one of the 7.
3. **Unique prefix**: input is a prefix of exactly one status.
4. **Unique substring**: input is a substring of exactly one status.
5. **Ambiguous** (2+ matches at prefix OR substring) → error listing candidates.
6. **Unknown** (0 matches) → error listing all 7 valid statuses.

## 2. The precise algorithm (with the prefix-vs-substring subtlety)

Steps 3 and 4 are SEPARATE, each with its OWN count + ambiguity check. A prefix
match is also a substring match, so step 3 (prefix) is tried FIRST and returns
on a unique hit before step 4 ever runs:

```ts
const MATCHABLE: Status[] = ['Planned','Researching','Ready','Implementing','Complete','Failed','Obsolete'];
const SYNONYMS: Record<string, Status> = {
  d: 'Complete', done: 'Complete', fin: 'Complete', finished: 'Complete', completed: 'Complete',
  re: 'Ready', rdy: 'Ready',
};

export function matchStatus(input: string): { status: Status } | { error: string; candidates: string[] } {
  const lower = input.toLowerCase();

  // 1. SYNONYM (exact, case-insensitive)
  if (lower in SYNONYMS) return { status: SYNONYMS[lower] };

  // 2. CANONICAL EXACT (case-insensitive)
  const exact = MATCHABLE.find(s => s.toLowerCase() === lower);
  if (exact) return { status: exact };

  // 3. UNIQUE PREFIX
  const prefixMatches = MATCHABLE.filter(s => s.toLowerCase().startsWith(lower));
  if (prefixMatches.length === 1) return { status: prefixMatches[0] };
  if (prefixMatches.length >= 2) {
    return { error: `Ambiguous status "${input}": matches ${prefixMatches.join(', ')}`, candidates: [...prefixMatches] };
  }

  // 4. UNIQUE SUBSTRING (prefix matched 0 → try the broader match)
  const substringMatches = MATCHABLE.filter(s => s.toLowerCase().includes(lower));
  if (substringMatches.length === 1) return { status: substringMatches[0] };
  if (substringMatches.length >= 2) {
    return { error: `Ambiguous status "${input}": matches ${substringMatches.join(', ')}`, candidates: [...substringMatches] };
  }

  // 6. UNKNOWN
  return { error: `Unknown status "${input}". Valid statuses: ${MATCHABLE.join(', ')}`, candidates: [...MATCHABLE] };
}
```

**Control-flow notes:**
- Step 3 returns on length===1 (unique) OR length>=2 (ambiguous). Only when
  length===0 does it FALL THROUGH to step 4. So a substring match is reached
  ONLY when the input is not a prefix of ANY status.
- The `candidates` array is `[...prefixMatches]` / `[...substringMatches]` /
  `[...MATCHABLE]` — a COPY (defensive; the consumer never mutates it, but
  copying avoids sharing the module-level array reference). Order = MATCHABLE
  order (canonical lifecycle order) because `.filter` preserves source order.
- `prefixMatches` is `string[]` (MATCHABLE is `Status[]` but `.filter` returns
  `Status[]`; assigning to `candidates: string[]` is fine since Status ⊂ string).

## 3. The headline insight: `re` (synonym) vs `r` (ambiguous)

- `'re'` is a SYNONYM for Ready (step 1) → returns `{ status: 'Ready' }`
  IMMEDIATELY. It never reaches prefix matching, where `'re'` would be a prefix
  of BOTH `Ready` AND `Researching` (→ ambiguous). The synonym table PREEMPTS
  that ambiguity by design. This is the PRD §5.4 "shorthands that would
  otherwise be ambiguous" rationale.
- `'r'` is NOT a synonym → falls to step 3 → prefix of `Ready` AND `Researching`
  → length 2 → ambiguous error, candidates `[Ready, Researching]`.

## 4. Worked examples (all branches, for the test suite)

| input | step hit | result |
| ----- | -------- | ------ |
| `done` | 1 (synonym) | `{ status: 'Complete' }` |
| `d` | 1 (synonym) | `{ status: 'Complete' }` |
| `fin`, `finished`, `completed` | 1 (synonym) | `{ status: 'Complete' }` |
| `re`, `rdy` | 1 (synonym) | `{ status: 'Ready' }` |
| `ready` | 2 (exact) | `{ status: 'Ready' }` |
| `Complete` / `FAILED` / `planned` | 2 (exact, case-insensitive) | that status |
| `comp` | 3 (unique prefix) | `{ status: 'Complete' }` |
| `c` / `p` / `i` / `o` / `f` | 3 (unique prefix) | Complete/Planned/Implementing/Obsolete/Failed |
| `res` / `research` / `impl` / `plan` / `obs` | 3 (unique prefix) | Researching/Implementing/Planned/Obsolete |
| `r` | 5 (ambiguous via prefix) | `{ error: 'Ambiguous status "r": matches Ready, Researching', candidates: ['Ready','Researching'] }` |
| `search` | 4 (unique substring; not a prefix of any) | `{ status: 'Researching' }` |
| `lan` | 4 (unique substring) | `{ status: 'Planned' }` |
| `ed` | 5 (ambiguous via substring: Failed+Planned) | `{ error: 'Ambiguous status "ed": matches Failed, Planned', candidates: ['Failed','Planned'] }` |
| `bogus` / `xyz` / `don` | 6 (unknown) | `{ error: 'Unknown status "bogus". Valid statuses: Planned, Researching, Ready, Implementing, Complete, Failed, Obsolete', candidates: [all 7] }` |

**Note `'don'`:** NOT a synonym (synonym is `'done'`), not exact, not a prefix
of any status, not a substring of any status → unknown. This is a good
edge-case test (synonym-table exactness vs prefix confusion).

## 5. Discriminated union return type + consumer narrowing

The contract return type is `{ status: Status } | { error: string; candidates: string[] }`
— a union with NO shared discriminant field (one arm has `status`, the other
`error`). TypeScript narrows via the `in` operator. The consumer
(P1.M2.T4.S1) does:
```ts
const result = matchStatus(argv.status);
if ('status' in result) {
  // result.status: Status — proceed with the cascade
} else {
  console.error(result.error);   // result.error + result.candidates
  process.exit(1);
}
```
Do NOT add a `kind`/`ok` discriminant field — the contract pins the exact shape.
The `in`-based narrowing is the established pattern.

## 6. Parallel-safety with P1.M2.T1.S1 (same file, same test file)

BOTH P1.M2.T1.S1 (normalizeTaskId + findItemByLooseId) and this item
(matchStatus) edit `src/utils/task-utils.ts` + `tests/unit/core/task-utils.test.ts`.
The merge is CLEAN because every change is purely ADDITIVE:

- **task-utils.ts imports:** `Status` is ALREADY imported (line 25, alongside
  Backlog/Phase/Milestone/Task/Subtask). P1.M2.T1.S1 adds NO import (Backlog/
  HierarchyItem already present). This item adds NO import (Status already
  present). → **Zero import conflict.**
- **task-utils.ts exports:** P1.M2.T1.S1 appends normalizeTaskId +
  findItemByLooseId (near findItem ~110). This item appends matchStatus (place
  near updateItemStatus ~380, or at a logical grouping — NOT on top of the
  T1.S1 functions). → **Different exports, no overlap.**
- **task-utils.test.ts:** P1.M2.T1.S1 appends describe('normalizeTaskId') +
  describe('findItemByLooseId'). This item appends describe('matchStatus').
  All inside the existing top-level describe('utils/task-utils'). → **Different
  describe blocks, no overlap.**
- **task-utils.test.ts imports:** P1.M2.T1.S1 adds normalizeTaskId +
  findItemByLooseId to the named import from task-utils.js. This item adds
  matchStatus to the SAME named import. Both are additive edits to the same
  multi-line import — a potential TEXTUAL overlap (both insert a line into the
  same `import { … }` block). → If both land, the merge needs both names in the
  block; this is a trivial additive merge (git can auto-merge two distinct
  inserted lines in an import block as long as they're on different lines).
  Document this so the integrator confirms both names are present after merge.

**Recommendation:** place matchStatus in task-utils.ts near updateItemStatus
(~380) — physically away from findItem (~110) where T1.S1 adds its functions —
to minimize the textual diff overlap. In the test, append the matchStatus
describe block at the END of the top-level describe (T1.S1 also appends at the
end; the two appended blocks are independent).

## 7. Coverage branch enumeration (100% enforced)

Every branch of matchStatus must be hit (vitest.config.ts enforces 100%):
- Step 1 synonym hit: `'done'` (Complete), `'re'` (Ready). (Also `'d'`,
  `'fin'`, `'finished'`, `'completed'`, `'rdy'` — at least one of each
  synonym-target arm; one test per synonym value is thorough but `'done'` +
  `'re'` cover both targets.)
- Step 2 exact hit: `'ready'`, `'Complete'` (case-insensitive), `'FAILED'`.
- Step 3 unique-prefix hit: `'comp'`→Complete, `'p'`→Planned.
- Step 5 ambiguous-via-prefix: `'r'`→[Ready, Researching].
- Step 4 unique-substring hit: `'search'`→Researching (not a prefix of any).
- Step 5 ambiguous-via-substring: `'ed'`→[Failed, Planned].
- Step 6 unknown: `'bogus'`.

(Each `if (x.length === 1)` and `if (x.length >= 2)` and the fall-through is
exercised. The `lower in SYNONYMS` true/false arms both hit.)

## 8. Scope boundaries (disjointness)

- **This item:** `src/utils/task-utils.ts` (+matchStatus +Mode-A JSDoc) +
  `tests/unit/core/task-utils.test.ts` (+import matchStatus +describe block).
- **P1.M2.T1.S1 (parallel previous):** same two files, but adds
  normalizeTaskId + findItemByLooseId (different exports/describes). Merge-safe.
- **P1.M2.T3.S1/S2 (sequenced after):** cascadeCompleteDown +
  recomputeAncestorsUp (other functions in the same file). Do NOT implement
  them here.
- **P1.M2.T4.S1 (consumer):** the `hack update` CLI handler in src/cli/index.ts
  calls matchStatus. This item MUST NOT touch src/cli/index.ts.
- **DO NOT modify:** findItem, normalizeTaskId, findItemByLooseId, the
  monotonic promoteIfAllComplete / rollupCompletion (T3 owns the cascade;
  those are orchestrator-facing), or any other existing function. matchStatus
  is a NEW, standalone, pure export.
- **DOCS:** Mode A — JSDoc on matchStatus only. No docs/*.md.