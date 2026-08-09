# Test Impact Analysis: Include Dedup Delta

## Test Files and Strategy

All include tests use **REAL tmpdir fixtures** (mkdtempSync), NOT vi.mock. This is critical:
recursion + dedup + base invariant are only trustworthy against real files.

### Test Files

1. **`tests/unit/core/prd-resolve.test.ts`** — recursive expansion (resolvePRD)
2. **`tests/unit/core/prd-markers.test.ts`** — marker emission + stale warnings
3. **`tests/unit/core/prd-includes.test.ts`** — single-level (resolveIncludes, NO dedup impact)

## Tests That Assert OLD Behavior (MUST BE REWRITTEN)

### From `prd-resolve.test.ts`

| # | Test Title | Old Fixture | Old Assertion | New Expected Behavior |
|---|---|---|---|---|
| 1 | "expands a diamond in both branches (path-based visited set)" | shared.md='S', a.md='[@shared.md]', b.md='{@shared.md}', main='@a.md\n@b.md' | `out === '[S]\n{S}'`, `out.split('S').length === 3` | shared='S' appears ONCE; second @shared.md ELIDED → `out === '[S]\n{}'` |
| 2 | "terminates a self-cycle leaving the back-edge literal" | a.md='X @a.md Y', main='@a.md' | `out === 'X @a.md Y'` | Inner @a.md ELIDED (not literal) → `out === 'X  Y'` |
| 3 | "terminates a mutual cycle leaving the back-edge literal" | a.md='A-TOP @b.md A-BOT', b.md='B-OPEN @a.md B-CLOSE', main='@a.md' | `out === 'A-TOP B-OPEN @a.md B-CLOSE A-BOT'` | b's @a.md ELIDED → `out === 'A-TOP B-OPEN  B-CLOSE A-BOT'` |
| 4 | "detects an include pointing back at the entry as a cycle" | a.md='A @main.md END', main='@a.md' | `out === 'A @main.md END'` | @main.md ELIDED → `out === 'A  END'` |
| 5 | "recursively expands a nested chain (entry→a→b→c)" | c.md='C', b.md='B(@c.md)', a.md='A(@c.md via b:@b.md)', main='start @a.md end' | `out === 'start A(C via b:B(C)) end'` | c.md='C' expands once (first encounter in a.md); b's @c.md ELIDED → `out === 'start A(C via b:B()) end'` |

### From `prd-markers.test.ts`

| # | Test Title | Impact |
|---|---|---|
| M1 | "no warn for a cycle back-edge" | a.md='X @a.md Y', resolvePRD(a.md). Output changes from `'X @a.md Y'` to `'X  Y'` (elision). Warning assertion (`console.warn` NOT called) STILL VALID — elision emits no warning. |

**Note on test M1**: This test calls `resolvePRD(join(tmp, 'a.md'))` directly (a.md IS the entry).
Under NEW dedup, the entry is seeded in visited, so the inner `@a.md` is elided. The test
asserts `console.warn` was NOT called — this remains true. Only the output assertion needs
updating (or the test needs restructuring to verify elision instead of literal survival).

## Tests UNAFFECTED by the Change

### `prd-resolve.test.ts` (unaffected)
- Single-level expand, no-includes identity, base invariant (subdir resolution), maxDepth gate
  tests, ENOENT silent verbatim, directory silent verbatim, invalid UTF-8 errors, EACCES errors

### `prd-markers.test.ts` (unaffected)
- All single-include marker tests, env toggle tests, nested-chain markers, stale-warning tests
  for missing/dir/non-.md, existing idempotency tests (linear chains, no diamonds)

### `prd-includes.test.ts` (unaffected)
- Tests `resolveIncludes` (single-level, no recursion, no dedup)

## NEW Tests Required (Requirement 2)

| # | Invariant | Fixture | Assertion |
|---|---|---|---|
| N1 | **Diamond dedup** | A→B→D, A→C→D (4 files + entry) | D's body appears EXACTLY once; second @D elided |
| N2 | **Marker-mode reference comment** | Diamond with markers:true | Elided ref is stable comment naming path; comment contains NO `@token`; second resolution pass is byte-identical |
| N3 | **No-marker elision** | Diamond with markers off | Elided ref is simply absent (no @D survivor in output) |
| N4 | **Idempotency (fixed point)** | Diamond-heavy fixture | `resolve(resolve(x)) === resolve(x)` |
| N5 | **Exponential-blowup guard** | N mutually @-referencing files | Output size is LINEAR in sum of file sizes, not exponential |
| N6 | **Entry-is-its-own-cycle** | Entry includes itself | Self-include is elided (seeded in visited) |
| N7 | **resolveIncludes single-level** | Confirm contract: direct duplicate @token in one file | Expand both OR dedup — match whatever the scan loop does; note in describe block |

## Test Naming Convention

Per PRD Requirement 2: `describe`/`it` titles should NAME the §2.3 invariant they lock in
(dedup / elision / idempotency), so a future reader understands *why* each test exists.