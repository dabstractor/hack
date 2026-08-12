# P1.M4.T3.S1 Research — Remote-Mutation Prohibition in Agent FORBIDDEN OPERATIONS

> Project 015 "Commit Generation & Agent Tool Safety" · PRD §9.10.3 / §5.2. **Prompt-text change**
> (Mode A — "the prompt edits themselves are the documentation"). No `src/` logic, no tools, no tests
> authored here; ONLY prompt text in `src/agents/prompts.ts` + `PROMPTS.md`.

## The deliverable, precisely

Add the remote-mutation prohibition (verbatim wording in PRP §"Implementation Tasks") to **every
FORBIDDEN OPERATIONS / FORBIDDEN ACTIONS section** so no agent is ever *told* it may mutate the repo
remote / default branch. (P1.M4.T1.S1 already removes the *capability* via the bash denylist;
P1.M4.T2.S1 already removes it via the per-role tool matrix. This item is the **prompt-layer**
prohibition — defense-in-depth at the instruction level, mandated by PRD §9.10.3 "this rule is added
to the §5.2 Universal Forbidden Operations.")

## Verified location map (read from source)

### `src/agents/prompts.ts` (1362 lines) — 4 "FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)" sections
Each ends with a `## ` next-section header that is the precise insertion anchor:

| # | Line | In prompt constant | Agent / PRD role | Ends right BEFORE | Insert AFTER |
|---|------|--------------------|------------------|-------------------|--------------|
| 1 | 209  | `PRP_BLUEPRINT_PROMPT` (starts :197) | Research / Planner | `## MULTI-PRP BATCHING POLICY` | the `Pipeline-state files … **NOT temporary** — do not delete them.` para |
| 2 | 699  | `PRP_BUILDER_PROMPT` (starts :694)   | Implementation / Coder / **post-validation fix** | `## Mission: One-Pass Implementation Success` | the `Pipeline-state files … **NOT temporary** — do not delete them.` para |
| 3 | 1091 | `BUG_HUNT_PROMPT` (starts :986)      | **Bug hunter** (Adversarial QA) | `## Output - IMPORTANT` | the `Pipeline-state files … **NOT temporary** — do not delete them.` para |
| 4 | 1209 | `CLEANUP_PROMPT` (starts :1187)      | **Cleanup** (the one licensed to delete) | `## Operational Notes` | the `Read-only \`git\` inspection (e.g. \`git status\`) is fine.` para |

NOTE: sections 1–3 share identical deletion-protection text ending in "do not delete them."
Section 4 (CLEANUP) has bespoke wording (extra bullets incl. the `git commit`/`git add` ban) ending
in "Read-only `git` inspection … is fine." Insert the prohibition AFTER that final paragraph in each.

The 4 prompts map 1:1 to the contract's "deletion-capable agent prompts": cleanup→CLEANUP,
bug-hunter→BUG_HUNT, post-validation fix→PRP_BUILDER, and research/planner (PRP_BLUEPRINT) also
carries a FORBIDDEN ACTIONS section so part (a) "every FORBIDDEN OPERATIONS section" includes it.
There is NO 5th deletion section — `DELTA_ANALYSIS_PROMPT` (:861) and `VALIDATION_PROMPT` (:1131)
have NO FORBIDDEN ACTIONS section (verified by grep). So **exactly 4 inserts in prompts.ts**.

### `PROMPTS.md` (1220 lines) — the 4 mirror sections (PROMPTS.md is the human-readable prompt source)
| # | Line | Section | Maps to prompts.ts |
|---|------|---------|--------------------|
| A | 208  | `## 4. PRP_CREATE_PROMPT (The Researcher)`  | PRP_BLUEPRINT_PROMPT |
| B | 670  | `## 5. PRP_EXECUTE_PROMPT (The Builder)`    | PRP_BUILDER_PROMPT |
| C | 760  | `## 6. CLEANUP_PROMPT`                      | CLEANUP_PROMPT |
| D | 1103 | `## 11. BUG_FINDING_PROMPT (Adversarial QA)`| BUG_HUNT_PROMPT |

⚠️ **DIVERGENCE (verified):** PROMPTS.md does **NOT** currently contain the "FORBIDDEN ACTIONS —
Critical-File Deletion Protection" sections at all (grep for `Critical-File`/`FORBIDDEN ACTIONS` in
PROMPTS.md → only the unrelated §9.9 negative-gate refs at :289/:293). The deletion-protection text
lives ONLY in prompts.ts. ⇒ For the "Mirror in PROMPTS.md" instruction, add the remote-mutation
prohibition as a clearly-marked new subsection inside each of the 4 PROMPTS.md prompt sections
(A–D). (Bringing the full Critical-File deletion text into PROMPTS.md is out of scope — this item
mirrors ONLY the remote-mutation prohibition, per the contract's (c).)

## Tests that assert on this prompt text (must stay GREEN — appending is safe for `toContain`)
```
tests/unit/agents/prompts/bug-hunt-prompt.test.ts
tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
tests/unit/agents/prompts.test.ts
tests/unit/agents/cleanup-agent.test.ts            # also touched by P1.M4.T2.S1 (tool matrix) — DISJOINT concern
tests/integration/prp-execute-prompt.test.ts
tests/integration/bug-finding-prompt.test.ts
```
These use `expect(PROMPT).toContain(...)` substring checks for STRUCTURE (section headers, key
phrases). Appending a new prohibition block does NOT break `toContain`. ⚠️ But scan each for any
strict-equality / length / exact-block assertion on the affected section BEFORE editing; if one
exists, the addition must be reflected there (do NOT weaken it). Run each after editing.

## Coordination (parallel items — DISJOINT, no file overlap)
- **P1.M4.T1.S1** (bash denylist) edits `src/tools/bash-mcp.ts` only — landed, do not touch.
- **P1.M4.T2.S1** (per-role tool matrix) edits `src/tools/git-mcp.ts` + `src/agents/agent-factory.ts`
  + 4 test files — DISJOINT from prompts.ts / PROMPTS.md. The cleanup-agent.test.ts overlap is
  incidental (that test asserts the tool set, not prompt text); this item does not edit it.
- **This item (T3.S1)** touches ONLY `src/agents/prompts.ts` + `PROMPTS.md`. No overlap.

## Verbatim prohibition wording (from the contract — use this text)
> NEVER run any remote-mutating git/GitHub command: `git push`, `git remote`, `git update-ref`,
> `gh repo` (any subcommand), `gh api -X PATCH|POST|DELETE`, `curl`/`wget` to `api.github.com`, or
> any reference to `default_branch`. These are human-only operations. No agent reaches git through
> the bash tool — use structured git tools only.

Plus the DOCS citation (§9.10.3): "Repo-remote-mutating operations are never exposed as any agent
tool, in any role. These are human-only operations, and this rule is added to the §5.2 Universal
Forbidden Operations."

## Why append (not rewrite) each section
Each existing FORBIDDEN ACTIONS section is load-bearing (deletion protection, PRD §5.1) and is
asserted on by tests. The remote-mutation prohibition is an ADDITIONAL prohibition layer (PRD §9.10.3)
— it does not replace the deletion text. Append a clearly-headed block citing §9.10.3 so it is
discoverable and grep-verifiable, leaving all existing text intact.

## Validation approach
- Static gates: `npm run typecheck && npm run lint && npm run format:check` (prompts.ts is TS — a
  template-literal edit must stay type/lint/format clean; PROMPTS.md is markdown, lint/format only).
- Prompt-content tests green (the 6 files above).
- Grep verification: each of the 4 prompts.ts sections + 4 PROMPTS.md sections contains the
  prohibition markers (`git push`, `gh repo`, `default_branch`, `§9.10.3`).