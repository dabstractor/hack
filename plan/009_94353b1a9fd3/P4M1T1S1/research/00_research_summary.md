# Research Summary — P4.M1.T1.S1: README + ARCHITECTURE + CONFIGURATION changeset-level sync

Source scouts: `scout1-readme-docs.md`, `scout2-architecture-doc.md`,
`scout3-config-source.md`. This file distills the load-bearing facts for PRP authoring.

## VERDICT — purely additive documentation; the "stale framing" sweep is a NO-OP

The contract's RESEARCH NOTE warned the docs "may have stale 'must run from repo root'
framing." **All three scouts grepped exhaustively and found ZERO stale framing.**
- README.md: 0 matches for `must run from|run from the root|cwd|current working directory|from the project root|cd into` (only `cd hacky-hack` in clone sequences — not stale).
- ARCHITECTURE.md: 1 match for `process.cwd()` at L838 — **accurate, not stale** (it returns the repo root *because* of the bootstrap chdir).
- CONFIGURATION.md: 0 matches for `.hack|TOML|cwd|must run from` — `.hack` is entirely absent.

**This is an ADDITIVE task** (new sections + one precedence-list expansion), not a rewrite.
The implementer should still RUN the stale-framing greps as a Level-4 validation gate (to
prove nothing was missed and nothing stale was introduced), but no prose deletion is required.

## SCOPE — three docs, six edits; Mode B (this IS the documentation task)

Contract item 3 specifies three docs. The scouts mapped exact insertion points:

| Doc | Edit | Scout finding | Insertion point |
|-----|------|---------------|-----------------|
| README.md | (a) `.hack` Configuration section | `## Configuration` ALREADY exists (L324-545, env-var focused) → add a `###` subsection (NOT a second top-level — preserves `#configuration` anchors at L81/L106) | New `### The .hack Configuration File` as FIRST subsection under `## Configuration` (between L324 and L326) |
| README.md | (a) "Running from anywhere" note | No such content exists | New `## Running from Anywhere` between L106 and L108 (after Quick Start) |
| README.md | (a) Breakdown-in-progress mention | Extend EXISTING `### Task Status (hack status / hack task)` (L263-280) — don't create new section | `>` blockquote after the fenced bash block (after L279, before L281) |
| ARCHITECTURE.md | (b) Bootstrap-layer section | NO bootstrap/main()/parseCLIArgs content exists → purely additive | New `## Bootstrap Layer` between L82 (end System Flow) and L84 (`## Resolved-Document Invariant`); add ToC bullet at L13 |
| CONFIGURATION.md | (c) `.hack` as PRIMARY config | `.hack` entirely absent | New `## .hack Configuration File` between L53 (end Quick Ref) and L55 (`## Environment Variables`) |
| CONFIGURATION.md | (c) 7-layer precedence | `## Configuration Priority` (L405-411) has a STALE 4-layer list → REWRITE to 7-layer §9.2.1 | Replace L407-411 numbered list |
| CONFIGURATION.md | (c) Task/status + breakdown exit code | NO task/status section exists → create | New `## Task & Status Commands` (after `## CLI Options` L303, or before `## See Also` L698) |
| CONFIGURATION.md | (c) PRP_COMMIT_FORMAT reconcile | ALREADY documented at L165 → cross-ref `.hack [pipeline] commit_format` | Edit L165 row |

## Implementation ground truth (verified by scout3 against live source)

### Bootstrap ordering (src/index.ts main(), the ARCHITECTURE.md content)
```
parseCLIArgs()                                    src/cli/index.ts
  → INVOCATION_CWD = process.cwd()                src/index.ts L64
  → resolveRepositoryRoot(INVOCATION_CWD, {explicit?})  src/utils/repo-root.ts L152  (§9.8)
  → process.chdir(repoRoot)                       src/index.ts L146  (single bootstrap chdir)
  → PRD-exists check                              src/index.ts L148-155
  → loadHackConfig(repoRoot)                      src/config/hack-config.ts L799  (§9.7)  src/index.ts L165
  → configureEnvironment()                        src/index.ts L168
  → getLogger / setupGlobalHandlers
  → configureHarness()  (singular — doc L391 shows plural drift to flag)
  → runAuthPreflight()  → ensureHarnessInitialized()
  → new PRPPipeline(...) + pipeline.run()
```
**Ordering rationale (load-bearing):** `.hack` loads AFTER the chdir (project files live at
repoRoot) and BEFORE `configureEnvironment()` (so seeded values are visible to the env
resolver). Env-over-file: `seedProcessEnv` fills ONLY `undefined` env keys (real env — even
empty — wins over file).

### resolveRepositoryRoot (src/utils/repo-root.ts) — the ARCHITECTURE content
- Signature (L152-156): `resolveRepositoryRoot(startDir, opts?: {explicit?}): {repoRoot, invocationCwd}`
- `NotARepositoryError` (L52-90): `.searchedFrom`, `.explicit`, message bakes `--repo-root` remediation.
- Traversal (L191-205): `existsSync(join(dir,'.git'))` — true for `.git` as **dir** (clone) AND **file** (worktree/submodule `gitdir:`). **Nearest ancestor wins** (inner repo beats outer). Root reached without `.git` → throw.
- Explicit (L213-219): resolve absolute, verify `.git`, else throw `NotARepositoryError({explicit:true})`.
- `realpathSync` canonicalizes. Module singletons: `getRepoRoot()` (L171), `getInvocationCwd()` (L184).

### .hack loader (src/config/hack-config.ts) — the README + CONFIGURATION content
- `parseHackFile(path): ParsedHackConfig` (L80) — UTF-8, REJECTS BOM, rethrows TomlError naming file+line.
- `loadHackConfig(repoRoot): MergedHackConfig` (L799) — 3-tier discovery + merge + seed + validate.
- `globalHackPath()` (L506): `$HACK_CONFIG_HOME/config` → `$XDG_CONFIG_HOME/hack/config` → `~/.hack`.
- 3 tiers (lowest → highest): global → project `<repoRoot>/.hack` (committable) → project-local `<repoRoot>/.hack.local` (gitignored). Missing file = not an error.
- **Env-over-file** (`seedProcessEnv` L549-561): set `process.env[ENV]` ONLY if `=== undefined`. Coerce via `String()`. CLI-only keys not seeded.
- **Secrets policy** (`validateHackTier` + `isSecretKey` L666-693): key ending `_key|_token|_secret|_password`. Non-empty secret in committable tier (global/project) → HARD ERROR. Empty → "not configured", skipped. `.hack.local` is the ONLY secrets-allowed tier.
- **Validation**: unknown section → WARN (continue); unknown key in known section → WARN (ignore, catches typos); type/range/enum mismatch → HARD ERROR (exit 1). All warnings/errors → **stderr synchronously** (§9.6; pino configured AFTER config load since `--log-level` may come from `.hack`).
- `SCHEMA_MAP` (L155-380): exhaustive `HackConfigSchemaEntry[]` — the §9.7.5 schema reference (each row: section/key/envVar?/cliFlag?/type/defaultValue?/acceptedValues?). **This is the data source for the CONFIGURATION.md schema table.**
- **`hack config` subcommand** (src/cli/commands/config.ts + src/cli/index.ts L567-571): `init [--force]` (write commented template, refuse clobber, ensure `.hack.local` in `.gitignore`), `show [--src] [-o table|json]` (effective merged config, secrets masked), `validate [<file>]` (CI gate, exit 1 on errors), `path [--global|--local]`.

### PRP_COMMIT_FORMAT (src/config/constants.ts) — the CONFIGURATION reconcile
- `PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT'` (L439); `DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix'` (L449); `PrpCommitFormat = 'task-prefix'|'plain'` (L459); `getPrpCommitFormat(): PrpCommitFormat` (L482) — single read site.
- `.hack` mapping: `[pipeline] commit_format` (SCHEMA_MAP L245-252, envVar `PRP_COMMIT_FORMAT`, acceptedValues `['task-prefix','plain']`).
- ALREADY documented in CONFIGURATION.md L165 → cross-ref the `.hack` key (no new content, just a cross-link).

### Breakdown-in-progress (PRD §5.3, the README + CONFIGURATION content)
- `hack status`/`hack task`/`hack task next` against a session whose dir exists but `tasks.json` is absent → calm stderr notice, **exit 0** (PRD §5.3 acceptance criteria).
- `--output json` → `{ "status": "awaiting_breakdown", "session": "NNN_hash" }`, exit 0.
- `--file /nonexistent` → still hard error (explicit override not softened).
- No sessions at all → still non-zero "No sessions found".
- Distinct from §5.1 corruption recovery (present-but-corrupt) and §4.4 interrupted-bugfix re-entry.

## The 7-layer §9.2.1 precedence (to replace CONFIGURATION.md L407-411 4-layer list)
Highest → lowest:
1. CLI flags (Commander; read THROUGH env via `.default(process.env.X ?? …)`) — **NOTE: scout3 listed this ambiguously; the §9.2.1 canonical order is CLI > shell-env > .env > .hack.local > .hack > global-.hack > defaults. Use the PRD §9.2.1 order as authoritative; the env-over-file rule means real env (shell + .env) wins over .hack tiers.**
2. Shell environment (real exported env vars — even empty — win over file)
3. `.env` file (loaded into env by shell/harness)
4. `.hack.local` (`<repoRoot>/.hack.local` — gitignored; secrets allowed)
5. `.hack` (`<repoRoot>/.hack` — committable; no secrets)
6. Global `.hack` (`~/.hack` | XDG | `$HACK_CONFIG_HOME`)
7. Default values (hardcoded in constants.ts)

> **Env-over-file rule:** `.hack` tiers seed `process.env` ONLY when the key is `undefined`.
> A real env var (shell or `.env`) — even empty — is already "set" and wins over the file.
> `.hack` fills gaps; it never overrides real env.

## House styles to mirror (so new sections match)
- **README.md**: fenced `bash` blocks (comment+command pairs), pipe tables, `>` blockquote callouts, inline `(PRD §X.Y)`, links to `docs/<FILE>.md#anchor`. Bare `hack …` for subcommands; `npm run dev -- …` for pipeline.
- **ARCHITECTURE.md**: `## Heading` + bold purpose + `**Location**: [src/...]` + mermaid diagrams (`flowchart`/`stateDiagram`/`graph`) + GFM tables + `>` callouts + `(PRD §X.Y)` (sub-section precision like §9.8.2). `---` dividers between `##` sections. ToC at L13-23.
- **CONFIGURATION.md**: pipe tables (env-var 4-col `Variable|Required|Default|Description`; CLI 4-col), numbered precedence lists with bold lead-ins, per-section `### [topic]` tables. ToC at L9-37.

## CRITICAL cross-doc consistency requirements
- **Three docs must cross-reference each other consistently**: README `.hack` section → link to `docs/CLI_REFERENCE.md` (which already fully documents `hack config` at L205-276) AND the new `docs/CONFIGURATION.md#...hack-configuration-file` section. ARCHITECTURE bootstrap section → defer the full `.hack` schema table to CONFIGURATION.md (house pattern: "ARCHITECTURE.md does not duplicate that table," L627). CONFIGURATION `.hack` section → cite `(PRD §9.7)` for the authoritative schema.
- **ToCs must be updated** for every new `##` section (README has no formal ToC; ARCHITECTURE ToC L13-23; CONFIGURATION ToC L9-37) — or internal anchors break.
- **PRD citations**: use the established `(PRD §9.7)`, `(PRD §9.8)`, `(PRD §5.3)` / `(PRD §5.1)` forms. Sub-section precision (§9.8.2, §9.7.3, §9.7.9) matches house style.

## Validation (the gate)
- `npm run validate` = lint + format:check + typecheck + test:run (docs-only changes → no test/typecheck impact, but format:check applies to .md via prettier `**/*.{ts,js,json,md,yml,yaml}`).
- `npm run format:check` — prettier checks .md files (the `.prettierignore` may exclude some; verify). Run `npm run format` if it complains.
- `npm run lint:md` or `markdownlint` if configured (`.markdownlint.json` exists at repo root — check if docs/ is linted).
- **Level-4 stale-framing gate**: re-run the greps (`must run from|run from the root|cwd|from the project root`) across all three docs to PROVE no stale framing remains (and none was introduced).
- **git diff --name-only** must show EXACTLY: `README.md`, `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md` (3 files, Mode B — no source, no tests).

## Files S1 touches (the diff)
MODIFY: `README.md`
MODIFY: `docs/ARCHITECTURE.md`
MODIFY: `docs/CONFIGURATION.md`
NO source files, NO tests, NO PRD.md, NO package.json (smol-toml already a dep).