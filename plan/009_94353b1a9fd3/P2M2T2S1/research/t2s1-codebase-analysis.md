# T2.S1 — Codebase Analysis (P2.M2.T2.S1: `hack config` subcommand)

Grounded findings for the `hack config init/show/validate/path` subcommand PRP. Every
claim is `file:line`-backed. This item CONSUMES the P2.M2.T1.S1 outputs (`SCHEMA_MAP`,
`SCHEMA_BY_KEY`, `HackConfigSchemaEntry`) and the P2.M1.T2.S1 validation layer
(`validateHackTier`, `isSecretKey`, `HACK_CONFIG_SCHEMA`) — see the parallel-execution
contract.

---

## 1. CRITICAL: subcommand actions run BEFORE the bootstrap `chdir`

`src/index.ts` `main()` ordering (verified):
```
112  const parseResult = parseCLIArgs();
113-119  if ('subcommand' in parseResult) return 0;   // ← subcommand dispatched HERE
... (repo-root resolve + chdir happen AFTER this, at the pipeline path)
resolveRepositoryRoot(INVOCATION_CWD, args.repoRoot ? {explicit} : undefined)
process.chdir(repoRoot)
```
`src/cli/index.ts:824` comment confirms: *"process.cwd() here === INVOCATION_CWD (S1's
chdir runs AFTER parseCLIArgs returns), so resolve() now is INVOCATION_CWD-relative."*

**Consequence:** inside ANY subcommand `.action()` handler:
- `process.cwd()` is STILL the invocation dir (subdir), NOT repoRoot.
- `getRepoRoot()` (repo-root.ts singleton) **THROWS** — `resolveRepositoryRoot` hasn't run.
- `resolve('.hack')` would resolve against the subdir → **WRONG** from a nested dir.

**The item's claim** ("After Phase 1's chdir, resolve('.hack') resolves to repoRoot — the
config subcommand benefits automatically") is **INACCURATE**. The config subcommand must
resolve repoRoot ITSELF via `resolveRepositoryRoot(process.cwd())` (default upward
traversal). This sets the singleton (harmless; config exits before the pipeline) and is
robust to invocation from any subdir. Consistent with §9.8.5 (git = hard prereq).

> Note: sibling subcommands (cache/task/status) currently use `resolve('plan')` and thus
> have the latent subdir bug; fixing them is OUT of scope. Config is MORE correct by using
> the resolver. `--repo-root` is a root-program flag NOT threaded into subcommands
> (Commander attaches it to the root, not the subcommand action); consistent with siblings,
> config resolves via default traversal. Documented as a known limitation.

## 2. Subcommand registration + sentinel dispatch (src/cli/index.ts)

- **Registration template (closest = `cache`, lines 540-563):**
  ```ts
  program.command('cache').description('...').argument('[action]', '...', 'stats')
    .option('--force', ..., false).option('-o, --output <format>', '...', 'table')
    .action(async (action, options) => {
      try { ...; process.exit(0); } catch (error) { ...; process.exit(1); }
    });
  ```
- **parseCLIArgs return union (lines 300-306):** add `| { subcommand: 'config'; options: ConfigOptions }`.
- **Sentinel dispatch (lines 759-815):** add a `config` branch mirroring `cache`:
  ```ts
  if (args.length > 0 && args[0] === 'config') {
    return { subcommand: 'config', options: { action: ..., force: ..., src: ..., global: ..., local: ..., output: ... } };
  }
  ```
  NOTE: the sentinel's `options` object is TYPE-SAFETY-ONLY (the `.action()` already ran +
  `process.exit`'d before parseCLIArgs returns). It must be a valid `ConfigOptions` shape
  but the values are placeholders.

## 3. Command class convention (src/cli/commands/cache.ts)

- Class with private `#planDir`/`#prdPath` fields; constructor defaults via `resolve(...)`.
- `async execute(action, options): Promise<void>` dispatches via switch; unknown action →
  `console.error` + `process.exit(1)`; outer try/catch → `logger().error` + `process.exit(1)`.
- Options interface exported (`CacheOptions`). Uses `chalk` + `cli-table3` for table output.
- **ConfigCommand design:** class with `#repoRoot`; `async execute(action: string, options:
  ConfigOptions)`. Constructor takes `repoRoot` (resolved by the `.action()`). Private
  `#initAction/#showAction/#validateAction/#pathAction`. Exported `ConfigOptions` interface.

## 4. Inputs consumed (read-only contracts)

### 4a. From P2.M2.T1.S1 (parallel — assume implemented exactly per its PRP)
`src/config/hack-config.ts` will export:
- `HackConfigSchemaEntry` interface: `{ section, key, envVar?, cliFlag?, type, defaultValue?, acceptedValues? }`.
- `SCHEMA_MAP: readonly HackConfigSchemaEntry[]` — 38 rows (§9.7.5 verbatim; NO `[auth]`).
- `SCHEMA_BY_KEY: Readonly<Record<string, HackConfigSchemaEntry>>` — `"section.key"` lookup.
- `HACK_KEY_TO_ENV` stays PRIVATE (`const`, not exported) — S1 re-authors it. DO NOT import it.

### 4b. From P2.M1.T2.S1 (already landed)
`src/config/hack-config.ts` currently exports: `parseHackFile`, `loadHackConfig`,
`ParsedHackConfig`, `MergedHackConfig` (extends with `_sources: Record<string,HackConfigTier>`),
`HackConfigValue`, `HackConfigTier`, `HackConfigFieldSpec`, `_resetValidationWarnings`.

### 4c. From P1.M1.T1.S1 (already landed)
`src/utils/repo-root.ts` exports: `resolveRepositoryRoot(startDir, opts?) → {repoRoot, invocationCwd}`,
`getRepoRoot()` (THROWS pre-bootstrap), `getInvocationCwd()`, `NotARepositoryError`.

## 5. CRITICAL: functions to EXPORT from hack-config.ts (additive `export` keywords)

The config subcommand needs 3 currently-PRIVATE functions. Each is the AUTHORITATIVE
implementation; duplicating them risks drift. Add `export` (one keyword each; disjoint from
S1's parallel edits — see §6):

| Function | Region | Why export | Alternative if not exported |
|----------|--------|-----------|-----------------------------|
| `globalHackPath()` | three-tier (~L295) | PATH `--global`; show/validate global tier | replicate 3-line cascade (drift risk) |
| `isSecretKey(key)` | secrets (~L390) | SHOW masking (same rule loader refuses by) | 1-liner suffix check (low drift) |
| `validateHackTier(parsed,file,tier)` | validation (~L430) | VALIDATE per-file lint (the §9.7.7 validator) | replicating is ~40 lines + dedup (HIGH drift) — DO NOT |

- `HACK_CONFIG_SCHEMA` does NOT need exporting — `validateHackTier` uses it internally.
- `seedProcessEnv` / `mergeTier` / `seedAuthOverrideKey` / `logEffectiveConfigTrace` stay private
  (consumed only via `loadHackConfig`).

## 6. Parallel-edit conflict analysis (S1 ‖ S2 both edit hack-config.ts)

- **S1 (P2.M2.T1.S1) edits:** (a) INSERT `SCHEMA_MAP`/`SCHEMA_BY_KEY`/`HackConfigSchemaEntry`
  block between `MergedHackConfig` and `HACK_KEY_TO_ENV`; (b) REPLACE `HACK_KEY_TO_ENV` literal
  with a derivation. Both in the **three-tier/env-seeding** region.
- **S2 (this) edits:** add `export` to `globalHackPath` (three-tier region, a few lines BELOW
  `HACK_KEY_TO_ENV`), `isSecretKey` (secrets region), `validateHackTier` (validation region).
- **Verdict:** DISJOINT lines/functions. S1's PRP "Out of scope" explicitly does NOT touch
  `isSecretKey`/`validateHackTier`/`globalHackPath` (they are T2.S1's, not S1's). The `globalHackPath`
  `export` is one keyword on a line S1 doesn't edit. Git merge resolves cleanly (different lines).
  Mitigation: S2's edits are ONE-WORD additions (`export`) on distinct function declarations.

## 7. SHOW source-attribution design (the trickiest action)

PRD §9.7.8/§9.7.10: SHOW merges all layers, prints every SCHEMA_MAP key with resolved value +
(with `--src`) the winning layer ∈ {global, project, local, env, cli, default}.

**`loadHackConfig` mutates process.env** (seedProcessEnv sets undefined env keys from file).
So post-call you CANNOT distinguish "env set by shell" from "env set by file seeding".

**Solution (env snapshot BEFORE load):**
1. Snapshot: `const preEnv = new Set(SCHEMA_MAP.filter(e=>e.envVar).map(e=>e.envVar!).filter(v=>process.env[v]!==undefined))`
   — BEFORE calling loadHackConfig.
2. `const merged = loadHackConfig(repoRoot)` → merged sections + `_sources` (file tiers only).
3. Per SCHEMA_MAP entry → resolved value + source:
   - env-linked AND `envVar ∈ preEnv` → value=`process.env[envVar]`, source=`'env'` (§9.2.1 layer 5/6 wins).
   - else if `"section.key" ∈ merged._sources` → value=merged value, source=`_sources[key]` (global/project/local).
   - else → value=`entry.defaultValue`, source=`'default'` (schema default).
4. Mask value → `'<redacted>'` if `isSecretKey(key)` (defensive; no SCHEMA_MAP key is secret — `[auth]` is absent).
5. CLI layer (7): SHOW is a subcommand; pipeline flags aren't passed → 'cli' is structurally
   N/A. Document as by-design (the item's "if available" = best-effort; SHOW reliably reports
   global/project/local/env/default only).

Output: table (cli-table3, cols: Key|Value[|Source]) or `--output json`.

## 8. VALIDATE design (CI-friendly, per-file, no env seeding)

PRD §9.7.8: `validate [<file>]` lints .hack (+.hack.local); exit 1 on errors, warn on unknowns.

- Default files: `[<repoRoot>/.hack, <repoRoot>/.hack.local]`. Explicit `<file>` → `[resolve(file)]`.
- Per file: tier inference (secrets policy uses tier — only 'project-local' may hold secrets):
  - basename `.hack.local` → `'project-local'`; else → `'project'`.
- Per file, in try/catch (continue across files; collect errors):
  - `parseHackFile(file)` (BOM/malformed → throws Error naming file+line/col).
  - `validateHackTier(parsed, file, tier)` (secrets §9.7.6 + type/range/enum §9.7.7 → throws on
    hard error; unknown section/key → `warnOnceValidation` to stderr; deduped by `file:path`).
  - Call `_resetValidationWarnings()` first so unknown-key warnings show per file (fresh dedup Set).
- After all files: if any errors → print each (stderr) + `process.exit(1)`; else `process.exit(0)`.
- **Does NOT call `loadHackConfig`** (no merge, no env seeding — pure lint).

## 9. INIT design (.hack template + .gitignore)

PRD §9.7.8/§9.7.4 + item: write a HEAVILY-COMMENTED `<repoRoot>/.hack` template including ALL
SCHEMA_MAP sections as commented-out examples; refuse to clobber without `--force`; append
`.hack.local` to `.gitignore` (create if absent, dedup the line); print next-step guidance.

- **Template generation:** generate from `SCHEMA_MAP` (grouped by section) so it stays in sync.
  Header comment + per-section `[section]` header + commented `# key = <default>` per entry
  (entries w/o default → `# key = ...  # (unset)`). Hand-authored static string would drift;
  generating from SCHEMA_MAP is DRY. Do NOT use `smol-toml.stringify` (it can't emit comments;
  the template MUST be commented per §9.7.4).
- **Clobber prevention:** `if (existsSync(<repoRoot>/.hack) && !options.force)` → stderr error +
  `process.exit(1)`.
- **.gitignore append (dedup):** read `.gitignore` if present; if no line is exactly/trims-to
  `.hack.local`, `fs.appendFileSync('.gitignore', '\n.hack.local\n')` (create if absent).
- **Next-step guidance:** print to stdout: where .hack was written, that .hack.local is gitignored,
  `hack config show` / `hack config validate` hints, link to docs.

## 10. Test pattern (tests/unit/cli/commands/)

- Convention: instantiate the Command class DIRECTLY (NOT process spawn). See
  `artifacts.test.ts` (vi.hoisted mocks for logger; vi.mock for fs/session-manager; beforeEach
  per-test). `inspect.test.ts` same dir.
- **ConfigCommand tests** at `tests/unit/cli/commands/config.test.ts`:
  - Use REAL temp dirs (mkdtempSync) as `repoRoot`; write temp `.hack`/`.hack.local`/`.gitignore`.
  - Mock `getLogger` (vi.mock logger.js) like artifacts.test.ts.
  - init: writes .hack, refuses clobber w/o --force, --force overwrites, appends .hack.local to
    .gitignore (create + dedup), template contains all 13 sections (assert a few `# [section]`).
  - show: temp .hack with a few keys → asserts resolved values + masked secrets (use a `.hack`
    is committable so secrets are refused at LOAD — test masking via a `.hack.local` secret? No:
    SCHEMA_MAP has no secret keys, so masking is defensive; assert a key with a secret-ish NAME
    if any, else assert no `[auth]` leaks). --src asserts winning layer. Mock process.env
    (vi.stubEnv) for env-layer attribution + env-over-file.
  - validate: valid file → exit 0 path (no throw); secret-in-.hack → throws/exit 1; out-of-range
    → throws/exit 1; unknown key → warns (spy console.warn) + exit 0; explicit file path.
  - path: --global/--local/no-flag print the right joined paths (mock globalHackPath via env).
- **parseCLIArgs sentinel test** (tests/unit/cli/index.test.ts): `setArgv(['config','show'])` →
  assert result is `{ subcommand: 'config', ... }` (mirrors how index.test.ts guards subcommands).
  NOTE: index.test.ts mocks `process.exit` to throw; the `.action()` calls process.exit, so the
  sentinel test must set argv such that the action path is taken OR test only the sentinel return.
  (See index.test.ts:105-110 — it currently THROWS on subcommand results; add a dedicated
  subcommand test block.)

## 11. Docs (Mode A — rides with the work)

`docs/CLI_REFERENCE.md` structure: `## Commands` (L50) has `### Task Management` (L172); add a
new `### Configuration Management` subsection documenting `hack config init/show/validate/path`,
the `--src`/masked-secrets behavior, `--force` clobber prevention, `--global`/`--local`/`--output`,
and the CI-friendly exit codes. Update `## Exit Codes` (L289) to note `hack config validate` →
exit 1 on hard errors (secrets/type/range/parse), exit 0 on warnings-only.

## 12. Verified facts

- `smol-toml` IS a direct dependency (`package.json` deps: `"smol-toml": "^1.6.1"`) — P2.M1.T1.S1
  promoted it. `parse`/`stringify`/`TomlError` available.
- `chalk` + `cli-table3` are deps (used by CacheCommand) — reuse for SHOW table output.
- `commander` is a dep — subcommand registration pattern proven by cache/task/status/inspect.
- Validation commands: `npm run typecheck` / `npm run lint` / `npm run format:check` /
  `npm run test:run` (gated). Targeted: `npx vitest run tests/unit/cli/commands/config.test.ts`.
- 100% coverage is enforced (vitest --coverage). ConfigCommand branches: action switch (4 cases
  + default), per-action conditionals (force/global/local/src/output) — all must be exercised.