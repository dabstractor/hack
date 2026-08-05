# Research — P1.M3.T1.S1: Implement commit relational check + remove gap comments + tests

## 1. Architecture contract (authoritative)

`plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_003_fix_strategy.md` prescribes the
WHOLE fix. Key points:

- **Placement = END of `validateHackTier`, after the section/key loop.** NOT in `loadHackConfig`. Why:
  BOTH runtime paths funnel through `validateHackTier` — (1) `hack config validate` CLI calls
  `validateHackTier` per file; (2) real startup `loadHackConfig` calls `validateHackTier` per tier
  (hack-config.ts:952). One edit fixes both. `loadHackConfig` would only fix path (2).
- **The relational check fires when `section === 'commit'` AND both keys are present in THIS tier.**
  A single-key tier is always valid (the check is skipped). Per-tier (per-file) — cross-tier
  (delay in `.hack`, cap in `.hack.local`) is a KNOWN, ACCEPTED limitation (defaults 10000/120000
  satisfy the constraint; PRD §9.7.7 frames validation as per-file; `hack config validate` lints files
  independently by design).
- **Verbatim check block** (from architecture + item LOGIC §3):
  ```ts
  // ── Cross-key relational check (PRD §9.7.5: commit.retry_delay_cap_ms ≥ retry_delay_ms) ──
  const commit = parsed.commit;
  if (commit && commit.retry_delay_ms !== undefined && commit.retry_delay_cap_ms !== undefined) {
    const delay = commit.retry_delay_ms as number;
    const cap = commit.retry_delay_cap_ms as number;
    if (cap < delay) {
      throw new HackConfigError(
        `[commit] retry_delay_cap_ms in ${file}: ${cap} is less than retry_delay_ms (${delay}); the cap must be ≥ the base delay.`
      );
    }
  }
  ```
- **Error message style**: mirrors `validateFieldValue` (`[section] key in file: ...`). Uses `≥`
  (unicode) in the remediation suffix.
- **Use `HackConfigError`** so it renders cleanly via the dedicated `main().catch()` arm (BUG-002 /
  P1.M2.T2.S1). NOTE: P1.M2.T1.S1 is **Complete** per `<plan_status>`, so `HackConfigError` is already
  defined + imported (hack-config.ts:12 `import { HackConfigError } from './types.js'`) AND the 9 throw
  sites already use it. Use `HackConfigError` directly — the "plain Error works" fallback is moot.

## 2. Exact insertion site (VERIFIED against HEAD)

`validateHackTier` (hack-config.ts:755–797). Boundary:
```
794:      validateFieldValue(file, section, key, value, spec);
795:    }              ← closes the INNER for loop (over keys)
796:  }                ← closes the OUTER for loop (over sections)
797:}                  ← closes validateHackTier
798:
799: /**  ← validateFieldValue JSDoc begins
```

**Insert the relational check between line 796 and line 797** — i.e. after the outer section loop
closes, before the function's closing `}`. Indented 2 spaces (function-body level), as a sibling of
the `for` loop. The architecture's block is the verbatim source.

## 3. The two gap comments (VERIFIED exact text)

- **hack-config.ts:602-603** (JSDoc on `HACK_CONFIG_SCHEMA`, part of the `@remarks` block). The
  offending sentence (currently lines 603 + part):
  ```
   *
   * The relational `commit.retry_delay_cap_ms >= commit.retry_delay_ms` cross-key check is a
   * DOCUMENTED GAP (P2.M2 may harden); `retry_delay_cap_ms` validates as `int >= 0` only.
   */
  ```
  **Action: REMOVE the whole "The relational … only." sentence + its leading blank ` *` line.** The
  rest of the `@remarks` (about `[auth]`, secrets policy, no S2 overlap) stays.

- **hack-config.ts:625** (inline comment on the `retry_delay_cap_ms` field spec):
  ```
      retry_delay_cap_ms: { type: 'int', min: 0 }, // relational cap>=delay deferred (cross-key)
  ```
  **Action: UPDATE the trailing comment** from `// relational cap>=delay deferred (cross-key)` to
  `// relational cap>=delay enforced in validateHackTier`.

The commit schema block (hack-config.ts:618-624) for reference:
```ts
  commit: {
    retry_max: { type: 'int', min: 1 },
    retry_delay_ms: { type: 'int', min: 0 },
    retry_delay_cap_ms: { type: 'int', min: 0 }, // relational cap>=delay deferred (cross-key)
    classifier_retry_max: { type: 'int', min: 1 },
  },
```

## 4. Type model (VERIFIED — the `as number` cast is safe)

```ts
export interface ParsedHackConfig {           // hack-config.ts:35
  [section: string]: { [key: string]: HackConfigValue };
}
```
- `parsed.commit` → `{ [key: string]: HackConfigValue }` (or `| undefined` if noUncheckedIndexedAccess;
  the `commit &&` guard covers both). HackConfigValue is `string | number | boolean`.
- `commit.retry_delay_ms !== undefined` narrows out undefined; `as number` casts `HackConfigValue`→
  `number` (valid TS — number is a member of the union).
- **Why the cast is SAFE at runtime:** by the time the relational check runs, the per-key loop has
  ALREADY validated both keys as `int` (`validateFieldValue` with `{ type:'int', min:0 }`). `commit` is
  a known section and both keys are known keys → they passed the type check → they are JS numbers. The
  `as number` is a type-system assertion of a runtime invariant the loop just enforced.

## 5. Test pattern (VERIFIED — the sibling range test is the model)

The relational tests go in the **`describe('hack-config: secrets & validation', …)`** block
(test hack-config.test.ts:577). Harness (already set up in that block's `beforeEach`):
```ts
let warnSpy: ReturnType<typeof vi.spyOn>;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hack-valid-'));
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env.PRP_API_KEY;
  delete process.env.HACKY_LOG_LEVEL;
  ...
});
```
The **range-error test (line 748-758)** is the verbatim model for the throw case:
```ts
it('SHOULD throw on an out-of-range int naming file+section+key+range', () => {
  vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-range'));
  const repoRoot = mkdtempSync(join(dir, 'repo-range-'));
  const hackFile = join(repoRoot, '.hack');
  writeFileSync(hackFile, '[tasks_lock]\npoll_ms = -5\n');
  expect(() => loadHackConfig(repoRoot)).toThrow(/out of range/);
  expect(() => loadHackConfig(repoRoot)).toThrow(/poll_ms/);
  expect(() => loadHackConfig(repoRoot)).toThrow(hackFile);
});
```
→ Mirror exactly for the relational throw case (cap < delay). The relational tests live in the same
"// --- Type / range / enum (§9.7.7) — HARD errors ---" sub-section (or a new "// --- Relational
cross-key (§9.7.5) ---" sub-section right after it).

## 6. The three test cases (from item LOGIC §3)

| case | .hack content | expectation | branch covered |
|------|---------------|-------------|----------------|
| (a) cap < delay | `[commit]\nretry_delay_ms = 200000\nretry_delay_cap_ms = 100\n` | throws; msg has `retry_delay_cap_ms` + `less than` | inner `if (cap < delay)` TRUE |
| (b) cap ≥ delay | `[commit]\nretry_delay_ms = 1000\nretry_delay_cap_ms = 10000\n` | passes (no throw) | inner `if (cap < delay)` FALSE |
| (c) single key | `[commit]\nretry_delay_ms = 1000\n` (no cap) | passes (no throw) | outer `if (commit && … both …)` FALSE |

- **(b)** is ALSO covered by the existing "SHOULD load a full valid .hack…" test (line 885-913, uses
  `retry_delay_ms = 1000` + `retry_delay_cap_ms = 10000`). Add an EXPLICIT minimal (b) anyway (smaller
  surface, isolates the relational pass from the full-config regression). The existing test is the
  primary regression guard for (b).
- **(c)** cover BOTH "only delay" and "only cap" — either single key → passes (one test with one key
  is enough per the item; add a second variant if cheap). The "no `[commit]` section at all" case is
  already covered by every other test in the file (no commit → outer `if` false → no throw).

All 3 branches of the new code are covered → no coverage gap regardless of whether vitest.config.ts
enforces 100% or a floor (P1.M2.T2.S2 research §4 says it's a FLOOR ~89/90, NOT 100%, for THIS
project; cover all branches regardless).

## 7. HackConfigError + rendering (dependency on P1.M2 — COMPLETE)

`HackConfigError` is imported at hack-config.ts:12 and already used at the 9 throw sites
(P1.M2.T1.S1 = Complete). P1.M2.T2.S1 adds the dedicated `main().catch()` clean arm; P1.M2.T2.S2 adds
the rendering tests (in parallel). **This item uses `HackConfigError` so the relational throw renders
cleanly too** — it rides on the BUG-002 work for free. If for some reason P1.M2.T1.S1 hadn't landed,
`Error` would work (same message); but it HAS landed, so use `HackConfigError`.

## 8. Disjointness / scope

- This item edits ONLY `src/config/hack-config.ts` (validateHackTier body + 2 comments) and
  `tests/unit/config/hack-config.test.ts` (adds 3 tests). NOTHING else.
- **P1.M2.T2.S2** (parallel, in flight) edits `tests/integration/config-error-rendering.test.ts` — a
  DIFFERENT file (disjoint). No merge conflict.
- **P1.M3.T2.S1** (later) is the docs sweep (README, CONFIGURATION.md, CLI_REFERENCE,
  ARCHITECTURE.md). THIS item's Mode A docs are the 2 inline JSDoc/comment edits IN hack-config.ts
  (lines 602-603 + 625) — NOT the external `docs/*.md` sweep (that's P1.M3.T2.S1).
- Do NOT touch `validateFieldValue`, `loadHackConfig`, `HACK_CONFIG_SCHEMA` field specs (beyond the
  comment), the `hack config validate` CLI, or any other file.

## 9. npm scripts (VERIFIED — same as the rest of the bugfix)

```
"fix": "npm run lint:fix && npm run format"
"typecheck": "tsc --noEmit -p tsconfig.build.json"
"lint": "eslint . --ext .ts"
"format:check": "prettier --check \"**/*.{ts,js,json,md,yml,yaml}\""
"test:run": "vitest run"
```
Gate = `npm run fix && npm run typecheck && npm run lint && npm run format:check` + the targeted
`tests/unit/config/hack-config.test.ts`. Do NOT run the full `npm run test:run` as the gate
(orthogonal pre-existing failures per the bugfix docs).