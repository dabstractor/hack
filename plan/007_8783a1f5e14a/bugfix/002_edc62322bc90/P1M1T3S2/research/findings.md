# Research Findings — P1.M1.T3.S2 (docs sync for bugfix 002)

> Mode B docs task. Source changes P1.M1.T1/T2 are COMPLETE. Sibling P1.M1.T3.S1 (README.md) is
> COMPLETE and sets the established convention (surgical edits, tone-matched, prettier-clean).
> This task owns the THREE docs/*.md files ONLY (README.md is off-limits — done by S1).

## Verified as-built behavior (src — READ-ONLY evidence; docs must describe THIS)

`src/index.ts` main() ordering (confirmed by grep):
- 127 `configureEnvironment();`
- 130 root logger created (moved up, independent of creds/harness)
- 142 `if (args.dryRun)` → 143 logs `🔍 DRY RUN - would execute with:` → returns 0
- 156 `if (args.validatePrd)` → 167 logs `Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}` →
  returns `result.valid ? 0 : 1`
- 207 `configureHarness();` (explicit, AFTER local-mode early-returns)
- 212 `await runAuthPreflight();`
- 217 `await ensureHarnessInitialized();`
→ `--validate-prd` / `--dry-run` early-return BEFORE any credential/harness work → credential-free.

`src/index.ts` main().catch() (334-344): renders BOTH `AuthPreflightError` (335) AND
`HarnessProviderMismatchError` (339) as `❌ <message>` + `process.exit(1)` — clean one-liner.
The pre-fix raw `Node.js v26.2.0` stack banner is GONE (configureHarness moved out of module-eval).

`src/config/types.ts:155` HarnessProviderMismatchError message (EXACT — reference in docs):
```
Harness 'claude-code' is incompatible with provider 'zai' (PRD §9.2.4). Switch the harness to 'pi'
(PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.
```
`src/config/types.ts:229` AuthPreflightError prefix (EXACT):
`Authentication preflight failed: no credential configured for provider '<provider>'`

## IMPORTANT consistency bug to fix within scope (CLI_REFERENCE.md Exit Codes)
`docs/CLI_REFERENCE.md` line 243 says:
> **2 (VALIDATION_ERROR)**: PRD validation failed when using `--validate-prd` or `--mode validate`.
This is WRONG for `--validate-prd`: actual behavior is exit 1 (ERROR) for an invalid PRD, exit 0 for
valid (src/index.ts `return result.valid ? 0 : 1`). The contract says: "ensure the exit-code table
(~line 243) is consistent (exit 0 valid / 1 invalid for --validate-prd is unchanged)." → So remove
the claim that `--validate-prd` yields code 2; it yields 1. (Keep code 2 mention only if a code-2
path genuinely exists — it does not for the CLI; treat the whole row as needing the consistency fix.)

## Pinned doc anchors (exact current strings for find/replace)

### docs/CLI_REFERENCE.md
- Quick Ref table: line 42 `--dry-run` row, line 44 `--validate-prd` row (minor; skip unless trivial).
- Special Modes — "Dry Run (Preview)": line 127 cmd, line 133 block; line ~134-142 "PRD Validation
  Only" → line 142: "Validates the PRD syntax and structure without running the pipeline. Exits with
  code 0 if valid, 1 if invalid." (CORRECT — keep; optionally add "no credential required".)
- Boolean Flags table: line 184 `--dry-run`, line 189 `--validate-prd` (Descriptions).
- Flag Details: line 195 `--dry-run` bullet = "Parses the PRD and validates the execution plan
  without running any agents. Displays what would be executed."
- Flag Details: line 205 `--validate-prd` bullet = "Validates PRD structure and exits. Returns exit
  code 0 if valid, 1 if invalid. Equivalent to `--mode validate`."
- Exit Codes: line 222 header; line 243 = the code-2 INCONSISTENCY (see above).

### docs/CONFIGURATION.md
- line 127 (Agent Runtime Harness section): "...The pipeline validates this at startup and fails fast
  with a configuration error." → refine: gates AGENT runs only; --validate-prd/--dry-run exempt.
- Boolean Flags table: line 209 `--dry-run`, line 214 `--validate-prd` (Descriptions).
- Common Gotchas "Using claude-code with a z.ai key": line 534 "Startup fails fast with a
  harness/provider configuration error." → note the clean one-line error + exit 1 (no stack trace).
- Quick Reference footnote (~line 26): "Required: Either ZAI_API_KEY, pi /login (...), or
  PRP_API_KEY must be set for the default path." → add local-mode exemption sentence.

### docs/INSTALLATION.md
- Quick Start step 4 "Configure authentication" (line 65): onboarding sequence. The bug restored
  --validate-prd as a credential-free FIRST step. Reflect that a user may lint their PRD BEFORE auth.
- "Authentication at startup" block (line 302-318): currently accurate about agent runs ("aborts ...
  before any session directory is created or any agent is invoked (PRD §9.2.7)") but omits the local-
  mode exemption. Add the exemption (note --validate-prd/--dry-run bypass the preflight).
- Troubleshooting "Startup fails with 'Authentication preflight failed'" (line ~458 block) is accurate.

## Out of scope (do NOT touch — surgical only)
- INSTALLATION.md Quick Start .env example (line ~84) shows stale `ANTHROPIC_AUTH_TOKEN=zk-xxxxx`
  (the default path uses ZAI_API_KEY). That staleness is PRE-EXISTING and NOT in this task's contract
  ("Keep edits surgical; do not reformat unrelated content"). Leave it. (Flag for a separate pass.)
- README.md — owned by P1.M1.T3.S1 (COMPLETE). Do not touch.
- Any source code, .env.example, tests.

## Style/convention (from sibling S1)
- Tone: short, imperative, code-fenced remediations, bold inline `code` for env/flag names.
- All three docs are in the prettier glob `**/*.{ts,js,json,md,yml,yaml}` → `npm run format:check`
  MUST pass (pipe-aligned tables, consistent blank lines). markdownlint-cli is a devDep → optional.
- Do NOT paste the pre-fix raw Node stack trace (Issue 2) — stale.
- Do NOT claim `--validate-prd` "always exits 0" — it exits 1 on an INVALID PRD (validity, not auth).
- Do NOT conflate `--validate-prd` (standalone boolean, src/cli/index.ts) with `--mode validate`.
