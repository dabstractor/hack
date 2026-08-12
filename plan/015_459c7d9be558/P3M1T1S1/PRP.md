# PRP — P3.M1.T1.S1: Update README.md — stagecoach, identity-transparency, tool scoping

---

## Goal

**Feature Goal**: Surface three user-visible behavioral guarantees from PRD §9.10
into `README.md` (Mode B — pure documentation, no source edits), reflecting the
work shipped in the now-Complete Phase P1 (Commit Generation & Agent Tool
Safety): (1) **stagecoach ships transitively** via `npm install` (no separate
install, no PATH dependency); (2) **all pipeline commits are identity-
transparent** (no `Co-Authored-By` trailer, no machine author, no `Generated-by`
footer); (3) **agent tool access is scoped by role** with remote-mutating git/
GitHub operations prohibited for all agents (human-only). This is the final
documentation task of the changeset (Mode B); it depends on — and documents —
the implemented §9.10.1 / §9.10.2 / §9.10.3 work.

**Deliverable** (Mode B — README.md ONLY):
1. **Installation section** (README.md:83-92) — ADD a `> **Note**` callout after
   the `npm install` fenced block stating `stagecoach` ships transitively (no
   separate install, no PATH lookup, no Go toolchain) — §9.10.1.
2. **NEW subsection `### Commit Workflow & Identity Transparency`** (insert after
   the "Self-Healing & Resilience" section, ≈line 185, before `## Usage Examples`)
   — documents stagecoach message-only delegation, the snapshot-based atomic
   plumbing commit the pipeline owns, the task-prefix position layer, and the
   identity-transparency guarantee (no trailer/footer/machine author in any mode,
   structurally enforced by a self-source-scan test) — §9.10.1 + §9.10.2.
3. **NEW subsection `### Agent Tool Access & Safety`** (insert after the AI Agent
   System agent table, ≈line 718, before `### PRP Concept`) — documents the
   per-role tool matrix (Research/Planner/Coder: no bash, read-only git; Commit
   agent: no bash, structured `git_commit`; Validation: denylisted bash) and the
   universal prohibition on remote-mutating operations — §9.10.3.

**Success Definition**:
- The Installation section's note states stagecoach is brought in by `npm
  install` with no separate install/PATH/Go-toolchain step.
- A dedicated `### Commit Workflow & Identity Transparency` subsection exists
  and states the three forbidden tokens (`Co-Authored-By`, machine author,
  `Generated-by`/`Generated with` footer), that it holds in ALL modes, that it's
  structurally enforced, and how to verify (`git log --format='%B' <sha>`).
- A dedicated `### Agent Tool Access & Safety` subsection exists with the
  per-role tool matrix and the universal remote-mutation prohibition (human-only).
- `npm run format:check` passes (README is in the prettier `**/*.md` glob); no
  typecheck/test regressions (README is not in the coverage include glob).
- Only `README.md` is modified; no source/package.json/docs/* edits.

---

## User Persona (if applicable)

**Target User**: A new contributor / operator reading README.md to understand
the pipeline's commit behavior and agent safety model before running it.
**Use Case**: A user runs `npm install`, sees stagecoach mentioned, and wants to
know whether they need a separate install; or a security-conscious reviewer wants
to confirm the pipeline won't mis-attribute commits or let an agent push to /
repoint the remote.
**User Journey**: README → Installation (stagecoach note) → Commit Workflow &
Identity Transparency (trust the commit history) → AI Agent System → Agent Tool
Access & Safety (trust the agent can't mutate the remote).
**Pain Points Addressed**: (1) Confusion about whether stagecoach needs a manual
install; (2) fear that AI-authored commits carry `Co-Authored-By: Claude` or
machine-identity footers; (3) fear that an autonomous agent can run `git push` /
flip the GitHub default branch (the §9.10 incident 2 vector).

---

## Why

- **PRD §9.10 compliance**: §9.10.1 (stagecoach delegation + identity-transparent
  by design), §9.10.2 (structural guard forbidding `Co-Authored-By` /
  `Generated-by` / machine author), and §9.10.3 (per-role tool matrix +
  universal remote-mutation prohibition) are all implemented in Phase P1 but
  have **no README surface**. README is the project's primary doc; these three
  guarantees are user-visible and belong there.
- **Trust/safety communication**: The §9.10 incidents (mis-attribution on 46/49
  commits; an agent flipping the GitHub default branch) are exactly the kind of
  failure users fear from autonomous pipelines. Documenting the mitigations
  (identity-transparency + tool scoping) turns "scary autonomous agent" into
  "auditable, capability-fenced."
- **Mode B changeset doc**: This is the documentation task that closes the
  changeset; item 5 DOCS — "This IS the documentation task (Mode B). No further
  docs subtask."
- **Installation completeness**: The Installation section currently says nothing
  about stagecoach, but `npm install` is what fetches it. A user who later sees
  `stagecoach` in the commit workflow or env table has no signal it was already
  installed.

### Out of scope (hard fences)
- **Any source code** (`src/**`) → READ-ONLY. This is Mode B doc-only.
- **`package.json`** → owned by sibling P3.M1.T1.S2 ("Update package.json +
  confirm no .hack schema row for FORMAT_NUDGE_MAX").
- **`docs/*.md`** (ARCHITECTURE.md, CONFIGURATION.md, CLI_REFERENCE.md,
  WORKFLOWS.md, INSTALLATION.md) → owned by the (separate) P4 changeset-level
  doc sweep or already-current. S1 edits README.md ONLY.
- **`.env.example`**, **`vitest.config.ts`** → READ-ONLY.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md`** → READ-ONLY (orchestrator-owned).
- **The existing agent table** (README.md:705-718) → UNCHANGED; the new tool-
  access subsection goes AFTER it.
- **The Environment Variables table** (README.md:415-428) → UNCHANGED; it already
  documents `PRP_COMMIT_FORMAT`/`PRP_COMMIT_STYLE`/`PRP_COMMIT_STYLE_EXAMPLES`.
  Do NOT duplicate.
- **The "Two-phase commits" bullet** (README.md:172-175) → optionally add a
  cross-link to the new subsection, but do NOT rewrite it.

---

## What

### User-visible behavior
README gains three new doc pieces. No runtime/behavioral change (this is Mode B
documentation).

### Technical requirements (exact contract — item 3)

**(a) Installation note (README.md, after the `npm install` fenced block at
line 92, before `### Run Your First Pipeline` at line 94).** Add a `> **Note**`
callout:

```markdown
> **Note — `stagecoach` ships with this package.** Commit-message generation is
> delegated to the [`stagecoach`](https://github.com/earendil-works/stagecoach)
> tool, declared as the `stagecoach-ai` npm dependency. Its `postinstall` script
> downloads the correct per-platform native binary (linux/darwin/windows ×
> amd64/arm64) into `~/.stagecoach/versions/`. `npm install` therefore brings
> `stagecoach` along **transitively — no separate install, no `PATH` lookup, no
> Go toolchain** for end users (PRD §9.10.1). See
> [Commit Workflow & Identity Transparency](#commit-workflow--identity-transparency).
```

(Verify the stagecoach repo URL is correct at implementation time; if the
canonical URL differs, use the one in package.json / the stagecoach-ai README.
If unsure, omit the hyperlink and just name the tool.)

**(b) Commit Workflow & Identity Transparency subsection (README.md, insert
after the "Self-Healing & Resilience" section — after line 185 — before `##
Usage Examples` at line 196).** New `### ...` subsection:

```markdown
### Commit Workflow & Identity Transparency

Every work-item commit goes through a **snapshot-based atomic plumbing commit**
(PRD §5.1): `git write-tree` freezes the index, `git commit-tree` creates the
commit, and a compare-and-swap `git update-ref` advances `HEAD`. `restore_critical_files`
blocks deletion of protected files (`PRD.md`, `PRP.md`, `tasks.json`, …) right
after staging.

**Descriptive messages come from `stagecoach`, message-only.** The pipeline
invokes `stagecoach --dry-run --single` — `--dry-run` emits the message to stdout
without committing; `--single` produces exactly one message with no multi-commit
decomposition. `stagecoach` produces **only** the bare descriptive message; the
pipeline then layers the **task-prefix position** (`<phase>.<milestone>.<task>.<subtask>:`,
per `PRP_COMMIT_FORMAT`; PRD §5.1) and performs the commit itself. `stagecoach`
runs on the same resolved provider/model the pipeline uses for agent runs, and
`PRP_COMMIT_STYLE` (`auto` | `plain` | `conventional` | `gitmoji`) forwards as
`stagecoach`'s `--format`.

> **Identity-transparent by design.** Pipeline commits carry **no**
> `Co-Authored-By:` trailer, **no** `Generated-by` / `Generated with` footer,
> and **no** machine/branded author — in **any** mode (task-prefix, plain,
> non-backlog, or commit-gen fallback). This is enforced structurally: a
> self-source-scan test walks all production source under `src/` and **fails the
> build** if a forbidden identity/attribution literal (`Co-Authored-By`,
> `noreply@anthropic.com`, `Generated with [Claude Code]`, `🤖 Generated`, the
> `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env literals, or a `git config user.name`/
> `user.email` write) appears in a non-comment line (PRD §9.10.2). Verify any
> commit with:
>
> ```bash
> git log --format='%B' <sha>     # contains none of those tokens
> ```
```

**(c) Agent Tool Access & Safety subsection (README.md, insert after the AI
Agent System agent table — after line 718 — before `### PRP Concept` at line
720).** New `### ...` subsection:

```markdown
### Agent Tool Access & Safety

Agent tool access is **scoped by role**, not granted universally (PRD §9.10.3).
No agent receives an unguarded `bash` shell; where shell is needed it is fenced,
and the only git surface any agent gets is the structured tools.

| Role                       | `bash` tool         | structured `git` tools                      |
| -------------------------- | ------------------- | ------------------------------------------- |
| Research / Planner / Coder | **none**            | read-only (`git_status`, `git_diff`) only   |
| Commit agent               | **none**            | `git_commit` only (structured; no raw bash) |
| Validation agent           | **yes, denylisted** | — (runs `tsc` / `vitest` / smoke)           |

The Validation agent's `bash` is **denylisted**: it refuses — non-zero exit,
clear error — any repo-remote-mutating or default-branch-mutating command
(`git push`, `git remote`, `git update-ref`, `git config`, `git reset --hard`
against a shared ref, `git rebase`, `git commit`, `gh repo …`, `gh api -X
PATCH|POST|DELETE`, `curl`/`wget` to `api.github.com`, any `default_branch`
reference) **before** exec. Ambiguous matches fail closed.

> **Universal prohibition (all agents, all roles).** Repo-remote-mutating
> operations — `git push`, `git remote`, `git update-ref`, `gh repo`, GitHub-API
> writes, and default-branch mutation — are **never exposed as any agent tool**.
> These are **human-only** operations (PRD §5.2 / §9.10.3). The structured `git`
> tools (`git_status` / `git_diff` / `git_add` / `git_commit`) are the **only**
> git surface any agent receives, and none of them can reach a remote or the
> default branch. This closes the vector that once let an agent flip a GitHub
> default branch via an unguarded shell plus the host's authed `gh`.
```

### Success Criteria
- [ ] Installation section has a note that stagecoach ships transitively via
      `npm install` (no separate install / PATH / Go toolchain).
- [ ] A `### Commit Workflow & Identity Transparency` subsection exists, states
      the message-only stagecoach delegation + the snapshot atomic commit +
      task-prefix layer, and the identity-transparency guarantee (no
      `Co-Authored-By` / machine author / `Generated-by` footer in any mode,
      structurally enforced, verifiable via `git log --format='%B'`).
- [ ] A `### Agent Tool Access & Safety` subsection exists with the per-role
      tool matrix and the universal remote-mutation prohibition (human-only).
- [ ] `npm run format:check` passes; no typecheck/test regressions.
- [ ] Only `README.md` is modified.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a single-file Markdown documentation change (Mode B). Its
correctness hinges on seven pre-proven facts, all pinned with line anchors
below: (1) the **exact insertion points** — Installation note after the `npm
install` block (README.md:92, before line 94); the Commit subsection after the
Self-Healing & Resilience section (after line 185, before `## Usage Examples`
line 196); the Agent subsection after the AI Agent System agent table (after
line 718, before `### PRP Concept` line 720); (2) the **stagecoach dependency is
real** — `package.json:83` declares `"stagecoach-ai": "^0.1.16"`; (3) the
**README style conventions** — `> **Note**` callouts (e.g. line 123, 429),
`(PRD §X.Y)` citations, backtick tool/flag names, cross-links to `docs/*.md`,
markdown tables (mirror the agent table at 712-718); (4) the **three guarantees
are already implemented** — Phase P1 (Commit Generation & Agent Tool Safety) is
Complete per `<plan_status>`, so the docs describe shipped behavior, not vapor;
(5) the **Environment Variables table already documents PRP_COMMIT_*** (lines
426-428) — do NOT duplicate; (6) the **"Two-phase commits" bullet** (172-175)
already mentions stagecoach but says nothing about identity — the new Commit
subsection is the discoverable home for that guarantee (optionally cross-link
from the bullet); (7) **Mode B = doc-only** — NO source/package.json/docs/*
edits; only README.md.

### Documentation & References
```yaml
# MUST READ — the PRD spec (already provided in selected_prd_content)
- docfile: PRD.md
  section: "9.1 Technology Stack" (h3.19, names stagecoach + identity-transparent)
       + "9.10 Commit Generation & Agent Tool Safety" (h3.28)
       + "9.10.1 Commit-Message Generation" (h4.43)
       + "9.10.2 Commit-Identity Structural Guard" (h4.44)
       + "9.10.3 Agent Tool-Access Scoping & Remote-Mutation Prohibition" (h4.45)
  why: §9.10.1/2/3 are the EXACT normative rules the three README additions document.
  critical: identity-transparency holds in ALL modes (task-prefix/plain/non-backlog/
       fallback); the per-role tool matrix; the universal remote-mutation prohibition
       is human-only.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/015_459c7d9be558/P3M1T1S1/research/s1-codebase-analysis.md
  section: §1 (README structure + line map), §2 (Installation edit), §3 (identity
       subsection placement decision), §4 (tool-scoping subsection), §5 (tone/
       anchors/style), §6 (scope fences + sibling coordination), §7 (unchanged),
       §8 (validation commands)
  why: Proves every insertion line, the stagecoach-ai dependency reality, the
       README style conventions, and the sibling-disjoint scope.

# MUST READ — confirm the dependency is real (read-only)
- file: package.json
  section: "dependencies" — `"stagecoach-ai": "^0.1.16"` (line 83).
  why: Confirms the "ships transitively via npm install" claim is TRUE in the
       current tree (not aspirational). The Installation note cites this.
  gotcha: READ-ONLY for S1 (sibling P3.M1.T1.S2 may edit package.json; S1 does not).

# THE FILE TO EDIT (the only file)
- file: README.md
  section: THREE additive edits —
       (1) Installation: `> **Note**` after the `npm install` block (line 92).
       (2) NEW `### Commit Workflow & Identity Transparency` after Self-Healing &
           Resilience (after line 185, before `## Usage Examples` line 196).
       (3) NEW `### Agent Tool Access & Safety` after the AI Agent System agent
           table (after line 718, before `### PRP Concept` line 720).
  why: README is the project's primary doc; these three user-visible guarantees
       have no README surface today.
  pattern: the existing `> **Note**` / `> **Deprecation**` callouts (lines 123,
       429); the existing agent markdown table (712-718); `(PRD §X.Y)` citations
       throughout; cross-links to docs/*.md.
  gotcha: do NOT edit the Environment Variables table (PRP_COMMIT_* already there,
       lines 426-428). do NOT rewrite the "Two-phase commits" bullet (172-175) —
       optionally cross-link. do NOT edit the agent table (705-718) — add the new
       subsection AFTER it. do NOT touch docs/*.md (separate doc sweep). do NOT
       edit package.json (sibling P3.M1.T1.S2). Pure additive Markdown only.

# STYLE/ANCHOR reference
- file: README.md (existing conventions, read-only)
  section: `> **Note**` callout shape (line 123); `(PRD §X.Y)` citation style;
       markdown table shape (agent table 712-718); heading-anchor cross-link
       style (lowercase, hyphens, e.g. `#commit-workflow--identity-transparency`).
  why: The three additions must match the file's existing voice/format so they
       read as native, not pasted-in.
  gotcha: GitHub auto-generates anchors from heading text — verify the
       Installation note's cross-link `(#commit-workflow--identity-transparency)`
       matches the new heading's generated anchor (GitHub: lowercase, spaces→
       hyphens, strip punctuation except hyphens; double-hyphen for the " & " →
       "Workflow & Identity" → "workflow--identity").

# CONTRACT INPUTS (read-only — confirm shipped behavior)
- file: src/core/git-plumbing.ts (or wherever gitWriteTree/gitCommitTree/gitUpdateRefCAS live)
  section: the snapshot-based atomic plumbing commit primitives (Phase P1.M1.T1, Complete).
  why: Confirms the "snapshot-based atomic plumbing commit (write-tree/commit-tree/
       CAS update-ref)" claim in the Commit subsection is TRUE.
  gotcha: READ-ONLY; do not edit. If unsure of exact file, cite "PRD §5.1" without
       a src path — the README claim is about behavior, not file location.

- file: src/agents/agent-factory.ts (Phase P1.M4.T2, Complete)
  why: Confirms the per-role tool matrix (Research/Planner/Coder: no bash, read-only
       git; Commit: git_commit only; Validation: denylisted bash) is TRUE.
  gotcha: READ-ONLY.
```

### Current Codebase tree (relevant slice)
```bash
README.md                   # EDIT — +Installation note, +Commit Workflow subsection, +Agent Tool Access subsection
package.json                # READ-ONLY — confirms stagecoach-ai dep (sibling P3.M1.T1.S2 may edit)
src/                        # READ-ONLY — Phase P1 implementations (confirm shipped behavior)
docs/*.md                   # READ-ONLY — separate doc sweep; S1 edits README only
PRD.md                      # READ-ONLY — §9.10.1/2/3 source of truth
vitest.config.ts            # READ-ONLY — README not in coverage include glob
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
README.md                   # MODIFIED — three additive doc pieces (Installation note + 2 new subsections)
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL (Mode B = doc-only): S1 edits ONLY README.md. Do NOT edit src/,
     package.json, docs/*.md, .env.example, or any config. The sibling
     P3.M1.T1.S2 owns package.json; a separate (future) doc sweep owns docs/*.md. -->
<!-- CRITICAL (three guarantees are SHIPPED, not aspirational): Phase P1 (Commit
     Generation & Agent Tool Safety) is Complete per <plan_status>. The README
     additions document real behavior. Verify any claim against the actual src/
     before stating it as fact (e.g. stagecoach-ai in package.json:83). -->
<!-- CRITICAL (do NOT duplicate the env table): README.md:426-428 already
     documents PRP_COMMIT_FORMAT / PRP_COMMIT_STYLE / PRP_COMMIT_STYLE_EXAMPLES.
     The Commit subsection should MENTION task-prefix/style layers conceptually
     and link to Configuration, NOT re-tabulate the env vars. -->
<!-- CRITICAL (heading anchors): GitHub auto-generates anchors from heading text.
     `### Commit Workflow & Identity Transparency` → `#commit-workflow--identity-transparency`
     (lowercase; spaces→hyphens; "&" stripped leaving double-hyphen; ":"/"." stripped).
     The Installation note's cross-link MUST match this generated anchor exactly,
     or the link 404s. Verify by previewing or with a markdown anchor tool. -->
<!-- GOTCHA (insertion ordering for the Commit subsection): insert it AFTER the
     "Self-Healing & Resilience" section (which ends ≈line 185 with its
     "For details, see ..." cross-link paragraph) and BEFORE "## Usage Examples"
     (line 196). Putting it inside Self-Healing would bury it; putting it after
     Usage Examples would orphan it from the commit-related context. -->
<!-- GOTCHA (insertion ordering for the Agent subsection): insert AFTER the AI
     Agent System agent table (ends ≈line 718) and BEFORE "### PRP Concept"
     (line 720). It belongs IN the AI Agent System section, right after the
     table that introduces the agents. -->
<!-- GOTCHA (stagecoach repo URL): the Installation note hyperlinks stagecoach.
     Verify the canonical URL at implementation time (package.json homepage /
     stagecoach-ai README). If uncertain, name the tool without a hyperlink
     rather than risk a wrong URL. -->
<!-- GOTCHA (tone): match the existing README voice — `> **Note**` callouts,
     backtick tool/flag/env names, `(PRD §X.Y)` citations, cross-links to
     docs/*.md. The additions should read as native, not pasted-in. -->
<!-- GOTCHA (format:check): README is in prettier's `**/*.md` glob (package.json
     format script). Run `npm run format:check` (or `npm run format` to auto-fix
     wrapping) before validating — prettier may re-wrap the table/markdown. -->
```

---

## Implementation Blueprint

### Data models and structure
None. Pure Markdown documentation (Mode B). No types, models, constants, or code.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY README.md — Installation note (§9.10.1)
  - LOCATE the `### Installation` fenced block ending at line 92 (the `npm install`
    line + closing ```).
  - INSERT (after the closing ```, before `### Run Your First Pipeline` at line 94)
    a `> **Note — stagecoach ships with this package.**` callout stating: stagecoach
    is the stagecoach-ai npm dependency; postinstall downloads the per-platform
    binary to ~/.stagecoach/versions/; npm install brings it transitively (no
    separate install, no PATH lookup, no Go toolchain); PRD §9.10.1; cross-link
    to #commit-workflow--identity-transparency.
  - PRESERVE: the existing fenced block, prerequisites, and "Run Your First Pipeline".
  - FOLLOW pattern: the existing `> **Note**` callouts (line 123, 429).
  - GOTCHA: verify the heading anchor matches the new Commit subsection (Task 2).

Task 2: MODIFY README.md — Commit Workflow & Identity Transparency subsection (§9.10.1 + §9.10.2)
  - LOCATE the end of "## Self-Healing & Resilience" (≈line 185, the "For details,
    see …" cross-link paragraph) and "## Usage Examples" (line 196).
  - INSERT a new `### Commit Workflow & Identity Transparency` subsection between
    them. Content per "What" §b:
    - snapshot-based atomic plumbing commit (write-tree/commit-tree/CAS update-ref;
      PRD §5.1) + restore_critical_files.
    - stagecoach message-only (--dry-run --single); pipeline layers task-prefix
      (PRP_COMMIT_FORMAT) + commits; stagecoach runs on resolved provider/model;
      PRP_COMMIT_STYLE forwards as --format.
    - `> **Identity-transparent by design.**` callout: no Co-Authored-By trailer,
      no Generated-by/Generated with footer, no machine author — in any mode
      (task-prefix/plain/non-backlog/fallback); structurally enforced by a
      self-source-scan test (lists forbidden literals); PRD §9.10.2; verify via
      `git log --format='%B' <sha>`.
  - PRESERVE: Self-Healing & Resilience section + Usage Examples section.
  - FOLLOW pattern: existing subsection prose + `> **Note**` callouts + fenced
    bash snippets + (PRD §X.Y) citations.
  - GOTCHA: do NOT re-tabulate PRP_COMMIT_* env vars (env table 426-428 owns them);
    mention conceptually + link to Configuration. Optionally cross-link from the
    "Two-phase commits" bullet (172-175).

Task 3: MODIFY README.md — Agent Tool Access & Safety subsection (§9.10.3)
  - LOCATE the AI Agent System agent table (ends ≈line 718) and "### PRP Concept"
    (line 720).
  - INSERT a new `### Agent Tool Access & Safety` subsection between them.
    Content per "What" §c:
    - per-role tool matrix (3-row markdown table: Research/Planner/Coder, Commit,
      Validation).
    - Validation bash denylist description (refuses remote/default-branch/rebase/
      commit/gh-repo/gh-api-write/curl-api.github.com/default_branch; fail closed).
    - `> **Universal prohibition (all agents, all roles).**` callout: remote-
      mutating ops never exposed as any agent tool; human-only; PRD §5.2/§9.10.3;
      closes the §9.10.3 incident-2 vector.
  - PRESERVE: the agent table (705-718) + PRP Concept subsection.
  - FOLLOW pattern: the existing agent markdown table (712-718) for the matrix;
    `> **Note**` callouts for the prohibition.
  - GOTCHA: do NOT edit the agent table itself — add AFTER it. Use the exact
    role names from §9.10.3 (Research/Planner/Coder; Commit; Validation).

Task 4: VERIFY — format + no regressions + only README changed
  - RUN npm run format:check → passes (or run `npm run format` to auto-wrap).
  - RUN npm run typecheck → exit 0 (no impact, but confirms no accidental src edit).
  - RUN npm run test:run → green (no impact).
  - RUN npm run validate → GREEN.
  - RUN grep -n "stagecoach\|identity-transparen\|tool access\|remote-mutat" README.md
    → confirms all three additions present.
  - VERIFY only README.md changed: git diff --name-only → README.md.
  - MANUAL: preview the heading anchors (Installation note cross-link →
    #commit-workflow--identity-transparency; verify it resolves on GitHub render).
```

### Implementation Patterns & Key Details
```markdown
<!-- PATTERN: `> **Note**` callout (mirror README.md:123, 429). -->
> **Note — stagecoach ships with this package.** … (PRD §9.10.1). See
> [Commit Workflow & Identity Transparency](#commit-workflow--identity-transparency).

<!-- PATTERN: markdown table (mirror the agent table at README.md:712-718). -->
| Role                       | `bash` tool         | structured `git` tools                      |
| -------------------------- | ------------------- | ------------------------------------------- |
| Research / Planner / Coder | **none**            | read-only (`git_status`, `git_diff`) only   |
| Commit agent               | **none**            | `git_commit` only (structured; no raw bash) |
| Validation agent           | **yes, denylisted** | — (runs `tsc` / `vitest` / smoke)           |

<!-- PATTERN: `(PRD §X.Y)` citation after claims (used throughout README). -->
… identity-transparent by design (PRD §9.10.2) …

<!-- PATTERN: cross-link to docs/*.md (used throughout README). -->
See [Configuration](docs/CONFIGURATION.md#resilience-tuning) for the env knobs.

<!-- CRITICAL: Mode B = README.md ONLY. No src/, package.json, docs/*.md edits. -->
<!-- CRITICAL: the three guarantees are SHIPPED (Phase P1 Complete) — document
     real behavior; verify stagecoach-ai in package.json:83. -->
<!-- CRITICAL: do NOT duplicate the PRP_COMMIT_* env table (README.md:426-428). -->
<!-- CRITICAL: verify heading anchors match the Installation cross-link. -->
```

### Integration Points
```yaml
README.md:
  - add: `> **Note**` callout in Installation (after npm install block, ≈line 92).
  - add: `### Commit Workflow & Identity Transparency` subsection (after Self-Healing,
         ≈line 185; before `## Usage Examples`, line 196).
  - add: `### Agent Tool Access & Safety` subsection (after AI Agent System agent
         table, ≈line 718; before `### PRP Concept`, line 720).
  - optional: cross-link from the "Two-phase commits" bullet (172-175) to the new
         Commit subsection.

NO SOURCE / NO package.json / NO docs/*.md / NO .env.example / NO CONFIG /
NO PRD.md / NO tasks.json
  — Mode B documentation; README.md ONLY.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run format:check     # prettier --check "**/*.md" — README is in the glob
# If it complains about wrapping, run `npm run format` to auto-fix, then re-check.
# Expected: Zero errors. Prettier may re-wrap tables/markdown; accept its formatting.
```

### Level 2: Unit Tests (Component Validation)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (confirms no accidental src edit)
npm run test:run         # vitest run → green (README not in coverage include glob)
# Expected: No regressions. README changes have zero code impact.
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate         # lint + format:check + typecheck + test:run → GREEN
npm run build            # tsc -p tsconfig.build.json → succeeds (no impact)

# Markdown sanity (manual render check):
# - Render README.md in a markdown previewer (or push to a branch + view on GitHub).
# - Verify the three additions render correctly:
#     1. Installation `> **Note**` callout appears under `### Installation`.
#     2. `### Commit Workflow & Identity Transparency` appears between Self-Healing
#        and Usage Examples; its `> **Identity-transparent by design.**` callout
#        and the `git log --format='%B' <sha>` snippet render.
#     3. `### Agent Tool Access & Safety` appears under AI Agent System, right
#        after the agent table; the 3-row matrix + universal-prohibition callout
#        render.
# - Verify the Installation note's cross-link (#commit-workflow--identity-transparency)
#   resolves (click it in the GitHub render).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm all three additions are present:
grep -n "stagecoach ships" README.md                                  # Installation note
grep -n "### Commit Workflow & Identity Transparency" README.md       # subsection heading
grep -n "Identity-transparent by design" README.md                    # identity callout
grep -n "### Agent Tool Access & Safety" README.md                    # subsection heading
grep -n "Universal prohibition" README.md                             # prohibition callout

# Confirm the per-role matrix rows are present:
grep -n "Research / Planner / Coder" README.md                        # matrix row 1
grep -n "Commit agent" README.md                                      # matrix row 2
grep -n "Validation agent" .* README.md 2>/dev/null || grep -n "denylisted" README.md  # matrix row 3

# Confirm the stagecoach dependency claim is grounded (read-only check):
grep -n "stagecoach-ai" package.json                                  # dep exists (^0.1.16)

# Confirm no forbidden tokens leaked into README as anything OTHER than the
# identity-transparency WARNING (which intentionally names them as forbidden):
grep -n "Co-Authored-By\|noreply@anthropic.com\|Generated with \[Claude Code\]" README.md
# EXPECT: matches ONLY inside the Commit subsection's identity-transparency callout
# (where they are named as FORBIDDEN). No matches elsewhere.

# Confirm only README.md changed:
git diff --name-only
# EXPECT: README.md ONLY (no src/, package.json, docs/*, .env.example, PRD.md).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` passes (README in prettier's `**/*.md` glob).
- [ ] `npm run typecheck` exit 0 (no accidental src edit).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds (no impact).

### Feature Validation
- [ ] Installation section has the stagecoach-transitive note (no separate install/
      PATH/Go-toolchain).
- [ ] `### Commit Workflow & Identity Transparency` subsection documents stagecoach
      message-only delegation, the snapshot atomic commit, task-prefix layer, and
      the identity-transparency guarantee (no trailer/footer/machine author in any
      mode; structurally enforced; verifiable via `git log --format='%B'`).
- [ ] `### Agent Tool Access & Safety` subsection has the per-role tool matrix +
      universal remote-mutation prohibition (human-only).
- [ ] The Installation note's cross-link to `#commit-workflow--identity-transparency`
      resolves on render.

### Code Quality Validation
- [ ] Additions match README's existing voice/format (`> **Note**` callouts,
      `(PRD §X.Y)` citations, backtick names, markdown tables, cross-links).
- [ ] No duplication of the PRP_COMMIT_* env table (README.md:426-428).
- [ ] The agent table (705-718) is UNCHANGED (new subsection added AFTER it).
- [ ] Only additive Markdown (no rewrite of existing prose except an optional
      cross-link from the "Two-phase commits" bullet).

### Documentation & Deployment
- [ ] README is the only file modified.
- [ ] No new env vars / config / source (Mode B doc-only).

---

## Anti-Patterns to Avoid
- ❌ Don't edit ANY file other than `README.md` — this is Mode B doc-only. No
  `src/`, `package.json` (sibling P3.M1.T1.S2 owns it), `docs/*.md` (separate
  doc sweep), `.env.example`, or config.
- ❌ Don't document **aspirational** behavior — verify each claim against the
  shipped code (e.g. `stagecoach-ai` in package.json:83; the per-role matrix in
  agent-factory.ts from Phase P1.M4.T2). If unsure, cite "PRD §X.Y" without a
  file path rather than state an unverified src location.
- ❌ Don't **duplicate the PRP_COMMIT_* env table** (README.md:426-428). Mention
  the task-prefix/style layers conceptually and link to Configuration.
- ❌ Don't **edit the agent table** (705-718) — add the Agent Tool Access &
  Safety subsection AFTER it. The table describes agent PURPOSE; the new
  subsection describes agent CAPABILITY/fencing.
- ❌ Don't **guess the stagecoach repo URL** — verify it (package.json homepage /
  stagecoach-ai README) or omit the hyperlink and just name the tool.
- ❌ Don't **mismatch the heading anchor** — the Installation note cross-links to
  `#commit-workflow--identity-transparency`; verify it matches GitHub's generated
  anchor for the new `### Commit Workflow & Identity Transparency` heading
  (lowercase, spaces→hyphens, "&" stripped → double-hyphen).
- ❌ Don't **bury the Commit subsection** inside Self-Healing & Resilience — give
  it its own `### ` heading between Self-Healing (ends ≈185) and Usage Examples
  (line 196) so it's discoverable.
- ❌ Don't forget `npm run format:check` — README is in prettier's `**/*.md` glob;
  run `npm run format` if it complains about table/markdown wrapping.
- ❌ Don't leave the identity-transparency WARNING tokens (`Co-Authored-By`,
  `noreply@anthropic.com`, etc.) anywhere OUTSIDE the dedicated "these are
  FORBIDDEN" callout — they should appear ONLY as named-forbidden examples.
- ❌ Don't touch `PRD.md`, `tasks.json`, `prd_snapshot.md`, or `vitest.config.ts`.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S1 is a single-file Markdown
documentation change (Mode B) with three additive pieces, each pinned to an exact
insertion line and mirroring an existing README convention (`> **Note**` callouts,
the agent markdown table, `(PRD §X.Y)` citations, cross-links to `docs/*.md`). The
correctness rests on seven pre-proven facts: the exact insertion points (line 92
for the Installation note; after line 185 for the Commit subsection; after line 718
for the Agent subsection), the real `stagecoach-ai` dependency (package.json:83),
the README style conventions, the shipped-not-aspirational status of all three
guarantees (Phase P1 Complete per `<plan_status>`), the existing PRP_COMMIT_* env
table (no duplication), and the Mode-B-doc-only scope. The single notable risk —
heading-anchor mismatch on the Installation cross-link — is explicitly flagged
with the GitHub anchor-generation rule. Scope fences are airtight: S1 edits ONLY
README.md; the parallel P2.M1.T1.S2 (Implementing) edits 3 src files (JSDoc/
comments/WARN-shape, no README) and the sibling P3.M1.T1.S2 (Planned) edits
package.json — zero overlap. The remaining 1/10 is ordinary markdown-render/
anchor-verification risk (mitigated by Task 4's render check).