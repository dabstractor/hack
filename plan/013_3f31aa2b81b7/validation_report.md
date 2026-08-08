# Validation Report — Per-Role Reasoning Level (Extended-Thinking Budget)

**Project:** hacky-hack (Autonomous PRP Development Pipeline)
**Feature validated:** Per-Role Reasoning Level — PRD §9.2.9 (session `plan/013_3f31aa2b81b7`)
**Validator:** Automated validation agent (`./validate.sh`) + manual E2E verification
**Date:** 2027-08-08
**Result:** ✅ **PASSED** — 24/24 gates green, 2 documentation-consistency warnings (no functional defects)

---

## 1. Executive Summary

The Per-Role Reasoning Level feature (PRD §9.2.9) is **functionally complete and correct**.
The extended-thinking ("reasoning") budget is now a first-class, independently-configurable
per-role setting, fully decoupled from model (tier) selection. Every acceptance criterion in
§9.2.9 was verified — by the existing 7,201-test suite, by the type system, and by direct
functional/CLI E2E checks.

**No functional bugs were found.** The only issues are **documentation-consistency** defects:
several source comments and one `.env.example` line still claim the reasoning budget is pinned
to `xhigh`, contradicting the §9.2.9 behavior change (the reasoning roles now default to
`high`, configurable). These comments are misleading but do not affect runtime behavior — the
agents resolve their budgets through the new per-role getters, which correctly default to
`high`/`off`.

| Category                                            | Count                                 |
| --------------------------------------------------- | ------------------------------------- |
| Critical / functional defects                       | **0**                                 |
| Major defects                                       | **0**                                 |
| Documentation-consistency warnings (stale comments) | **2** (covering 10 comment locations) |
| Gates passed                                        | 24 / 24                               |
| Unit/integration tests                              | 7,201 passed / 71 skipped / 0 failed  |

---

## 2. What Was Validated

The validation exercised the full §9.2.9 surface across ten phases (see `./validate.sh`):

| Phase | Check                                           | Result                                                             |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------ |
| 1     | ESLint (`npm run lint`)                         | ✅ 0 errors (6 pre-existing `no-explicit-any` warnings, unrelated) |
| 2     | TypeScript strict typecheck (`tsc --noEmit`)    | ✅ 0 errors                                                        |
| 3     | Prettier format check                           | ✅ All files conform                                               |
| 4     | Vitest full suite                               | ✅ 7,201 passed, 71 skipped                                        |
| 5     | Docs check (`scripts/check-docs.ts`)            | ✅ 5/5                                                             |
| 6     | Production build (`tsc -p tsconfig.build.json`) | ✅ `dist/` emitted                                                 |
| 7     | Functional E2E — config resolution              | ✅ 7/7 (see §3)                                                    |
| 8     | Functional E2E — CLI surface                    | ✅ 7/7 (see §4)                                                    |
| 9     | Documentation completeness (Mode-B docs)        | ✅ 4/4                                                             |
| 10    | Stale-comment scan                              | ⚠️ 2 warnings (see §5)                                             |

---

## 3. §9.2.9 Acceptance Criteria — Functional Verification

Each criterion from PRD §9.2.9 was verified directly (not just via unit tests):

| #   | Acceptance criterion                                                                                                            | Verification                                                                                                                                    | Status                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A   | `PRP_REASONING_IMPL_AGENT=off` keeps the strong model with thinking disabled                                                    | Architect (reasoning role, balanced tier `zai/glm-5.2`) + `thinking:'off'`; Coder (impl role, fast tier `zai/glm-5-turbo`) + `thinking:'xhigh'` | ✅ **PASS** — model tier and reasoning level are truly independent axes |
| B   | With no reasoning config, roles resolve to `high/high/high/high/off`                                                            | `getReasoning{Agent,Breakdown,BugFinder,Validation,Impl}()` → `high/high/high/high/off`                                                         | ✅ **PASS**                                                             |
| C   | `PRP_REASONING_VALIDATION_AGENT=xhigh` overrides validation; `PRP_REASONING_AGENT=medium` lowers research; others keep defaults | Per-env-var getters resolve independently                                                                                                       | ✅ **PASS**                                                             |
| D   | Empty value (`""`) treated as unset → default; never forwarded                                                                  | `""` and `"   "` both → default `off` (impl)                                                                                                    | ✅ **PASS**                                                             |
| E   | Invalid value (`ultra`) aborts at startup, exit 1, naming key+value+levels, before any session/agent                            | `resolveReasoningLevel("ultra",...)` throws `ReasoningConfigError`; `main().catch` renders `❌ …` and exits 1                                   | ✅ **PASS**                                                             |
| F   | `hack config show --src` reports each role's resolved level + winning source                                                    | All 5 `reasoning.*` rows appear with `default`/`env`/`project` source attribution                                                               | ✅ **PASS**                                                             |
| —   | Case-insensitive vocabulary (`HIGH`→`high`, `Off`→`off`)                                                                        | Functional getters normalize; `.hack` loader accepts case-insensitively                                                                         | ✅ **PASS**                                                             |
| —   | Bug-finder & validation resolve **independent** levels                                                                          | `BUG_FINDER=xhigh` + `VALIDATION=low` → distinct levels, no cross-contamination                                                                 | ✅ **PASS**                                                             |
| —   | Invalid `.hack` reasoning value fails fast with actionable message                                                              | `[reasoning] impl_agent = "loud"` → `HackConfigError` naming section+key+file+value+accepted                                                    | ✅ **PASS**                                                             |
| —   | `--help` short-circuits before validation (works with no repo, invalid env)                                                     | `PRP_REASONING_AGENT=ultra hack --help` → exit 0                                                                                                | ✅ **PASS**                                                             |
| —   | Env-over-file rule holds for reasoning                                                                                          | `.hack agent=high` + `env PRP_REASONING_AGENT=low` → `low` (env wins)                                                                           | ✅ **PASS**                                                             |

### Implementation verification (code-level)

- **`src/config/constants.ts`** — `ReasoningLevel` type, `REASONING_LEVELS` vocabulary
  (`off/minimal/low/medium/high/xhigh` — identical to the pi SDK's `VALID_THINKING_LEVELS`),
  5 env-name constants, 5 defaults (`high/high/high/high/off`), `resolveReasoningLevel()`
  shared validator (case-insensitive, empty→default, invalid→throw), 5 per-role getters,
  `validateAllReasoningLevels()` aggregate. ✅ Correct.
- **`src/config/types.ts`** — `ReasoningConfigError` mirrors `AuthPreflightError`
  (`this.name`, readonly `key`/`value`, actionable message naming key+value+levels). ✅ Correct.
- **`src/agents/agent-factory.ts`** — `ThinkingLevel = ReasoningLevel` (reconciled: added
  `minimal`, dropped `max`); `ROLE_CONFIG` carries `tier` only (no `thinking`); `createBaseConfig`
  takes a **required** `thinking` param composed independently of tier (compile-time enforced
  decoupling — a missing arg is a TS2554 error, not a silent `undefined`); all factories wired
  to their getters; `createQAAgent(level)` takes a caller-supplied level. ✅ Correct.
- **`src/agents/commit-message-agent.ts`** — `createBaseConfig('researcher','research','off')`
  (hardcoded `off`, documented, not coupled to `PRP_REASONING_IMPL_AGENT`). ✅ Correct.
- **4 `createQAAgent` call sites** — bug-hunt→`getReasoningBugFinder()`,
  validation→`getReasoningValidation()`, delta-analysis→`getReasoningAgent()`,
  change-classifier (×2)→`getReasoningAgent()` (research-leaning, documented). ✅ Correct.
- **`src/config/hack-config.ts`** — 5 `[reasoning]` `SCHEMA_MAP` entries + `HACK_CONFIG_SCHEMA`
  enum; case-insensitive enum check + lowercase seeding for `[reasoning]`. ✅ Correct.
- **`src/index.ts`** — `validateAllReasoningLevels()` on startup path (after auth preflight,
  before any session/agent); `ReasoningConfigError` arm in `main().catch` (exit 1, no stack). ✅ Correct.

---

## 4. CLI / End-to-End Workflow Verification

Real workflows were simulated through the actual CLI (`npx tsx src/index.ts`) and the built
`dist/`:

1. **`hack config show --src`** → surfaces all 5 reasoning roles with correct defaults
   (`high/high/high/high/off`) and `default` source. With `PRP_REASONING_IMPL_AGENT=xhigh`,
   shows `xhigh` / `env`. ✅
2. **`.hack` case-insensitivity** → `[reasoning] agent = "HIGH"` and `impl_agent = "Off"`
   accepted, reported with `project` source. ✅
3. **Env-over-file** → `.hack agent=high` + shell `PRP_REASONING_AGENT=low` → resolved `low`
   (`env` wins, per §9.2.1). ✅
4. **Invalid `.hack` value** → `[reasoning] impl_agent = "loud"` → hard error naming
   section+key+file+value+accepted values, exit 1. ✅
5. **`--help` short-circuit** → `PRP_REASONING_AGENT=ultra hack --help` exits 0 (validation
   never runs for `--help`). ✅
6. **Functional getter resolution** (via `dist/`) → case normalization (`HIGH`→`high`),
   empty→default, bug-finder/validation independence all confirmed. ✅

---

## 5. Bug Tracker (Issues Found)

> The validator reports; it does not fix. Each item below is a **finding**, not a patch.
> Severity is calibrated against the §9.2.9 functional contract — none are functional defects.

### ⚠️ ISSUE-1: Stale source comments still claim `xhigh` reasoning budget (documentation consistency)

**Severity:** Low (documentation-only; runtime behavior is correct)
**Spec ref:** PRD §9.2.9 "Behavior change vs. the prior hard-wired design" — the reasoning roles
moved from a hard `xhigh` pin to a configurable **`high`** default.

**Description.** The §9.2.9 behavior change lowered the reasoning-role default from `xhigh` to
`high`. The agent-factory.ts comment cleanup (T3.S2) updated the comments _within_
`agent-factory.ts`, but **10 comment locations in other files** still state the reasoning budget
is `xhigh`. These are now factually wrong: the actual budget is resolved by the per-role getters
and defaults to `high`. A reader following these comments would believe the bug-finder/architect
run at the maximum budget, when they in fact run at `high` unless explicitly overridden.

**Locations (verified):**

| File:line                                 | Stale text                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/agent-factory.ts:174`         | "Set to 'xhigh' for the Reasoning role (decomposition/bug-finding/validation); undefined for Research/Implementation roles." |
| `src/workflows/fix-cycle-workflow.ts:253` | "inherits the xhigh Reasoning budget (mirrors decomposePRD invariant)."                                                      |
| `src/workflows/prp-pipeline.ts:1328`      | "Reasoning role (xhigh budget — wired by createArchitectAgent via S2)."                                                      |
| `src/workflows/prp-pipeline.ts:1330`      | "instance on every attempt, so every retry inherits the xhigh budget."                                                       |
| `src/config/constants.ts:948`             | "rewrite the reasoning persona (balanced tier @ `xhigh`) realizes it via the `qa` persona"                                   |
| `src/config/constants.ts:1075`            | "reasoning persona that already runs the bug hunt (balanced tier @ `xhigh`)."                                                |
| `src/config/constants.ts:1086`            | "with `--thinking xhigh` per PRD §9.2.3"                                                                                     |
| `src/config/constants.ts:1087`            | "(balanced tier @ `xhigh`) realizes it via the `qa` persona"                                                                 |
| `src/config/constants.ts:1124`            | "agent is the runtime reasoning persona (`createQAAgent`, balanced tier @ `xhigh` per"                                       |

**Note:** `src/agents/agent-factory.ts:174` is especially misleading because it lives in the
JSDoc of `AgentConfig.thinking` — the very field the §9.2.9 feature populates — and claims
"undefined for Research/Implementation roles", which is the _opposite_ of the new behavior
(every role now carries an explicit resolved level; impl defaults to `off`, research to `high`).

**Impact.** None at runtime (the getters supply the correct level). Confusion for maintainers
and contradicts the user-facing docs (`docs/CONFIGURATION.md` §"Behavior change", which is
correct).

**Recommended action (for a follow-up PR).** Update each `xhigh`-budget comment to read
"`high` (default, configurable per §9.2.9)" and fix the `AgentConfig.thinking` JSDoc to state
the level is "resolved per-role via `PRP_REASONING_*` (defaults high/high/high/high/off)".

---

### ⚠️ ISSUE-2: Stale `.env.example` comment claims bug-finder runs at `xhigh`

**Severity:** Low (documentation-only)
**Spec ref:** PRD §9.2.9 behavior change; `.env.example` line 179.

**Description.** `.env.example:179`, in the `BUG_FINDER_AGENT` doc block, states:

> "The bug-finder runs as the reasoning persona at the maximum reasoning budget (xhigh)."

This contradicts the §9.2.9 behavior change and the _same file's own_ "REASONING LEVELS" section
(lines 88–89), which correctly documents `PRP_REASONING_BUG_FINDER_AGENT` defaulting to `high`.
A user reading the `BUG_FINDER_AGENT` block would be told `xhigh` while the reasoning-levels
block (50 lines up) says `high`.

**Impact.** None at runtime. Internal doc inconsistency within `.env.example`.

**Recommended action.** Change "at the maximum reasoning budget (xhigh)" → "at the `high`
reasoning budget by default (configurable via `PRP_REASONING_BUG_FINDER_AGENT`; PRD §9.2.9)".

---

### ℹ️ OBSERVATION-1: `config show --src` displays raw case-variant values (cosmetic)

**Severity:** Very low (display only; functional resolution is correct)
**Spec ref:** §9.7.5 canonicalization note ("(→ 'high')").

**Description.** When a reasoning value is supplied in non-lowercase form via `.hack` or a shell
env var (e.g. `PRP_REASONING_AGENT=HIGH` or `[reasoning] agent = "HIGH"`), `hack config show --src`
displays the **raw** value (`HIGH`) rather than the **normalized** lowercase value (`high`) that
the getter actually resolves to. The functional behavior is correct — `getReasoningAgent()`
returns `"high"` — but the displayed effective value differs cosmetically from the resolved one.

**Why it happens.** `config show` reflects the value from the winning source layer verbatim.
`.hack`-sourced values _are_ lowercased when seeded into `process.env` (`seedProcessEnv`), but
`config show` reads the merged file/env values for display, not the post-normalization env. For
shell env values, no normalization occurs at display time.

**Impact.** A user could set `HIGH` and see `HIGH` in `config show` yet the agent runs at `high`.
No functional discrepancy, but the §9.7.5 "(→ 'high')" canonicalization promise is not reflected
in the display. Arguably acceptable (the source _did_ say `HIGH`), but worth noting for a future
polish pass where `config show` normalizes case-insensitive enum values before display.

---

## 6. Items Verified Clean (No Issues)

The following high-risk areas were specifically scrutinized and found correct:

- **Decoupling proof (the core §9.2.9 guarantee):** An architect (reasoning role) set to
  `thinking:'off'` still uses the balanced-tier model `zai/glm-5.2`; a coder (impl role) set to
  `thinking:'xhigh'` still uses the fast-tier model `zai/glm-5-turbo`. Tuning one axis never
  perturbs the other. ✅
- **`createBaseConfig` required-arg enforcement:** The `thinking` param has no default, so a
  caller that forgets to resolve a level is a compile error (TS2554), not a silent re-coupling. ✅
- **Vocabulary alignment:** `REASONING_LEVELS` is byte-identical to the pi SDK's
  `VALID_THINKING_LEVELS` (`off/minimal/low/medium/high/xhigh`) — `minimal` present, `max`
  absent. ✅
- **QA-persona split:** Bug-finder and validation resolve **independent** levels via separate
  getters; delta-analysis and change-classifier are documented as research-leaning. ✅
- **Startup ordering:** reasoning validation runs after auth preflight and `.hack`/env load, but
  before any session/agent — so both a missing credential and a bad level are caught at startup. ✅
- **`--help`/`--version`/invalid-flag** short-circuit during `parseCLIArgs()` before the repo-root
  traversal and reasoning validation, so they work with no repo and invalid env. ✅
- **Error rendering:** `ReasoningConfigError` surfaces as a clean `❌ <message>` (no stack trace),
  matching the §9.2.7/§9.7.7 fail-fast discipline. ✅
- **Mode-B changeset docs:** `docs/CONFIGURATION.md` (full reasoning section + two-axes model +
  behavior-change note), `docs/ARCHITECTURE.md` (reasoning as orthogonal axis + QA split), and
  `README.md` (feature blurb + link) are all present and consistent with the implementation. ✅

---

## 7. Reproducing This Validation

```bash
./validate.sh        # runs all 10 phases; exits 0 (24 pass, 2 warnings)
```

The script writes detailed per-gate output to stdout and captures failures to `/tmp/validate.out`.
It performs no source modification — it only reads, builds, tests, and invokes the CLI.

---

## 8. Conclusion

The Per-Role Reasoning Level feature is **production-ready**. Every functional acceptance
criterion of PRD §9.2.9 is satisfied and verified — by 7,201 passing tests, by strict
typechecking, and by direct functional/CLI E2E checks. The model-tier ↔ reasoning-level
decoupling (the central thesis of §9.2.9) is enforced both at the type level and at runtime.

The only findings are **low-severity documentation-consistency defects**: a handful of source
comments and one `.env.example` line that still describe the _pre-§9.2.9_ `xhigh` default. These
are misleading to readers but have **zero runtime impact** — the agents correctly resolve their
budgets through the new per-role getters (defaulting to `high`/`off`). They should be cleaned up
in a small follow-up doc pass for consistency with the already-correct user-facing documentation.
