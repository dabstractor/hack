# P2.M2.T3.S1 — Codebase & Context Research

> Research supporting the PRP for `.gitignore` management + tracked-`.hack.local` warning +
> §9.7.10 acceptance tests. Grounded in HEAD + the parallel P2.M2.T2.S1 PRP (treated as a
> contract that lands first).

---

## 1. Parallel-execution contract (P2.M2.T2.S1 lands FIRST)

`src/cli/commands/config.ts` does **not** exist yet at research time (P2.M2.T2.S1 in progress).
T3.S1's implementer will find it landed. T2.S1's PRP specifies (treat as contract):

- **`ConfigCommand`** class in `src/cli/commands/config.ts`: `constructor(repoRoot)`, private
  `#repoRoot`, `async execute(action: string, options: ConfigOptions)`. Mirrors `CacheCommand`.
- **`ConfigOptions`** interface: `{ output:'table'|'json'; force:boolean; src:boolean;
  global:boolean; local:boolean }`.
- **`#initAction(options)`** writes `<repoRoot>/.hack` (commented template from `SCHEMAMap`),
  refuses clobber unless `options.force`, calls a **private** `ensureGitignoreHasHackLocal(repoRoot)`
  (basic append+dedup, NO comment header, NO section placement), prints guidance.
- **`#showAction(options)`** snapshots pre-defined env (`preEnv`), calls `loadHackConfig(repoRoot)`,
  renders every `SCHEMA_MAP` key with value + (if `--src`) source layer; masks via `isSecretKey`.
- **`#validateAction(options, fileArg?)`**: `_resetValidationWarnings()` first; files =
  `fileArg ? [resolve(fileArg)] : [<repoRoot>/.hack, <repoRoot>/.hack.local]`; per-file
  `parseHackFile` + `validateHackTier(parsed, file, tierFor(file))` in try/catch (collect errors,
  continue); `tierFor(file) = basename==='.hack.local' ? 'project-local' : 'project'`; exit 1 if
  any errors else 0. **NEVER** calls `loadHackConfig` (pure lint, no env seeding).
- **`#pathAction(options)`**: global=`globalHackPath()`, project=`join(repoRoot,'.hack')`,
  local=`join(repoRoot,'.hack.local')`; `--global`/`--local` filter; table/json.

**T3.S1 edits `config.ts` (disjoint, additive):** (1) ENHANCE `ensureGitignoreHasHackLocal` to add
a comment header + place near the `# Environment files` section; (2) ADD a `warnIfHackLocalTracked`
call inside `#validateAction`. These touch a private helper + add one call site — NO conflict with
T2.S1's four-action structure or the registration in `index.ts`.

---

## 2. `src/config/hack-config.ts` — exported surface available to acceptance tests (P2.M1 + P2.M2.T1.S1 landed)

Verified by reading the file. Public exports:

- `SCHEMA_MAP: readonly HackConfigSchemaEntry[]` (38 §9.7.5 rows) + `SCHEMA_BY_KEY` lookup index.
- `HackConfigSchemaEntry` interface: `{ section, key, envVar?, cliFlag?, type, defaultValue?,
  acceptedValues?/enum?, min?, max? }` (verify exact field names when importing).
- `parseHackFile(filePath): ParsedHackConfig` — throws on BOM/malformed (with file+line/col);
  ENOENT propagates if file vanishes mid-run.
- `loadHackConfig(repoRoot): MergedHackConfig` — tier discovery (global/project/project-local) →
  per-tier `parseHackFile` + `validateHackTier` → `mergeTier` → `seedProcessEnv` +
  `seedAuthOverrideKey` + `logEffectiveConfigTrace`. Returns `{...merged, _sources}` where
  `_sources: Record<'section.key', HackConfigTier>`. **THROWS** on a secret in a committable tier
  or a type/range/enum mismatch (via `validateHackTier`). **MUTATES `process.env`** (env-over-file).
- `validateHackTier(parsed, file, tier)` — exported (T2.S1). Secrets FIRST (key-name based);
  non-empty secret in `global`/`project` → **throws** (msg: `Secret-bearing key [s] k is not
  permitted in the committable file <file> (PRD §9.7.6). Move it to .hack.local ...`). Empty
  secret → skipped (not configured, §9.2.7). Secret in `project-local` → allowed, never echoed.
  Unknown section/key → `warnOnceValidation` (stderr, deduped, `_validationWarned` Set). Type/range
  → throws via `validateFieldValue` (echoes the OFFENDING VALUE for non-secret keys, e.g.
  `got -5`, `expected int > 0`). **Secrets never reach `validateFieldValue`** (caught first).
- `isSecretKey(key): boolean` — exported (T2.S1). `key.endsWith('_key'|'_token'|'_secret'|'_password')`.
- `globalHackPath(): string` — exported (T2.S1). `$HACK_CONFIG_HOME/config` → `$XDG_CONFIG_HOME/hack/config` → `~/.hack`.
- `_resetValidationWarnings()` — exported test hook.
- `HackConfigTier = 'global' | 'project' | 'project-local'`; `MergedHackConfig extends ParsedHackConfig { _sources }`.

**Private (do NOT import):** `seedProcessEnv`, `seedAuthOverrideKey`, `mergeTier`,
`logEffectiveConfigTrace`, `warnOnceValidation`, `validateFieldValue`, `HACK_CONFIG_SCHEMA`,
`HACK_KEY_TO_ENV`, `_validationWarned`.

### 2.1 Auth seeding — CRITICAL for §9.7.10 criterion 4

`seedAuthOverrideKey` seeds **ONLY** `[auth] override_key → process.env.PRP_API_KEY` (the §9.7.6
canonical mapping), and only when `PRP_API_KEY` is undefined + value non-empty. `seedProcessEnv`
**EXCLUDES `[auth]` entirely** (secret-bearing). Therefore `[auth] zai_api_key` in `.hack.local` is
**accepted** (held in `merged.auth`) but is **NOT re-seeded** to any env var — consistent with
§9.7.2's non-goal (`.hack` is never the primary auth channel; use `ZAI_API_KEY`/`auth.json`).

**Reconciliation of the PRD §9.7.10 wording** ("the same key in .hack.local is accepted and seeds
PRP_API_KEY"): the **implemented + §9.7.6-canonical** behavior is — `zai_api_key` (example secret)
is *refused* in `.hack` and *accepted* in `.hack.local`; the explicit-override mechanism that seeds
`PRP_API_KEY` is `[auth] override_key` (§9.7.6). The acceptance test asserts BOTH faithfully:
(1) zai_api_key refused in .hack / accepted in .hack.local; (2) override_key in .hack.local seeds
PRP_API_KEY. Do NOT add a new zai_api_key→PRP_API_KEY seeding (would be an un-specced new feature
beyond §9.7.6; AGENTS.md rule 4 forbids it).

---

## 3. §9.7.6 secrets-policy hard error does NOT echo the secret value

Confirmed by reading `validateHackTier` (hack-config.ts:755–806): the secret branch throws BEFORE
any value serialization, naming only file + key + remediation. `validateFieldValue` (reached only
for NON-secret keys) DOES echo the offending value (`got -5`, `is not one of [a, b]`). So the
§9.7.10 criterion-9 invariant ("no secret value in an error message") holds for secrets by
construction. Acceptance test asserts the literal secret string does NOT appear in the thrown msg.

---

## 4. Test infrastructure

- **Unit:** `tests/unit/config/hack-config.test.ts` ALREADY covers (at unit level): parse/load/
  seeding, env-over-file (crit 7), secrets refusal/acceptance + override_key→PRP_API_KEY (crit 4),
  empty-secret==not-configured, unknown section/key warnings (crit 6), out-of-range/enum/type
  throws (crit 5), masked effective-config trace at debug (crit 9). **T3.S1 must NOT duplicate
  these** — T3.S1 writes ACCEPTANCE/integration tests (cross-subsystem + real CLI), complementary.
- **Integration dir:** `tests/integration/config/` (has `pi-harness-auth.test.ts`);
  `tests/integration/cli/` (has `repo-root-semantics.test.ts`); `tests/integration/repo-root-acceptance.test.ts`.
- **GOLD TEMPLATE:** `tests/integration/repo-root-acceptance.test.ts` — uses real
  `mkdtempSync` + `spawnSync('git',['init','-q',repo])` (`makeRepo()` helper), `spawnSync(tsxBin,
  [absIndex, ...args], {cwd})` for CLI subprocess, `realpathSync` for canonical compare, `rmSync`
  in `finally`. Copy `makeRepo()` + `runCli()` + `tsxBin`/`absIndex` resolution verbatim.
- **vitest config:** `pool:'forks'`, `globals:true`, `setupFiles:['./tests/setup.ts']`,
  coverage floor (statements 89/branches 90/functions 94/lines 89). No special integration config.
- **`tests/setup.ts` loads `.env` via dotenv** + `beforeEach` deletes `SKIP_BUG_FINDING` + global
  `afterEach` calls `vi.unstubAllEnvs()`. ⇒ Acceptance tests MUST use a hermetic env: `beforeEach`
  delete the config-seeded vars (`PARALLEL_RESEARCH`, `PRP_MODEL_BALANCED`, `PRP_API_KEY`,
  `PRP_AGENT_HARNESS`, `HACKY_LOG_LEVEL`, …) and rely on `vi.unstubAllEnvs()` (or own afterEach).
- **child_process in src:** `spawnSync` is already used across `src/utils/*` (typecheck-runner,
  test runners, prd-validation-executor, cli-help-executor). `git ls-files` is NOT used anywhere
  yet — T3.S1 introduces it for the tracked-file check.
- **Coverage:** new `config.ts` already targets 100% (T2.S1). T3.S1's additions
  (`ensureGitignoreHasHackLocal` branches + `warnIfHackLocalTracked` branches) must each be covered.

---

## 5. §9.7.10 → concrete acceptance test mapping (9 criteria)

| # | Criterion | Layer | Mechanism |
|---|-----------|-------|-----------|
| 1 | committable .hack (mode=bug-hunt, parallel_research=true, balanced=glm-5.2) applies, bare, any subdir | A (direct, nested cwd) | `resolveRepositoryRoot(nested)`→`loadHackConfig(repoRoot)`; assert `process.env.PARALLEL_RESEARCH==='true'`, `PRP_MODEL_BALANCED==='glm-5.2'`, `merged.cli.mode==='bug-hunt'`. |
| 2 | `init` writes commented .hack, gitignores .hack.local, refuses clobber w/o --force | A (ConfigCommand) + B (subprocess) | `new ConfigCommand(repo).execute('init',{...})`; assert .hack sections + `.gitignore` has `.hack.local` under comment near env section; re-init w/o force → throws/exit1; `--force` overwrites. |
| 3 | `show --src` prints every tunable + winning layer, secrets masked | A (ConfigCommand) | `.hack`+`.hack.local` fixtures; capture stdout; assert every `SCHEMA_MAP` key + source attribution. (Masking structurally N/A — SCHEMA_MAP has no secret key; covered by crit 9.) |
| 4 | `[auth] zai_api_key` in .hack aborts; accepted in .hack.local; override_key seeds PRP_API_KEY | A (direct) | `.hack` w/ zai_api_key → `loadHackConfig` throws (assert no value echo); `.hack.local` w/ zai_api_key → no throw; `.hack.local` w/ override_key → `process.env.PRP_API_KEY` set. |
| 5 | out-of-range/typo (poll_ms=-5, harness name=foo) aborts before any agent | A (direct) | `.hack` w/ each → `loadHackConfig` throws w/ actionable msg (key+value+accepted). |
| 6 | unknown key/section → stderr warning + proceeds | A (direct) | `.hack` w/ `[foo]`/`[pipeline] reseaerch_depth` → no throw; spy `console.warn` for the warning. |
| 7 | env-over-file: `PARALLEL_RESEARCH=false` beats `[pipeline] parallel_research=true` | A (direct) | `vi.stubEnv('PARALLEL_RESEARCH','false')` BEFORE `loadHackConfig`; assert `process.env.PARALLEL_RESEARCH==='false'` (file did NOT override). |
| 8 | from `src/deep/nested/` resolves same .hack/.env/PRD.md/plan/ (joint w/ §9.8, DONE) | A (direct, nested cwd) | temp repo w/ .hack/.env/PRD.md/plan/; from nested: `resolveRepositoryRoot`→repoRoot; `loadHackConfig(repoRoot)` reads repoRoot/.hack; post-`chdir(repoRoot)` `resolve('PRD.md')`/`resolve('plan')` === repoRoot paths. |
| 9 | no secret value unmasked in show/debug-trace/errors | A (direct) | `.hack.local` w/ override_key="sk-secret-marker"; `loadHackConfig` w/ `HACKY_LOG_LEVEL=debug` → spy `console.warn` trace shows `"<redacted>"` + NOT the marker; `.hack` w/ zai_api_key="sk-x" → thrown msg lacks "sk-x"; `show` stdout lacks the marker. |

**Placement:** `tests/integration/config/hack-config-acceptance.test.ts` (mirrors
`tests/integration/repo-root-acceptance.test.ts`). Layer A = direct subsystem calls on real temp
git repos; Layer B = optional subprocess `hack config init` (proves the real CLI path).

---

## 6. Tracked-`.hack.local` warning (NEW in validate) — design

```ts
import { spawnSync } from 'node:child_process';
function warnIfHackLocalTracked(repoRoot: string): void {
  const hackLocal = join(repoRoot, '.hack.local');
  if (!existsSync(hackLocal)) return;                 // nothing on disk to leak
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '.hack.local'],
    { cwd: repoRoot, encoding: 'utf8' });
  if (r.status === 0) {                               // exit 0 ⇒ tracked in the index
    console.error(                                    // stderr, sync (§9.6)
      `[hack] WARNING: ${hackLocal} is tracked by git — potential secret leak (PRD §9.7.6). ` +
      `Untrack it with: git rm --cached .hack.local`
    );
  }
}
```
- Called ONCE inside `#validateAction` (after `_resetValidationWarnings()`, before/after the per-file
  loop — warning is advisory, exit code unchanged: 0 on warnings-only per §9.7.10).
- `git ls-files --error-unmatch` exits non-zero if untracked OR not a git repo ⇒ no warning (safe for
  non-git tmpdirs, though validate always runs in a repo via `resolveRepositoryRoot`).
- Tracking = present in the index; `git add .hack.local` (staged) is sufficient for the test
  (avoids needing `git commit` user.email config in a temp repo).
- Loud (stderr, `[hack] WARNING:` prefix) but NOT a hard error (PRD §9.7.3 "warn loudly").

---

## 7. `.gitignore` enhancement (refine T2.S1's `ensureGitignoreHasHackLocal`)

T2.S1 lands a basic append+dedup (plain `.hack.local\n`, no comment, end-of-file). T3.S1 refines:

1. **Comment header:** emit `# .hack local overrides (never commit)\n.hack.local\n` as a block.
2. **Section placement:** if the existing `.gitignore` has a line matching `/#\s*Environment files/i`,
   insert the block immediately AFTER that header line; else append at end (leading `\n` if needed).
3. **Dedup (idempotent):** if any existing trimmed line `=== '.hack.local'`, return (no-op). (A bare
   line from a prior T2.S1-style init is left as-is — dedup wins; the comment is added on first
   T3.S1-style init. Acceptable + idempotent.)
4. **Create-if-absent:** no `.gitignore` → `writeFileSync(gi, block)`.

Current repo-root `.gitignore` HAS `# Environment files` followed by `.env`/`.env.local`/`.env.*.local`/
`.envrc` — so the block lands right after it (the research note's "near this section" intent).

---

## 8. docs/CLI_REFERENCE.md insertion points (Mode A)

- `## Commands` → subsections end at `### Task Management` (L172). T2.S1 adds `### Configuration
  Management` (init/show/validate/path). **T3.S1 augments** it: under `init`, note the `.gitignore`
  behavior (adds `.hack.local` under `# .hack local overrides (never commit)`, near the Environment
  files section, idempotent); under `validate`, note the tracked-`.hack.local` stderr WARNING +
  `git rm --cached .hack.local` remediation.
- `## Exit Codes` (L289): the validate exit-code note (1=hard errors, 0=warnings-only) is added by
  T2.S1. T3.S1 ensures the tracked-file WARNING is documented as a non-fatal warning (exit 0).

---

## 9. Validation commands (verified in package.json scripts)

```bash
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm run format:check       # prettier --check
npx vitest run tests/integration/config/hack-config-acceptance.test.ts
npx vitest run tests/unit/cli/commands/config.test.ts   # T2.S1's unit suite (regression guard)
npm run build              # tsc → dist
npm run validate           # full gate (typecheck+lint+format+tests+coverage floor)
```