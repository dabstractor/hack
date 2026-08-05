# Scout Findings: `.hack` Config-Source Documentation Sync

Scout run for the CONFIGURATION.md sync task. All findings are file:line exact,
implementation-verified against the live source. No source code was modified
(this is recon only).

---

# Code Context

## Files Retrieved
1. `docs/CONFIGURATION.md` (full file, 706 lines) — the doc to edit; heading outline + table styles + stale-framing hunt
2. `src/utils/repo-root.ts` (full file) — `resolveRepositoryRoot` API + `NotARepositoryError`
3. `src/config/hack-config.ts` (full file) — `parseHackFile` / `loadHackConfig` / secrets / validation / `SCHEMA_MAP`
4. `src/config/constants.ts` (full file) — `PRP_COMMIT_FORMAT` + `getPrpCommitFormat`
5. `src/index.ts` (lines 130-175) — bootstrap ordering (INVOCATION_CWD → resolveRepositoryRoot → chdir → loadHackConfig → configureEnvironment)
6. `src/cli/commands/config.ts` (lines 120-200) — `hack config` subcommand (init/show/validate/path)
7. `package.json` (line 82) — smol-toml dependency
8. `PRD.md` (lines 297-316) — breakdown-in-progress state requirement + exit code 0

---

## PART A — CURRENT `docs/CONFIGURATION.md` STRUCTURE

### A.1 Full Heading Outline (all headings + line numbers)

```
L1   # Configuration Reference
L9   ## Table of Contents
L39  ## Quick Reference
L55  ## Environment Variables
L57    ### API Authentication
L95    ### Model Selection
L113   ### Agent Runtime (Harness)
L141   ### Pipeline Control
L151   ### Resilience Tuning
L167   ### Distributed PRDs
L178   ### Concurrency & Monitoring
L188   ### Bug Hunt Configuration
L197   ### Validation Control
L206   ### Advanced Configuration
L219   ### tasks.json Lock Tunables
L233 ## CLI Options
L237   ### Required Options
L243   ### Execution Mode
L265   ### Boolean Flags
L278   ### Limit Options
L285   ### Delta Response
L295   ### Adopt Mode (`--adopt-prd`)
L305 ## Models, Roles & Reasoning Budget
L315   ### Model Tiers
L332   ### When to Use Each Tier
L351   ### Model Roles
L370   ### Model Override
L384   ### Deprecation (legacy `ANTHROPIC_*` aliases)
L405 ## Configuration Priority
L414   ### Example: Priority in Action
L428   ### Special Case: Provider-Aware Resolution
L438 ## Security
L440   ### API Key Security
L458   ### API Endpoint Security
L475 ## Example Configuration
L573 ## Common Gotchas
L575   ### "API key not working"
L598   ### "Tests fail with wrong API endpoint"
L615   ### "Scope format rejected"
L637   ### "Model selection affecting cost"
L652   ### "Harness appearing in the model string is invalid"
L674   ### "Using claude-code with a z.ai key"
L698 ## See Also
```

### A.2 Recommended insertion point for `.hack Configuration File` section

**To make `.hack` PRIMARY (ahead of env vars/CLI), insert a new `## .hack Configuration File`
section between `## Quick Reference` (ends L53) and `## Environment Variables` (L55).**
This places it as the first configuration mechanism in the doc narrative.

Two edits required:
1. **New section** after L53 (before the `## Environment Variables` heading at L55).
   Content: intro that `.hack` is the PRIMARY config mechanism; the §9.7.5 schema summary
   table (or summary + link); env-over-file rule; secrets policy; 3-tier discovery;
   cross-reference to §9.2.1 precedence.
2. **Quick Reference** (L39-53): add a one-line pointer that `.hack` is the recommended
   primary config source, ahead of env vars.
3. **Table of Contents** (L9-37): add the new `.hack Configuration File` entry near the top
   (right after Quick Reference) and any new "Task & Status Commands" entry.

> The `## Configuration Priority` section (L405) is where the §9.2.1 7-layer model is
> expanded — see A.3.

### A.3 Does the doc have an env-var table? A CLI-flag table?

**YES — both.** These are the table styles to mirror for the new `.hack` schema table.

**Env-var table** — appears in every `### ...` subsection under `## Environment Variables`
(L55-231). Pipe-table format, columns: `Variable | Required | Default | Description`.
Verbatim representative example (Quick Reference table, L43-53):

```
| Variable            | Required | Default                          | Description                                                                              |
| ------------------- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `ZAI_API_KEY`       | Yes\*    | None                             | z.ai API key (the default-path credential).                                              |
| `PRP_API_BASE_URL`  | No       | `https://api.z.ai/api/anthropic` | z.ai API endpoint (default for `zai` provider only). Legacy alias: `ANTHROPIC_BASE_URL`. |
| `PRP_AGENT_HARNESS` | No       | `pi`                             | Agent runtime/SDK (`pi` or `claude-code`); orthogonal to the LLM provider                |
```

**CLI-flag table** — in subsections under `## CLI Options` (L233-303). Pipe-table format,
columns vary: `Option | Type | Default | Description` or `Option | Type | Choices | Default | Description`.
Verbatim representative example (Required Options, L238-241):

```
| Option         | Type   | Default    | Description               |
| -------------- | ------ | ---------- | ------------------------- |
| `--prd <path>` | string | `./PRD.md` | Path to PRD markdown file |
```

**Recommended `.hack` schema table style** — mirror the env-var table, with columns like
`Section | Key | Type | Default | Env Var | CLI Flag | Description` (or split per-section
like the env-var tables). The authoritative source for every row is `SCHEMA_MAP` in
`src/config/hack-config.ts` (lines 155-380) — the §9.7.5 reference is already a data
structure with `section`/`key`/`envVar`/`cliFlag`/`type`/`defaultValue`/`acceptedValues`.

### A.4 `.env` / dotenv / precedence / layering mentions — the §9.2.1 content to expand

**`## Configuration Priority` (L405-436)** — this is the STALE 4-layer model that must be
expanded to the §9.2.1 7-layer precedence. Verbatim (L407-411):

```
Configuration is loaded from multiple sources in the following priority order (highest to lowest):

1. **Shell Environment** - Environment variables set in your shell or parent process
2. **`.env` File** - Local project configuration file
3. **Runtime Overrides** - Explicit environment variable settings in code
4. **Default Values** - Hardcoded defaults in TypeScript code
```

This 4-layer list does NOT mention `.hack` at all. The task is to expand this to the
§9.2.1 7-layer precedence model (which interposes the `.hack` tiers: global → project →
project-local between shell-env and .env, per the env-over-file rule).

Other `.env` / dotenv references:
- L181: `.env.example` "CONCURRENCY CONFIGURATION" grouping
- L410: `2. **`.env` File** - Local project configuration file` (the priority list)
- L442: `**CRITICAL**: Never commit your `.env` file to version control.`
- L444: `.env` file contains sensitive authentication credentials`
- L448: `.env` (in .gitignore code block)
- L453-454: `.env.example` template + keep `.env` local
- L477: `Create a `.env` file in your project root:`
- L703: `[.env.example](../.env.example)` in See Also

> Note: the `.env` Security section (L440-456) should cross-reference the new `.hack`
> secrets policy (committable `.hack` refuses secrets; `.hack.local` is the gitignored
> secrets tier) since `.hack.local` is the file-based analog of `.env` for non-secret
> pipeline tunables + the only `.hack` tier that may hold secrets.

### A.5 STALE framing hunt (grep results)

**All of these returned NO MATCHES in `docs/CONFIGURATION.md`:**
- `must run from` — no matches
- `run from the root` — no matches
- `cwd` — no matches
- `.hack` — **no matches** (the `.hack` concept is entirely ABSENT, not stale)
- `TOML` — no matches
- `config file` — no matches

**Conclusion:** There is no stale `.hack`/TOML/cwd framing to correct. The doc simply does
not mention `.hack` at all. The entire `.hack` system is undocumented — this is a pure
additive task (new section + precedence expansion), not a rewrite of stale text.

The only thing that could be considered "stale" is the **4-layer Configuration Priority
list (L407-411)** which is now incomplete (omits `.hack` tiers) but was never wrong for
the world it described.

### A.6 Does CONFIGURATION.md document `PRP_COMMIT_FORMAT` / commit format / §5.1?

**YES — `PRP_COMMIT_FORMAT` is already documented.** Line 165 (in the `### Resilience Tuning`
env-var table, L151-165):

```
| `PRP_COMMIT_FORMAT` | No | `task-prefix` | Commit-message format mode. `task-prefix` (DEFAULT) layers the `<phase>.<milestone>.<task>.<subtask>:` position prefix; `plain` opts out (no prefix). Any other value (including empty) falls back to `task-prefix`. See PRD §5.1. |
```

Also, §5.1 is referenced on:
- L161 `COMMIT_RETRY_MAX ... See PRD §5.1.`
- L162 `COMMIT_RETRY_DELAY ... See PRD §5.1.`
- L163 `COMMIT_RETRY_DELAY_CAP ... See PRD §5.1.`
- L165 `PRP_COMMIT_FORMAT ... See PRD §5.1.`
- L221 `tasks.json.lock` tunables header references PRD §5.1

**What the task wants added/reconciled:** Note that `PRP_COMMIT_FORMAT` is **already live**
in `constants.ts` (`PRP_COMMIT_FORMAT` constant + `getPrpCommitFormat()` getter — confirmed
in B.3 below) AND is accessible via the `.hack` file as `[pipeline] commit_format` (the
`SCHEMA_MAP` mapping in `hack-config.ts` L245-252). The env-var-table row at L165 should
cross-reference the `.hack` `[pipeline] commit_format` key so users know both surfaces exist.

### A.7 Task/Status section + breakdown-in-progress exit code

**There is NO "task/status section" in `docs/CONFIGURATION.md`.** Grep for `breakdown`,
`exit code`, `exit-code`, `TaskStatus`, `Status`, `hack status`, `hack task` returned no
task/status section (the only `exit code` mention is L677, about claude-code startup
failure → exit 1).

**This means the "task/status section" must be ADDED (new section).** The content is the
PRD §299-310 breakdown-in-progress state:
- `hack status` / `hack task` / `hack task next` against a session whose directory exists
  but whose `tasks.json` is absent → **calm notice, exit code 0** (not an error).
- `hack status --output json` → `{ "status": "awaiting_breakdown", "session": "NNN_hash" }`, exit 0.
- `hack status --file /nonexistent` → still a hard error (explicit override not softened).
- `hack status` with NO sessions at all → still non-zero "No sessions found".

**Recommended placement:** a new `## Task & Status Commands` section, likely after
`## CLI Options` (L233-303) or near the end before `## See Also` (L698). This is a new
section; it documents `hack status` / `hack task` exit codes, which are currently entirely
absent from CONFIGURATION.md.

### A.8 Doc table + prose style — representative verbatim examples to mirror

**Table style 1 (env-var table, 4-col):** see A.3 Quick Reference table (L43-53).
Columns: `Variable | Required | Default | Description`. Backtick-wrapped values,
defaults in backticks, `\*` for conditional-required footnotes.

**Table style 2 (CLI table, 4-col):** see A.3 Required Options (L238-241).
Columns: `Option | Type | Default | Description`.

**Prose style — numbered precedence list with bold lead-ins** (L407-411, to mirror when
rewriting the 7-layer model):
```
1. **Shell Environment** - Environment variables set in your shell or parent process
2. **`.env` File** - Local project configuration file
```

**Prose style — bold-prefixed resolution-order list** (L78-82, to mirror for tier discovery):
```
1. **Explicit override** — `PRP_API_KEY` env var (or `options.override`)
2. **Provider-native env var** — `ZAI_API_KEY` for `zai`; ...
3. **`~/.pi/agent/auth.json`** — auto-detected by pi's file-backed AuthStorage
```

---

## PART B — IMPLEMENTATION SOURCE (accurate signatures/behaviors)

### B.1 `src/utils/repo-root.ts` — full `resolveRepositoryRoot` API

**Exported API:**

```typescript
// Signature (src/utils/repo-root.ts L152-156)
export function resolveRepositoryRoot(
  startDir: string,
  opts?: ResolveRepoOpts
): { repoRoot: string; invocationCwd: string }
```

- **`ResolveRepoOpts`** (L41-45): `{ explicit?: string }` — forward-compat for the
  `--repo-root` CLI flag.
- **`NotARepositoryError extends Error`** (L52-90):
  - `readonly searchedFrom: string` — directory the search started from (or explicit path).
  - `readonly explicit: boolean` — whether it came from `opts.explicit`.
  - Constructor sets `this.name = 'NotARepositoryError'` and bakes the `--repo-root`
    remediation into the message.
- **Default traversal (`traverseUp`, L191-205):** from resolved-absolute `startDir`,
  at each dir test `existsSync(join(dir, '.git'))`. `existsSync` is true for `.git` as a
  **directory** (normal clone) AND as a **file** (worktree/submodule `gitdir:` pointer — §9.8.4).
  **Nearest ancestor wins** (inner repo inside outer → inner). If filesystem root reached
  without `.git` → throw `NotARepositoryError`.
- **Explicit (`resolveExplicit`, L213-219):** resolve to absolute, verify `.git` present
  (dir-or-file); throw `NotARepositoryError({ explicit: true })` if absent.
- **`realpathSync`** (L161): canonicalizes the found root (symlinks resolved).
- **Module singletons:** `getRepoRoot()` (L171) + `getInvocationCwd()` (L184) — throw
  if accessed before `resolveRepositoryRoot` has run.

**Bootstrap wiring in `src/index.ts` (`main()`):**
- **L64:** `const INVOCATION_CWD = process.cwd();` — capture the true invocation cwd
  before any chdir.
- **L142-146:** 
  ```typescript
  const { repoRoot } = resolveRepositoryRoot(
    INVOCATION_CWD,
    args.repoRoot ? { explicit: args.repoRoot } : undefined
  );
  process.chdir(repoRoot);
  ```
- **Bootstrap ordering (L135-168):**
  `parseCLIArgs()` → `resolveRepositoryRoot(INVOCATION_CWD, …)` → `process.chdir(repoRoot)`
  → PRD-exists check → `loadHackConfig(repoRoot)` (L165) → `configureEnvironment()` (L168).
- **Ordering rationale (L160-163):** `.hack` load AFTER the §9.8 chdir (project files live
  at `repoRoot`) and BEFORE `configureEnvironment()` (so seeded values are visible to the
  env resolver). Env-over-file: seeding fills ONLY undefined env keys.

### B.2 `src/config/hack-config.ts` — full `.hack` API

**Exported functions:**
- **`parseHackFile(filePath: string): ParsedHackConfig`** (L80) — parse a single `.hack`/
  `.hack.local` TOML file. Reads raw bytes, REJECTS BOM (`0xEF 0xBB 0xBF`), rethrows
  `TomlError` as `Error` naming file + line/column (original on `error.cause`). ENOENT
  propagates.
- **`loadHackConfig(repoRoot: string): MergedHackConfig`** (L799) — the main entry: 3-tier
  discovery + merge + env-seed + auth-seed + debug-trace.
- **`globalHackPath(): string`** (L506) — cascade: `$HACK_CONFIG_HOME/config` →
  `$XDG_CONFIG_HOME/hack/config` → `~/.hack`.
- **`validateHackTier(parsed, file, tier): void`** (L753) — per-tier secrets + type/range/enum.
- **`isSecretKey(key: string): boolean`** (L666) — suffix rule.
- **`_resetValidationWarnings(): void`** (L657) — test-only hook.
- **Exports:** `SCHEMA_MAP` (L155), `SCHEMA_BY_KEY` (L490), `HACK_CONFIG_SCHEMA` (private),
  types `ParsedHackConfig`/`MergedHackConfig`/`HackConfigTier`/`HackConfigSchemaEntry`/
  `HackConfigFieldSpec`.

**Three-tier discovery** (`loadHackConfig`, L799-820), lowest → highest:
1. **global:** `globalHackPath()` → `$HACK_CONFIG_HOME/config` | `$XDG_CONFIG_HOME/hack/config` | `~/.hack`
2. **project:** `<repoRoot>/.hack` (committable)
3. **project-local:** `<repoRoot>/.hack.local` (gitignored)

Missing file at any tier is NOT an error (that tier contributes nothing).

**Env-over-file seeding** (`seedProcessEnv`, L549-561):
- For each `[section].key` mapped to an env var (per `HACK_KEY_TO_ENV`, derived from `SCHEMA_MAP`),
  set `process.env[ENV]` ONLY if `process.env[ENV] === undefined` (NOT also-empty).
- **Real env — even empty — wins over file.** Coerces via `String()`.
- CLI-only keys (no `envVar`) are NOT seeded (stored in `MergedHackConfig` only).

**Auth override seeding** (`seedAuthOverrideKey`, L606-617):
- `.hack.local` `[auth] override_key` → `process.env.PRP_API_KEY` (ONLY when undefined +
  non-empty). `.hack.local` is the ONLY tier permitted to hold secrets.

**Secrets policy** (`validateHackTier` + `isSecretKey`, L666-693):
- `isSecretKey`: key NAME ends with `_key` / `_token` / `_secret` / `_password`.
- Non-empty secret in a **committable tier** (global/project) → **HARD ERROR** (§9.7.6):
  ```
  Secret-bearing key [section] key is not permitted in the committable file <file>
  (PRD §9.7.6). Move it to .hack.local (gitignored) or an environment variable, then retry.
  ```
- Empty/whitespace secret → "not configured" (§9.2.7), skipped.
- Secret in `project-local` (`.hack.local`) → **allowed**, skips type validation, never echoed.

**Validation** (`validateHackTier`, L753-789 + `validateFieldValue`):
- **Unknown section** → WARN once to stderr (sync `console.warn`), ignored.
- **Unknown key** in a known section → WARN once, ignored.
- **Type/range/enum mismatch** → **HARD ERROR** (exit 1) naming file + section + key + value + expected.
- `HACK_CONFIG_SCHEMA` (L441-482) is the validation authority (type/min/max/enum).
- `SCHEMA_MAP` (L155-380) is the seeding/show authority (dual-surface map). Both coexist by design.

**The §9.7.5 schema reference** (`SCHEMA_MAP`, L155-380) — exhaustive array of
`HackConfigSchemaEntry` rows. Each has `section`/`key`/`envVar?`/`cliFlag?`/`type`/
`defaultValue?`/`acceptedValues?`. **This is the data source for the doc's schema table.**

**`ParsedHackConfig` type** (L66-69):
```typescript
export interface ParsedHackConfig {
  [section: string]: { [key: string]: HackConfigValue };
}
// HackConfigValue = string | number | boolean
```

**`MergedHackConfig` type** (L106-109):
```typescript
export interface MergedHackConfig extends ParsedHackConfig {
  _sources: Record<string, HackConfigTier>;
}
```

**`hack config` subcommand** (`src/cli/commands/config.ts` + `src/cli/index.ts` L567-571):
- `hack config init [--force]` — write commented `<repoRoot>/.hack` template, refuse
  clobber without `--force`, ensure `.hack.local` in `.gitignore`.
- `hack config show [--src] [-o table|json]` — print effective merged config (every `SCHEMA_MAP` row).
- `hack config validate [<file>]` — lint `.hack` + `.hack.local` (CI gate; exit code
  distinguishes errors from warnings).
- `hack config path [--global|--local]` — print discovery paths.

### B.3 `src/config/constants.ts` — `PRP_COMMIT_FORMAT` confirmed LIVE

- **Constant:** `export const PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT';` (constants.ts L439)
- **Default:** `export const DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const;` (L449)
- **Type:** `export type PrpCommitFormat = 'task-prefix' | 'plain';` (L459)
- **Getter:** `export function getPrpCommitFormat(): PrpCommitFormat` (L482) — returns
  `'plain'` only when trimmed value is exactly `'plain'`; otherwise `DEFAULT_PRP_COMMIT_FORMAT`
  (`'task-prefix'`). This is the SINGLE read site (no other code reads
  `process.env[PRP_COMMIT_FORMAT]` directly).
- **`.hack` mapping:** `[pipeline] commit_format` (hack-config.ts `SCHEMA_MAP` L245-252):
  ```typescript
  { section: 'pipeline', key: 'commit_format', envVar: 'PRP_COMMIT_FORMAT',
    type: 'string', defaultValue: 'task-prefix', acceptedValues: ['task-prefix', 'plain'] }
  ```

### B.4 smol-toml dependency confirmed

**`package.json` line 82:**
```json
"smol-toml": "^1.6.1",
```
Listed under `dependencies`. Imported in `src/config/hack-config.ts` line 9:
`import { parse, TomlError } from 'smol-toml';`. TOML 1.0 parser.

---

## Architecture

### Configuration loading flow (the bootstrap ordering to document)

```
parseCLIArgs()                                   (Commander; --help/--version short-circuit here)
  ↓
const INVOCATION_CWD = process.cwd()             (index.ts L64 — capture before chdir)
  ↓
resolveRepositoryRoot(INVOCATION_CWD, {explicit?})  (index.ts L142 — §9.8 upward .git walk)
  ↓
process.chdir(repoRoot)                          (index.ts L146 — single bootstrap chdir)
  ↓
[PRD-exists check against now-correct cwd]       (index.ts L148-155)
  ↓
loadHackConfig(repoRoot)                         (index.ts L165 — §9.7 3-tier .hack load + env-seed)
  │  global (~/.hack | XDG) → project (.hack) → project-local (.hack.local)
  │  secrets refusal (committable tiers) → type/range validation → merge → seedProcessEnv
  ↓
configureEnvironment()                           (index.ts L168 — reads seeded + shell env)
```

### The 7-layer §9.2.1 precedence (to replace the 4-layer list at L407-411)

The current doc's `## Configuration Priority` (L405-411) lists only 4 layers. The
`.hack` system adds 3 tiers. The expanded precedence (highest → lowest) per §9.2.1 +
the env-over-file implementation:

1. **Shell environment** (real exported env vars — even empty — win over file)
2. **`.env` file** (loaded into env by the shell/harness before the process)
3. **`.hack.local`** (`<repoRoot>/.hack.local` — gitignored; highest `.hack` tier; secrets allowed)
4. **`.hack`** (`<repoRoot>/.hack` — committable; no secrets)
5. **Global `.hack`** (`~/.hack` | `$XDG_CONFIG_HOME/hack/config` | `$HACK_CONFIG_HOME/config`)
6. **CLI flags** (Commander; read THROUGH env via `.default(process.env.X ?? …)`)
7. **Default values** (hardcoded in `constants.ts`)

> **Env-over-file rule (§9.2.1):** `.hack` tiers seed `process.env` ONLY when the key is
> `undefined`. A real env var (shell or `.env`) — even an empty one — is already "set" and
> therefore wins over the file value. The `.hack` tiers do NOT override real env; they fill
> gaps. (Implementation: `seedProcessEnv` at hack-config.ts L549-561, `=== undefined` check.)

### Secrets tiering (to cross-reference the Security section L438-456)

| Tier | File | Committable? | Secrets? |
|------|------|--------------|----------|
| Global | `~/.hack` / XDG / `$HACK_CONFIG_HOME` | n/a (user) | **Refused** |
| Project | `<repoRoot>/.hack` | ✅ Yes | **Refused** (hard error) |
| Project-local | `<repoRoot>/.hack.local` | ❌ gitignored | ✅ Allowed (only secrets tier) |

---

## Start Here

**Open `docs/CONFIGURATION.md` first.** The two highest-value edits are:
1. **New `## .hack Configuration File` section** inserted between L53 and L55 (after
   `## Quick Reference`, before `## Environment Variables`) — makes `.hack` the PRIMARY
   mechanism. Mirror the env-var table style (A.3); the authoritative row data is
   `SCHEMA_MAP` in `src/config/hack-config.ts` L155-380.
2. **Rewrite `## Configuration Priority` (L405-411)** from the 4-layer list to the 7-layer
   §9.2.1 model (see Architecture above). Add the env-over-file rule + secrets tiering.

Then: add the breakdown-in-progress exit-code content as a new `## Task & Status Commands`
section (no such section exists today — A.7), and reconcile `PRP_COMMIT_FORMAT` (L165) to
cross-reference the `.hack` `[pipeline] commit_format` key (B.3).

---

## Supervisor coordination

No blocking decisions required. All findings are recon-only and complete. The task is a
documentation additive (new `.hack` section + 7-layer precedence expansion + new
task/status exit-code section) — no source-code ambiguity surfaced. The runtime output
path was written directly.

---

## Residual Risks / Open Notes for the Implementing Agent

1. **TOC update (L9-37):** the Table of Contents must be updated for every new/renamed
   section, or the doc's internal anchors break. Don't forget this mechanical step.
2. **Schema table size:** `SCHEMA_MAP` has ~40 rows across 13 sections. Consider mirroring
   the env-var doc's per-section table style (one `### [section]` table each) rather than
   one giant table, for readability and to match the existing doc convention.
3. **The `.env` Security section (L440-456)** should add a one-line cross-reference to the
   `.hack` secrets policy so users know `.hack.local` is the file-based secrets tier
   (analogous to `.env`).
4. **`Quick Reference` (L39-53)** frames `.env` as primary ("Create a `.env` file"). To
   make `.hack` truly primary in the narrative, add a pointer to the new `.hack` section
   at the top of Quick Reference.
5. **breakdown-in-progress (A.7):** this content lives in PRD §297-316, not in any existing
   CONFIGURATION.md section. The "task/status section" named in the task does not exist —
   it must be created. Confirm with the PRD whether `hack status` / `hack task` CLI docs
   belong in CONFIGURATION.md or a separate CLI_REFERENCE doc (the doc already cross-links
   `./CLI_REFERENCE.md` at L289/L303).
```
acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned concrete file:line findings for all 6 Part-A items (full heading outline with line numbers, env-var + CLI-flag table styles verbatim, the 4-layer Configuration Priority list at L407-411 to expand to 7-layer §9.2.1, stale-framing grep showing zero .hack/TOML/cwd matches, PRP_COMMIT_FORMAT confirmed at L165) and all 4 Part-B items (resolveRepositoryRoot signature + bootstrap ordering index.ts L64/L142-146/L165/L168, hack-config.ts full API parseHackFile/loadHackConfig/3-tier/secrets/validation/SCHEMA_MAP, constants.ts PRP_COMMIT_FORMAT+getPrpCommitFormat, package.json L82 smol-toml ^1.6.1)."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep -nE '^#{1,4} ' docs/CONFIGURATION.md",
      "result": "passed",
      "summary": "Extracted full heading outline with exact line numbers (28 headings mapped)"
    },
    {
      "command": "grep 'smol-toml' package.json",
      "result": "passed",
      "summary": "Confirmed smol-toml ^1.6.1 at package.json L82"
    },
    {
      "command": "grep 'must run from|run from the root|cwd|.hack|TOML|config file' docs/CONFIGURATION.md",
      "result": "passed",
      "summary": "Zero matches — no stale .hack/TOML/cwd framing; .hack is entirely absent (additive task)"
    },
    {
      "command": "grep 'PRP_COMMIT_FORMAT|commit_format|§5.1' docs/CONFIGURATION.md",
      "result": "passed",
      "summary": "PRP_COMMIT_FORMAT already documented at L165; §5.1 referenced at L161-165/L221"
    },
    {
      "command": "grep 'breakdown|exit code|TaskStatus|Status' docs/CONFIGURATION.md",
      "result": "passed",
      "summary": "No task/status section exists; only exit-code mention is L677 (claude-code startup). Section must be created."
    },
    {
      "command": "grep 'INVOCATION_CWD|resolveRepositoryRoot|process.chdir|loadHackConfig|configureEnvironment' src/index.ts",
      "result": "passed",
      "summary": "Bootstrap ordering confirmed: INVOCATION_CWD L64, resolve L142, chdir L146, loadHackConfig L165, configureEnvironment L168"
    },
    {
      "command": "grep 'breakdown.*progress|session.*in.*progress|ExitCode' src/",
      "result": "passed",
      "summary": "breakdown-in-progress is a PRD §297-316 read-only status concept, exit code 0; no src constant named BREAKDOWN_IN_PROGRESS"
    }
  ],
  "validationOutput": [
    "Scout output written to /home/dustin/projects/hacky-hack/plan/009_94353b1a9fd3/P4M1T1S1/research/scout3-config-source.md",
    "All signatures verified against live source (repo-root.ts, hack-config.ts, constants.ts, index.ts, config.ts, package.json, PRD.md)",
    "No source code modified — recon only"
  ],
  "residualRisks": [
    "TOC (L9-37) must be manually updated for new sections or anchors break",
    "SCHEMA_MAP has ~40 rows / 13 sections — implementer should choose per-section tables to match existing env-var doc convention",
    ".env Security section (L440-456) needs cross-reference to .hack.local secrets tier",
    "breakdown-in-progress 'task/status section' does not exist in CONFIGURATION.md — must be created; confirm with PRD whether it belongs here or in CLI_REFERENCE.md"
  ],
  "noStagedFiles": true,
  "diffSummary": "No code diff — scout recon only. Output is a markdown findings document at the authoritative runtime path.",
  "reviewFindings": [
    "no blockers — all recon complete; the doc task is purely additive (new .hack section + 7-layer precedence rewrite + new task/status exit-code section)"
  ],
  "manualNotes": "The .hack system is entirely absent from CONFIGURATION.md (zero matches for .hack/TOML/config-file). This is an additive documentation task, not a stale-framing correction. The only 'stale' content is the 4-layer Configuration Priority list (L407-411) which is incomplete (omits .hack tiers) but was never wrong. PRP_COMMIT_FORMAT is already live and documented at L165; needs a cross-reference to the .hack [pipeline] commit_format key. The breakdown-in-progress exit code (0) comes from PRD §297-316 and has no existing section in the doc."
}
```