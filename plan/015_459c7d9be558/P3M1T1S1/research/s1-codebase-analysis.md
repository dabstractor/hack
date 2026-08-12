# P3.M1.T1.S1 — Codebase Analysis (Proven Facts)

Scope: Update README.md (Mode B — pure documentation) to surface three user-
visible behavioral guarantees from §9.10: (1) stagecoach ships transitively via
npm install, (2) all pipeline commits are identity-transparent, (3) agent tool
access is scoped by role with remote-mutating ops prohibited. This is the final
documentation task; depends on all P1 implementing subtasks (Complete) + P2
(format-nudge, Implementing — but that's JSDoc-only, no README overlap).

## §1 — README.md structure (927 lines)

| Lines | Section | Relevance |
|-------|---------|-----------|
| 1-27 | Title + badges + TL;DR | (skip) |
| 72-95 | **Quick Start → Installation** | **EDIT (a): stagecoach transitive note** |
| 108-127 | Running from Anywhere | (skip) |
| 129-139 | Distributed PRDs | (skip) |
| 141-161 | **Features** (bullet list) | candidate home for identity note |
| 163-185 | **Self-Healing & Resilience** | **EDIT (b): identity-transparency note** |
| 196-358 | Usage Examples | (skip) |
| 361-381 | CLI Options | (skip) |
| 383-487 | Configuration (env table + Setup) | (skip — PRP_COMMIT_* already there) |
| 642-703 | Architecture Overview | (skip) |
| 705-727 | **AI Agent System** (agent table + PRP Concept) | **EDIT (c): tool-scoping note** |
| 728-822 | Pipeline Workflow + Project Structure | (skip) |
| 824-927 | Development + Contributing + License | (skip) |

## §2 — EDIT (a): Installation section (lines 83-92)

Current:
```bash
### Installation
# Clone the repository
git clone https://github.com/dabstractor/hacky-hack.git
cd hacky-hack
# Install dependencies
npm install
```

No mention that `stagecoach` (the commit-message generator) is brought in. The
contract item 3a requires: "note that stagecoach ships transitively via npm
install — no separate install step, no PATH dependency (§9.10.1)."

**Add a `> **Note**` callout AFTER the fenced block** (before `### Run Your
First Pipeline`, line 94). Key facts from §9.10.1:
- `stagecoach` is the `stagecoach-ai` npm dependency (package.json:83 confirms
  `"stagecoach-ai": "^0.1.16"`).
- Its `postinstall` downloads the per-platform native binary into
  `~/.stagecoach/versions/<ver>/<plat>/`.
- `npm install hacky-hack` brings it transitively: **no separate install, no
  PATH lookup, no Go toolchain**.
- Used message-only (`stagecoach --dry-run --single`) for descriptive commit
  messages.

## §3 — EDIT (b): identity-transparency note (Self-Healing & Resilience)

The "Two-phase commits" bullet (lines 172-175) mentions `stagecoach` but says
nothing about identity transparency. The contract item 3b requires a "user-
visible note that all pipeline commits are identity-transparent: no
Co-Authored-By trailer, no machine author, no Generated-by footer (§9.10.2)."

**Two placement options:**
- (b1) Add a NEW dedicated subsection `### Commit Workflow & Identity
  Transparency` after the Self-Healing & Resilience section (after line 185,
  before `## Usage Examples` line 196). This is the cleanest, most discoverable
  home — it's a distinct user-visible guarantee deserving its own heading.
- (b2) Extend the existing "Two-phase commits" bullet. Less discoverable.

**DECISION: use (b1)** — a dedicated subsection. It can also naturally hold the
stagecoach delegation explanation (message-only, task-prefix layer, determinism)
as user-facing context, which complements the Installation note (a). This
matches the contract's "features or commit-workflow section" phrasing.

Content (from §9.10.1 + §9.10.2):
- stagecoach generates ONLY the bare descriptive message (message-only,
  `--dry-run --single`); the pipeline owns the commit (snapshot-based atomic
  plumbing: write-tree/commit-tree/CAS update-ref; restore_critical_files;
  task-prefix position layer).
- **Identity-transparent**: no `Co-Authored-By:` trailer, no `Generated-by`/
  `Generated with` footer, no machine/branded author — in any mode
  (task-prefix, plain, non-backlog, fallback). Enforced structurally by a
  self-source-scan test that fails the build if a forbidden identity literal
  appears in production source.
- Verifiable: `git log --format='%B' <sha>` contains none of those tokens.

## §4 — EDIT (c): tool-scoping note (AI Agent System)

Current AI Agent System section (lines 705-727): a 4-row agent table (Architect/
Researcher/Coder/QA) + PRP Concept bullets. No mention of tool scoping or the
remote-mutation prohibition. Contract item 3c requires noting: "agent tool
access is scoped by role: Research/Planner/Coder agents have no bash and
read-only git; the Validation agent has denylisted bash; remote-mutating git/
GitHub operations are prohibited for all agents (human-only) (§9.10.3)."

**Add a NEW subsection `### Agent Tool Access & Safety` AFTER the agent table**
(after line 718, before `### PRP Concept` at line 720). Content (from §9.10.3):
- Per-role tool matrix (compact version):
  - Research/Planner/Coder: **no bash**, read-only git (`git_status`/`git_diff`).
  - Commit agent: **no bash**, structured `git_commit` only.
  - Validation agent: **yes, denylisted bash** (runs tsc/vitest/smoke; fenced).
- **Universal prohibition**: repo-remote-mutating ops (`git push`, `git remote`,
  `git update-ref`, `gh repo`, GitHub-API writes, default-branch mutation) are
  **never exposed as any agent tool, in any role** — human-only.
- The bash denylist (validation agent) fails closed on remote/default-branch/
  rebase/commit operations before exec.
- Rationale (one line): these rules close the vector that let an agent flip a
  GitHub default branch via an unguarded shell + authed `gh` (§9.10.3 incident 2).

## §5 — Tone, anchors, and style conventions

README uses:
- `> **Note**` / `> **Deprecation**` callouts (e.g. line 123, 429).
- Backtick code formatting for tool/flag/env names.
- `(PRD §X.Y)` citations after claims (e.g. "(PRD §4.2)", "(PRD §9.2.8)").
- Cross-links to `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`,
  `docs/WORKFLOWS.md`, `docs/CLI_REFERENCE.md`.
- Markdown tables for the agent matrix (mirror the agent table style at 712-718).

Anchors are auto-generated from heading text (GitHub style: lowercase, hyphens,
punctuation stripped). New headings must be link-safe.

## §6 — Scope fences & sibling coordination

- **S1 owns (this PRP):** README.md ONLY — three additions (a) Installation
  note, (b) Commit Workflow & Identity Transparency subsection, (c) Agent Tool
  Access & Safety subsection. COMPLETES this task + Milestone P3.M1.
- **P2.M1.T1.S2 (parallel, Implementing):** edits 3 src files (fix-cycle-
  workflow.ts, prp-generator.ts, prp-executor.ts) — JSDoc/comments/WARN-shape
  only. NO README edit. Zero overlap.
- **P3.M1.T1.S2 (sibling, Planned):** "Update package.json + confirm no .hack
  schema row for FORMAT_NUDGE_MAX" — edits package.json, NOT README. Zero
  overlap.
- **READ-ONLY:** PRD.md, tasks.json, prd_snapshot.md, vitest.config.ts,
  package.json, all src/ files (this is Mode B doc-only — NO source edits).

## §7 — What stays UNCHANGED

- All existing README content (just ADD three pieces; no edits to existing
  prose except possibly the "Two-phase commits" bullet cross-link).
- The agent table itself (705-718) — unchanged; the new subsection goes AFTER it.
- The Environment Variables table — already documents PRP_COMMIT_FORMAT/STYLE
  (lines 426-428); do NOT duplicate.
- package.json, .env.example, docs/* — owned by other tasks.

## §8 — Validation commands (verified)

```bash
npm run format:check        # prettier --check (README is in the **/*.md glob)
npm run validate            # lint + format:check + typecheck + test:run
# (no typecheck/test impact — README is not in the coverage include glob)
# Manual markdown sanity:
npx markdownlint README.md 2>/dev/null || true   # if markdownlint configured
grep -n "stagecoach\|identity-transparen\|tool access\|remote-mutat" README.md
```