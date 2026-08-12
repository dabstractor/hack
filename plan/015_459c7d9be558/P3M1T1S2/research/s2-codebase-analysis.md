# P3.M1.T1.S2 — Codebase Analysis (package.json metadata + FORMAT_NUDGE_MAX schema confirmation)

## 1. package.json current state (the file to EDIT)

File: `package.json`

Current metadata (lines 1-12):
```json
{
  "name": "hacky-hack",
  "version": "0.1.0",
  "description": "Autonomous PRP Development Pipeline - Agentic software development system",
  "type": "module",
  "bin": { "hack": "./dist/index.js" },
  "engines": { "node": ">=20.0.0", "npm": ">=10.0.0" },
  ...
}
```

Current keywords (lines 62-67):
```json
  "keywords": [
    "typescript",
    "agent",
    "pipeline",
    "autonomous"
  ],
```

- `description` (line 4): generic — no mention of stagecoach / commit generation / identity transparency.
- `keywords` (lines 62-67): 4 generic tags — no `stagecoach`, no `commit-generation`, no `identity-transparent`.
- `"author": ""` (line 68), `"license": "MIT"` (line 69).
- `stagecoach-ai` dependency was added in P1.M2.T1.S1 (confirmed in plan_status: P1.M2.T1 "stagecoach-ai dependency + binary resolver module" = Complete). The S1 README PRP cites it as `"stagecoach-ai": "^0.1.16"` (package.json:83). S2 should CONFIRM the exact version line at edit time (don't hardcode it in the PRP).

**What S2 changes:**
- `description`: reflect the stagecoach commit-generation path + identity transparency.
- `keywords`: ADD `stagecoach`, `commit-generation`, `identity-transparent` (and optionally `git`, `commits`).

**JSON gotchas:**
- No trailing commas in JSON (the keywords array + description are JSON values).
- Preserve double-quote style, 2-space indent (package.json uses 2-space — confirm at edit time; `npm run format` / prettier enforces it).
- Keep the array alphabetically ordered IF the current one is (current: `typescript, agent, pipeline, autonomous` is NOT alphabetical — it's insertion-ordered. So S2 can append; but prettier may reorder. Run `npm run format` after the edit).

## 2. FORMAT_NUDGE_MAX — internal constant, NO env var, NO .hack row (CONFIRMED)

File: `src/config/constants.ts` (lines 440-459)

```ts
/**
 * ...
 * **Not configurable.** This is an INTERNAL constant with a fixed default of 2. It is
 * intentionally NOT exposed as an environment variable or a `.hack` TOML key (§4.5.1 gives
 * it a fixed default; no env var is documented for it). Do not add an env reader here.
 *
 * @example
 * ```ts
 * import { FORMAT_NUDGE_MAX } from './config/constants.js';
 * console.log(FORMAT_NUDGE_MAX); // 2
 * ```
 */
export const FORMAT_NUDGE_MAX = 2;
```

- **Plain exported `const`, value `2`.** No `process.env` read, no getter function, no `DEFAULT_*` companion.
- JSDoc is EXPLICIT: "intentionally NOT exposed as an environment variable or a `.hack` TOML key … Do not add an env reader here."
- This satisfies the contract item 3(b)/(c): there is NOTHING to add or remove — the constant is correctly internal-only.

**Consumers (read-only confirmations, all already wired in P2.M1.T1.S1 — Complete):**
- `src/agents/prp-executor.ts:32,358` (import + `maxFormatNudges = FORMAT_NUDGE_MAX`)
- `src/agents/prp-generator.ts:28,829` (import + `maxNudges = FORMAT_NUDGE_MAX`)
- `src/workflows/fix-cycle-workflow.ts:44,391` (import + `maxNudge = FORMAT_NUDGE_MAX`)
All three call sites import the CONSTANT directly (not a getter). No env reader exists anywhere. ✓

## 3. .hack schema (hack-config.ts) — FORMAT_NUDGE_MAX is ABSENT (correct)

File: `src/config/hack-config.ts`

- `SCHEMA_MAP: readonly HackConfigSchemaEntry[]` (line 189) is the exhaustive §9.7.5 schema reference.
- Section names present: `models`, `reasoning`, `harness`, `endpoint`, `pipeline`, `distributed_prd`, `concurrency`, `bug_hunt`, `validation`, `api`, `monitor`, `cli`, `commit`, `tasks_lock`.
- **`grep FORMAT_NUDGE hack-config.ts` → ABSENT.** No row, no key, no envVar. Correct per the contract.
- The `commit` section (line 332) DOES exist — it holds commit-related tunables (e.g. `commit_format`, and per the constants.ts sibling `COMMIT_RETRY_MAX` which IS env-driven via `getCommitRetryMax()`). FORMAT_NUDGE_MAX is deliberately NOT in this section.

**Schema entry shape** (for the contract's "if a row was accidentally added, remove it" instruction):
```ts
export interface HackConfigSchemaEntry {
  readonly section: string;
  readonly key: string;
  readonly envVar?: string;        // §9.2.2 env-var name (undefined for CLI-only)
  readonly cliFlag?: string;       // Commander option (undefined for env-only)
  ...
}
```
A FORMAT_NUDGE_MAX row would look like `{ section: 'pipeline', key: 'format_nudge_max', envVar: 'FORMAT_NUDGE_MAX', ... }`. **None exists → nothing to remove.** The confirmation is a `grep` assertion, not an edit.

## 4. .hack file + .env.example — no FORMAT_NUDGE_MAX entry (CONFIRMED)

- `<repoRoot>/.hack` (the team-wide defaults file): sections `[harness]`, `[models]`, `[distributed_prd]`, `[pipeline]`, `[validation]`, `[cli]`. **No `format_nudge_max` key anywhere.** Correct.
- `.env.example`: `grep FORMAT_NUDGE .env.example` → **(none)**. Correct — the delta PRD says "no new tunable is required."
- No `hack.example` / `.hack.example` file exists (the `.hack` file itself is the example-ish template).

**Contract item 3(c) satisfaction:** there is nothing to add to `.hack` or `.env.example`. The confirmation is a `grep` assertion in the PRP's validation gates.

## 5. Sibling coordination (zero overlap)

- **P3.M1.T1.S1** (the previous PRP, parallel) — README.md ONLY. Explicitly fences package.json to S2: *"package.json → owned by sibling P3.M1.T1.S2"*. Zero overlap.
- **P2.M1.T1.S2** (Implementing) — src/ JSDoc/comments/WARN-shape on the FORMAT_NUDGE consumers (prp-executor, prp-generator, fix-cycle-workflow). Zero overlap with package.json.
- **P2.M1.T1.S1** (Complete) — added the FORMAT_NUDGE_MAX constant + wired the 3 call sites. DONE. S2 only CONFIRMS it's internal-only.
- **P1.M2.T1.S1** (Complete) — added the stagecoach-ai dependency. DONE. S2's package.json description/keywords REFLECT this shipped dep.

## 6. Mode B (documentation) — this IS the docs task

Contract item 5 DOCS: "This IS the documentation task (Mode B)." S2 is a metadata/doc change to package.json (description/keywords are discoverability metadata, not runtime config) + a CONFIRMATION (grep assertions) that FORMAT_NUDGE_MAX has no schema/env surface. **No source code logic change.** No README edit (S1 owns README). No docs/*.md edit.

## 7. Validation (verified commands)

- `npm run format:check` — package.json IS in prettier's glob (the format script runs on `**/*.{ts,json,md}` or similar). Run `npm run format` to auto-fix keyword-array wrapping/indentation.
- `npm run validate` = lint + format:check + typecheck + test:run (GREEN gate; package.json edit has zero code impact but format:check must pass).
- `npm run build` — succeeds (no impact).
- `grep -n "stagecoach\|commit-generation\|identity-transparent" package.json` — confirms the new keywords/description.
- `grep -rn "FORMAT_NUDGE_MAX" src/config/hack-config.ts` → ABSENT (the confirmation).
- `grep -n "FORMAT_NUDGE" .env.example .hack` → ABSENT (the confirmation).
- `git diff --name-only` → `package.json` ONLY.

## 8. The minimal, low-risk change

```jsonc
// description (line 4):
//   BEFORE: "Autonomous PRP Development Pipeline - Agentic software development system"
//   AFTER:  "Autonomous PRP Development Pipeline — stagecoach-backed, identity-transparent commit generation for agentic software development"
//           (or similar; reflect stagecoach + identity-transparency per contract item 3a)

// keywords (lines 62-67): ADD three tags
//   BEFORE: ["typescript", "agent", "pipeline", "autonomous"]
//   AFTER:  ["typescript", "agent", "pipeline", "autonomous", "stagecoach", "commit-generation", "identity-transparent"]
//           (optionally also "git", "commits")
```

Plus grep-assertion validation gates (no edits to hack-config.ts / .hack / .env.example). This is the full scope.