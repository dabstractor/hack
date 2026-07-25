# P3.M1.T1.S1 — Codebase Analysis (Proven Facts)

Scope: Create `nextBugfixDir(sessionPath, hashSeed)` helper that returns the next
numbered `bugfix/NNN_hash/` directory path. Foundational — consumed by S2
(runQACycle creation) and S3 (#detectInterruptedBugfix scanning).

## §1 — The canonical NNN_hash numbering pattern

The codebase uses ONE numbering convention everywhere (session-manager.ts:69):

```ts
const SESSION_DIR_PATTERN = /^(\d{3})_([a-f0-9]{12})$/;
// 'NNN_hash' where NNN = 3-digit zero-padded seq, hash = first 12 hex chars of SHA-256
```

Built via `String(sequence).padStart(3, '0')` + `_` + 12-char hash slice.

Confirmed call sites (all in session-manager.ts):
- L324-327 `#getSessionPath(sequence, hash)`: `resolve(planDir, '${padded}_${hash}')`
- L557 `createSession`: `sessionId = ${String(sequence).padStart(3,'0')}_${sessionHash}`
- L803 `createDeltaSession`: same pattern
- L661/666 createSessionDirectory (session-utils.ts): `fullHash.slice(0, 12)` then
  `${String(sequence).padStart(3,'0')}_${sessionHash}`

The bugfix numbering MUST mirror this EXACTLY under the bugfix/ subdirectory:
`plan/NNN_hash/bugfix/NNN_hash/` (PRD §5.1).

## §2 — The canonical sequence-scan pattern (the EXACT thing to mirror)

`SessionManager.__scanSessionDirectories(planDir)` (session-manager.ts:1395-1420)
is THE reference implementation for "find max NNN + 1 in a directory":

```ts
static async __scanSessionDirectories(planDir): Promise<SessionDirInfo[]> {
  try {
    const entries = await readdir(planDir, { withFileTypes: true });
    const sessions = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(SESSION_DIR_PATTERN);
        if (match) {
          sessions.push({
            name: entry.name,
            path: resolve(planDir, entry.name),
            sequence: parseInt(match[1], 10),
            hash: match[2],
          });
        }
      }
    }
    return sessions;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return []; // directory doesn't exist yet
    }
    throw error;
  }
}
```

And `#getNextSequence()` (L346-353) reduces to max+1:
```ts
async #getNextSequence(): Promise<number> {
  const sessions = await SessionManager.__scanSessionDirectories(this.planDir);
  const maxSeq = sessions.reduce((max, s) => Math.max(max, s.sequence), 0);
  return maxSeq + 1;
}
```

**nextBugfixDir MUST mirror this exact shape** (readdir + withFileTypes + regex
match + parseInt + ENOENT→[]) — but applied to `sessionPath/bugfix/` instead of
`planDir`. The contract's suggested `parseInt(e.split('_')[0], 10)` is
LOOSER than the canonical regex; use the regex `/^(\d{3})_/` (or the full
`/^(\d{3})_([a-f0-9]{12})$/`) to stay consistent and reject malformed entries.

## §3 — Where the helper goes (file decision)

Contract item 3 LOGIC: "Create a helper function (in session-utils.ts or
prp-pipeline.ts)". **session-utils.ts is the correct home**:
- It ALREADY owns `createSessionDirectory` (the NNN_hash creator), `hashPRD`,
  `hashPRDContent` — all the numbering primitives.
- It is the lower layer (pure utilities); prp-pipeline.ts imports FROM it.
- S2 (runQACycle, in prp-pipeline.ts) and S3 (#detectInterruptedBugfix, in
  prp-pipeline.ts) will both `import { nextBugfixDir } from '../core/session-utils.js'`.
- Placing it in prp-pipeline.ts would create a circular need (S3's scan wants
  the same numbering logic).

## §4 — Imports needed in session-utils.ts

Current imports (session-utils.ts:25-34):
```ts
import { createHash, randomBytes } from 'node:crypto';   // ← already present
import {
  readFile, writeFile, mkdir, rename, unlink, stat,
} from 'node:fs/promises';                                // ← readdir MISSING
import { resolve, join, dirname, basename } from 'node:path';  // ← all present
```
**ADD `readdir` to the `node:fs/promises` import.** `createHash` and `randomBytes`
are already imported (so the hash/uniqueness primitives are available without a
new import).

## §5 — The hash seed (contract item 3d/3e)

Contract: "hash can be derived from the bug report content hash or a timestamp-
based hash for uniqueness." Two clean options, both available without new deps:

**(A) Caller supplies the seed** — signature `nextBugfixDir(sessionPath, hashSeed)`:
the caller (S2 runQACycle) computes `hashPRDContent(bugReportContent).slice(0,12)`
or passes the bug report bytes; nextBugfixDir just slices/pads. This is the
contract's literal signature and is PUREST (helper does no hashing, just numbering).
- `hashSeed` could be the FULL 64-char hash OR the 12-char slice. Cleanest: accept
  the full content/string and slice internally (mirror createSessionDirectory's
  `fullHash.slice(0, 12)`), so callers don't have to remember the 12-char rule.

**(B) Helper generates uniqueness** — if no content to hash, derive a 12-char hex
from `randomBytes(6).toString('hex')` (already imported) or
`Date.now().toString(16).slice(0,12)`. This is the "timestamp-based hash for
uniqueness" fallback.

**Decision for the PRP:** Implement the contract's literal signature
`nextBugfixDir(sessionPath: string, hashSeed: string)` where `hashSeed` is the
seed content/string the caller provides; the helper hashes it via
`hashPRDContent` (or, if it's already a hex hash, slices to 12). Provide a SECOND
small exported helper `generateBugfixHash(seed?: string): string` that returns a
12-char hex — hashing `seed` if given, else `randomBytes(6).toString('hex')`.
This gives S2 a clean "pass the bug report" path AND a "just give me a unique
hash" path, without the numbering helper doing two jobs. Both are pure/testable.

## §6 — ENOENT handling (first iteration)

`sessionPath/bugfix/` does NOT exist on the first bug-hunt iteration.
`__scanSessionDirectories` returns `[]` on ENOENT (session-manager.ts:1420).
nextBugfixDir MUST do the same: `catch (ENOENT) → sequences = [] → seq = 1`.
Do NOT pre-create the bugfix/ dir (S2's runQACycle owns mkdir). nextBugfixDir is
read-only (it only READS the listing and RETURNS a path string; it does not
create anything). This keeps it trivially unit-testable with a mocked readdir.

## §7 — Return shape

Contract item 3: returns `{ dir: string, sequence: number }`.
- `dir` = `resolve(sessionPath, 'bugfix', '${NNN}_${12hexhash}')`
- `sequence` = the integer NNN (1-based, first iteration = 1)

S2 uses `.dir` (to mkdir + copy TEST_RESULTS.md); S3 uses `.sequence` (to iterate
1..N when scanning for interrupted children) — actually S3 will call a sibling
scan, but exposing `sequence` is cheap and matches the contract.

## §8 — Test conventions (tests/unit/core/session-utils.test.ts)

- File ALREADY mocks `node:crypto`, `node:fs/promises`, `node:util` at module
  level via `vi.mock(...)`.
- **The `node:fs/promises` mock does NOT currently include `readdir`** (it lists
  readFile/writeFile/mkdir/rename/unlink). **ADD `readdir: vi.fn()` to that mock
  object** or the new helper's `readdir` call hits the real FS (tests fail / are
  non-deterministic).
- Pattern: `const mockReaddir = readdir as any;` then per-test
  `mockReaddir.mockResolvedValue([...Dirent-like...])`.
- Dirent shape needed (because `withFileTypes: true`): each entry needs a `.name`
  string and an `.isDirectory()` method. Build with `vi.fn(() => true)`.
- The `createHash` mock chain: `mockCreateHash.mockReturnValue({ update: vi.fn(() => ({ digest: vi.fn(() => '64charhexstring...') })) })`.
- 100% coverage gate (vitest.config.ts:41-47 thresholds 100/100/100/100 on
  src/**/*.ts) — every branch in nextBugfixDir MUST be exercised:
  - readdir ENOENT path (→ seq 1)
  - readdir success + empty entries (→ seq 1)
  - readdir success + entries with NO matching NNN_ pattern (→ seq 1)
  - readdir success + entries WITH matching pattern (→ max+1)
  - hashSeed-hashed path + randomBytes-fallback path (in generateBugfixHash)
  - non-ENOENT error path (re-throws)

## §9 — Scope fences & sibling coordination

- **S1 owns (this PRP):** nextBugfixDir + generateBugfixHash in session-utils.ts
  + their unit tests + JSDoc (Mode A). NO changes to prp-pipeline.ts.
- **S2 (runQACycle creation):** will REPLACE the flat `resolve(sessionPath,
  'bugfix')` (prp-pipeline.ts:1862) with `const { dir } = nextBugfixDir(
  sessionPath, bugReportContent)` + mkdir(dir). S1 does NOT touch runQACycle.
- **S3 (#detectInterruptedBugfix scanning):** will scan numbered children instead
  of the flat dir. S1 provides the numbering primitive; S3 may add a sibling
  `scanBugfixDirs(sessionPath)` helper OR reuse the regex. S1 does NOT touch it.
- **S4 (lifecycle tests):** integration tests across S2+S3.
- **READ-ONLY:** PRD.md, tasks.json, prd_snapshot.md, vitest.config.ts,
  prp-pipeline.ts (S1 is session-utils.ts + test ONLY).
- **FixCycleWorkflow path check:** validates sessionPath contains 'bugfix'
  (architecture doc notes numbered path `bugfix/001_hash/` still contains
  'bugfix' → check passes unchanged). S1 doesn't touch FixCycleWorkflow.

## §10 — Validation commands (verified)

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # eslint . --ext .ts
npm run format:check        # prettier --check
npm run test:run            # vitest run
npm run validate            # lint + format:check + typecheck + test:run
npm run build               # tsc -p tsconfig.build.json
npx vitest run --coverage   # 100/100/100/100 on src/**/*.ts
```