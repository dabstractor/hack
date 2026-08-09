# Validation Report — Distributed-PRD Include-Dedup Feature (PRD §2.3)

**Validator:** autonomous validation pass · **Date:** 2026-01-28 · **Scope:** PRD §2.3 (include expansion, global-flat dedup, elision, idempotency, markers, stale-include warnings) + codebase quality gates.

---

## Headline Verdict

> **All three (3) bugs listed in the "Bug Fix Requirements" PRD are ALREADY FIXED in the current codebase and independently verified at runtime. No critical, major, or minor defects remain in scope.**

The PRD's bug list describes a **prior** state of the code. Three later commits resolved each finding before this validation ran:

| PRD Bug | Fix commit | File(s) touched | Runtime-verified |
|---|---|---|---|
| **BUG-001** — marker format `@!include` vs stale JSDoc | `613b857` "Fix stale PRD_INCLUDE_MARKERS JSDoc for @! markers" + `a91bec9` doc sweep | `src/config/constants.ts` | ✅ |
| **BUG-002** — stale `.md` at maxDepth gate emits no warning | `b3f686c` "Emit stale-include warning at depth gate" | `src/core/session-utils.ts` | ✅ |
| **BUG-003** — symlink aliases defeat dedup (lexical key) | `e1ce973` "Key visited set on canonical realpath for symlink dedup" | `src/core/session-utils.ts` | ✅ |

---

## Methodology

The validator did **not** trust commit messages or code comments — it exercised the actual runtime behavior via independent probes, plus the project's own quality gates and test suite.

1. **Spec read.** Read PRD §2.3 in full (`spec/02-core-concepts.md`) and traced the three bug locations in `src/core/session-utils.ts` and `src/config/constants.ts`.
2. **Independent runtime probes (17 checks).** Wrote a standalone TS probe (`/tmp`, outside the repo) that imports `resolvePRD` directly and exercises every PRD-asserted behavior and all three bug scenarios. **17/17 passed.**
3. **E2E on the real distributed spec.** Resolved the project's own canonical multi-file PRD (`spec/SPEC.md`, which uses `@01-…md`…`@16-…md` includes) exactly as production does — verifying merge completeness, idempotency, hash stability, and warning semantics.
4. **Quality gates.** Ran lint, typecheck, prettier, docs:check, and the full unit/integration suite.
5. **Production-wiring audit.** Confirmed every production path (`session-manager`, `prp-pipeline`, `hashPRD`) routes through the dedup-aware `resolvePRD`, and that the non-dedup single-level primitive `resolveIncludes` has **zero** production callers.

---

## Per-Bug Verification (runtime evidence)

### BUG-001 — Marker format & JSDoc — **FIXED**
- `resolvePRD('main.md', {markers:true})` with `main='@a.md'`, `a.md='A'` → emits `<!-- @!include: a.md -->\nA\n<!-- @!end-include -->`. ✅
- The `@!` prefix is a **deliberate collision-proof** technique: `!` is outside the token char-class `[A-Za-z0-9_./-]`, so markers are structurally non-resolvable on re-scan. Verified: with files literally named `include`, `end-include`, `include-ref` present, marker output stays byte-idempotent across two resolution passes and no marker-word file content leaks in. ✅
- The user-facing JSDoc for `PRD_INCLUDE_MARKERS` in `src/config/constants.ts` (lines ~1283–1303) **now documents the `@!include`/`@!end-include`/`@!include-ref` markers** — the stale-doc complaint is resolved.

### BUG-002 — Stale `.md` warning at the maxDepth gate — **FIXED**
- `g.md='G @missing.md END'`, `main.md='@g.md'`, `resolvePRD(main, {maxDepth:1})` → output `'G @missing.md END'` with **exactly ONE** stderr `console.warn` naming `missing.md`. ✅ (The PRD's repro case now warns.)
- Deep chain at default depth: `main→f1→…→f10`, `f10='DEEP @stale.md END'`, `resolvePRD(main)` (default `maxDepth=10`) → the `stale.md` warning fires. ✅
- Implementation: `neutralizeResolvableTokens` (the depth-gate scan) now routes non-resolving `.md` tokens through the shared `emitStaleIncludeWarning`, satisfying §2.3's unconditional MUST.

### BUG-003 — Symlink-alias dedup — **FIXED**
- `real.md='REAL'`, `alias.md` → symlink to `real.md`, `main.md='@real.md @alias.md'`, `resolvePRD(main)` → `'REAL '` (**`REAL` appears exactly once**; the alias reference elides). ✅ (The PRD's repro of `'REAL REAL'` duplication no longer occurs.)
- Implementation: a new `dedupKey(abs)` helper returns `realpathSync(abs)` (with a safe lexical fallback), and all three keying sites — the elision `has` check, the mark-visited `add`, and the entry pre-seed — use it. The macOS-tmpdir-is-symlink hazard noted in the code comment is handled.

### Core §2.3 contract — all hold
- **Idempotency** `resolve(resolve(x))===resolve(x)`: verified markers-off AND markers-on, including with stale survivors and marker-word collision files. ✅
- **Diamond** (A→C, B→C): C injected exactly once. ✅
- **Self-cycle** & **mutual cycle**: terminate without blowup (entry pre-seeded in visited). ✅
- **Exponential-blowup protection** (`a` refs `b` twice, `b` refs `a` twice): each file expands once. ✅
- **Boundary rules**: `foo@bar.com` stays literal; space-prefixed `@a.md` expands. ✅

---

## E2E — Real Distributed Spec (`spec/SPEC.md`)

Resolved the project's own canonical PRD the way `hashPRD`/`SessionManager.initialize` do in production:
- ✅ All 16 included section files merged inline (sum of bodies 156,549 B vs resolved 157,023 B; distinctive bodies from `02-core-concepts` and `16-validation-gates` both present).
- ✅ No leftover `@NN-…md` directives (all expanded).
- ✅ Idempotent fixed point (resolve-of-resolve identical).
- ✅ SHA-256 of the resolved document is stable across runs (§4.1 hash/snapshot consistency).
- ✅ Markers-on round-trip also idempotent.

**Note (expected, not a defect):** resolution emits exactly **2** stale-include warnings for `@path/to/file.md`, because the §2.3 *documentation prose itself* (`spec/02-core-concepts.md:24`) uses that literal string twice as a syntax example. Per §2.3, a `.md`-suffixed token that fails to resolve MUST warn — this is the typo-detection feature working as designed, not a bug. (See *Non-Defect Observations* §B.)

---

## Quality Gates

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ **0 errors**; 6 pre-existing `no-explicit-any` **warnings** (4 in `src/cli/index.ts`, 2 in `src/utils/logger.ts`) — unrelated to §2.3 |
| Type check | `npm run typecheck` | ✅ clean |
| Format | `npm run format:check` | ✅ all files conform |
| Docs | `npm run docs:check` | ✅ 5/5 passed |
| Unit/integration suite | `npm run test:run` | ✅ **7225 passed**, 71 skipped (no §2.3 skips; skips are intentional feature-gated/"skip-logic" tests) |
| §2.3-targeted suite | `prd-includes` + `prd-resolve` + `prd-markers` | ✅ **72/72 passed** |

---

## Critical / Major / Minor Issues

**Critical:** None.
**Major:** None.
**Minor:** None.

(The three PRD-listed bugs are resolved — see *Headline Verdict*. They are **not** open issues.)

---

## Non-Defect Observations (NOT counted as issues)

These are documented for transparency. Each is either correct-as-designed behavior or out of scope for a code fixer (would require editing the PRD, which is forbidden for an implementation/fix agent per `AGENTS.md`). **They do not constitute defects and do not gate validation.**

- **(A) Spec-text vs implementation marker wording.** The literal example in `spec/02-core-concepts.md` §2.3 still reads `<!-- @include: path -->`, while the code emits the collision-proof `<!-- @!include: path -->`. The code is **strictly more correct** than the literal example: the bare `@include` form would itself be a resolvable token if a file named `include` existed, violating §2.3's own "no resolvable `@token`" requirement for the elision reference comment. The user-facing JSDoc and overview docs already match the code. Reconciling the literal spec example is a **PRD-text edit** (a planning act) — not something a code fixer should touch; reverting the code to `@include` would **reintroduce** the collision hazard (a regression).

- **(B) Spec doc-example triggers stale warnings.** Resolving the canonical spec yields 2 stderr warnings because `spec/02-core-concepts.md:24` uses the literal `@path/to/file.md` as its include-syntax example. This is the §2.3 stale-`.md` MUST firing correctly. Harmless noise; resolution still succeeds and is idempotent.

- **(C) Pre-existing `no-explicit-any` lint warnings.** 6 warnings (non-blocking; lint exits 0) in `src/cli/index.ts` and `src/utils/logger.ts`. Pre-existing and unrelated to the §2.3 feature.

---

## Production-Wiring Audit

- All production PRD consumers (`src/core/session-manager.ts`, `src/workflows/prp-pipeline.ts`, and `hashPRD`) call **`resolvePRD`** (the dedup-aware resolver). ✅
- The single-level non-dedup primitive **`resolveIncludes`** has **zero production callers** in `src/` (only tests). No production path bypasses dedup. ✅
- `hashPRD` resolves via `resolvePRD` before hashing → §4.1/§4.3 hashing and delta detection operate over the fully-resolved, idempotent document. ✅

---

## Recommendation

**No code changes required.** The §2.3 feature is correct, robust, and fully covered by tests + runtime probes. The only follow-ups are optional PRD-text/planning edits (Observation A) and cosmetic type-tightening (Observation C), neither of which is a defect.

---

**Final structured verdict:** see `validation_result.json` → `{ "hasIssues": false, "issueCount": 0 }`.