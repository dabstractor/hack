# Research Notes — P1.M1.T4.S1

## Add .gitignore scaffolding mandate to TASK_BREAKDOWN_PROMPT + PROMPTS.md

A prompt-text change (Mode A — the edit is the documentation). Two deliverables:
1. Add a baseline-`.gitignore` scaffolding mandate to `TASK_BREAKDOWN_PROMPT` in
   `src/agents/prompts.ts` (the LIVE prompt) + mirror it in `PROMPTS.md`.
2. Terminology cleanup: rename the surviving `stagecoach`-as-in-process-tool wording in
   the CLEANUP_PROMPT §4.2 comments → "Smart Commit".

---

## 1. TASK_BREAKDOWN_PROMPT structure (src/agents/prompts.ts:47–181)

```
# LEAD TECHNICAL ARCHITECT & PROJECT SYNTHESIZER
> ROLE / CONTEXT / GOAL
## HIERARCHY DEFINITIONS
## CRITICAL CONSTRAINTS & STANDARD OF WORK (SOW)
  ### 1. RESEARCH-DRIVEN ARCHITECTURE (NEW PRIORITY)   [4 bullets incl. READ THE PRD FIRST, NEVER LOOP ON SUBAGENT CALLS]
  ### 2. COHERENCE & CONTINUITY
  ### 3. IMPLICIT TDD & QUALITY
  ### 4. THE "CONTEXT SCOPE" BLINDER
  ### 5. DOCUMENTATION SYNC (TWO MODES)                 ← MODE A / MODE B rule
## PROCESS
  1. ANALYZE  2. RESEARCH  3. DETERMINE  4. DECOMPOSE
## OUTPUT FORMAT  (JSON → ./$TASKS_FILE)
```

**Placement decision:** add the mandate as **SOW #6 BASELINE `.gitignore` SCAFFOLDING
(FIRST SUBTASK)** — immediately after #5 Documentation Sync. Rationale:
- SOW ("CRITICAL CONSTRAINTS & STANDARD OF WORK") is the home for decomposition MUST-rules;
  #5 Documentation Sync is the exact precedent (another decomposition-constraining rule).
- The contract allows "near the DECOMPOSE step OR the toolchain/scaffold section" — a SOW
  numbered constraint is the most visible, semantically-correct home for a "MUST include a
  first subtask" mandate.
- Avoids disturbing PROCESS step 4 / OUTPUT FORMAT.

## 2. PROMPTS.md has DRIFTED from prompts.ts (pre-existing — NOT our job to re-sync)

PROMPTS.md (`# LEAD TECHNICAL ARCHITECT …` starts ~L60) mirrors an OLDER snapshot of the
prompt:
- PROMPTS.md SOW #1 has only 4 bullets (VALIDATE / SPAWN SUBAGENTS / REALITY CHECK /
  PERSISTENCE). **Missing** the prompts.ts bullets "READ THE PRD FIRST; SUBAGENTS ARE
  OPTIONAL" and "NEVER LOOP ON SUBAGENT CALLS".
- PROMPTS.md **has NO SOW #5 (Documentation Sync Two Modes)** — it jumps #4 → ## PROCESS.

**Implication for numbering:** the .gitignore mandate becomes SOW **#6 in prompts.ts**
(after #5) but SOW **#5 in PROMPTS.md** (next after its #4). The heading NUMBER differs
between the two files due to pre-existing drift; the MANDATE TEXT must be identical in both
(that is what the contract's "mirror the same text" requires). Do NOT renumber or re-sync the
rest of PROMPTS.md — that drift is out of scope (it would be a large unrelated diff).

## 3. Copy-ready mandate text (use verbatim in BOTH files — the contract's wording)

As a SOW section (prompts.ts → `### 6.`; PROMPTS.md → `### 5.`):

```markdown
### 6. BASELINE `.gitignore` SCAFFOLDING (FIRST SUBTASK)

- **MANDATE:** The decomposition MUST include a FIRST, dependency-root scaffolding subtask
  that creates — or, if one exists, **extends (never overwrites)** — a baseline `.gitignore`
  at the repo root, before any feature implementation subtask. (PRD §4.1 step 4 + §5.1
  "Baseline `.gitignore` (breakdown scaffolding)".)
- **MINIMUM COVERAGE:** language/framework dependency directories (e.g. `node_modules/`),
  build/output directories (e.g. `dist/`, `build/`), and common OS/IDE cruft (e.g.
  `.DS_Store`, `Thumbs.db`).
- **PROTECTED — NEVER GITIGNORED:** `plan/`, `PRD.md`, and any task files (`*tasks*.json`).
  The baseline `.gitignore` MUST respect this.
- **WHY:** the pipeline commits the working tree via Smart Commit; an unignored dependency
  tree overflows `ARG_MAX` during staging and strands task substance. This scaffold subtask
  prevents that failure at the source.
```
(Adjust the leading `### 6.` / `### 5.` per file; the bullet text is identical.)

## 4. Terminology cleanup — stagecoach → Smart Commit (2 spots, both §4.2 CLEANUP_PROMPT)

`grep -n "stagecoach" src/agents/prompts.ts` → exactly TWO hits, BOTH in the CLEANUP_PROMPT
region (which implements PRD §4.2 step 4). Post-§9.10.1, "stagecoach" is a MESSAGE-ONLY
binary; the COMMIT itself is Smart Commit. So wording that says "stagecoach … performs the
commit" / "stagecoach post-cleanup commit" is the "stagecoach-as-in-process-tool" wording the
contract wants renamed.

### Spot 1 — JSDoc above CLEANUP_PROMPT (prompts.ts:~1167)
BEFORE: `… it MUST NOT \`git commit\` / \`git add\` — the orchestrator's stagecoach
(P3.M1.T3.S1) performs the post-cleanup commit. A self-committing …`
AFTER:  `… it MUST NOT \`git commit\` / \`git add\` — the orchestrator's Smart Commit performs
the post-cleanup commit. A self-committing …`
(Drop the stale `(P3.M1.T3.S1)` parenthetical — it references the removed in-process
commit-message agent task; Smart Commit is not tied to it.)

### Spot 2 — CLEANUP_PROMPT body, FORBIDDEN ACTIONS (prompts.ts:~1210)
BEFORE: `You **MUST NOT** run \`git commit\` or \`git add\` — the orchestrator commits your
reorganization via the stagecoach post-cleanup commit. Committing yourself causes a
double-commit race.`
AFTER:  `You **MUST NOT** run \`git commit\` or \`git add\` — the orchestrator commits your
reorganization via the Smart Commit post-cleanup commit. Committing yourself causes a
double-commit race.`

No other `stagecoach` mentions exist in prompts.ts. The §5.1 FORBIDDEN ACTIONS sections
(PRP_BLUEPRINT/PRP_BUILDER/BUG_HUNT) already say "Smart Commit" — nothing to change there.
NOTE: these edits are to the `CLEANUP_PROMPT` constant's text + its JSDoc — they are within
`src/agents/prompts.ts`, the SAME file as deliverable #1, so they ride in this task. Do NOT
mirror the CLEANUP_PROMPT wording in PROMPTS.md (the contract's mirror requirement is scoped to
the .gitignore mandate; the CLEANUP_PROMPT has "no PROMPTS.md source" per its own JSDoc at
L1170 — "Source: authored for P3.M1.T3.S3 (no PROMPTS.md source)").

## 5. Test safety — additions do NOT break existing prompt tests

`tests/integration/task-breakdown-prompt.test.ts` and
`tests/unit/agents/prompts/architect-prompt.test.ts` assert prompt content with
`expect(TASK_BREAKDOWN_PROMPT).toContain('<substring>')` — substring PRESENCE only. There are
**no** `.not.toContain`, `.toHaveLength`, or section-COUNT assertions. Adding a new SOW section
+ a stagecoach→Smart Commit rename is therefore safe: every existing `toContain` still passes
(its substring is still present), and no test asserts the structure is unchanged. Verified by
grepping both files for `not.toContain|toHaveLength|length ===|SOW|Documentation Sync`.

## 6. Scope boundaries (no overlap with the parallel T3.S3)

- **Deliverable #1** (.gitignore mandate): `src/agents/prompts.ts` (TASK_BREAKDOWN_PROMPT) +
  `PROMPTS.md`.
- **Deliverable #2** (stagecoach→Smart Commit): `src/agents/prompts.ts` (CLEANUP_PROMPT JSDoc +
  body) — SAME file.
- **Parallel predecessor T3.S3** (generation-timeout/SIGINT rescue): entirely in
  `src/utils/git-commit.ts` + `tests/unit/utils/git-commit.test.ts` (verified via its PRP).
  ZERO overlap with prompts.ts / PROMPTS.md.
- Do NOT touch: any other prompt constant, the PROMPTS object barrel (L1332), any source file
  outside `src/agents/prompts.ts`, the existing repo `.gitignore` (it already covers
  node_modules/dist/build/.DS_Store/Thumbs.db), PRD.md, spec/**, tasks.json.

## 7. Validation commands (verified in package.json)

```
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (the template literal still parses)
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check (markdown IS in the glob → PROMPTS.md + the .ts template)
npx vitest run tests/integration/task-breakdown-prompt.test.ts tests/unit/agents/prompts/architect-prompt.test.ts
```
If `format:check` flags the new markdown/heading, run `npm run format` (writes) then re-check.
The repo `.gitignore` is NOT modified (already adequate) — this task adds a PROMPT RULE that
ensures every decomposed project gets one.