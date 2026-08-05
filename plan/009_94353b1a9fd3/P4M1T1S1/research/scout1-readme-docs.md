# Scout Report — README.md Documentation Sync (P4M1T1S1)

Target file: `README.md` (repo root), 831 lines.
Read-only recon. No source files modified. All line numbers from the current `README.md`.

> ⚠️ HEADLINE FINDING (blocking decision for the implementer): README.md **already has a `## Configuration` section (lines 324–545)** that is entirely about environment variables, auth, model tiers, z.ai, and API safeguards. The task's instruction to "add a 'Configuration' section describing the `.hack` file" collides with this existing heading. The `.hack` content is a *different kind* of configuration. See §6 below for the recommended resolution (add a `###` subsection, do NOT create a second top-level `## Configuration`).

---

## 1. Full heading outline (markdown headings only, exact line numbers)

```
1:    # PRP Pipeline
28:   ## What is PRP Pipeline?
72:   ## Quick Start
76:     ### Prerequisites
83:     ### Installation
94:     ### Run Your First Pipeline
108:  ## Distributed (Multi-File) PRDs
120:  ## Features
142:  ## Self-Healing & Resilience
175:  ## Usage Examples
177:    ### Basic Pipeline Execution
187:    ### Scoped Execution
205:    ### Delta Session (PRD Changes)
225:    ### Bug Hunt Mode
240:    ### Adopt an Existing Codebase (--adopt-prd)
252:    ### Accept PRD Edits as Baseline (--accept-prd-changes)
263:    ### Task Status (hack status / hack task)
281:    ### Resume Interrupted Session
288:    ### Dry Run
295:    ### Bypass Cache
302:  ## CLI Options
324:  ## Configuration                 ← already exists (env-var/auth focused)
326:    ### Environment Variables
351:    ### Setup
369:    ### Model Tiers
378:    ### How It Works
393:    ### API Safeguards
428:    ### z.ai Configuration
470:    ### Troubleshooting
546:  ## Architecture Overview
548:    ### System Flow
574:    ### Core Components
576:      #### Session Manager
580:      #### Task Orchestrator
584:      #### Agent Factory
593:      #### PRP Runtime
609:  ## AI Agent System
620:    ### PRP Concept
632:  ## Pipeline Workflow
634:    ### Phase 1: Session Initialization
642:    ### Phase 2: PRD Decomposition
650:    ### Phase 3: Backlog Execution
662:    ### Phase 4: QA Cycle
671:  ## Project Structure
728:  ## Development
730:    ### Prerequisites
736:    ### Setup
750:    ### Available Scripts
767:    ### Running Tests
783:    ### Building
796:  ## Contributing
809:  ## License
```

(Note: the heading-grep also matched `# comment` lines inside bash fences at lines 86,90,97,100,192,etc. — those are NOT headings; the list above is the true heading structure.)

### Best-fit insertion points
- **`.hack` Configuration content** → inside the existing `## Configuration` block, as a NEW `###` subsection inserted as the **first** subsection, i.e. between line 324 (`## Configuration`) and line 326 (`### Environment Variables`). This matches the PRD §9.7 precedence order where `.hack` files are layered *below* env vars. Recommend heading: `### The .hack Configuration File` or `### Configuration Files (.hack)`.
  - (Alternative if the implementer wants a standalone top-level: rename existing `## Configuration` → `## Environment Variables & Auth` and repurpose `## Configuration` for `.hack`. But this breaks the two internal `#configuration` anchor links at lines 81 and 106 — so the subsection approach is lower-risk.)
- **"Running from Anywhere" note** → new top-level `## Running from Anywhere` section inserted between line 106 (end of Quick Start `**Next Steps**…`) and line 108 (`## Distributed (Multi-File) PRDs`). This keeps it adjacent to Quick Start / Installation, where a launch-location question naturally arises. (A `###` subsection under `## Quick Start` is also acceptable if a shorter note is desired.)
- **Breakdown-in-progress calm notice** → NO new section. Extend the EXISTING `### Task Status (hack status / hack task)` block (lines 263–280). Add a `>` blockquote note immediately after the closing ` ``` ` of the bash block at line 279 (i.e., before line 281 `### Resume Interrupted Session`). This is the only place `hack status`/`hack task` are documented.

---

## 2. Term coverage in README.md — what exists vs what's missing

Grepped README.md for every target term. Results:

| Term | In README? | Notes |
| --- | --- | --- |
| `.hack` (the file) | **NO** — zero matches | Completely absent. Must be added. |
| `hack config` (subcommand) | **NO** — zero matches | Absent. (Only `hack status` / `hack task` are shown.) |
| `--repo-root` flag | **NO** — zero matches | Absent. |
| `repo-root` / `repo root` | **NO** — zero matches | Absent. |
| `from anywhere` (run-from-anywhere) | **NO** — zero matches | Absent. |
| `upward .git` / `.git traverse` | **NO** — zero matches | Absent. |
| `breakdown-in-progress` / `breakdown in progress` | **NO** — zero matches | Absent. |
| `tasks.json` | YES — 12 matches | All are in architecture/recovery/feature-listing context, **not** the breakdown-in-progress sense. Matches at lines: 49, 137, 140, 155, 156, 166, 168, 172, 553, 615, 639, 648, 717. Representative: line 166 "`tasks.json` corruption recovery"; line 648 "Persists to `tasks.json`". None mention the not-yet-generated/transient state. |

**Conclusion:** Everything the task asks to document (`.hack`, `hack config`, three-tier layering, secrets policy, env-over-file, run-from-anywhere, `--repo-root`, breakdown-in-progress notice) is **net-new content** for README.md. Source of truth lives in:
- `PRD.md §9.7` — the `.hack` file (format, schema, three-tier layering, secrets policy, env-over-file rule). See PRD lines 796–985.
- `PRD.md §9.8` — repo-root resolution via upward `.git` traversal + `--repo-root` override (§9.8.6). See PRD lines 1026–1093.
- `PRD.md §5.1` "Tasks-Not-Yet-Generated Window (Breakdown-in-Progress)" — PRD lines 293–314 (acceptance criteria 310–314).
- `docs/CLI_REFERENCE.md` lines 205–276 — already documents `hack config init/show/validate/path`, the `.hack`/`.hack.local` layering, `.gitignore` seeding, secrets policy, and the tracked-`.hack.local` warning. This is the natural cross-reference target for the README section.
- `docs/CONFIGURATION.md` — **does NOT yet cover `.hack` / `hack config` / `--repo-root`** (grep returned zero matches). So the README `.hack` section should link to `docs/CLI_REFERENCE.md` (which has it), not `docs/CONFIGURATION.md`, unless that doc is also updated out-of-scope.

---

## 3. README prose STYLE and conventions (to mirror)

House style is GitHub-flavored Markdown with:
- Fenced ` ```bash ` blocks where every line is a `# comment`-then-command pair.
- Pipe tables with aligned `| --- |` padding.
- `>` blockquote callouts for deprecation notes and clarifications.
- Inline PRD section references like `(PRD §9.2.8)`.
- Mermaid `flowchart` diagrams.
- Cross-references to `docs/<FILE>.md` with GitHub anchors.

### Representative example A — fenced bash block (lines 263–280, the exact section to extend)
```markdown
### Task Status (hack status / hack task)

`hack status` is an alias of `hack task` (git muscle memory; PRD §5.3) for inspecting the current
session's backlog. Bugfix tasks discovered before main-session tasks are surfaced first.

```bash
# List all tasks in the current session
hack status
# Same thing, git-style alias
hack task

# Show the next executable (Planned) subtask
hack task next

# Status-counts summary (grouped by status)
hack task status
```
```

### Representative example B — `>` blockquote callout (lines 319–322)
```markdown
> `--mode validate` runs the validation agent phase on a real session; `--mode bug-hunt` runs
> the QA bug hunt. These are `--mode` values — distinct from the pure-local `--validate-prd`
> flag, which validates PRD syntax and exits without invoking any agent. See
> [CLI Reference](docs/CLI_REFERENCE.md) for the exhaustive flag list.
```

### Representative example C — `>` deprecation blockquote with bold lead + docs cross-ref (lines 341–345)
```markdown
> **Deprecation (PRD §9.2.8):** the `ANTHROPIC_BASE_URL` and `ANTHROPIC_DEFAULT_*` names are
> deprecated aliases — still readable, they emit a one-time warning and are slated for future
> removal. Set the canonical `PRP_*` names instead (see the [canonical↔legacy table](docs/CONFIGURATION.md#deprecation-legacy-anthropic_-aliases)).
```

### Representative example D — pipe table (lines 326–339, the Environment Variables table)
```markdown
### Environment Variables

| Variable               | Required | Default                          | Description                                                                    |
| ---------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `ZAI_API_KEY`          | Yes\*    | None                             | z.ai API key (default-path credential for the `zai` provider).                 |
| `PRP_API_BASE_URL`     | No       | `https://api.z.ai/api/anthropic` | LLM provider endpoint (z.ai default for the `zai` provider).                   |
```

### Stylistic guidance for new content
- New `.hack` subsection: lead with a one-sentence purpose, then a small layering table (Global / Project `.hack` / Project-local `.hack.local`), then a fenced `bash` example showing `hack config init` / `hack config show`, then a `>` blockquote for the secrets + env-over-file policy. Link to `docs/CLI_REFERENCE.md` (anchor near line 205) and cite `(PRD §9.7)`.
- "Running from Anywhere" section: 2–3 sentences + a fenced `bash` snippet showing `cd src/deep && hack status` resolving to the repo root, plus a `>` note for `--repo-root`. Cite `(PRD §9.8)`.
- Breakdown-in-progress notice: a single `>` blockquote appended to the existing `### Task Status` section, citing `(PRD §5.1)` and matching the calm wording from PRD line 302.

---

## 4. STALE framing that contradicts run-from-anywhere — sweep results

Grepped README.md for every requested stale phrase. **NONE found.**

| Phrase | Matches |
| --- | --- |
| `must run from` | 0 |
| `run from the root` | 0 |
| `run from the repo root` | 0 |
| `cwd` | 0 |
| `current working directory` | 0 |
| `from the project root` | 0 |
| `cd into` | 0 |

The **only** thing close is `cd hacky-hack`, appearing exactly twice, both inside Installation/Setup bash blocks as part of a standard `git clone … && cd` sequence — **not** stale must-run-from-repo-root framing:
- **Line 88** (inside `### Installation`, fenced block starting line 85): `cd hacky-hack` — follows `git clone https://github.com/dabstractor/hacky-hack.git`.
- **Line 741** (inside `## Development` → `### Setup`, fenced block starting line 738): `cd hacky-hack` — same clone-then-cd pattern.

Additional observation (relevant to run-from-anywhere messaging): The Quick Start and Usage Examples use `npm run dev -- --prd ./PRD.md` everywhere (lines 98, 101, 181, 184, 193, 196, 199, 202, 211, 231, …). Bare-`hack` examples appear only for `hack status` / `hack task` (lines 270–278). There is **no** prose anywhere claiming the tool must be launched from the repo root. So the task's "ensure no stale must-run-from-repo-root framing remains" is effectively a **no-op for prose** — nothing to remove or rewrite. (The implementer may optionally add a forward-looking "run from anywhere" cross-link in the Installation block, but that is additive, not corrective.)

---

## 5. README's existing links to `docs/` files (for consistent cross-referencing)

All `docs/…` link targets currently used in README.md (with the heading/line where each appears):

| docs/ target | README line(s) | Surrounding context |
| --- | --- | --- |
| `docs/CONFIGURATION.md#distributed-prds` | 118 | Distributed PRDs section |
| `docs/CONFIGURATION.md#resilience-tuning` | 170, 339 | Self-Healing section; `PRP_COMMIT_FORMAT` table row |
| `docs/CONFIGURATION.md#deprecation-legacy-anthropic_-aliases` | 343 | Deprecation blockquote |
| `docs/CONFIGURATION.md` | 349 | "For the full auth + preflight walkthrough…" |
| `docs/WORKFLOWS.md#issue-driven-re-planning` | 171 | Self-Healing section |
| `docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery` | 172 | Self-Healing section |
| `docs/ARCHITECTURE.md#delta-sessions` | 223 | Delta Session section |
| `docs/CLI_REFERENCE.md` | 322 | `--mode` blockquote |
| `docs/INSTALLATION.md` | 349 | Auth/preflight walkthrough |
| `docs/architecture.md` | 606 | "Architecture Documentation" bullet |
| `docs/api/index.html` | 607 | TypeDoc API reference |
| `docs/contributing.md` | 798 | Contributing section |

Consistency guidance for the new sections:
- The `.hack` section should link to **`docs/CLI_REFERENCE.md`** (which already fully documents `hack config` and the layering at lines 205–276). Do **not** link to `docs/CONFIGURATION.md#...` for `.hack` topics — that doc does not yet cover `.hack` (grep confirmed zero matches).
- Use the established PRD-section-citation convention `(PRD §9.7)` / `(PRD §9.8)` / `(PRD §5.1)`.

Pre-existing link quality notes (out of scope to fix here, flagged for awareness):
- Line 606 links `docs/architecture.md` (lowercase) but the actual file is `docs/ARCHITECTURE.md` (uppercase) — case mismatch on case-sensitive filesystems.
- Line 798 links `docs/contributing.md` which is **not** present in the current `docs/` listing (no such file). Already-broken, unrelated to this task.

---

## 6. Architecture / how the new content connects

- **`.hack` (PRD §9.7)** is layered configuration loaded at bootstrap in precedence order Global `~/.hack` → Project `<repoRoot>/.hack` (committable, no secrets) → Project-local `<repoRoot>/.hack.local` (gitignored, secrets allowed) → `.env` → shell env → CLI flags (PRD §9.2.1). Env-over-file rule: real env vars win over file values. `hack config` subcommand: `init` / `show` / `validate` / `path` (PRD §9.7.8; documented in `docs/CLI_REFERENCE.md:205-276`). Secrets policy: `.hack` refuses secret-bearing keys (hard error); `.hack.local` is the only file tier allowed to hold secrets; `hack config init` seeds `.hack.local` into `.gitignore`.
- **Run-from-anywhere (PRD §9.8)**: at startup, after `parseCLIArgs()`, `hack` walks upward from `INVOCATION_CWD` until it finds a `.git` entry (dir or file — worktree/submodule aware), `chdir`s to that repo root, then loads `.hack`/`.env`/`PRD.md`/`plan/` from there. Explicit user paths (`--prd`, `--file`, `--repo-root`) resolve against `INVOCATION_CWD`; default paths re-root to the repo. `--repo-root <path>` (PRD §9.8.6) skips the upward search and pins a root. Git is a hard prerequisite; no `.git` ancestor → exit 1 with an actionable message naming the `--repo-root` remediation.
- **Breakdown-in-progress (PRD §5.1, "Tasks-Not-Yet-Generated Window")**: when `hack status`/`hack task`/`hack task next` resolves a session whose directory exists but whose `tasks.json` is not yet written, they print a single calm stderr notice (or `--output json` → `{ "status": "awaiting_breakdown", "session": "NNN_hash" }`) and exit `0` — no `ENOENT`, no stack trace, no error. Distinct from the "no sessions found" state (which still exits non-zero) and from `tasks.json` corruption recovery.

These three concepts are independent features but all three are **bootstrap / launch-time** behaviors, which is why the README places them near Quick Start / Installation / CLI Options. The breakdown-in-progress note belongs with the existing `hack status`/`hack task` examples because it is specific to those subcommands.

---

## 7. Start Here

Open `README.md` and act in this order:
1. **Lines 263–280** — extend `### Task Status (hack status / hack task)` with the breakdown-in-progress `>` blockquote (lowest-risk, self-contained edit).
2. **Lines 106 → 108** — insert new `## Running from Anywhere` top-level section (cite PRD §9.8, link to `docs/CLI_REFERENCE.md`).
3. **Lines 324 → 326** — insert new `### The .hack Configuration File` subsection as the **first** subsection under the existing `## Configuration`, before `### Environment Variables` (cite PRD §9.7, link to `docs/CLI_REFERENCE.md`).

No prose deletion/rewrite is required for the stale-framing sweep — it is a no-op (see §4).

---

## 8. Residual risks / open questions for the implementer

1. **`## Configuration` heading collision** (see headline + §1). The cleanest, link-safe resolution is a new `###` subsection under the existing `## Configuration`. The internal anchors `[Configuration](#configuration)` at README lines 81 and 106 stay valid under this approach. If the implementer instead renames the top-level heading, both anchors and any external `#configuration` deep-links break.
2. `docs/CONFIGURATION.md` does **not** currently document `.hack`, `hack config`, or `--repo-root`. The README `.hack` section must therefore cross-reference `docs/CLI_REFERENCE.md` (which does), or accept that the deeper reference is CLI-Reference-only. Updating `docs/CONFIGURATION.md` is out of scope for this README task.
3. Two pre-existing broken/mismatched docs links exist (§5): `docs/architecture.md` case (line 606) and missing `docs/contributing.md` (line 798). Not in scope but worth not worsening.
4. House style uses `npm run dev -- …` for pipeline examples and bare `hack …` only for `status`/`task`. New `.hack`/run-from-anywhere examples should prefer bare `hack config …` and `hack status …` forms to match the existing `hack` subcommand precedent, since these are documented as direct-CLI usages in `docs/CLI_REFERENCE.md`.