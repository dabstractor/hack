# PRP — P2.M2.T2.S1: Register `config` subcommand + implement init/show/validate/path actions

---

## Goal

**Feature Goal**: Add a new `hack config` **subcommand** to the `hack` CLI that exposes the
`.hack` configuration feature (PRD §9.7.8) through four actions — `init`, `show`, `validate`,
`path` — each consuming the authoritative config primitives produced by the sibling work items
(`SCHEMA_MAP`/`SCHEMA_BY_KEY` from P2.M2.T1.S1; `loadHackConfig`/`parseHackFile`/`validateHackTier`
from P2.M1.T1/S1; `resolveRepositoryRoot` from P1.M1.T1.S1). The subcommand is registered in
`parseCLIArgs()` alongside `cache`/`task`/`status`/`inspect`, dispatched as a `{ subcommand: 'config' }`
sentinel, and implemented as a `ConfigCommand` class in `src/cli/commands/config.ts` mirroring the
proven `CacheCommand` pattern.

> **Scope boundary (read first).** S1 (P2.M2.T1.S1) is being implemented **in parallel** and owns
> the DATA layer (`SCHEMA_MAP`/`SCHEMA_BY_KEY`/`HackConfigSchemaEntry` + re-authoring
> `HACK_KEY_TO_ENV`) in `src/config/hack-config.ts`. **This PRP (S1's downstream consumer) CONSUMES
> those exports read-only** and makes ONE category of edit to `hack-config.ts`: adding `export` to
> three currently-private functions (`globalHackPath`, `isSecretKey`, `validateHackTier`) that the
> config subcommand needs. Those three functions are in regions **disjoint** from S1's edits (see
> "Why / Out of scope" + research §6). S1 does NOT touch those three functions.

**Deliverable** (Mode A — docs ride with the work):
1. **`src/cli/commands/config.ts`** (NEW) — `ConfigCommand` class + exported `ConfigOptions`
   interface; `async execute(action, options)` dispatching to four private actions.
2. **`src/config/hack-config.ts`** (MODIFIED) — add `export` to `globalHackPath`, `isSecretKey`,
   `validateHackTier` (one keyword each; bodies byte-identical). NO other change.
3. **`src/cli/index.ts`** (MODIFIED) — register the `config` subcommand (mirror `cache`),
   add `| { subcommand: 'config'; options: ConfigOptions }` to the `parseCLIArgs` return union,
   add the `config` sentinel branch.
4. **`tests/unit/cli/commands/config.test.ts`** (NEW) — unit tests for all four actions
   (temp dirs, mocked logger, vi.stubEnv for env layer).
5. **`tests/unit/cli/index.test.ts`** (MODIFIED) — add a `config` subcommand sentinel test.
6. **`docs/CLI_REFERENCE.md`** (MODIFIED, Mode A) — `### Configuration Management` subsection +
   Exit-Codes note for `hack config validate`.

**Success Definition**:
- `hack config init` writes a commented `<repoRoot>/.hack` (all 13 SCHEMA_MAP sections as
  commented examples), refuses to clobber without `--force`, appends `.hack.local` to `.gitignore`
  (creating it if absent, deduped), and prints next-step guidance.
- `hack config show` (default) prints every `SCHEMA_MAP` key with its resolved value, masks any
  secret-suffixed key, and runs **without invoking any agent**. `--src` annotates the winning
  layer (global/project/local/env/default). `--output json` emits machine-readable JSON.
- `hack config validate` lints `.hack` + `.hack.local` (or an explicit `<file>`), exits **1** on
  secrets/type/range/parse hard errors and **0** on warnings-only (CI-friendly); never seeds env.
- `hack config path` prints the resolved global / project / local paths actually consulted
  (`--global` / `--local` filter; no flag = all three).
- `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run
  tests/unit/cli/commands/config.test.ts` GREEN; `npm run build` compiles; 100% coverage on the
  new file; S1's symbols (`SCHEMA_MAP`/`SCHEMA_BY_KEY`/`HackConfigSchemaEntry`/`HACK_KEY_TO_ENV`)
  untouched.

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / onboarding developer / CI.
**Use Case**: Onboard config (`init`), diagnose effective config + auth (`show`, safe — no agent),
gate PRs on a clean `.hack` (`validate`), and locate the files consulted (`path`).
**User Journey**: `hack config init` → edit `.hack` → `hack config validate` (CI gate) →
`hack config show --src` (debug why a value resolved the way it did) → `hack config path`
(find where global/local live).
**Pain Points Addressed**: No generator (hand-write TOML from scratch today); no way to see the
EFFECTIVE merged config with source attribution; no CI lint; no way to print the discovery paths.

---

## Why

- **PRD §9.7.8 compliance**: the spec mandates exactly these four actions with these exact flags.
- **Unblocks/closes Task P2.M2.T2**: this IS the entire `hack config` subcommand.
- **Safe diagnostic surface (§9.7.10 acceptance)**: `show` runs without an agent, so a user with
  broken auth can still inspect config — the §9.7.10 "diagnosing auth/config" requirement.
- **Consumes the authoritative primitives**: `SCHEMA_MAP` (S1) drives `show`/`init`; `loadHackConfig`
  + `_sources` (S1/P2.M1) drives the merge; `validateHackTier` (P2.M1.T2.S1) drives `validate`;
  `globalHackPath` drives `path --global`. No duplication of validated logic.
- **Completes the `.hack` feature alongside P2.M2.T3** (gitignore/tracked-warning hardening, which
  builds on this `init`/`validate`).

### Out of scope (hard fences)
- **S1's DATA layer** (`SCHEMA_MAP`/`SCHEMA_BY_KEY`/`HackConfigSchemaEntry`/`HACK_KEY_TO_ENV`) — S1
  owns it; this PRP only IMPORTS it. Do not redefine, move, or edit it.
- **The bodies of `globalHackPath`/`isSecretKey`/`validateHackTier`** — only the `export` keyword
  is added; the function bodies stay byte-identical (they are P2.M1.T2.S1's authoritative code).
- **`loadHackConfig`/`seedProcessEnv`/`mergeTier`/`seedAuthOverrideKey`/`logEffectiveConfigTrace`** —
  stay private; consumed only via `loadHackConfig`.
- **CLI-layer wiring** (reading `MergedHackConfig` for non-env-linked flags in the pipeline path)
  — that's a separate CLI-integration concern, NOT the `config` subcommand.
- **`--repo-root` support inside subcommands** — Commander attaches root-program flags to the root,
  not the subcommand action; sibling subcommands don't support it either. Config resolves repoRoot
  via default upward traversal. (Documented limitation; not in §9.7.8.)
- **P2.M2.T3**: `.hack.local`-tracked-by-git WARNING in `validate`/load, and the §9.7.10 acceptance
  tests for the tracked-secret case — that's the next subtask. (This PRP's `validate` reuses
  `validateHackTier`, which already enforces §9.7.6 secrets; the *tracked-by-git* detection is T3.)
- **Interactive/init wizard** — §9.7.2 non-goal; `init` emits a static commented template.

---

## What

### User-visible behavior
- `hack config init [--force]` → writes `<repoRoot>/.hack` (heavily-commented), ensures
  `.hack.local` ∈ `.gitignore`, prints guidance. Refuses clobber w/o `--force`.
- `hack config show [--src] [-o table|json]` → prints every §9.7.5 key with resolved value
  (secrets masked); `--src` adds the winning layer. No agent invoked.
- `hack config validate [<file>]` → lints `.hack` + `.hack.local` (or `<file>`); stderr warnings
  on unknowns; exit 1 on hard errors, 0 otherwise.
- `hack config path [--global|--local]` → prints the resolved path(s) consulted.

### Technical requirements (exact contract — item 3a–d)

**(a) Registration** — in `src/cli/index.ts`, mirror the `cache` subcommand (lines 540-563):
```ts
program
  .command('config')
  .description('.hack configuration file management')
  .argument('[action]', 'Action: init, show, validate, path', 'show')
  .option('--force', 'Overwrite existing .hack (init only)', false)
  .option('--src', 'Annotate each value with its source layer (show only)', false)
  .option('--global', 'Print global config path (path only)', false)
  .option('--local', 'Print project-local config path (path only)', false)
  .option('-o, --output <format>', 'Output format (table, json)', 'table')
  .action(async (action, options) => {
    try {
      const { repoRoot } = resolveRepositoryRoot(process.cwd()); // chdir hasn't run yet (see gotcha)
      await new ConfigCommand(repoRoot).execute(action, options);
      process.exit(0);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger().error(`Config command failed: ${msg}`);
      process.exit(1);
    }
  });
```
Add to the `parseCLIArgs` return union (line 306): `| { subcommand: 'config'; options: ConfigOptions }`.
Add the sentinel branch after the `cache` branch (line ~791): `if (args[0] === 'config') return { subcommand: 'config', options: { action:'show', force:false, src:false, global:false, local:false, output:'table' } };`
(The sentinel options are type-safety placeholders — the `.action()` already exited.)

**(b) INIT** — write `<repoRoot>/.hack` from a template generated from `SCHEMA_MAP` (grouped by
section, every key as a `# key = <default>` commented example; header + per-section `[section]`
headers; entries without a default → `# key = ...  # (unset)`). Refuse clobber unless `--force`.
Append `.hack.local` to `<repoRoot>/.gitignore` (create if absent; dedup the exact line via
read-then-`appendFileSync`). Print next-step guidance to stdout. Do NOT use `smol-toml.stringify`
(it can't emit comments; the template MUST be commented per §9.7.4).

**(c) SHOW** — (1) snapshot which env-linked env vars are pre-defined: `preEnv = Set(SCHEMA_MAP
envVars ∩ defined process.env)` BEFORE `loadHackConfig`; (2) `merged = loadHackConfig(repoRoot)`;
(3) per `SCHEMA_MAP` entry compute value+source: env-linked & envVar∈preEnv → `'env'` +
`process.env[envVar]`; else if `"section.key"∈merged._sources` → that tier + merged value; else
→ `'default'` + `entry.defaultValue`; (4) mask → `'<redacted>'` if `isSecretKey(key)`; (5) render
table (cli-table3, cols `Key|Value`+`Source` when `--src`) or `--output json`. CLI layer (7) is
structurally N/A to a subcommand — document; SHOW reports global/project/local/env/default only.

**(d) VALIDATE** — files = explicit `<file>` ? `[resolve(file)]` : `[<repoRoot>/.hack,
<repoRoot>/.hack.local]`. Per-file tier inference: basename `.hack.local` → `'project-local'`,
else `'project'`. `_resetValidationWarnings()` first (fresh dedup). Per file in try/catch (continue
across files): `parseHackFile(file)` then `validateHackTier(parsed, file, tier)`. Collect thrown
errors; unknown section/key warnings already go to stderr via `warnOnceValidation`. After all files:
any errors → print each + `process.exit(1)`; else `process.exit(0)`. NEVER call `loadHackConfig`
(no merge, no env seeding — pure lint).

**(PATH)** — paths: global=`globalHackPath()`, project=`join(repoRoot,'.hack')`,
local=`join(repoRoot,'.hack.local')`. `--global` → global only; `--local` → local only; no flag →
all three (labeled). Table or `--output json`.

**DOCS (Mode A, PRD §6.1 — rides with the work)**: `docs/CLI_REFERENCE.md` — add `### Configuration
Management` under `## Commands` documenting all four actions, `--src`/masked-secrets, `--force`
clobber prevention, `--global`/`--local`/`--output`; add an Exit-Codes note that `hack config
validate` exits 1 on secrets/type/range/parse errors and 0 on warnings-only.

### Success Criteria
- [ ] `config` subcommand registered (mirror cache); sentinel `{subcommand:'config'}` returned; default action `'show'`.
- [ ] `init`: writes commented `.hack` (all 13 SCHEMA_MAP sections present as commented examples); clobber refusal w/o `--force`; `.gitignore` append (create+dedup); guidance printed.
- [ ] `show`: every SCHEMA_MAP key printed; secrets masked; `--src` shows winning layer; `--output json` valid; no agent invoked.
- [ ] `validate`: secrets/type/range/parse → exit 1; unknowns → stderr warn + exit 0; explicit `<file>` honored; never seeds env.
- [ ] `path`: correct global/project/local paths; `--global`/`--local` filters; `--output json`.
- [ ] `globalHackPath`/`isSecretKey`/`validateHackTier` exported (bodies byte-identical); S1 symbols untouched.
- [ ] `typecheck && lint && format:check` clean; new tests GREEN; 100% coverage on `config.ts`; `npm run build` compiles.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The exact registration template (cache, src/cli/index.ts:540-563 + sentinel 759-815), the
command-class convention (CacheCommand), the inputs to consume (SCHEMA_MAP shape from S1's research,
loadHackConfig/validateHackTier/globalHackPath/isSecretKey from P2.M1), the repoRoot-at-action-time
gotcha (research §1), the SHOW env-snapshot design (§7), the VALIDATE tier inference (§8), the INIT
template-from-SCHEMA_MAP + .gitignore dedup (§9), and the test pattern (artifacts.test.ts) are all
captured in research §s. Build baseline is green; smol-toml/chalk/cli-table3/commander are all deps.

### Documentation & References
```yaml
# MUST READ — the authoritative subcommand spec
- docfile: PRD.md
  section: "9.7.8 The hack config Subcommand" (h4.26)
  why: The four actions + flags + behaviors (init clobber/--force + .gitignore; show --src/masked/
       no-agent; validate CI exit codes; path --global/--local). THE spec for this PRP.
  critical: show "merges all layers (including env/CLI)" + masked secrets + no-agent; validate
       "CI-friendly (exit code distinguishes errors from warnings)".
- docfile: PRD.md
  section: "9.7.3 Discovery, Layering & File Locations" (h4.21) + "9.7.5 Schema Reference" (h4.23)
  why: §9.7.3 — the three paths `path` prints + global cascade ($HACK_CONFIG_HOME/config →
       $XDG_CONFIG_HOME/hack/config → ~/.hack). §9.7.5 — the 38 rows `show`/`init` render.
- docfile: PRD.md
  section: "9.7.6 Secrets Policy" (h4.24) + "9.7.7 Validation & Error Handling" (h4.25) + "9.7.10" (h4.28)
  why: §9.7.6/§9.7.7 = what `validate` enforces (via validateHackTier); §9.7.10 = the acceptance
       criteria (init/show --src/validate/secret-refusal/masked — several are satisfied HERE).

# MUST READ — the architecture scouting (proven facts)
- docfile: plan/009_94353b1a9fd3/architecture/system_context.md
  section: §2.4 (Subcommand Registration Pattern — the cache template) + §3 (Config System Architecture)
  why: §2.4 is the EXACT template to mirror (cache command + sentinel). §3 documents the schema
       surface + the env-over-file seeding that `show` must respect.
  critical: §2.4 shows cache uses resolve('plan') (INVOCATION_CWD-relative) — config must NOT copy
       that; it must resolveRepositoryRoot(process.cwd()) (research §1).
- docfile: plan/009_94353b1a9fd3/architecture/bootstrap-and-reporoot.md
  section: §8 (Subcommand registration pattern) + §1 (bootstrap ordering)
  why: §8 = the cache/task registration template. §1 = confirms subcommand dispatch is BEFORE chdir.
- docfile: plan/009_94353b1a9fd3/architecture/config-system-and-constants.md
  section: §7 (Dual-Config-Surface Map)
  why: which keys are env-linked vs CLI-only — informs `show` source attribution.

# MUST READ — the parallel task's PRP (S1 — CONTRACT; consume read-only, do not conflict)
- docfile: plan/009_94353b1a9fd3/P2M2T1S1/PRP.md
  section: "Goal / Deliverable / Out of scope"
  why: S1 defines SCHEMA_MAP/SCHEMA_BY_KEY/HackConfigSchemaEntry (the map show/init render) +
       re-authors HACK_KEY_TO_ENV. S1 does NOT touch globalHackPath/isSecretKey/validateHackTier.
  critical: import SCHEMA_MAP/SCHEMA_BY_KEY read-only. Do NOT import the PRIVATE HACK_KEY_TO_ENV.

# MUST READ — the consumed validation layer (P2.M1.T2.S1 — already landed)
- file: src/config/hack-config.ts
  why: validateHackTier/isSecretKey/globalHackPath (to EXPORT), loadHackConfig/parseHackFile (consume),
       MergedHackConfig._sources (show attribution), _resetValidationWarnings (validate fresh dedup).
  pattern: the functions are already authoritative; only ADD `export` to 3 of them (bodies untouched).

# MUST READ — the repoRoot resolver (P1.M1.T1.S1 — already landed)
- file: src/utils/repo-root.ts
  why: resolveRepositoryRoot(process.cwd()) → {repoRoot} — call in the .action() (chdir hasn't run).
  gotcha: getRepoRoot() THROWS pre-bootstrap (singleton unset during subcommand dispatch) — DO NOT use.

# MUST READ — this subtask's research (design + gotchas)
- docfile: plan/009_94353b1a9fd3/P2M2T2S1/research/t2s1-codebase-analysis.md
  section: §1 (chdir-vs-dispatch), §2 (registration/sentinel), §5 (exports needed), §6 (parallel-edit
       conflict), §7 (show source attribution), §8 (validate design), §9 (init design), §10 (tests), §11 (docs)
  why: the binding design + the repoRoot-at-action-time gotcha + the export plan + the SHOW/VALIDATE
       algorithms. Implementation follows this directly.

# THE FILE TO MIRROR (registration + class convention)
- file: src/cli/index.ts
  why: EDIT — register `config` (mirror cache 540-563) + return-union + sentinel branch. The cache
       command + sentinel are the templates.
- file: src/cli/commands/cache.ts
  why: TEMPLATE — ConfigCommand mirrors CacheCommand (class, #repoRoot field, async execute(action,
       options), exported Options interface, chalk+cli-table3, try/catch→process.exit).
- file: tests/unit/cli/commands/artifacts.test.ts
  why: TEMPLATE — vi.hoisted logger mock + vi.mock fs + instantiate Command directly with temp state.
```

### Current Codebase tree (relevant slice)
```bash
src/cli/
  index.ts                 # EDIT — register config subcommand + sentinel + return-union
  commands/
    cache.ts               # READ — class convention template (CacheCommand)
    artifacts.ts           # READ — another class + options convention
    config.ts              # NEW — ConfigCommand + ConfigOptions
src/config/
  hack-config.ts           # EDIT — export globalHackPath/isSecretKey/validateHackTier (keyword only)
  constants.ts             # UNTOUCHED
  environment.ts           # UNTOUCHED
src/utils/
  repo-root.ts             # READ — resolveRepositoryRoot (consume in .action())
tests/unit/cli/
  index.test.ts            # EDIT — add config sentinel test
  commands/
    artifacts.test.ts      # READ — test pattern (vi.hoisted/vi.mock + direct instantiation)
    config.test.ts         # NEW — unit tests for init/show/validate/path
docs/
  CLI_REFERENCE.md         # EDIT (Mode A) — ### Configuration Management + Exit Codes
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/cli/commands/config.ts             # NEW — ConfigCommand(repoRoot).execute(action,options) → init/show/validate/path
src/config/hack-config.ts              # MODIFIED — +export on globalHackPath, isSecretKey, validateHackTier (bodies identical)
src/cli/index.ts                       # MODIFIED — +config subcommand (cache mirror) + return-union + sentinel branch
tests/unit/cli/commands/config.test.ts # NEW — init/show/validate/path unit tests (temp dirs + mocked logger + vi.stubEnv)
tests/unit/cli/index.test.ts           # MODIFIED — +config sentinel parseCLIArgs test
docs/CLI_REFERENCE.md                  # MODIFIED (Mode A) — ### Configuration Management + Exit Codes note
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: subcommand .action() runs BEFORE the bootstrap chdir (src/index.ts main(): parseCLIArgs →
// subcommand early-return → [later] resolveRepositoryRoot+chdir). So process.cwd()===INVOCATION_CWD and
// getRepoRoot() THROWS (singleton unset) during the action. The config .action() MUST call
// resolveRepositoryRoot(process.cwd()) itself. The item's "benefits automatically from chdir" claim is
// INACCURATE — verify by reading src/index.ts:112-119 vs the resolveRepositoryRoot call below it.

// CRITICAL: getRepoRoot() (repo-root.ts) throws 'Repository root not resolved yet' pre-bootstrap.
// Use resolveRepositoryRoot(process.cwd()) → { repoRoot } in the .action(). Sets the singleton (harmless).

// CRITICAL: S1 (P2.M2.T1.S1) edits hack-config.ts IN PARALLEL. Its edits = INSERT SCHEMA_MAP block +
// REPLACE HACK_KEY_TO_ENV literal (three-tier/env-seeding region). THIS task's edits = ADD `export` to
// globalHackPath (a few lines below HACK_KEY_TO_ENV), isSecretKey + validateHackTier (secrets/validation
// region). DISJOINT lines; S1 does NOT touch those 3 functions. One-word additions → clean merge.

// CRITICAL: loadHackConfig MUTATES process.env (seedProcessEnv sets undefined keys from file). So after
// loadHackConfig you CANNOT tell "env set by shell" from "env set by file seeding". SHOW must snapshot
// pre-defined env vars BEFORE calling loadHackConfig (research §7). Skipping the snapshot = wrong source.

// CRITICAL: validateHackTier takes a TIER param (only 'project-local' may hold secrets, §9.7.6).
// VALIDATE must infer tier per file: basename '.hack.local' → 'project-local', else 'project'. Passing
// the wrong tier makes the secrets check wrong (a secret in .hack validated as project-local = no refusal).

// CRITICAL: validateHackTier throws on the FIRST hard error in a file. For CI-friendly multi-file
// reporting, VALIDATE calls it per-file inside try/catch, COLLECTS errors, continues, then exits 1 if
// any. Warnings already stream to stderr via warnOnceValidation (deduped by file:path). Call
// _resetValidationWarnings() first so unknown-key warnings show per file.

// GOTCHA: the INIT template MUST be commented (§9.7.4 "heavily-commented"). smol-toml.stringify CANNOT
// emit comments. Generate commented lines from SCHEMA_MAP (DRY, stays in sync) — do NOT hand-author a
// static string that will drift from SCHEMA_MAP, and do NOT use stringify.

// GOTCHA: .gitignore append must DEDUP (check the exact `.hack.local` line exists before appending).
// fs.appendFileSync without dedup duplicates the line on repeated `init`. Read-then-append.

// GOTCHA: SCHEMA_MAP has NO secret-suffixed keys ([auth] is absent). SHOW masking (isSecretKey) is
// DEFENSIVE — in practice no SCHEMA_MAP value is masked. But DO apply it (future-proofing; §9.7.10).

// GOTCHA: SHOW 'cli' layer (§9.2.1 layer 7) is structurally N/A — `hack config show` is a subcommand
// that doesn't receive pipeline flags. SHOW reliably reports global/project/local/env/default. Document
// (the item's "CLI args if available" = best-effort). Do NOT fake a 'cli' source.

// GOTCHA: the sentinel branch's `options` object in parseCLIArgs is TYPE-SAFETY-ONLY — the .action()
// already ran + process.exit'd. It must be a valid ConfigOptions shape but values are placeholders.

// GOTCHA: vitest enforces 100% coverage. ConfigCommand branches: the action switch (init/show/validate/
// path + unknown→exit1), per-action conditionals (force/global/local/src/output, clobber-exists,
// envPreDefined membership, _sources membership, isSecretKey). EVERY branch needs a test case.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/cli/commands/config.ts
export interface ConfigOptions {
  output: 'table' | 'json';
  force: boolean;    // init only
  src: boolean;      // show only
  global: boolean;   // path only
  local: boolean;    // path only
}

export class ConfigCommand {
  readonly #repoRoot: string;
  constructor(repoRoot: string) { this.#repoRoot = repoRoot; }
  async execute(action: string, options: ConfigOptions): Promise<void> { /* switch → 4 actions */ }
  // private #initAction / #showAction / #validateAction / #pathAction
}
```

The four "layers" SHOW attributes: `'global' | 'project' | 'project-local' | 'env' | 'default'`
(extend `HackConfigTier` only at the SHOW layer — do not modify the exported `HackConfigTier`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config/hack-config.ts — EXPORT 3 functions (bodies byte-identical)
  - ADD the `export` keyword to THREE existing private function declarations:
      `function globalHackPath()`  → `export function globalHackPath()`
      `function isSecretKey(key)`  → `export function isSecretKey(key)`
      `function validateHackTier(parsed, file, tier)` → `export function validateHackTier(...)`
  - DO NOT change any function BODY, signature, JSDoc, or the module-private `_validationWarned`/
    `warnOnceValidation`/`validateFieldValue`/`HACK_CONFIG_SCHEMA`. Those stay private/internal.
  - DO NOT touch S1's region: HACK_KEY_TO_ENV, MergedHackConfig, or where S1 inserts SCHEMA_MAP.
  - ADD a one-line JSDoc note to each newly-exported function: "Exported for the `hack config`
    subcommand (P2.M2.T2.S1)." (Mode-A doc rides with the work.)
  - VERIFY: `git diff src/config/hack-config.ts` shows ONLY three `+export` word-additions + the
    three doc notes; zero body changes.

Task 2: CREATE src/cli/commands/config.ts — ConfigCommand + ConfigOptions
  - IMPORTS: node:fs (existsSync, readFileSync, appendFileSync, writeFileSync), node:path (join),
    chalk, cli-table3, from '../../config/hack-config.js' (loadHackConfig, parseHackFile,
    validateHackTier, globalHackPath, isSecretKey, _resetValidationWarnings, SCHEMA_MAP, type
    MergedHackConfig), from '../../utils/repo-root.js' is NOT needed here (repoRoot passed in),
    from '../../utils/logger.js' (getLogger) for the error arm (mirror CacheCommand).
  - ConfigOptions interface + ConfigCommand class (#repoRoot, async execute(action,options)
    switch: 'init'→#initAction, 'show'→#showAction, 'validate'→#validateAction, 'path'→#pathAction,
    default→console.error 'Unknown action' + valid-actions list + process.exit(1)).
  - #initAction(options): if existsSync(<repoRoot>/.hack) && !options.force → stderr "refusing to
    overwrite… --force" + process.exit(1). Else writeFileSync(<repoRoot>/.hack, buildTemplate()).
    Then ensureGitignoreHasHackLocal(<repoRoot>). Print guidance (where written, .hack.local
    gitignored, `hack config show`/`validate` hints, docs link). buildTemplate() generates from
    SCHEMA_MAP: header comment + per-section `[section]` + `# key = <default>` per entry (no
    default → `# key = ...  # (unset)`); include the §9.7.5 example-flavored comments.
  - #showAction(options): preEnv = new Set(SCHEMA_MAP.filter(e=>e.envVar &&
    process.env[e.envVar]!==undefined).map(e=>e.envVar!)) BEFORE load. merged = loadHackConfig(repoRoot).
    rows = SCHEMA_MAP.map(e => resolveEntry(e, merged, preEnv)). resolveEntry: env-linked & envVar∈preEnv
    → {value: process.env[envVar], source:'env'}; else if `${section}.${key}`∈merged._sources →
    {value: merged[section][key], source: merged._sources[key]}; else → {value: e.defaultValue, source:'default'}.
    Mask: isSecretKey(e.key) → value='<redacted>'. Render: options.output==='json' →
    JSON.stringify(rows.map(...),null,2); else cli-table3 (head: Key|Value [+Source if options.src]).
  - #validateAction(options, fileArg?): files = fileArg ? [resolve(fileArg)] : [join(repoRoot,'.hack'),
    join(repoRoot,'.hack.local')]. _resetValidationWarnings(). errors=[]; for file of files:
    if !existsSync(file) continue; try { const p=parseHackFile(file); validateHackTier(p, file,
    tierFor(file)); } catch(e){ errors.push(`${file}: ${msg(e)}`); }. After loop: if errors.length →
    errors.forEach(e=>console.error(e)); process.exit(1); else process.exit(0). tierFor(file):
    basename(file)==='.hack.local' ? 'project-local' : 'project'.
  - #pathAction(options): g=globalHackPath(); p=join(repoRoot,'.hack'); l=join(repoRoot,'.hack.local').
    sel = options.global ? {global:g} : options.local ? {local:l} : {global:g, project:p, local:l}.
    Render json or labeled table/console lines.
  - FOLLOW pattern: CacheCommand (class shape, try/catch→process.exit, chalk/cli-table3, getLogger).
  - NAMING: ConfigCommand, ConfigOptions; private #initAction/#showAction/#validateAction/#pathAction.

Task 3: MODIFY src/cli/index.ts — register config subcommand + sentinel + return-union
  - ADD import: `import { ConfigCommand, type ConfigOptions } from './commands/config.js';` and
    `import { resolveRepositoryRoot } from '../utils/repo-root.js';` (if not already imported).
  - ADD the `config` subcommand registration AFTER the `cache` block (line ~563), mirroring cache
    exactly (see "Technical requirements (a)" — the .action() calls resolveRepositoryRoot then
    `new ConfigCommand(repoRoot).execute(action, options)`).
  - ADD to the parseCLIArgs return union (line 306): `| { subcommand: 'config'; options: ConfigOptions }`.
  - ADD the sentinel branch after the `cache` branch (line ~798): `if (args[0]==='config') return
    { subcommand:'config', options:{action:'show',force:false,src:false,global:false,local:false,output:'table'} }`.
  - PRESERVE: existing subcommands, the post-parse INVOCATION_CWD-relative --prd resolution (824+),
    all root options. Do NOT change main()'s dispatch (it already returns 0 on any subcommand).

Task 4: CREATE tests/unit/cli/commands/config.test.ts — init/show/validate/path unit tests
  - IMPORTS: vitest (describe/it/expect/beforeEach/afterEach/vi), node:fs/os/path (mkdtempSync/
    writeFileSync/readFileSync/existsSync/rmSync/tmpdir/join), ConfigCommand + ConfigOptions.
  - MOCK getLogger (vi.mock '../../utils/logger.js' → vi.hoisted mockLogger) like artifacts.test.ts.
  - FIXTURE: mkdtempSync a repoRoot per test; afterEach rmSync + restore process.env (vi.unstubAllEnvs).
  - init: (1) writes .hack with all 13 `[section]` headers (assert a sample: [harness]/[models]/
    [pipeline]/[cli]); (2) refuses clobber w/o --force (expect process.exit/throw); (3) --force
    overwrites; (4) creates .gitignore if absent + appends '.hack.local'; (5) dedups (run init twice,
    assert '.hack.local' appears once); (6) guidance printed (spy console.log).
  - show: temp .hack with [harness]name="claude-code" + [cli]log_level="debug"; assert row value=
    'claude-code', source='project'; set PARALLEL_RESEARCH via vi.stubEnv BEFORE execute → source='env';
    assert secret-suffixed key (if present) masked; --output json parses; --src adds Source column.
    (env-over-file: stub env → 'env' wins over file.)
  - validate: (1) valid .hack → no throw/exit-0 path; (2) [auth]zai_api_key in .hack → throws/
    exit-1; (3) [tasks_lock]poll_ms=-5 → throws/exit-1; (4) unknown key → console.warn spy + exit-0;
    (5) explicit <file> path honored; (6) NO process.env mutation (assert a seeded var stays undefined).
  - path: mock HACK_CONFIG_HOME/XDG/homedir via vi.stubEnv → assert global path; --global/--local
    filter; --output json. (Restore env afterEach.)
  - COVERAGE: every ConfigCommand branch (4 actions + unknown; per-action conditionals). 100%.

Task 5: MODIFY tests/unit/cli/index.test.ts — add config sentinel test
  - ADD a describe('parseCLIArgs: config subcommand') block: setArgv(['config','show']) → assert
    parseCLIArgs() returns an object with subcommand==='config' (guard: index.test.ts currently
    throws on subcommand results at line 105-110 — add a dedicated block that EXPECTS the sentinel).
    NOTE: index.test.ts mocks process.exit to throw; the config .action() calls process.exit, so use
    argv that triggers the sentinel-return path OR mock ConfigCommand.execute to no-op + not exit.
    Simplest: vi.mock './commands/config.js' so the .action()'s execute is a stub that returns
    without process.exit, then assert the sentinel is returned. (Mirror how cache/inspect are tested
    if a precedent exists; otherwise the stub approach is clean.)

Task 6: MODIFY docs/CLI_REFERENCE.md (Mode A) — ### Configuration Management + Exit Codes
  - ADD `### Configuration Management` under `## Commands` (after `### Task Management`, ~L172):
    document `hack config init [--force]`, `hack config show [--src] [-o table|json]`,
    `hack config validate [<file>]`, `hack config path [--global|--local]`. Document: --src source
    attribution + masked secrets; --force clobber prevention; --global/--local path filtering;
    validate's CI exit codes (1 = secrets/type/range/parse hard error; 0 = warnings-only).
  - UPDATE `## Exit Codes` (~L289): add a row/note that `hack config validate` exits 1 on
    secret-in-committable-file / type-range-enum / parse errors; 0 when only unknown-section/key
    warnings occurred.

Task 7: VERIFY — typecheck, lint, format, targeted tests, coverage, build, no-conflict
  - RUN `npm run typecheck` → exit 0 (ConfigCommand + the 3 new exports + sentinel typing compile).
  - RUN `npm run lint && npm run format:check` → clean (run `npm run format` if it complains).
  - RUN `npx vitest run tests/unit/cli/commands/config.test.ts` → GREEN; `--coverage` → 100% config.ts.
  - RUN `npx vitest run tests/unit/cli/index.test.ts` → GREEN (sentinel test).
  - RUN `npm run build` → compiles dist.
  - VERIFY git diff src/config/hack-config.ts = THREE `export` word-additions (+doc notes) ONLY;
    S1 symbols (SCHEMA_MAP/SCHEMA_BY_KEY/HACK_KEY_TO_ENV) untouched (whether or not S1 landed yet).
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the .action() resolves repoRoot (chdir hasn't run during subcommand dispatch).
.action(async (action, options) => {
  try {
    const { repoRoot } = resolveRepositoryRoot(process.cwd()); // NOT getRepoRoot() — throws
    await new ConfigCommand(repoRoot).execute(action, options);
    process.exit(0);
  } catch (error) { /* logger().error + process.exit(1) — mirror cache */ }
});

// PATTERN: SHOW source attribution — env snapshot BEFORE loadHackConfig.
const preEnv = new Set(
  SCHEMA_MAP.filter(e => e.envVar && process.env[e.envVar] !== undefined).map(e => e.envVar!)
);
const merged = loadHackConfig(repoRoot); // MUTATES process.env (seeds undefined from file)
for (const e of SCHEMA_MAP) {
  const k = `${e.section}.${e.key}`;
  let value, source;
  if (e.envVar && preEnv.has(e.envVar)) { value = process.env[e.envVar]; source = 'env'; }      // §9.2.1 layer 5/6 wins
  else if (k in merged._sources) { value = merged[e.section]?.[e.key]; source = merged._sources[k]; } // file tier
  else { value = e.defaultValue; source = 'default'; }
  if (isSecretKey(e.key)) value = '<redacted>'; // defensive (no SCHEMA_MAP key is secret)
  // render value/source
}

// PATTERN: VALIDATE — per-file, tier-inferred, no env seeding, collect errors.
_resetValidationWarnings();
const errors: string[] = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  try {
    const parsed = parseHackFile(file);
    validateHackTier(parsed, file, basename(file) === '.hack.local' ? 'project-local' : 'project');
  } catch (e) { errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`); }
}
if (errors.length) { errors.forEach(e => console.error(e)); process.exit(1); }
process.exit(0);

// PATTERN: INIT template from SCHEMA_MAP (commented; stringify can't emit comments).
function buildTemplate(): string {
  const sections = new Map<string, typeof SCHEMA_MAP>();
  for (const e of SCHEMA_MAP) { if (!sections.has(e.section)) sections.set(e.section, []); sections.get(e.section)!.push(e); }
  let out = `# <repoRoot>/.hack — PRP pipeline defaults (PRD §9.7). Generated by \`hack config init\`.\n` +
            `# Safe to commit (NO secrets — §9.7.6). Edit personal overrides in .hack.local (gitignored).\n\n`;
  for (const [section, entries] of sections) {
    out += `[${section}]\n`;
    for (const e of entries) out += `# ${e.key} = ${e.defaultValue === undefined ? '...  # (unset)' : JSON.stringify(e.defaultValue)}\n`;
    out += '\n';
  }
  return out.trimEnd() + '\n';
}

// PATTERN: .gitignore append with dedup.
function ensureGitignoreHasHackLocal(repoRoot: string): void {
  const gi = join(repoRoot, '.gitignore');
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (existing.split('\n').some(l => l.trim() === '.hack.local')) return; // already present
  appendFileSync(gi, (existing && !existing.endsWith('\n') ? '\n' : '') + '.hack.local\n');
}
```

### Integration Points
```yaml
CLI (src/cli/index.ts):
  - register: `config` subcommand (mirror cache) — default action 'show'
  - return-union: + `{ subcommand: 'config'; options: ConfigOptions }`
  - sentinel: + `config` branch after `cache`
CONFIG (src/config/hack-config.ts):
  - export (NEW): globalHackPath, isSecretKey, validateHackTier (keyword-only; bodies identical)
  - consumed (unchanged): loadHackConfig, parseHackFile, SCHEMA_MAP, SCHEMA_BY_KEY, MergedHackConfig, _resetValidationWarnings
NEW FILE (src/cli/commands/config.ts): ConfigCommand + ConfigOptions
TESTS: tests/unit/cli/commands/config.test.ts (NEW) + tests/unit/cli/index.test.ts (sentinel +)
DOCS (Mode A): docs/CLI_REFERENCE.md — ### Configuration Management + Exit Codes note
NO DATABASE / NO NEW ENV VARS / NO NEW DEPS (smol-toml/chalk/cli-table3/commander all present).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck          # exit 0 — ConfigCommand + 3 new exports + sentinel typing compile
npm run lint -- --ext .ts  # eslint
npm run format:check       # prettier; run `npm run format` if it complains
# Expected: Zero errors. typecheck proves the imports (SCHEMA_MAP/validateHackTier/globalHackPath/
# isSecretKey/resolveRepositoryRoot) resolve and the sentinel/return-union typecheck.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/cli/commands/config.test.ts        # GATED (runs under npm run validate)
npx vitest run tests/unit/cli/commands/config.test.ts --coverage  # 100% on src/cli/commands/config.ts
npx vitest run tests/unit/cli/index.test.ts                  # sentinel test GREEN
# Expected: ALL green. init (write/clobber/gitignore-dedup/guidance), show (resolved values/source
# attribution/env-over-file/masking/json), validate (exit-1 on secrets+range+parse / exit-0 on unknowns /
# no-env-seeding / explicit-file), path (global/project/local + filters + json).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run build              # compiles dist — confirms no transitive breakage

# Manual smoke (from repo root, real .hack absent first):
npm run dev -- config init          # writes .hack + .gitignore line + guidance
npm run dev -- config path          # prints global/project/local paths
npm run dev -- config validate      # exit 0 on a clean generated .hack
npm run dev -- config show          # prints every SCHEMA_MAP key with defaults
npm run dev -- config show --src    # + Source column (all 'default' for a fresh .hack)
npm run dev -- config show -o json  # valid JSON
# From a SUBDIR (proves repoRoot resolution):
cd src && npm run dev -- config path  # project path still <repoRoot>/.hack (NOT src/.hack)

# Conflict check vs S1 (parallel):
git diff src/config/hack-config.ts | grep -E "^[+-]" | grep -v "^[+-][+-]"  # EXPECT: only +export additions
# Expected: build succeeds; all four actions work; subdir invocation resolves repoRoot; S1 symbols intact.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# CI-friendliness: validate exit code distinguishes errors from warnings.
echo '[tasks_lock]
poll_ms = -5' > /tmp/bad.hack
npm run dev -- config validate /tmp/bad.hack; echo "exit=$?"  # EXPECT: exit=1 (range hard error)

echo '[unknownsection]
foo = 1' > /tmp/unknown.hack
npm run dev -- config validate /tmp/unknown.hack; echo "exit=$?"  # EXPECT: stderr warn + exit=0

# Secret masking: a .hack.local secret never appears in show stdout (SCHEMA_MAP has no secret keys,
# but assert no [auth] leaks and the mask path is covered by the isSecretKey unit test).
# Expected: validate is CI-correct (1 on errors, 0 on warnings); show never echoes a raw secret.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/cli/commands/config.test.ts` green; 100% coverage on `config.ts`.
- [ ] `npx vitest run tests/unit/cli/index.test.ts` green (sentinel test).
- [ ] `npm run build` succeeds.

### Feature Validation
- [ ] `init` writes a commented `.hack` (all 13 SCHEMA_MAP sections); refuses clobber w/o `--force`; appends+dedups `.hack.local` to `.gitignore`; prints guidance.
- [ ] `show` prints every SCHEMA_MAP key; secrets masked; `--src` shows winning layer; `--output json` valid; no agent invoked.
- [ ] `validate` exits 1 on secrets/type/range/parse; exits 0 on warnings-only; honors explicit `<file>`; never seeds env.
- [ ] `path` prints correct global/project/local paths; `--global`/`--local` filter; `--output json`.
- [ ] Subdir invocation resolves repoRoot correctly (`config path` from `src/` prints repo-root `.hack`).

### Code Quality Validation
- [ ] S1 symbols (`SCHEMA_MAP`/`SCHEMA_BY_KEY`/`HackConfigSchemaEntry`/`HACK_KEY_TO_ENV`) untouched.
- [ ] `hack-config.ts` diff = three `export` additions (+doc notes) ONLY; function bodies byte-identical.
- [ ] ConfigCommand follows CacheCommand convention (class, options interface, try/catch→exit, chalk/cli-table3).
- [ ] Mode-A JSDoc on ConfigCommand/ConfigOptions + the 3 newly-exported functions + CLI_REFERENCE.md subsection.

### Documentation & Deployment
- [ ] `docs/CLI_REFERENCE.md` `### Configuration Management` + Exit-Codes note (Mode A, rides with the work).
- [ ] No new env vars / deps / routes (pure CLI subcommand consuming existing config primitives).

---

## Anti-Patterns to Avoid

- ❌ Don't use `getRepoRoot()` or `resolve('.hack')` in the config `.action()` — the bootstrap chdir
   runs AFTER subcommand dispatch; use `resolveRepositoryRoot(process.cwd())` (research §1).
- ❌ Don't duplicate `validateHackTier`/`globalHackPath`/`isSecretKey` in config.ts — EXPORT + reuse
   them (the authoritative implementations; duplicating risks drift from the loader's own rules).
- ❌ Don't call `loadHackConfig` in `validate` (it seeds process.env + merges — validate is a pure
   lint). Use `parseHackFile` + `validateHackTier` per file.
- ❌ Don't skip the env snapshot in `show` — `loadHackConfig` mutates process.env, so post-call you
   can't attribute 'env' vs file-tier correctly (research §7).
- ❌ Don't pass the wrong `tier` to `validateHackTier` in validate — secrets policy is tier-dependent
   (only 'project-local' may hold secrets). Infer from basename.
- ❌ Don't use `smol-toml.stringify` for the INIT template — it can't emit comments; the template
   MUST be commented (§9.7.4). Generate commented lines from `SCHEMA_MAP`.
- ❌ Don't append `.hack.local` to `.gitignore` without dedup — repeated `init` duplicates the line.
- ❌ Don't touch S1's region of `hack-config.ts` (`SCHEMA_MAP`/`HACK_KEY_TO_ENV`) — disjoint edits only.
- ❌ Don't fake a 'cli' source layer in `show` — pipeline flags aren't passed to the subcommand;
   report global/project/local/env/default and document the limitation.
- ❌ Don't import the PRIVATE `HACK_KEY_TO_ENV` — S1 keeps it private; use `SCHEMA_MAP`/`SCHEMA_BY_KEY`.

---

## Confidence Score

**8.5/10** — One-pass success likelihood is high. The registration template (cache), the class
convention (CacheCommand), the consumed primitives (SCHEMA_MAP from S1; loadHackConfig/
validateHackTier/globalHackPath/isSecretKey from P2.M1), and the test pattern (artifacts.test.ts)
are all proven in the codebase and captured precisely in research. The two residual risks: (1) the
**repoRoot-at-action-time gotcha** — the item's claim is inaccurate, but research §1 documents the
correct `resolveRepositoryRoot(process.cwd())` approach and the PRP calls it out in three places
(goal, gotchas, task 3), so the implementer won't fall into the `getRepoRoot()`-throws trap; (2)
the **parallel edit to `hack-config.ts`** with S1 — mitigated by disjoint regions (S1 edits the
three-tier/env-seeding region; this adds `export` to 3 functions in other regions) and S1's PRP
explicitly not touching those functions. The SHOW source-attribution algorithm is the most intricate
part but is fully specified (env snapshot + tier/default fallback). All four actions are
well-specified by PRD §9.7.8 + §9.7.10 acceptance criteria, and validate reuses the authoritative
validator rather than reimplementing it.