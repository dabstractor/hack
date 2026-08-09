# Research — P1.M1.T3.S1: Canonical `dedupKey` (realpathSync + lexical fallback) at all three visited-set sites

> Bugfix `002_2b460dab1a1f`, **BUG-003 (MINOR)**. PRD §2.3 dedup is "keyed on the resolved absolute path"
> with the intent "a file is expanded at most once." The visited set keys on the **lexical**
> `path.resolve` result, so two symlink aliases to the SAME physical file get distinct keys → the file's
> content expands twice (verified: `real.md='REAL'` + `alias.md`→symlink + `main.md='@real.md @alias.md'`
> → `'REAL REAL'`). **Fix: key all three visited sites on `realpathSync` (canonical), with a lexical
> fallback for non-resolvable paths — ONLY the key changes; markers/stat/messages untouched.** TDD:
> failing symlink-dedup test first → fix → green.

## 0. Scope boundary (critical)

- **Files touched:** `src/core/session-utils.ts` (import + `dedupKey` helper + 3 keying-site edits + 2
  JSDoc edits) + `tests/unit/core/prd-resolve.test.ts` (add `symlinkSync` import + one failing test →
  passing). Nothing else.
- **NO behavior change** except symlink-alias dedup: markers, messages, stat semantics, recursion,
  elision output, idempotency — all UNCHANGED. ONLY the visited-set key changes from lexical `abs` to
  canonical `dedupKey(abs)`.
- **Disjoint from the parallel item T2.S1 (BUG-002):** it edits `neutralizeResolvableTokens` + the
  resolvePRD **STALE-WARNING** bullet. This task edits the **3 keying sites** + the expandIncludesRecursive
  `@param visited` doc + the resolvePRD **GLOBAL-FLAT-DEDUP** bullet. Different lines/functions — no
  overlap (`architecture/bugfix_findings.md` L173-174 confirms).

## 1. Verified current state (src/core/session-utils.ts)

- **Imports (L28-41):** `stat` from `node:fs/promises` (L34); `resolve, join, dirname, basename` from
  `node:path` (L35). **`realpathSync` is NOT imported.** → ADD `import { realpathSync } from 'node:fs';`
  (sync API — `node:fs`, not `node:fs/promises`).
- **Keying site (a) — elision check:** `if (visited.has(abs))` at **L505** (`abs = resolve(baseDir, token)`
  ~L501). → `if (visited.has(dedupKey(abs)))`.
- **Keying site (b) — mark-visited:** `visited.add(abs)` at **L527** (after `st.isFile()` +
  `readUTF8FileStrict`, inside the `// GLOBAL FLAT DEDUP: mark THIS file visited BEFORE descending` block).
  → `visited.add(dedupKey(abs))`.
- **Keying site (c) — entry pre-seed:** `new Set<string>([absEntry])` at **L720** (`absEntry = resolve(prdPath)`
  at L703, inside `resolvePRD`). → `new Set<string>([dedupKey(absEntry)])`.
- **Mode A doc 1 — expandIncludesRecursive `@param visited` (L468-469):** currently
  *"GLOBAL flat set of absolute paths already expanded this resolution (shared by reference; first
  encounter wins, later references elide). The entry file is pre-seeded."* → add that the key is the
  **canonical (realpath-resolved) absolute path, symlink-safe**.
- **Mode A doc 2 — resolvePRD `@remarks` GLOBAL-FLAT-DEDUP bullet (L639-640):** currently
  *"a single visited `Set`, keyed on the resolved absolute path, is shared across the whole resolution"*
  → change "keyed on the resolved absolute path" → "keyed on the canonical (realpath-resolved) absolute
  path, so symlink aliases to the same physical file dedup correctly".

## 2. The macOS-symlink invariant (why ALL THREE sites must change together)

On macOS the system tmpdir is symlinked (`/var/folders/...` → `/private/var/folders/...`). If only some
sites switched to `realpathSync`, the keys would MISMATCH across sites (entry pre-seeded as
`/private/var/...` but recursive encounters as `/var/...`, or vice-versa) → the **entry-back-edge** and
**self-include** elision tests would BREAK (a back-edge to the entry would no longer find it in `visited`).
**All three sites MUST use `dedupKey`** so the key is consistent everywhere. (Today all three use lexical
`abs`/`absEntry` consistently, which is why existing tests pass; the fix preserves consistency by moving
all three to canonical together.)

## 3. Ready-to-paste code

### 3a. Import (add near the existing imports, ~after the `node:fs/promises` block)
```ts
import { realpathSync } from 'node:fs';
```

### 3b. The `dedupKey` helper (place immediately before `expandIncludesRecursive`)
```ts
/**
 * Canonical dedup key for the global-flat `visited` set (PRD §2.3, BUG-003).
 *
 * @remarks
 * Returns the symlink-resolved canonical absolute path via `realpathSync`, with a LEXICAL fallback
 * (`abs` unchanged) when the path cannot be resolved (ENOENT / not yet stat'd). Keying on the canonical
 * path — not the lexical `path.resolve` result — means two paths that are symlink aliases to the SAME
 * physical file get ONE visited entry, so the file expands exactly once (the second reference elides),
 * honoring the §2.3 "a file expanded at most once" intent.
 *
 * The fallback is safe: `visited.add` runs only for existing files (post `st.isFile()`), and the entry
 * pre-seed is an existing file, so both always take the realpath branch. The fallback mainly guards the
 * elision `has` check against not-yet-stat'd / stale tokens, which are never in `visited` anyway.
 *
 * COST: one synchronous `realpath` syscall per encounter. Acceptable — dedup bounds encounters to one
 * per file (a later alias hits `visited.has` and elides before the `add`), and PRDs are small. ALL THREE
 * keying sites (elision `has`, mark-visited `add`, entry pre-seed) MUST use this: on macOS the tmpdir is
 * symlinked (`/var` → `/private/var`), so mixing canonical and lexical keys across sites would break
 * entry-back-edge / self-include elision.
 *
 * @param abs - The lexical absolute path (`path.resolve(baseDir, token)` or `path.resolve(prdPath)`).
 * @returns The canonical realpath when resolvable; the lexical `abs` otherwise.
 */
function dedupKey(abs: string): string {
  try {
    return realpathSync(abs);
  } catch {
    return abs; // ENOENT / not-yet-stat'd → lexical fallback (safe; see @remarks)
  }
}
```

### 3c. The three site edits (ONLY the key argument changes)
```ts
// (a) elision check — L505
if (visited.has(dedupKey(abs))) {     // was: if (visited.has(abs))
// (b) mark-visited — L527
visited.add(dedupKey(abs));            // was: visited.add(abs)
// (c) entry pre-seed — L720 (in resolvePRD)
new Set<string>([dedupKey(absEntry)]), // was: new Set<string>([absEntry])
```

### 3d. JSDoc edits (Mode A)
```ts
// @param visited (L468-469) — add the canonical-key note:
 * @param visited - GLOBAL flat set of CANONICAL (realpath-resolved) absolute paths already expanded
 *        this resolution (shared by reference; first encounter wins, later references elide; symlink
 *        aliases to one physical file dedup). The entry file is pre-seeded. See {@link dedupKey}.

// GLOBAL-FLAT-DEDUP bullet (L639-640) — reword the keying clause:
 *  - **GLOBAL FLAT DEDUPLICATION** (PRD §2.3 "No duplication (dedup)"): a single visited `Set`,
 *    keyed on the canonical (realpath-resolved) absolute path (so symlink aliases to the same physical
 *    file dedup correctly), is shared across the whole resolution (passed by reference, never copied) …
```

## 4. The failing-first test (tests/unit/core/prd-resolve.test.ts)

- **Import:** add `symlinkSync` to the existing `import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';` (L27-33).
- **New describe block** (place near the existing dedup describes, e.g. after `describe('resolvePRD — global-flat dedup & elision …')` ~L103 or alongside the `diamond dedup` block ~L408). Reuses the file-level `tmp`:
```ts
// resolvePRD — symlink-alias dedup (BUG-003, §2.3): the visited set keys on the canonical realpath,
// so two paths that are aliases of ONE physical file expand exactly once (second reference elided).
describe('resolvePRD — symlink-alias dedup (BUG-003, §2.3)', () => {
  it('dedups two symlink aliases to one physical file (second reference elided)', async () => {
    // SETUP — real.md is the physical file; alias.md is a symlink to it. main references both.
    writeFileSync(join(tmp, 'real.md'), 'REAL');
    symlinkSync(join(tmp, 'real.md'), join(tmp, 'alias.md'));
    writeFileSync(join(tmp, 'main.md'), '@real.md @alias.md');

    // EXECUTE
    const out = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — 'REAL' appears EXACTLY ONCE (the @alias.md reference ELIDES: same canonical file).
    // Output is 'REAL ' (REAL + the gap space between the two tokens; the elided alias emits nothing).
    expect(out).toBe('REAL ');
    expect(out.split('REAL').length).toBe(2); // appears exactly once
  });
});
```
**RED before the fix:** `out` is `'REAL REAL'` (lexical keys differ → both expand) → `expect(out).toBe('REAL ')` FAILS.
**GREEN after the fix:** both `real.md` and `alias.md` realpath to the same canonical file → second
reference elides → `'REAL '`. (No symlink-capability guard: the primary dev platform — macOS/Linux —
supports `symlinkSync`; if one is ever desired, skip the test when `symlinkSync` throws.)

## 5. Why existing dedup tests keep passing (no regression)

Existing real-file dedup tests (diamond L137, mutual-cycle L117, self-include L481, entry-back-edge L128,
nested-chain L72) assert dedup **BEHAVIOR** (content appears once), not the key string. For NON-symlink
files, `realpathSync(abs) === path.resolve(...)` on a non-symlinked path (the lexical normalized abs IS
the canonical path), so the visited key is effectively unchanged → identical dedup behavior. The macOS
tmpdir IS symlinked, but because ALL THREE sites move to `dedupKey` TOGETHER (§2), the keys stay
consistent across sites, so entry-back-edge / self-include elision still finds the entry in `visited`.

## 6. Validation
```bash
npm run test:run -- prd-resolve prd-markers   # new symlink-dedup test GREEN + all existing dedup/marker tests GREEN
npm run typecheck                             # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint                                  # eslint . --ext .ts — clean
npm run format:check                          # prettier — clean (run `npm run format` if it flags)
```