# Research Notes — P5.M3.T1.S1 (README resilience blurb)

Mode B changeset-level doc sweep. Documentation-only. Scope = README.md ONLY.

## 1. Baseline validation gates (verified green BEFORE any edit)

- `npm run docs:lint` → `markdownlint "docs/**/*.md"` → **exit 0** (green).
  - CRITICAL: the glob `docs/**/*.md` does **NOT** match root `README.md`. So `docs:lint` does
    NOT lint the README. The binding gate on the README edit is `format:check` (prettier).
  - Implication: as long as we do NOT touch any `docs/*.md`, `docs:lint` stays green trivially.
- `npx prettier --check README.md` → **passes** (README is already prettier-compliant).
- `.markdownlint.json`: `{ default: true, MD013: false, MD024: { siblings_only: true }, MD036: false }`.
  - MD013 (line length) disabled → long prose lines are fine.
  - MD024 siblings_only → a heading must be unique among same-level siblings under the same parent.
    (README is not linted by docs:lint, but follow the rule for consistency/quality.)
- `.prettierrc`: no `proseWrap` key → defaults to **`preserve`** (prose paragraphs are NOT rewrapped).
  - GOTCHA: markdown **tables** ARE reformatted by prettier (column/pipe alignment). A manually-added
    table that is not prettier-aligned WILL fail `format:check`. Decision: blurb uses prose + bullets
    (no table) → near-zero prettier risk. If a table is added, run `npm run format` to align it.
- `.prettierignore` does NOT list `README.md` → README IS checked by `format:check`.

## 2. README.md current structure (verified headings)

- `## Features` (bullet list of capabilities) — L108. Sibling sections: `## What is PRP Pipeline?`,
  `## Quick Start`, `## Usage Examples`. No `### Self-Healing` / `### Resilience` exists anywhere.
- `## Configuration` → `### Environment Variables` (env-var table) — L205.
- `## Architecture Overview` → `### System Flow`, `### Core Components` (Session Manager, Task
  Orchestrator, Agent Factory, PRP Runtime) — L390+.
- Two identical mermaid `flowchart LR` diagrams (L14 and L392). DO NOT touch (not requested; staleness risk).

## 3. grep confirmation (README has NOTHING on resilience)

`grep -in "resilien|self-heal|recovery|re-plan|RESEARCH_TIMEOUT|ISSUE_RETRY_MAX" README.md` → no matches.
This is the gap this subtask fills.

## 4. Existing Mode A docs to LINK to (do NOT duplicate)

| Mechanism | Env knob (default) | PRD ref | Mode A doc (verified heading → anchor) |
| --- | --- | --- | --- |
| R1: research deadline + synchronous fallback | `RESEARCH_TIMEOUT` (`300`s) | §4.2 | `docs/CONFIGURATION.md` §"Resilience Tuning" → `#resilience-tuning` |
| R2: issue-driven re-planning | `ISSUE_RETRY_MAX` (`3`) | §4.5 | `docs/WORKFLOWS.md` §"Issue-Driven Re-planning" → `#issue-driven-re-planning` |
| R4: tasks.json corruption recovery (git-history restore) | none (automatic, non-fatal) | §5.1 | `docs/ARCHITECTURE.md` §"tasks.json Protection & Smart Recovery" → `#tasksjson-protection--smart-recovery` |

Anchor algorithm (GitHub/markdownlint): lowercase → strip punctuation (`.`, `&`) → spaces→hyphens.
- "Resilience Tuning" → `resilience-tuning` ✓
- "Issue-Driven Re-planning" → `issue-driven-re-planning` ✓
- "tasks.json Protection & Smart Recovery" → `tasksjson-protection--smart-recovery` (double hyphen where `&` was) ✓

NOTE: R1 has NO dedicated narrative subsection in WORKFLOWS.md/ARCHITECTURE.md yet — only the
CONFIGURATION.md row (links to PRD §4.2). The end-to-end resilience narrative reconciliation is the
SEPARATE sibling subtask **P5.M3.T1.S2** ("Reconcile WORKFLOWS.md + ARCHITECTURE.md"). S1 must NOT
preempt S2 — S1 edits README.md ONLY and links to docs as they exist today.

## 5. What is IMPLEMENTED (non-stale facts safe to state)

Per plan_status: P5.M1 (R1 research deadline/fallback, R2 issue re-planning) = Complete; R4
(S1 git primitives Complete, S2 recovery routine Complete, S3 wiring = "Implementing" in parallel,
treated as a CONTRACT per parallel-execution-context). All three mechanisms are real and safe to
document as implemented.

## 6. Draft blurb (prettier-safe prose + bullets; ready to paste)

See PRP.md "Implementation Blueprint" → ready-to-paste markdown block. Prose only (no table) →
pretter `proseWrap: preserve` will not reformat; `format:check` stays green. Heading
`## Self-Healing & Resilience` is unique (no MD024 sibling conflict).

## 7. Decisions (locked)

- Placement: new `## Self-Healing & Resilience` section immediately AFTER `## Features` bullet list
  and BEFORE `## Usage Examples` (most discoverable; surfaces capability at major-section level).
- Add ONE bullet to the `## Features` list pointing into the new section.
- Do NOT add rows to the README `### Environment Variables` table (would duplicate
  CONFIGURATION.md#resilience-tuning → staleness). Name knobs INLINE in the section + LINK.
- Do NOT touch the mermaid diagrams, docs/*.md, PRD.md, tasks.json, .gitignore.
