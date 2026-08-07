# Validation Report — hacky-hack (PRP Pipeline)

**Date:** 2026-08-07
**Validator:** Automated end-to-end (`./validate.sh`) + independent manual probes
**Scope:** Full codebase validation, with emphasis on the PRD §5.1 "Commit Message Style" layer and §5.4 `hack update` command (the session-012 delta).

---

## Executive Summary

**The codebase passes validation end-to-end. 34/34 checks pass; 0 critical/major/minor code defects found.**

The input PRD is itself a *prior* validation report describing one critical bug (**BUG-001**: `getRecentCommitMessages()` passed simple-git the invalid option `maxEntries` instead of `maxCount`, breaking the default `auto` commit-style on every pipeline commit). I verified independently that **BUG-001 is already fixed** in the current source (commit `bba784b`), is covered by real-simple-git regression tests, and behaves correctly under the default configuration. No new code defects were introduced.

The only item worth flagging is **non-blocking local build staleness** (the gitignored `dist/` artifact had not been rebuilt after the source fix) — not a code defect; a clean `npm run build` resolves it.

---

## Status of the Input PRD's BUG-001

| Aspect | Result |
|---|---|
| Source fix present? | ✅ `src/tools/git-mcp.ts:590` uses `git.log({ maxCount: count })` |
| Unit test corrected? | ✅ `tests/unit/tools/git-mcp.test.ts:977` asserts `{ maxCount: 2 }` |
| Regression test vs real simple-git? | ✅ `tests/integration/git-mcp-log.test.ts` (no mock masking) |
| Full `auto` path E2E (LLM mocked only)? | ✅ `tests/integration/git-commit-generate.test.ts` |
| Independent repro under DEFAULT config? | ✅ `style=auto n=5` → returns 5 messages, **no throw** |
| `maxEntries` still rejected by simple-git 3.30.0? | ✅ (confirms the bug class was real) |

**Conclusion:** BUG-001 is genuinely resolved and defended against regression. The headline feature (`auto` commit-style learning) works under the out-of-the-box default.

---

## What Was Validated

### Standard quality gates (project's own tooling)
- **Lint** (`npm run lint`): 0 errors. 6 `@typescript-eslint/no-explicit-any` warnings (configured as `warn`, not `error` — non-blocking).
- **Type check** (`npm run typecheck` / `tsc --noEmit`): 0 errors.
- **Format** (`npm run format:check` / prettier): all files conform.
- **Tests** (`npm run test:run` / vitest): **7125 passed, 71 skipped, 0 failed** (216 files).
- **Docs** (`npm run docs:check`): 5/5 checks pass (terminology, code blocks, dates, …).

### End-to-end user workflows (mirroring README + PRD)
1. **Shipped binary smoke** — `hack --version`, `--help`, subcommand listing (`update` §5.4, `status` §5.3) all work against `dist/index.js`.
2. **Distributed-PRD include expansion (§2.3)** — `resolvePRD('spec/SPEC.md')` expands all 16 `@`-includes (0 leftover directives), contains §5.1 "Commit Message Style" and §5.4 "Manual Status Updates", and is **idempotent** (`resolve(resolve(x)) === resolve(x)`).
3. **`.hack` config loader** — `config show --src` surfaces the new `pipeline.commit_style` (`auto`, default) and `pipeline.commit_style_examples` (`5`, default); `cli.prd` resolves to `spec/SPEC.md`.
4. **Commit-style system-prompt builder (§5.1, all 4 modes)** — `plain` (imperative/≤72-char/no type-prefix), `conventional` (`type(scope): desc` + vocab), `gitmoji` (emoji reference table + real emoji char), `auto` (examples verbatim + anti-reuse instruction + ignore-position-prefix instruction); `auto` with no examples omits the examples section.
5. **BUG-001 regression** — real `getRecentCommitMessages(5)` under default config returns 5 real commits without throwing; targeted regression suite (`git-commit-generate` + `git-mcp-log`) passes.
6. **`hack update` E2E (§5.4)** — in a throwaway git repo with a schema-valid `tasks.json`:
   - Loose ID matching: `p1m1t1s1`, `1.1.1.2`, `1`, `P1.M1.T1.S1` all resolve.
   - Loose status matching: synonyms (`re`→Ready, `done`→Complete), prefixes, substrings.
   - Downward `Complete` cascade: `update 1 done` → every P1 descendant `Complete`.
   - Bottom-up ancestor recompute: completing last subtask promotes Task/Milestone/Phase.
   - Downgrade: resetting a subtask to `Planned` drops ancestors to the least-progressed status.
   - Atomic write: valid JSON retained, no leftover temp/`.bak` files.
   - Error paths (all exit non-zero with clear messages): unknown id, ambiguous status `r`, unknown status `bogus`, non-settable `Retrying` (correctly excluded).
7. **`.hack` loader validation (new keys)** — rejects invalid `commit_style` enum, out-of-range `examples` (`<0`), and type mismatch (string for int); accepts valid explicit values.

---

## Bug Tracker

### Critical
_None._

### Major
_None._

### Minor
_None (code)._

### Non-blocking observations
1. **Local `dist/` build was stale relative to source.** At validation start, the gitignored `dist/tools/git-mcp.js` still contained the pre-fix `maxEntries` (the BUG-001 defect), because the artifact predated the source fix. Since `dist/` is **gitignored** (a build artifact, not committed), this is **not a shipped defect** — a clean `npm run build` regenerates it correctly from the fixed source (verified: post-rebuild `dist/tools/git-mcp.js` uses `maxCount`, 0 stale files). Anyone running the previously-built local binary during a pipeline run would have hit the placeholder-commit fallback; the rebuild resolves this. **Recommendation:** rebuild before any pipeline run, or add a staleness guard to CI/`prebuild`.
2. **6 `no-explicit-any` lint warnings** in `src/cli/index.ts` and `src/utils/logger.ts`. These are configured as warnings (not errors) and do not fail the build; tightening them to typed signatures is a future polish item.

---

## Testing Summary

| Category | Count |
|---|---|
| Critical bugs found | 0 |
| Major bugs found | 0 |
| Minor bugs found | 0 |
| Prior-report bugs confirmed fixed | 1 (BUG-001) |
| `validate.sh` checks passed | 34 / 34 |
| `validate.sh` checks failed | 0 |

---

## Recommendations

1. **Rebuild `dist/` before pipeline runs** (or wire a source-vs-dist staleness check into `prebuild`/CI) so the shipped artifact always reflects the fixed source.
2. Optionally promote the 6 `no-explicit-any` sites to typed signatures to reach 0 lint warnings.
3. Keep the real-simple-git integration tests (`git-mcp-log`, `git-commit-generate`) as the permanent regression net for the option-name class of bug — they are what caught/mask nothing here and prevent re-introduction.

---

## Validation Artefact
The executable validator is at **`./validate.sh`** (11 phases, fully self-contained, read-only against this repo; all write operations run in throwaway `/tmp` git repos). Re-run anytime with `./validate.sh`.