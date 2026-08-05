# PRP — P2.M2.T3.S1: `.gitignore` management + tracked-`.hack.local` warning + §9.7.10 acceptance tests

---

## Goal

**Feature Goal**: Harden the `.hack` configuration feature (PRD §9.7) with three finishing pieces
that close Milestone **P2.M2** and Phase **P2**:
1. **`.gitignore` management** — `hack config init` adds `.hack.local` under a comment header,
   placed near the repo's `# Environment files` section (idempotent, create-if-absent).
2. **Tracked-`.hack.local` warning** — `hack config validate` emits a loud **stderr** WARNING when
   `.hack.local` is tracked by git (potential secret leak), pointing the user at
   `git rm --cached .hack.local` (PRD §9.7.6 / §9.7.3).
3. **§9.7.10 acceptance tests** — a comprehensive, end-to-end acceptance sweep covering ALL NINE
   §9.7.10 criteria, exercised on real temp git repos via the config subsystem + (where valuable)
   the real CLI subprocess.

> **Scope boundary (read first).** The `hack config` subcommand itself — `ConfigCommand` +
> `init`/`show`/`validate`/`path` + a basic `.gitignore` append+dedup + CLI registration — is owned
> by the **parallel** sibling **P2.M2.T2.S1**, which lands FIRST. This PRP CONSUMES that landed
> `src/cli/commands/config.ts` and makes TWO additive, disjoint edits to it (enhance the gitignore
> helper; add one tracked-file warning call in `validate`), then adds the acceptance test file +
> doc notes. It does NOT re-implement any action or touch `src/cli/index.ts` registration.

**Deliverable** (Mode A — docs ride with the work):
1. **`src/cli/commands/config.ts`** (MODIFIED, additive) — (a) refine `ensureGitignoreHasHackLocal`
   to emit a comment header + place near the Environment-files section; (b) add a
   `warnIfHackLocalTracked(repoRoot)` helper + call it once inside `#validateAction`.
2. **`tests/integration/config/hack-config-acceptance.test.ts`** (NEW) — all nine §9.7.10 criteria
   (Layer A: direct subsystem calls on real `git init` tmpdirs; Layer B: subprocess `hack config`).
3. **`docs/CLI_REFERENCE.md`** (MODIFIED, Mode A) — augment the `### Configuration Management`
   section (landed by T2.S1): `init`'s `.gitignore` behavior (comment + section placement +
   idempotence) and `validate`'s tracked-`.hack.local` stderr WARNING + remediation.

**Success Definition**:
- `hack config init` writes `.hack.local` into `<repoRoot>/.gitignore` under a
  `# .hack local overrides (never commit)` comment, positioned immediately after the
  `# Environment files` header when that section exists (else appended), deduped across repeated
  runs, and creates `.gitignore` if absent.
- `hack config validate`, run in a repo where `.hack.local` is tracked by git (`git ls-files
  --error-unmatch .hack.local` exits 0), prints a loud stderr WARNING naming the file, the
  §9.7.6 rationale, and the `git rm --cached .hack.local` remediation — WITHOUT changing the exit
  code (advisory warning, exit 0 when only warnings occurred).
- All nine §9.7.10 acceptance criteria pass as integration tests on real temp git repos; the
  pre-existing `tests/unit/config/hack-config.test.ts` and T2.S1's `tests/unit/cli/commands/
  config.test.ts` remain GREEN (no duplication, no regression).
- `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run
  tests/integration/config/hack-config-acceptance.test.ts` GREEN; `npm run build` compiles;
  coverage floor holds; no new runtime dependency (`child_process` is a Node built-in).

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / onboarding developer / CI.
**Use Case**: `hack config init` onboards safely (secrets can never leak via `.hack.local` because
it is gitignored by construction); `hack config validate` in CI catches a `.hack.local` that was
accidentally `git add`-ed before it reaches a remote; the §9.7.10 acceptance sweep is the
machine-checked Definition of Done for the entire `.hack` feature (Phase P2).
**User Journey**: `hack config init` (writes `.hack` + gitignores `.hack.local`) → user commits →
CI runs `hack config validate` (warns if `.hack.local` is tracked, exits 0 on warnings-only) →
developer runs `hack config show --src` to verify effective config → acceptance suite proves the
end-to-end §9.7.10 contract.
**Pain Points Addressed**: A `.hack.local` secret committed to git (real leak risk); no
machine-checked proof that the §9.7.10 contract holds across the loader + validator + repo-root
resolution + CLI; the basic T2.S1 gitignore append lacks the documented comment/section placement.

---

## Why

- **PRD §9.7.3 / §9.7.6 compliance**: the spec mandates `init` gitignore `.hack.local` AND
  `validate` warn loudly on a tracked `.hack.local` ("point the user at `git rm --cached .hack.local`").
- **Closes P2.M2 + Phase P2**: the acceptance sweep is the Definition of Done for the `.hack`
  feature; without it the criteria are only unit-scattered, never proven end-to-end.
- **Secret-leak prevention**: secrets live ONLY in gitignored `.hack.local` (§9.7.6); the tracked-file
  warning is the safety net for human error (`git add .` staged it anyway).
- **Complementary, not duplicative**: the unit suite (`tests/unit/config/hack-config.test.ts`) and
  T2.S1's command unit suite already cover the components; this PRP proves they compose on a real
  repo from a real nested cwd, and fills the two spec gaps (gitignore comment/placement; tracked
  warning) that T2.S1 deliberately left to T3.

### Out of scope (hard fences)
- **Re-implementing `ConfigCommand` actions** (init/show/validate/path) or its CLI registration —
  those are T2.S1's, already landed. This PRP only ENHANCES the gitignore helper and ADDS one call
  in `validate`.
- **The loader / validator / secrets logic** (`loadHackConfig`, `validateHackTier`, `seedProcessEnv`,
  `seedAuthOverrideKey`, `SCHEMA_MAP`) — P2.M1 + P2.M2.T1.S1, consumed read-only.
- **Adding `[auth] zai_api_key → PRP_API_KEY` seeding** — NOT in §9.7.6 (only `override_key` maps to
  `PRP_API_KEY`). Adding it would be an un-specced new feature (AGENTS.md rule 4). `zai_api_key` in
  `.hack.local` is *accepted* (held in merged config) but not re-seeded — §9.7.2 non-goal.
- **Running the full pipeline** to prove "bare `hack` applies" end-to-end — infeasible in tests
  (needs agents/PRD). The acceptance test proves the **config-seeding layer** (which is what
  "applies" means: `process.env` is seeded + the merged config carries `[cli]` defaults) is
  repo-rooted and subdir-independent; the `--mode` Commander-default wiring is verified separately.
- **`--repo-root` inside the config subcommand** — not supported by any sibling subcommand (T2.S1
  documented limitation); validate resolves repoRoot via the command's constructor.
- **A tracked-file check inside the LOADER** — PRD scopes it to `validate` only (§9.7.3/§9.7.6 say
  "`hack config validate` MUST warn"); the loader stays fast and warning-free.

---

## What

### User-visible behavior
- `hack config init` (re-run) leaves `.gitignore` with exactly ONE `.hack.local` line, immediately
  preceded by `# .hack local overrides (never commit)`, sitting right after the `# Environment files`
  header (when that section exists). No `.gitignore` → one is created containing just the block.
- `hack config validate` in a repo where `git ls-files --error-unmatch .hack.local` succeeds prints,
  to **stderr**:
  `[hack] WARNING: <repoRoot>/.hack.local is tracked by git — potential secret leak (PRD §9.7.6).
  Untrack it with: git rm --cached .hack.local` and otherwise proceeds (exit code reflects only
  hard content errors: 1 on secrets/type/range/parse, 0 on warnings-only).
- The §9.7.10 acceptance suite (`npx vitest run tests/integration/config/hack-config-acceptance.test.ts`)
  passes all nine criteria on real `git init` tmpdirs.

### Technical requirements (exact contract — item 3a/b/c)

**(a) `.gitignore` management** — enhance the private `ensureGitignoreHasHackLocal(repoRoot)` in
`src/cli/commands/config.ts` (landed by T2.S1 as a plain append+dedup) so that:
1. The written block is `# .hack local overrides (never commit)\n.hack.local\n`.
2. If `<repoRoot>/.gitignore` exists and contains a line matching `/^#\s*Environment files\s*$/im`,
   insert the block immediately AFTER that header line (preserve the rest of the file + trailing
   newline semantics). Else append the block at end (prefix `\n` if the file is non-empty and lacks
   a trailing newline). If `.gitignore` is absent, `writeFileSync` it containing just the block.
3. **Idempotent dedup**: if ANY existing trimmed line `=== '.hack.local'`, return without writing
   (a bare line from a prior T2.S1-style init is left as-is; the comment is added on the first
   T3.S1-style init into a fresh `.gitignore`).
4. Read-then-write (no `appendFileSync` blind append — section insertion needs a rewrite; keep it
   atomic via a single `writeFileSync` of the composed content).

**(b) Tracked-`.hack.local` warning** — add a private `warnIfHackLocalTracked(repoRoot: string):
void` to `src/cli/commands/config.ts` and call it ONCE inside `#validateAction` (after
`_resetValidationWarnings()`, before the per-file lint loop):
```ts
import { spawnSync } from 'node:child_process';
function warnIfHackLocalTracked(repoRoot: string): void {
  const hackLocal = join(repoRoot, '.hack.local');
  if (!existsSync(hackLocal)) return;                                    // nothing on disk
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '.hack.local'],
    { cwd: repoRoot, encoding: 'utf8' });
  if (r.status === 0) {                                                   // tracked in the index
    console.error(                                                       // stderr, sync (§9.6)
      `[hack] WARNING: ${hackLocal} is tracked by git — potential secret leak (PRD §9.7.6). ` +
      `Untrack it with: git rm --cached .hack.local`
    );
  }
}
```
`git ls-files --error-unmatch` exits non-zero when untracked **or** not a git repo ⇒ no warning
(safe for any tmpdir). The warning is advisory — it MUST NOT flip the exit code (validate exits 0
when only warnings occurred, per §9.7.10).

**(c) §9.7.10 acceptance tests** — create `tests/integration/config/hack-config-acceptance.test.ts`
covering all nine criteria (see Implementation Blueprint §Data models for the exact cases). Use
real `git init` tmpdirs (copy `makeRepo()` + `runCli()` + `tsxBin`/`absIndex` verbatim from
`tests/integration/repo-root-acceptance.test.ts`), hermetic env (delete seeded env vars in
`beforeEach`; rely on global `vi.unstubAllEnvs()`), and `rmSync(..., {recursive:true,force:true})`
in `finally`. Layer A = direct subsystem calls (`loadHackConfig`, `ConfigCommand`, `resolveRepositoryRoot`);
Layer B = optional subprocess `hack config init` (proves the real CLI writes `.gitignore`).

**DOCS (Mode A, PRD §6.1)**: in `docs/CLI_REFERENCE.md` `### Configuration Management` (landed by
T2.S1): (1) under `init`, document the `.gitignore` behavior — adds `.hack.local` under
`# .hack local overrides (never commit)`, near the Environment-files section, idempotent, creates
`.gitignore` if absent; (2) under `validate`, document the tracked-`.hack.local` stderr WARNING +
`git rm --cached .hack.local` remediation, noting it is a non-fatal warning (exit 0 when only
warnings occurred).

### Success Criteria
- [ ] `init` writes the `.hack.local` block under the comment, near `# Environment files` (when
  present), idempotent across repeated runs, create-if-absent.
- [ ] `validate` warns on a tracked `.hack.local` (stderr, `[hack] WARNING:`, remediation) without
  changing the exit code; stays silent when `.hack.local` is absent or untracked or not a git repo.
- [ ] All nine §9.7.10 criteria pass as integration tests on real temp git repos.
- [ ] `tests/unit/config/hack-config.test.ts` + `tests/unit/cli/commands/config.test.ts` stay GREEN.
- [ ] `typecheck && lint && format:check` clean; `npm run build` compiles; coverage floor holds.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The exact consumed surface (`loadHackConfig`/`validateHackTier`/`SCHEMA_MAP`/`isSecretKey`/
`globalHackPath` exports + the auth-seeding truth), the gold acceptance-test template
(`repo-root-acceptance.test.ts` — `makeRepo`/`runCli`/`spawnSync`/`realpathSync`), the §9.7.10→test
mapping (research §5), the gitignore enhancement + tracked-warning designs (research §6/§7), the
parallel-contract boundary with T2.S1 (research §1), the docs insertion points (research §8), and
the verified validation commands (research §9) are all captured. The implementer reads the landed
`config.ts` (T2.S1) and the landed `hack-config.ts` for exact field names.

### Documentation & References
```yaml
# MUST READ — the authoritative spec for this subtask
- docfile: PRD.md
  section: "9.7.10 Acceptance Criteria" (L1002)
  why: THE nine criteria this PRP turns into machine-checked tests. Each maps 1:1 to a test (research §5).
  critical: crit 4 wording ("same key ... seeds PRP_API_KEY") is satisfied via override_key (§9.7.6 canonical);
       zai_api_key is the secret-presence EXAMPLE (refused in .hack, accepted in .hack.local). Do NOT add
       zai_api_key→PRP_API_KEY seeding (research §2.1).
- docfile: PRD.md
  section: "9.7.6 Secrets Policy" (L960) + "9.7.3 Discovery, Layering & File Locations" (L846)
  why: §9.7.6 mandates the tracked-.hack.local validate warning; §9.7.3 mandates init gitignores
       .hack.local ("MUST warn loudly ... point the user at `git rm --cached .hack.local`").
- docfile: PRD.md
  section: "9.7.7 Validation & Error Handling" (L967) + "9.7.8 The hack config Subcommand" (L977)
  why: §9.7.7 = what validate enforces (warnings vs hard errors; stderr sync §9.6); §9.7.8 = the four
       actions T2.S1 implements (this PRP enhances init's gitignore + validate's tracked check).

# MUST READ — this subtask's research (binding design + the 9-criteria test map)
- docfile: plan/009_94353b1a9fd3/P2M2T3S1/research/t3s1-codebase-analysis.md
  section: §1 (parallel contract), §2 (hack-config exports + auth-seeding truth), §3 (secret-error no-echo),
           §4 (test infra), §5 (9-criteria map), §6 (tracked-warning design), §7 (gitignore design), §8 (docs)
  why: THE design + gotchas. Implementation follows §6/§7 directly; tests follow §5.

# MUST READ — the parallel task's PRP (T2.S1 — CONTRACT; it lands FIRST; consume, don't conflict)
- docfile: plan/009_94353b1a9fd3/P2M2T2S1/PRP.md
  section: "Goal / Deliverable / Out of scope" + "Implementation Tasks Task 2 (CREATE config.ts)"
  why: defines ConfigCommand + #initAction/#validateAction + the basic ensureGitignoreHasHackLocal this
       PRP ENHANCES, and the #validateAction this PRP ADDS the tracked-warning call to. Confirms disjoint edits.
  critical: T2.S1's ensureGitignoreHasHackLocal is a plain append+dedup (no comment/section) — T3 REFINES it.

# MUST READ — the architecture scouting (proven facts)
- docfile: plan/009_94353b1a9fd3/architecture/system_context.md
  section: §3.5 (Secrets Policy) + §5 (deps: child_process already used; no new dep)
  why: secret key list; confirms child_process is already a familiar pattern in src/utils (no new dep).

# MUST READ — the consumed config layer (P2.M1 + P2.M2.T1.S1 — already landed)
- file: src/config/hack-config.ts
  why: loadHackConfig/validateHackTier/parseHackFile/SCHEMA_MAP/isSecretKey/globalHackPath/_resetValidationWarnings
       (consume), seedAuthOverrideKey (override_key→PRP_API_KEY ONLY — §2.1 truth), MergedHackConfig._sources.
  pattern: imports for the acceptance test; read for exact HackConfigSchemaEntry field names.
  gotcha: seedProcessEnv EXCLUDES [auth]; zai_api_key is NEVER auto-seeded (§2.1).

# MUST READ — the file this PRP edits (landed by T2.S1) + its test + the gold acceptance template
- file: src/cli/commands/config.ts
  why: EDIT (additive) — enhance ensureGitignoreHasHackLocal (comment+section placement) + add
       warnIfHackLocalTracked + call it in #validateAction. READ FIRST to confirm T2.S1's exact helper
       name/signature before editing (treat the PRP's name as the expected contract).
- file: tests/integration/repo-root-acceptance.test.ts
  why: GOLD TEMPLATE — copy makeRepo()/runCli()/tsxBin/absIndex/realpathSync finally-rmSync verbatim.
  pattern: Layer A (direct calls on real git tmpdirs) + Layer B (spawnSync the real CLI, controlled cwd).
- file: tests/unit/config/hack-config.test.ts
  why: READ — the EXISTING unit coverage (crit 4/5/6/7/9). Do NOT duplicate; the acceptance test asserts
       the SAME contract at integration scope (cross-subsystem + real repo + nested cwd).
- file: tests/unit/cli/commands/config.test.ts
  why: READ — T2.S1's command unit suite (init gitignore dedup, clobber, show --src, validate exit codes).
       T3's acceptance test is COMPLEMENTARY (subprocess CLI + the comment/section placement + tracked warning).
- file: docs/CLI_REFERENCE.md
  why: EDIT (Mode A) — augment ### Configuration Management (init gitignore behavior + validate tracked warning).
```

### Current Codebase tree (relevant slice)
```bash
src/cli/commands/
  config.ts                 # EDIT (additive) — T2.S1 lands it; T3 enhances gitignore helper + adds tracked-warning call
src/config/
  hack-config.ts            # READ — consume loadHackConfig/validateHackTier/SCHEMA_MAP/isSecretKey/globalHackPath
src/utils/
  repo-root.ts              # READ — resolveRepositoryRoot (acceptance crit 1/8)
tests/integration/
  repo-root-acceptance.test.ts   # READ — GOLD template (makeRepo/runCli/spawnSync/realpathSync)
  config/
    hack-config-acceptance.test.ts   # NEW — nine §9.7.10 criteria
tests/unit/
  config/hack-config.test.ts        # READ — existing unit coverage (do not duplicate)
  cli/commands/config.test.ts       # READ — T2.S1's command unit suite (regression guard)
docs/
  CLI_REFERENCE.md          # EDIT (Mode A) — augment ### Configuration Management
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/cli/commands/config.ts                            # MODIFIED (additive) — gitignore comment+section; tracked-warning in validate
tests/integration/config/hack-config-acceptance.test.ts   # NEW — nine §9.7.10 acceptance criteria (real git tmpdirs)
docs/CLI_REFERENCE.md                                 # MODIFIED (Mode A) — init gitignore behavior + validate tracked warning
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: P2.M2.T2.S1 lands src/cli/commands/config.ts FIRST (parallel). READ the landed file before
// editing to confirm the exact helper name/signature (the PRP names it ensureGitignoreHasHackLocal +
// #validateAction per T2.S1's contract). Your edits are ADDITIVE + DISJOINT: enhance the gitignore
// helper's body; add one warnIfHackLocalTracked() call inside #validateAction. Do NOT touch the four
// action methods' structure, #showAction, #pathAction, #initAction's template/clobber logic, or index.ts.

// CRITICAL: §9.7.10 crit-4 wording ("same key ... seeds PRP_API_KEY") is satisfied by override_key→PRP_API_KEY
// (§9.7.6 canonical, implemented by seedAuthOverrideKey). zai_api_key is the secret-PRESENCE example:
// refused in .hack, accepted in .hack.local (held in merged.auth, NOT re-seeded — §9.7.2 non-goal). Do NOT
// add zai_api_key→PRP_API_KEY seeding (un-specced new feature, AGENTS.md rule 4). Test BOTH faithfully.

// CRITICAL: validateHackTier's secret-refusal error NEVER echoes the secret value (throws before any
// JSON.stringify, naming file+key+remediation only). validateFieldValue DOES echo non-secret offending
// values (got -5 / not one of [a,b]). So crit-9 ("no secret in an error msg") holds for secrets by
// construction — assert the literal secret string is absent from the thrown message.

// CRITICAL: tests/setup.ts loads .env + the ambient shell may export config vars. Acceptance tests MUST
// use a hermetic env: beforeEach delete the seeded vars (PARALLEL_RESEARCH, PRP_MODEL_BALANCED, PRP_API_KEY,
// PRP_AGENT_HARNESS, HACKY_LOG_LEVEL, RESEARCH_DEPTH, …); global afterEach calls vi.unstubAllEnvs(). For
// crit-7 (env-over-file), vi.stubEnv('PARALLEL_RESEARCH','false') BEFORE loadHackConfig, then assert the
// file value did NOT override.

// CRITICAL: git ls-files --error-unmatch exits NON-ZERO when untracked OR not a git repo. Treat only
// status===0 as "tracked". Tracking == present in the INDEX; `git add .hack.local` (staged, no commit) is
// sufficient for the positive test (avoids needing user.email config in a temp repo for `git commit`).

// GOTCHA: the gitignore enhancement is a REWRITE (read → compose → writeFileSync), NOT appendFileSync,
// because section insertion edits the middle of the file. Compose the full new content and write once.

// GOTCHA: dedup must win over section-placement — if `.hack.local` already exists (bare, from a prior
// T2.S1-style init), return WITHOUT rewriting (idempotent). The comment is only added on first init into
// a fresh .gitignore. Do not "fix up" existing bare lines (keeps init idempotent + predictable).

// GOTCHA: spawnSync('git', ...) needs `git` on PATH (CI + dev have it; repo-root-acceptance.test.ts already
// depends on it via makeRepo). If spawnSync sets r.error (e.g. ENOENT git binary), r.status is null ≠ 0 →
// no warning (safe). Do NOT throw on git absence.

// GOTCHA: the tracked warning is ADVISORY — it MUST NOT change validate's exit code. validate exits 1 only
// on hard content errors (secrets/type/range/parse); 0 on warnings-only (§9.7.10). Wire warnIfHackLocalTracked
// OUTSIDE the errors-collecting loop; it only writes to stderr.

// GOTCHA: vitest coverage floor applies repo-wide; the new branches in config.ts (gitignore env-section
// present/absent + create-if-absent + dedup; tracked present/absent/no-git/no-file) EACH need a test. The
// acceptance test covers the tracked branches; ensure the T2.S1 unit suite (or this acceptance suite) also
// covers the gitignore branches so config.ts stays at 100%.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The acceptance test enumerates the nine §9.7.10 criteria; helper scaffolding
mirrors `tests/integration/repo-root-acceptance.test.ts`:

```ts
// tests/integration/config/hack-config-acceptance.test.ts (sketch)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadHackConfig, SCHEMA_MAP, _resetValidationWarnings } from '../../../src/config/hack-config.js';
import { resolveRepositoryRoot } from '../../../src/utils/repo-root.js';
import { ConfigCommand } from '../../../src/cli/commands/config.js';

const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');
const makeRepo = (): string => { /* copy verbatim from repo-root-acceptance.test.ts */ };
const runCli = (args: string[], cwd: string) => spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });

const SEEDED_ENV = ['PARALLEL_RESEARCH','PRP_MODEL_BALANCED','PRP_MODEL_HIGH','PRP_MODEL_FAST','PRP_API_KEY',
  'PRP_AGENT_HARNESS','HACKY_LOG_LEVEL','RESEARCH_DEPTH','PRP_API_BASE_URL'];
beforeEach(() => { for (const k of SEEDED_ENV) delete process.env[k]; _resetValidationWarnings(); });
afterEach(() => { vi.unstubAllEnvs(); });   // global setup also calls this; harmless
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the landed src/cli/commands/config.ts (T2.S1) — confirm contract
  - CONFIRM: ConfigCommand(repoRoot).execute(action,options); private ensureGitignoreHasHackLocal(repoRoot);
    #validateAction(options, fileArg?) calls _resetValidationWarnings() then a per-file parse+validate loop.
  - NOTE the EXACT helper name + the EXACT line where #validateAction resets warnings (insertion point for
    the tracked-warning call). If names differ from this PRP, adapt — the BEHAVIOR contract is what matters.
  - DO NOT modify anything in this task; this is reconnaissance so Tasks 2–3 land cleanly.

Task 2: MODIFY src/cli/commands/config.ts — ENHANCE ensureGitignoreHasHackLocal (comment + section placement)
  - REPLACE the body of the private ensureGitignoreHasHackLocal(repoRoot) with the §7 design:
      const gi = join(repoRoot,'.gitignore'); const LINE='.hack.local';
      const BLOCK = `# .hack local overrides (never commit)\n${LINE}\n`;
      const existing = existsSync(gi) ? readFileSync(gi,'utf8') : '';
      const lines = existing.split(/\r?\n/);
      if (lines.some(l => l.trim()===LINE)) return;                       // idempotent dedup
      const envHeaderIdx = lines.findIndex(l => /^#\s*Environment files\s*$/im.test(l.trim()));
      let next: string;
      if (!existing) next = BLOCK;                                         // create-if-absent
      else if (envHeaderIdx >= 0) { const out=[...lines]; out.splice(envHeaderIdx+1,0,BLOCK.trimEnd()); next=out.join('\n')+'\n'; }
      else next = (existing.endsWith('\n') ? existing : existing+'\n') + '\n' + BLOCK;
      writeFileSync(gi, next);
  - KEEP the function private + called from #initAction exactly as T2.S1 wired it. Do NOT change its name
    or call sites. (If T2.S1 named it differently, edit that name.)
  - VERIFY: git diff shows ONLY the helper body changed; #initAction's clobber/template/guidance untouched.

Task 3: MODIFY src/cli/commands/config.ts — ADD warnIfHackLocalTracked + call it in #validateAction
  - ADD `import { spawnSync } from 'node:child_process';` (top-of-file import group, alphabetical).
  - ADD the private function warnIfHackLocalTracked(repoRoot) per the §6 design (existsSync guard;
    spawnSync git ls-files --error-unmatch .hack.local {cwd:repoRoot}; status===0 → console.error WARNING).
  - ADD a single call `warnIfHackLocalTracked(this.#repoRoot);` inside #validateAction, immediately after
    `_resetValidationWarnings();` and BEFORE the per-file lint loop. (Advisory warning; exit code unchanged.)
  - DO NOT alter the per-file errors[]/exit-code logic. The warning is purely additive stderr output.
  - VERIFY: git diff shows +1 import, +1 function, +1 call line; no other validate logic changed.

Task 4: MODIFY docs/CLI_REFERENCE.md (Mode A) — augment ### Configuration Management
  - UNDER the `init` subsection (landed by T2.S1): add a bullet/note — "`hack config init` also adds
    `.hack.local` to `<repoRoot>/.gitignore` (under a `# .hack local overrides (never commit)` comment,
    near the `# Environment files` section; idempotent; creates `.gitignore` if absent) so personal
    overrides and secrets are never committed (PRD §9.7.6)."
  - UNDER the `validate` subsection: add a bullet/note — "If `.hack.local` is tracked by git,
    `hack config validate` prints a loud **stderr** WARNING (potential secret leak, PRD §9.7.6) and
    points you at `git rm --cached .hack.local`. This is a non-fatal warning — validate still exits 0
    when only warnings occurred."
  - PRESERVE the rest of the section (show/path, exit-code note). Do not duplicate T2.S1's content.

Task 5: CREATE tests/integration/config/hack-config-acceptance.test.ts — nine §9.7.10 criteria
  - SCAFFOLD: imports + SEEDED_ENV beforeEach-delete + afterEach vi.unstubAllEnvs + makeRepo/runCli
    (verbatim from repo-root-acceptance.test.ts) + rmSync in finally for every test.
  - CRITERION 1 (committable .hack applies, bare, any subdir): temp repo; write .hack with
    [cli]mode="bug-hunt", [pipeline]parallel_research=true, [models]balanced="glm-5.2"; mkdir
    src/deep/nested; const {repoRoot}=resolveRepositoryRoot(nested); const merged=loadHackConfig(repoRoot);
    assert process.env.PARALLEL_RESEARCH==='true', process.env.PRP_MODEL_BALANCED==='glm-5.2',
    merged.cli?.mode==='bug-hunt'. (Proves repo-rooted seeding from a nested cwd, no env/flags.)
  - CRITERION 2 (init writes commented .hack + gitignores .hack.local + refuses clobber): Layer A —
    new ConfigCommand(repo).execute('init',{output:'table',force:false,src:false,global:false,local:false});
    assert .hack exists + contains all SCHEMA_MAP sections (sample: [harness],[models],[pipeline],[cli]);
    assert .gitignore contains the `# .hack local overrides (never commit)` line followed by `.hack.local`,
    positioned after a synthetic `# Environment files` header you wrote first; re-run init without force →
    expect throw/process.exit(1) (clobber refused); with force:true → overwrites. Layer B (optional) —
    runCli(['config','init'], repo) exits 0 + writes .hack + .gitignore block.
  - CRITERION 3 (show --src prints every tunable + winning layer): temp repo; .hack sets [harness]name="claude-code",
    [pipeline]research_depth=5; .hack.local sets [cli]log_level="debug"; const cmd=new ConfigCommand(repo);
    spy console.log; await cmd.execute('show',{output:'table',src:true,force:false,global:false,local:false});
    assert every SCHEMA_MAP `${section}.${key}` appears in captured stdout; harness.name→'claude-code' source
    'project'; cli.log_level→'debug' source 'project-local'; a default key (e.g. pipeline.issue_retry_max)
    source 'default'. (Masking structurally N/A — SCHEMA_MAP has no secret key; assert no [auth] leaks; the
    mask PATH is covered by the unit suite's isSecretKey test + crit-9 below.)
  - CRITERION 4 (zai_api_key refused in .hack / accepted in .hack.local; override_key seeds PRP_API_KEY):
    (a) .hack with [auth]zai_api_key="sk-secret-x" → expect loadHackConfig(repo) to THROW; assert the
    message names the file + key + §9.7.6 + remediation AND does NOT contain "sk-secret-x". (b) .hack.local
    with [auth]zai_api_key="sk-y" → loadHackConfig does NOT throw; merged.auth?.zai_api_key==='sk-y'
    (accepted, held). (c) .hack.local with [auth]override_key="sk-override" (delete PRP_API_KEY first) →
    process.env.PRP_API_KEY==='sk-override' (§9.7.6 canonical mapping).
  - CRITERION 5 (out-of-range/typo aborts before any agent): (a) .hack with [tasks_lock]poll_ms=-5 →
    loadHackConfig THROWS, message names file+section+key+value+range ('int > 0'). (b) .hack with
    [harness]name="foo" → THROWS, message lists accepted values (pi, claude-code). (Assert these fire during
    LOAD — i.e. "before any agent" — because validateHackTier runs pre-merge inside loadHackConfig.)
  - CRITERION 6 (unknown key/section → stderr warning + proceeds): .hack with [foo]x=1 and
    [pipeline]reseaerch_depth=9 → loadHackConfig does NOT throw; spy console.warn captures
    /unknown section \[foo\]/ and /unknown key \[pipeline\] reseaerch_depth/; merged.pipeline?.research_depth
    is undefined (the typo'd key ignored; no real research_depth set).
  - CRITERION 7 (env-over-file: PARALLEL_RESEARCH=false beats file true): vi.stubEnv('PARALLEL_RESEARCH','false')
    BEFORE load; .hack with [pipeline]parallel_research=true; assert process.env.PARALLEL_RESEARCH==='false'
    (shell/file-did-not-override). (Complement: without the stub, file sets it to 'true'.)
  - CRITERION 8 (subdir resolves same .hack/.env/PRD.md/plan/ — joint w/ §9.8 DONE): temp repo with .hack
    (sets [models]balanced="glm-5.2"), .env (any), PRD.md (touch), plan/ (mkdir); mkdir src/deep/nested;
    from nested: const {repoRoot}=resolveRepositoryRoot(nested); const merged=loadHackConfig(repoRoot) →
    assert merged.models?.balanced==='glm-5.2' (read repoRoot/.hack, NOT nested/.hack); process.chdir(repoRoot);
    assert resolve('PRD.md')===join(repoRoot,'PRD.md'), resolve('plan')===join(repoRoot,'plan'),
    resolve('.env')===join(repoRoot,'.env'). (Restores process.cwd in finally.)
  - CRITERION 9 (no secret value unmasked in show/debug-trace/errors): .hack.local with [auth]override_key="sk-trace-marker";
    vi.stubEnv('HACKY_LOG_LEVEL','debug'); spy console.warn; loadHackConfig(repo) → assert a trace line
    /auth\.override_key = "<redacted>"  \(source: project-local\)/ AND assert NO captured warn contains
    "sk-trace-marker". (b) repeat crit-4(a) secret refusal: assert thrown message lacks "sk-secret-x".
    (c) new ConfigCommand(repo).execute('show',{...}) on the .hack.local-with-secret repo → captured stdout
    lacks "sk-trace-marker" (show never prints [auth]).
  - COVERAGE: also cover the NEW config.ts branches (gitignore: env-section-present / absent / create-if-
    absent / dedup; tracked: present / absent / not-a-git-repo / no-file). Some overlap with T2.S1's unit
    suite is fine; ensure config.ts stays at 100%.

Task 6: VERIFY — typecheck, lint, format, targeted tests, regression, build, no-conflict
  - RUN `npm run typecheck` → exit 0.
  - RUN `npm run lint && npm run format:check` → clean (run `npm run format` if it complains).
  - RUN `npx vitest run tests/integration/config/hack-config-acceptance.test.ts` → GREEN (all 9 criteria).
  - RUN `npx vitest run tests/unit/cli/commands/config.test.ts tests/unit/config/hack-config.test.ts` → GREEN
    (T2.S1 + P2.M1 regression; the gitignore-enhancement must not break T2.S1's dedup/init tests).
  - RUN `npm run build` → compiles dist.
  - RUN `npm run validate` (or the coverage-gated equivalent) → coverage floor holds; config.ts ~100%.
  - VERIFY git diff src/cli/commands/config.ts = ADDITIVE only (gitignore helper body + 1 import + 1 fn +
    1 call); the four action methods' structure + index.ts registration untouched.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: tracked-.hack.local warning (validate, advisory, stderr, §9.6-compliant).
function warnIfHackLocalTracked(repoRoot: string): void {
  const hackLocal = join(repoRoot, '.hack.local');
  if (!existsSync(hackLocal)) return;                 // nothing on disk to leak
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '.hack.local'],
    { cwd: repoRoot, encoding: 'utf8' });
  if (r.status === 0) {                               // exit 0 ⇒ tracked in the index
    console.error(
      `[hack] WARNING: ${hackLocal} is tracked by git — potential secret leak (PRD §9.7.6). ` +
      `Untrack it with: git rm --cached .hack.local`
    );
  }
}
// Wire into #validateAction AFTER _resetValidationWarnings(), BEFORE the per-file loop.

// PATTERN: gitignore enhancement (idempotent, comment header, section-aware placement, create-if-absent).
function ensureGitignoreHasHackLocal(repoRoot: string): void {
  const gi = join(repoRoot, '.gitignore');
  const LINE = '.hack.local';
  const BLOCK = `# .hack local overrides (never commit)\n${LINE}\n`;
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  if (lines.some(l => l.trim() === LINE)) return;                       // dedup wins (idempotent)
  const envHeaderIdx = lines.findIndex(l => /^#\s*Environment files\s*$/im.test(l.trim()));
  let next: string;
  if (!existing) next = BLOCK;                                          // create-if-absent
  else if (envHeaderIdx >= 0) {
    const out = [...lines]; out.splice(envHeaderIdx + 1, 0, BLOCK.trimEnd());
    next = out.join('\n') + '\n';
  } else next = (existing.endsWith('\n') ? existing : existing + '\n') + '\n' + BLOCK;
  writeFileSync(gi, next);
}

// PATTERN: real-git-tmpdir acceptance test (copy makeRepo/runCli verbatim from repo-root-acceptance.test.ts).
const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'hack-acceptance-'));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) { rmSync(repo, { recursive: true, force: true }); throw new Error('git init failed'); }
  return repo;
};
// positive tracked-file test: spawnSync('git', ['-C', repo, 'add', '.hack.local']) stages it (index) ⇒ ls-files finds it.
```

### Integration Points
```yaml
CLI COMMAND (src/cli/commands/config.ts):  # EDIT (additive)
  - ensureGitignoreHasHackLocal: body refined (comment + section placement + create-if-absent; dedup kept)
  - warnIfHackLocalTracked: NEW private function + ONE call inside #validateAction (after _resetValidationWarnings)
  - +import { spawnSync } from 'node:child_process'
TESTS: tests/integration/config/hack-config-acceptance.test.ts (NEW — nine §9.7.10 criteria)
DOCS (Mode A): docs/CLI_REFERENCE.md ### Configuration Management — init gitignore behavior + validate tracked warning
NO DATABASE / NO NEW ENV VARS / NO NEW DEPS (child_process is a Node built-in; smol-toml/chalk/cli-table3/commander already deps)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck          # exit 0 — the gitignore rewrite + spawnSync import + acceptance imports compile
npm run lint               # eslint
npm run format:check       # prettier; run `npm run format` if it complains
# Expected: Zero errors. typecheck proves ConfigCommand edits + the acceptance-test imports
# (loadHackConfig/validateHackTier/SCHEMA_MAP/ConfigCommand/resolveRepositoryRoot) resolve.
```

### Level 2: Unit + Integration Tests (Component Validation)
```bash
npx vitest run tests/integration/config/hack-config-acceptance.test.ts   # GATED — all nine §9.7.10 criteria
npx vitest run tests/unit/cli/commands/config.test.ts                    # T2.S1 regression (gitignore dedup/init/clobber/show/validate)
npx vitest run tests/unit/config/hack-config.test.ts                     # P2.M1 regression (loader/validator/secrets)
# Expected: ALL green. The gitignore enhancement must not break T2.S1's init/dedup tests; the tracked
# warning must not break T2.S1's validate exit-code tests (it's advisory — exit code unchanged).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run build              # compiles dist — confirms no transitive breakage

# Manual smoke (from a THROWAWAY temp git repo — do NOT run inside this project dir per AGENTS.md):
#   git init /tmp/hack-smoke && cd /tmp/hack-smoke
#   node $(pwd)/node_modules/.bin/tsx $(pwd)/src/index.ts config init   # writes .hack + .gitignore block
#   cat .gitignore                                                     # → has comment + .hack.local near env section
#   echo '[auth]\nzai_api_key="sk-x"' > .hack
#   node .../tsx .../src/index.ts config validate; echo "exit=$?"      # → exit 1 (secret refused)
#   git add .hack.local 2>/dev/null; node .../tsx .../src/index.ts config validate  # → stderr WARNING (tracked)
# Expected: build succeeds; init writes the gitignore block correctly; validate refuses secrets (exit 1)
# and warns on a tracked .hack.local (stderr, exit 0 when only warnings).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Tracked-secret leak net (real git repo, the §9.7.6 safety net):
# In a temp repo: write .hack.local with a secret, `git add .hack.local`, run validate.
# EXPECT: stderr contains "is tracked by git" + "git rm --cached .hack.local"; exit code unaffected by the warning.
# (Covered programmatically by the acceptance test's tracked-file case; this is the manual confirmation.)

# §9.7.10 sweep as the Definition of Done:
npx vitest run tests/integration/config/hack-config-acceptance.test.ts --reporter=verbose
# EXPECT: nine named criteria pass (crit 1–9) on real git tmpdirs.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.
- [ ] `npx vitest run tests/integration/config/hack-config-acceptance.test.ts` green (all nine §9.7.10 criteria).
- [ ] `npx vitest run tests/unit/cli/commands/config.test.ts tests/unit/config/hack-config.test.ts` green (regression).
- [ ] `npm run build` succeeds; coverage floor holds; `src/cli/commands/config.ts` ~100% covered.

### Feature Validation
- [ ] `init` writes `.hack.local` under `# .hack local overrides (never commit)`, near `# Environment files`
      (when present), idempotent, create-if-absent.
- [ ] `validate` warns (stderr) on a tracked `.hack.local` with the `git rm --cached` remediation; silent
      when absent/untracked/non-git; exit code unchanged (advisory).
- [ ] Crit 1: committable .hack (mode/parallel_research/balanced) seeds `process.env` + merged `[cli]` from a nested cwd.
- [ ] Crit 4: zai_api_key refused in `.hack` (no value echo) / accepted in `.hack.local`; override_key seeds `PRP_API_KEY`.
- [ ] Crit 5: poll_ms=-5 / harness name=foo abort load with actionable messages.
- [ ] Crit 6: unknown section/key → stderr warn + proceeds.
- [ ] Crit 7: `PARALLEL_RESEARCH=false` (env) beats `[pipeline] parallel_research=true` (file).
- [ ] Crit 8: from `src/deep/nested/` resolves the same `.hack`/`.env`/`PRD.md`/`plan/` as root.
- [ ] Crit 9: no secret value unmasked in show / debug-trace / error messages.

### Code Quality Validation
- [ ] `config.ts` diff is ADDITIVE only (gitignore helper body + 1 import + 1 function + 1 call); action
      methods' structure + `index.ts` registration untouched (no conflict with T2.S1).
- [ ] Acceptance test follows `repo-root-acceptance.test.ts` (real `git init` tmpdirs, `spawnSync`, `realpathSync`,
      `rmSync` in `finally`, hermetic env).
- [ ] No duplication of `tests/unit/config/hack-config.test.ts` or T2.S1's command unit suite (complementary scope).
- [ ] Mode-A doc notes in `docs/CLI_REFERENCE.md` `### Configuration Management`.

### Documentation & Deployment
- [ ] `docs/CLI_REFERENCE.md` documents init's `.gitignore` behavior + validate's tracked warning (Mode A).
- [ ] No new env vars / deps / routes.

---

## Anti-Patterns to Avoid

- ❌ Don't re-implement `ConfigCommand` actions or CLI registration — that's T2.S1 (landed first). Only
   ENHANCE the gitignore helper + ADD one tracked-warning call.
- ❌ Don't add `[auth] zai_api_key → PRP_API_KEY` seeding — not in §9.7.6 (only `override_key` maps).
   zai_api_key is the secret-presence example (refused in `.hack`, accepted in `.hack.local`); test
   override_key→PRP_API_KEY for the "seeds PRP_API_KEY" half of crit 4.
- ❌ Don't make the tracked-file warning a hard error — PRD §9.7.3 says "warn loudly"; validate exits 0
   on warnings-only. The warning must not flip the exit code.
- ❌ Don't call `git ls-files` without guarding `r.status === 0` — it exits non-zero when untracked OR
   not a git repo; only status 0 means tracked.
- ❌ Don't use `appendFileSync` for the gitignore enhancement — section insertion edits the file's middle;
   read → compose → `writeFileSync` once.
- ❌ Don't "fix up" an existing bare `.hack.local` line — dedup must win (idempotent init). The comment is
   added only on first init into a fresh `.gitignore`.
- ❌ Don't run the full pipeline to prove crit 1 — infeasible in tests. Prove the config-SEEDING layer
   (`process.env` seeded + merged `[cli]` carried) is repo-rooted + subdir-independent; the `--mode`
   Commander-default wiring is a separate concern.
- ❌ Don't duplicate the unit suite (`tests/unit/config/hack-config.test.ts`, T2.S1's command suite) — the
   acceptance test is COMPLEMENTARY (cross-subsystem + real repo + nested cwd + the two spec gaps).
- ❌ Don't rely on ambient env in acceptance tests — `tests/setup.ts` loads `.env`; delete seeded vars in
   `beforeEach` and use `vi.stubEnv`/`vi.unstubAllEnvs` for the env-over-file cases.
- ❌ Don't echo a secret value in any assertion-positive path — `validateHackTier` never echoes secrets
   (caught before `validateFieldValue`); assert the literal secret string is ABSENT from thrown messages,
   the debug trace (masked `"<redacted>"`), and `show` stdout.

---

## Confidence Score

**8.5/10** — One-pass success likelihood is high. The two code edits are small, additive, and disjoint
from T2.S1's structure (enhance one private helper body; add one private function + one call). The
consumed config layer (`loadHackConfig`/`validateHackTier`/`SCHEMA_MAP`/`seedAuthOverrideKey`) is fully
landed and its exact behavior is documented (research §2, incl. the auth-seeding truth that reconciles
the §9.7.10 crit-4 wording). The acceptance test follows a proven gold template
(`repo-root-acceptance.test.ts`) with `makeRepo`/`runCli`/`spawnSync`/`realpathSync`, and each of the
nine criteria maps 1:1 to a concrete test (research §5). The two residual risks: (1) **T2.S1's actual
`config.ts` may name/structure the gitignore helper or `#validateAction` slightly differently than its
PRP** — mitigated by Task 1 (read-first reconnaissance) and by specifying the BEHAVIOR contract rather
than fragile line numbers; (2) **coverage of the new `config.ts` branches** — the gitignore
env-section-present/absent/create-if-absent/dedup and tracked present/absent/non-git/no-file branches
each need a test; the acceptance suite covers the tracked branches, and the implementer must ensure the
gitignore branches are covered (acceptance crit-2 + a couple of explicit branch tests, or T2.S1's unit
suite) so `config.ts` stays at ~100%. No new deps; `child_process` is built-in and already used across
`src/utils`.