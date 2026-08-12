# PRP — P1.M4.T3.S1: Add Remote-Mutation Prohibition to FORBIDDEN OPERATIONS Sections

> Project 015 "Commit Generation & Agent Tool Safety" · **PRD §9.10.3 / §5.2.** A **prompt-text**
> change (Mode A — "the prompt edits themselves are the documentation"). Adds the repo-remote-mutation
> prohibition to every agent FORBIDDEN OPERATIONS section so no agent is ever *instructed* that it may
> mutate the repo remote / default branch. This is the **prompt-layer** prohibition mandated by PRD
> §9.10.3 ("this rule is added to the §5.2 Universal Forbidden Operations"), complementing the
> capability removals already shipped by the parallel items (T1.S1 bash denylist; T2.S1 per-role tool
> matrix). **No `src/` logic, no tools, no tests authored — ONLY prompt text in
> `src/agents/prompts.ts` + `PROMPTS.md`.**

> **Parallel-coordination:** P1.M4.T1.S1 (bash denylist, `src/tools/bash-mcp.ts`) and P1.M4.T2.S1
> (per-role tool matrix, `src/tools/git-mcp.ts` + `src/agents/agent-factory.ts` + 4 test files) are
> being implemented concurrently and are **file-disjoint** from this item. This item touches ONLY
> `src/agents/prompts.ts` and `PROMPTS.md`. No overlap; no shared edits.

---

## Goal

**Feature Goal**: Ensure every agent prompt that carries a FORBIDDEN OPERATIONS / FORBIDDEN ACTIONS
section also carries the explicit repo-remote-mutation prohibition (PRD §9.10.3), so the instruction
layer — not just the tool layer — forbids `git push`, `git remote`, `git update-ref`, `gh repo`,
GitHub-API writes, and any `default_branch` reference. These are human-only operations.

**Deliverable** (prompt-text edits to 2 existing files; NO new files; NO `src/` logic change):
1. **EDIT** `src/agents/prompts.ts` — append the remote-mutation prohibition block to each of the
   **4** `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)` sections
   (PRP_BLUEPRINT :209, PRP_BUILDER :699, BUG_HUNT :1091, CLEANUP :1209).
2. **EDIT** `PROMPTS.md` — mirror the prohibition into the **4** corresponding prompt sections
   (§4 Research :208, §5 Builder :670, §6 Cleanup :760, §11 Bug-Finding :1103).

**Success Definition**:
- Every one of the 4 prompts.ts FORBIDDEN ACTIONS sections and the 4 PROMPTS.md prompt sections
  contains the verbatim prohibition (grep-verifiable: `git push`, `gh repo`, `default_branch`, `§9.10.3`).
- The existing deletion-protection text is **untouched** (append-only).
- `npm run typecheck && npm run lint && npm run format:check` clean.
- The 6 prompt-content test files stay GREEN (no `toContain` regressions; no strict-equality break).
- `git diff --stat` confined to `src/agents/prompts.ts` + `PROMPTS.md`.

## User Persona (if applicable)

**Target User**: Pipeline operator / security reviewer. End users unaffected. This is the
instruction-layer mitigation for incident 2 (§9.10.3): a `pi`+`glm` agent used an unguarded shell +
authed `gh` to flip a GitHub default branch. The tool layer (T1.S1/T2.S1) removes the capability;
this item removes the *instructional permission* so an agent is never told remote mutation is its job.

**Use Case**: Any agent (cleanup, bug-hunter, coder/post-validation-fix, researcher) reads its system
prompt and sees — alongside the critical-file deletion ban — an explicit, unambiguous ban on every
remote-mutating operation, citing §9.10.3 and naming the human-only tools.

**Pain Points Addressed**: A prompt that licenses a deletion-capable agent to "operate at the repo
root with bash, filesystem, and git tools" without ever naming the remote-mutation boundary is a
latent foot-gun even after the tool matrix lands. The prohibition makes the boundary explicit.

## Why

- **Completes the §9.10.3 defense-in-depth.** §9.10.3 names three controls: the bash denylist
  (T1.S1), the per-role tool matrix (T2.S1), and the universal prompt-layer prohibition (this item).
  All three are acceptance-relevant; this item is the third.
- **Instruction-layer safety is cheap and durable.** Prompts are the cheapest, most visible place to
  state a hard boundary. Even if a future tool-wiring change re-exposed a capability, the explicit
  prohibition remains as a guardrail and a review signal.
- **Scope discipline.** Pure prompt-text append to existing sections; no new prompt, no new tool, no
  behavior change beyond additional instructional text. Mode A (the edits are the documentation).

## What

Append a clearly-headed **"Remote-Mutation Prohibition (PRD §9.10.3)"** block to each of the 4
`## FORBIDDEN ACTIONS` sections in `src/agents/prompts.ts`, and mirror it into the 4 corresponding
`PROMPTS.md` prompt sections. Use the verbatim wording below; cite §9.10.3. Do not alter the existing
critical-file deletion text.

### Success Criteria

- [ ] All 4 prompts.ts FORBIDDEN ACTIONS sections contain the prohibition block.
- [ ] All 4 PROMPTS.md prompt sections (§4/§5/§6/§11) contain the prohibition block.
- [ ] Existing deletion-protection text in every section is unchanged (append-only).
- [ ] The 6 prompt-content test files pass; static gates clean; diff confined to the 2 files.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.** This
PRP names every section by file+line+prompt-constant, gives the exact insertion anchor (the paragraph
each section ends with and the `## ` header that follows it), supplies the verbatim prohibition text,
maps the deletion-capable-agent categories to the 4 sections, documents the PROMPTS.md divergence
(it lacks the Critical-File deletion sections, so the prohibition is added as a new subsection there),
and lists the prompt-content tests that must stay green.

### Documentation & References

```yaml
# MUST READ — this item's own research (verified location map + insert anchors + test list)
- docfile: plan/015_459c7d9be558/P1M4T3S1/research/findings.md
  why: §"Verified location map" (file+line+prompt-constant for all 8 insert sites), §"Tests that assert
       on this prompt text" (the 6 files + the append-safe gotcha), §"Verbatim prohibition wording",
       §"Why append (not rewrite)". All sections load-bearing.
  section: all.

# MUST READ — the PRD contract (the prohibition's source + acceptance language)
- docfile: PRD.md
  why: §9.10.3 "Requirement — universal prohibition (all agents, all roles)" is the verbatim mandate
       ("Repo-remote-mutating operations … are never exposed as any agent tool, in any role … this rule
       is added to the §5.2 'Universal Forbidden Operations.'") + §5.2 lists the existing 4 universal
       prohibitions (PRD.md, source of truth). §9.10.3 also defines the bash-denylist command set that
       the prompt wording must mirror.
  section: "9.10.3 Agent Tool-Access Scoping & Remote-Mutation Prohibition" + "5.2 Agent Capabilities"
           (Universal Forbidden Operations list).

# ── FILES TO EDIT ──
- file: src/agents/prompts.ts
  why: THE primary file. 4 "## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)"
       sections at :209 (PRP_BLUEPRINT), :699 (PRP_BUILDER), :1091 (BUG_HUNT), :1209 (CLEANUP).
       Each is a block inside a `export const …PROMPT = \`…\`` template literal (backtick-delimited).
  pattern: each FORBIDDEN ACTIONS section is a `## ` header + prose + bullet list, terminated by the
           NEXT `## ` header. Append the new prohibition block INSIDE the section (after its final
           paragraph, before the next `## ` header). Escape backticks inside the template literal as \`.
  gotcha: template-literal escaping — the prompts use \`rm\`, \`git rm\`, etc. Mirror that escaping in the
          new block (e.g. \`git push\`). Do NOT introduce an unescaped backtick or `${}` — it would break
          the template literal / typecheck.

- file: PROMPTS.md
  why: the human-readable prompt source. 4 mirror sections: §4 PRP_CREATE_PROMPT (:208),
       §5 PRP_EXECUTE_PROMPT (:670), §6 CLEANUP_PROMPT (:760), §11 BUG_FINDING_PROMPT (:1103).
  pattern: each section is a fenced ```markdown block under a `## N. NAME` header. Add the prohibition
           as a new `## FORBIDDEN ACTIONS — Remote-Mutation Prohibition (PRD §9.10.3)` subsection
           INSIDE the relevant prompt's fenced block.
  gotcha: PROMPTS.md does NOT contain the "Critical-File Deletion Protection" sections (verified — they
          live only in prompts.ts). Do NOT attempt to "find and extend" a deletion section there; ADD a
          fresh prohibition subsection. (Backticks are literal in markdown — no escaping needed.)

# ── READ-ONLY (the capability-removal items — do NOT touch) ──
- file: src/tools/bash-mcp.ts
  why: P1.M4.T1.S1 owns the bash denylist. This item does NOT touch it. (The prohibition wording mirrors
       the denylist command set so prompt + tool layers agree.)
- file: src/agents/agent-factory.ts
  why: P1.M4.T2.S1 owns the per-role tool matrix (buildToolSet). This item does NOT touch it.

# ── Tests that assert on this prompt text (must stay GREEN) ──
- file: tests/unit/agents/prompts/bug-hunt-prompt.test.ts
  why: asserts BUG_HUNT_PROMPT content (likely toContain for structure). Append-safe; verify after edit.
- file: tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
  why: asserts PRP_BLUEPRINT_PROMPT content. Append-safe; verify after edit.
- file: tests/unit/agents/prompts.test.ts
  why: umbrella prompt-structure tests. Append-safe; verify.
- file: tests/integration/prp-execute-prompt.test.ts
  why: asserts PRP_BUILDER/execute prompt content. Append-safe; verify.
- file: tests/integration/bug-finding-prompt.test.ts
  why: asserts bug-finding prompt content. Append-safe; verify.
- file: tests/unit/agents/cleanup-agent.test.ts
  why: asserts CLEANUP_PROMPT content (also touched by T2.S1 for the TOOL set — disjoint concern). Verify.
  gotcha: scan ALL of these for any STRICT-equality / exact-block / `.length` assertion on the affected
          section BEFORE editing. toContain is append-safe; a strict block assertion is not.
```

### Current Codebase tree (the 2 files in scope + READ-ONLY parallel-edit files)

```bash
src/agents/prompts.ts        # EDIT — append prohibition to 4 FORBIDDEN ACTIONS sections
PROMPTS.md                   # EDIT — mirror prohibition into 4 prompt sections (§4/§5/§6/§11)
src/tools/bash-mcp.ts        # READ-ONLY (T1.S1 denylist — disjoint)
src/agents/agent-factory.ts  # READ-ONLY (T2.S1 tool matrix — disjoint)
src/tools/git-mcp.ts         # READ-ONLY (T2.S1 ReadOnlyGitMCP — disjoint)
```

### Desired Codebase tree with files to be added

```bash
# NO new files. This item EDITS the 2 existing prompt files only.
# Research notes already at:
#   plan/015_459c7d9be558/P1M4T3S1/research/findings.md
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — prompts.ts uses TEMPLATE LITERALS (export const X = `…`). Every backtick inside must be
//   escaped as \` and there must be NO unescaped ${ } (the prompts use $BUG_RESULTS_FILE etc. as literal
//   text, which is fine; just don't add ${...}). An unescaped backtick terminates the literal → typecheck
//   FAILS. Mirror the existing escaping (\`rm\`, \`git rm\`) verbatim in the new block.

// CRITICAL — APPEND, do not rewrite. Each FORBIDDEN ACTIONS section's deletion-protection text is
//   asserted on by tests and is load-bearing (PRD §5.1). The remote-mutation prohibition is an
//   ADDITIONAL layer (§9.10.3). Add a clearly-headed block; leave all existing text intact.

// CRITICAL — PROMPTS.md does NOT contain the Critical-File deletion sections (verified by grep). Do not
//   search for a deletion section to extend there — ADD a fresh prohibition subsection inside each of
//   the 4 prompt sections. Backticks are literal in markdown (no escaping).

// GOTCHA — 3 of the 4 prompts.ts sections (PRP_BLUEPRINT/PRP_BUILDER/BUG_HUNT) end with the IDENTICAL
//   paragraph "Pipeline-state files (PRD.md, PRP.md, tasks.json, prd_snapshot.md) are **NOT temporary**
//   — do not delete them." Insert AFTER it in each. The CLEANUP section (:1209) is bespoke and ends
//   with "Read-only `git` inspection (e.g. `git status`) is fine." — insert after THAT line.

// GOTCHA — keep the prohibition wording IDENTICAL across all 8 sites (prompts.ts ×4 + PROMPTS.md ×4)
//   so a single grep (e.g. `git push` + `gh repo` + `default_branch` + `§9.10.3`) verifies all of them.
```

## Implementation Blueprint

### Data models and structure

No data models. The only "structure" is a consistent prohibition block. Recommended block (prompts.ts
form, with template-literal escaping; PROMPTS.md form drops the `\` escaping):

```
## FORBIDDEN ACTIONS — Remote-Mutation Prohibition (PRD §9.10.3)

You **MUST NEVER** run any remote-mutating git/GitHub command: \`git push\`,
\`git remote\`, \`git update-ref\`, \`gh repo\` (any subcommand),
\`gh api -X PATCH|POST|DELETE\`, \`curl\`/\`wget\` to \`api.github.com\`, or any
reference to \`default_branch\`. These are **human-only operations**. No agent
reaches git through the bash tool — use the structured git tools only.
Repo-remote-mutating operations are never exposed as any agent tool, in any role
(PRD §9.10.3), and this rule is part of the §5.2 Universal Forbidden Operations.
```

### Implementation Tasks (ordered by dependencies)

```yaml
# ═════════════════════ TASK 1: prompts.ts — PRP_BLUEPRINT_PROMPT (:209) ═════════════════════
Task 1: EDIT src/agents/prompts.ts (PRP_BLUEPRINT_PROMPT, the Researcher)
  - LOCATE the FORBIDDEN ACTIONS section at :209.
  - INSERT (immediately AFTER the "Pipeline-state files … **NOT temporary** — do not delete them."
    paragraph, and BEFORE the "## MULTI-PRP BATCHING POLICY" header) the Remote-Mutation Prohibition
    block from §"Data models and structure" above (template-literal-escaped form).
  - ESCAPE every backtick as \`. Verify no unescaped backtick / ${} introduced.
  - DO NOT modify the existing deletion-protection text (append-only).
  - VERIFY: npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts → green.

# ═════════════════════ TASK 2: prompts.ts — PRP_BUILDER_PROMPT (:699) ═════════════════════
Task 2: EDIT src/agents/prompts.ts (PRP_BUILDER_PROMPT, the Builder / post-validation fix)
  - LOCATE the FORBIDDEN ACTIONS section at :699.
  - INSERT after "Pipeline-state files … **NOT temporary** — do not delete them." and BEFORE
    "## Mission: One-Pass Implementation Success" — the same prohibition block (escaped).
  - VERIFY: npx vitest run tests/integration/prp-execute-prompt.test.ts → green.

# ═════════════════════ TASK 3: prompts.ts — BUG_HUNT_PROMPT (:1091) ═════════════════════
Task 3: EDIT src/agents/prompts.ts (BUG_HUNT_PROMPT, the Bug hunter)
  - LOCATE the FORBIDDEN ACTIONS section at :1091.
  - INSERT after "Pipeline-state files … **NOT temporary** — do not delete them." and BEFORE
    "## Output - IMPORTANT" — the same prohibition block (escaped).
  - VERIFY: npx vitest run tests/unit/agents/prompts/bug-hunt-prompt.test.ts tests/integration/bug-finding-prompt.test.ts → green.

# ═════════════════════ TASK 4: prompts.ts — CLEANUP_PROMPT (:1209) ═════════════════════
Task 4: EDIT src/agents/prompts.ts (CLEANUP_PROMPT, the one agent licensed to delete)
  - LOCATE the FORBIDDEN ACTIONS section at :1209. NOTE this section is bespoke (extra bullets incl.
    the `git commit`/`git add` ban) and ends with "Read-only \`git\` inspection (e.g. \`git status\`)
    is fine."
  - INSERT after that final paragraph and BEFORE "## Operational Notes" — the same prohibition block
    (escaped). (CLEANUP is the highest-risk deletion-capable agent — the prohibition is most important here.)
  - VERIFY: npx vitest run tests/unit/agents/cleanup-agent.test.ts → green (the prompt-content part;
    the tool-set assertions are T2.S1's concern and unaffected by a prompt-text append).

# ═════════════════════ TASK 5: PROMPTS.md — mirror into 4 prompt sections ═════════════════════
Task 5: EDIT PROMPTS.md — mirror the prohibition into the 4 corresponding prompt sections
  - SECTION §4 PRP_CREATE_PROMPT (The Researcher) at :208 — add the prohibition subsection inside its
    fenced ```markdown block (markdown form: backticks literal, no escaping).
  - SECTION §5 PRP_EXECUTE_PROMPT (The Builder) at :670 — same.
  - SECTION §6 CLEANUP_PROMPT at :760 — same (place near the existing "CRITICAL - NEVER DELETE" /
    "DO NOT DELETE OR MODIFY" lists; the prohibition is the remote-mutation analogue).
  - SECTION §11 BUG_FINDING_PROMPT (Adversarial QA) at :1103 — same.
  - USE THE SAME wording (minus the \` escaping) so a single grep verifies all 4 + the 4 prompts.ts sites.
  - DO NOT add the Critical-File deletion text to PROMPTS.md (out of scope; it never lived there).
  - VERIFY: grep -c "git push" PROMPTS.md → >=4; grep -c "§9.10.3" PROMPTS.md → >=4.

# ═════════════════════ TASK 6: VERIFY (static gates + prompt tests + grep + scope guard) ═════════════════════
Task 6: VERIFY
  - RUN: npm run typecheck && npm run lint && npm run format:check → clean (prompts.ts is TS).
  - RUN: npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
              tests/unit/agents/prompts/bug-hunt-prompt.test.ts
              tests/unit/agents/prompts.test.ts
              tests/integration/prp-execute-prompt.test.ts
              tests/integration/bug-finding-prompt.test.ts
              tests/unit/agents/cleanup-agent.test.ts   → all green.
  - RUN (verification greps — each EXPECT >= 8 total across the 2 files; >=4 in each file):
      grep -rc "git push" src/agents/prompts.ts PROMPTS.md
      grep -rc "gh repo" src/agents/prompts.ts PROMPTS.md
      grep -rc "default_branch" src/agents/prompts.ts PROMPTS.md
      grep -rc "§9.10.3\|9.10.3" src/agents/prompts.ts PROMPTS.md
  - RUN (scope guard): git diff --stat → ONLY src/agents/prompts.ts + PROMPTS.md.
```

### Implementation Patterns & Key Details

````markdown
# Template-literal form (src/agents/prompts.ts — backticks escaped) — insert inside each FORBIDDEN ACTIONS section:

## FORBIDDEN ACTIONS — Remote-Mutation Prohibition (PRD §9.10.3)

You **MUST NEVER** run any remote-mutating git/GitHub command: \`git push\`,
\`git remote\`, \`git update-ref\`, \`gh repo\` (any subcommand),
\`gh api -X PATCH|POST|DELETE\`, \`curl\`/\`wget\` to \`api.github.com\`, or any
reference to \`default_branch\`. These are **human-only operations**. No agent
reaches git through the bash tool — use the structured git tools only.
Repo-remote-mutating operations are never exposed as any agent tool, in any role
(PRD §9.10.3), and this rule is part of the §5.2 Universal Forbidden Operations.

# Markdown form (PROMPTS.md — backticks literal) — identical wording, no \` escaping:

## FORBIDDEN ACTIONS — Remote-Mutation Prohibition (PRD §9.10.3)

You **MUST NEVER** run any remote-mutating git/GitHub command: `git push`,
`git remote`, `git update-ref`, `gh repo` (any subcommand),
`gh api -X PATCH|POST|DELETE`, `curl`/`wget` to `api.github.com`, or any
reference to `default_branch`. These are **human-only operations**. No agent
reaches git through the bash tool — use the structured git tools only.
Repo-remote-mutating operations are never exposed as any agent tool, in any role
(PRD §9.10.3), and this rule is part of the §5.2 Universal Forbidden Operations.
````

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# The change is pure prompt text. Integration surface:
#  - src/agents/prompts.ts: 4 exported prompt template literals gain an appended subsection each.
#    These prompts are consumed verbatim as `system:` by createResearcherAgent/createCoderAgent/
#    createQAAgent/createCleanupAgent (src/agents/agent-factory.ts) — no signature change.
#  - PROMPTS.md: human-readable mirror; consumed by readers/PRD §9.3.4 — no runtime consumer.
# No env vars, no package.json, no deps. No change to bash-mcp.ts / agent-factory.ts / git-mcp.ts.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit ; catches an unescaped backtick/${} in the template literal
npm run lint             # eslint ; expect clean for prompts.ts
npm run format:check     # prettier --check ; if it complains: npx prettier --write src/agents/prompts.ts PROMPTS.md
# Expected: Zero errors. An unescaped backtick in the template literal surfaces as a tsc error here.
```

### Level 2: Prompt-content tests (primary gate — append must not break toContain)

```bash
npx vitest run \
  tests/unit/agents/prompts/prp-blueprint-prompt.test.ts \
  tests/unit/agents/prompts/bug-hunt-prompt.test.ts \
  tests/unit/agents/prompts.test.ts \
  tests/integration/prp-execute-prompt.test.ts \
  tests/integration/bug-finding-prompt.test.ts \
  tests/unit/agents/cleanup-agent.test.ts
# Expected: all green. toContain assertions are append-safe. If a test FAILS, read it: it is likely a
# strict-equality / exact-block assertion on the edited section — update the expectation to include the
# new prohibition text (do NOT weaken/delete the assertion).
```

### Level 3: System Validation (no regression)

```bash
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected: no NEW failures vs. the pre-change baseline (modulo the parallel T1.S1/T2.S1 in-flight
# changes, which are disjoint files). This item adds prompt text only.
npm run typecheck   # confirm clean
```

### Level 4: Creative & Domain-Specific Validation (the §9.10.3 acceptance — grep the prohibition landed)

```bash
# Scope guard — ONLY the 2 prompt files changed; the parallel-item files untouched:
git diff --stat -- src/tools/bash-mcp.ts src/agents/agent-factory.ts src/tools/git-mcp.ts  # EXPECT: empty
git diff --stat                                                                            # EXPECT: prompts.ts + PROMPTS.md only

# Prohibition-coverage guard — every one of the 8 sites carries the markers:
grep -n "git push" src/agents/prompts.ts        # EXPECT: 4 hits (one per FORBIDDEN ACTIONS section)
grep -n "git push" PROMPTS.md                   # EXPECT: 4 hits (§4/§5/§6/§11)
grep -n "gh repo" src/agents/prompts.ts PROMPTS.md   # EXPECT: 8 total
grep -n "default_branch" src/agents/prompts.ts PROMPTS.md  # EXPECT: 8 total
grep -n "9.10.3" src/agents/prompts.ts PROMPTS.md   # EXPECT: 8 total (the citation)

# Deletion-text-preservation guard — the existing Critical-File protection text is still present once per section:
grep -c "Critical-File Deletion Protection" src/agents/prompts.ts   # EXPECT: 4 (unchanged headers)
grep -c "are pipeline state, not scratch artifacts" src/agents/prompts.ts  # EXPECT: 4 (unchanged body)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck && npm run lint && npm run format:check` clean (no unescaped backtick).
- [ ] The 6 prompt-content test files pass.
- [ ] `npx vitest run --reporter=dot`: no new failures vs. baseline.
- [ ] `git diff --stat` confined to `src/agents/prompts.ts` + `PROMPTS.md`.

### Feature Validation (§9.10.3 acceptance — prompt layer)

- [ ] All 4 prompts.ts FORBIDDEN ACTIONS sections (PRP_BLUEPRINT/PRP_BUILDER/BUG_HUNT/CLEANUP) carry
      the prohibition block citing §9.10.3.
- [ ] All 4 PROMPTS.md prompt sections (§4/§5/§6/§11) mirror the prohibition.
- [ ] The prohibition names `git push`, `git remote`, `git update-ref`, `gh repo`,
      `gh api -X PATCH|POST|DELETE`, `curl`/`wget` to `api.github.com`, and `default_branch`.
- [ ] Existing critical-file deletion-protection text in every section is unchanged (append-only).
- [ ] Wording is identical across all 8 sites (single grep verifies all).

### Code Quality Validation

- [ ] Template-literal escaping correct in prompts.ts (every backtick escaped; no unescaped `${}`).
- [ ] PROMPTS.md uses literal backticks (no escaping) consistent with the rest of the file.
- [ ] Each new block is clearly headed (`## FORBIDDEN ACTIONS — Remote-Mutation Prohibition (PRD §9.10.3)`).
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] The prohibition text itself IS the documentation (Mode A) — it cites §9.10.3 + §5.2 inline.
- [ ] Commit message uses the project's format (no `[PRP Auto]` / no `Co-Authored-By` — §9.10.2). If a
      task-prefix convention is in effect, use `P1.M4.T3.S1: <subject>`.

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite or delete the existing critical-file deletion-protection text — APPEND a new block.
  That text is asserted on by tests and is mandated by PRD §5.1.
- ❌ Don't leave an unescaped backtick or `${...}` in a prompts.ts template literal — it terminates the
  string and breaks typecheck. Escape every backtick as `\` (mirror the existing `\\`rm\\`` style).
- ❌ Don't search PROMPTS.md for a "Critical-File Deletion Protection" section to extend — it doesn't
  exist there (verified). ADD a fresh prohibition subsection inside each of the 4 prompt sections.
- ❌ Don't touch `src/tools/bash-mcp.ts` (T1.S1) or `src/agents/agent-factory.ts` / `src/tools/git-mcp.ts`
  (T2.S1) — those parallel items own them; this item is prompts.ts + PROMPTS.md only.
- ❌ Don't weaken a prompt-content test to force green — if a strict-equality assertion breaks, update it
  to include the new prohibition text (the prohibition is the correct new content).
- ❌ Don't paraphrase the prohibition per-site — use IDENTICAL wording across all 8 sites so coverage is
  grep-verifiable and the prompt+tool layers agree with the §9.10.3 denylist.
- ❌ Don't add the prohibition only to "deletion-capable" prompts and skip PRP_BLUEPRINT (Research) —
  part (a) says EVERY FORBIDDEN OPERATIONS section; all 4 prompts.ts sections get it.
- ❌ Don't prepend `[PRP Auto]` / `Co-Authored-By` to the commit (forbidden per §9.10.2).
- ❌ Don't run the pipeline app (`npm run dev`/`tsx src/index.ts`) — only run vitest + static gates.

---

## Confidence Score

**9.5/10** — one-pass success likelihood. This is a pure, mechanical prompt-text append to 4 verified
sections in prompts.ts + 4 mirror sections in PROMPTS.md, using verbatim wording supplied in the PRP.
Every insert site is pinned by file+line+prompt-constant+insertion-anchor; the template-literal
escaping gotcha is flagged; the PROMPTS.md divergence (no deletion sections) is documented; the 6
prompt-content tests are enumerated with the append-safe caveat; and the parallel-item file-disjointness
is confirmed. The only residual risk — a strict-equality prompt test breaking on the append — is
explicitly flagged with a run-first-then-update task (do-not-weaken). Blast radius is 2 files; `src/`
logic files are fenced off by an explicit scope guard.