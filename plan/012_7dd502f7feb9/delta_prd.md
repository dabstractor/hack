# Delta PRD — Session 012 (PRD 011 → 012)

> **Scope of this delta.** Session `012_7dd502f7feb9` implements the
> substantive additions in the current PRD vs. the `011` snapshot. The diff
> (`diff plan/011_*/prd_snapshot.md <merged-current-PRD>`) is exactly **two new
> features** plus their config/env wiring and a trailing cosmetic blank line:
>
> 1. **Commit Message Style layer** (`PRP_COMMIT_STYLE` /
>    `PRP_COMMIT_STYLE_EXAMPLES`) — PRD §5.1 "Commit Message Style (Learning &
>    Explicit Modes)", §9.2.2 (two new env vars), §9.7.5 (two new `[pipeline]`
>    schema rows + example `.hack`), and a one-line clarification on the
>    existing `PRP_COMMIT_FORMAT` "position layer" bullet.
> 2. **Manual Status Updates** (`hack update`) — PRD §5.4, an entirely new
>    functional-requirements section.
>
> Everything else in the PRD is byte-identical to the `011` snapshot (the
> `[cli] prd` row whitespace tweak and the trailing blank line are cosmetic and
> produce no task).

## What is NOT changing (reality check — do NOT re-implement)

- **§9.9 Validation Gate Semantics** — COMPLETE in session 011 (REQ-G1 prompt
  guardrails + REQ-G2 executor neutralization + tests + Mode B docs). The
  `011`→`012` PRD diff does not touch §9.9. No task.
- **`PRP_COMMIT_FORMAT` position layer + `formatCommitMessage` + Smart Commit
  resilience** — COMPLETE. `formatCommitMessage` (`src/utils/git-commit.ts:214`)
  already layers the `task-prefix`/`plain` position prefix and appends the
  `Co-Authored-By` trailer; `getPrpCommitFormat()` (`src/config/constants.ts`)
  already reads `PRP_COMMIT_FORMAT`. The Style feature below reuses this path
  unchanged — the style layer only changes the **descriptive message**
  `stagecoach` emits, not the position layer that wraps it.
- **§5.1 Smart Commit Resilience** (commit-gen retry + fallback placeholder),
  **§5.3 `hack task`/`hack status`** + the breakdown-in-progress window, and
  the **`tasks.json` lock** (`src/core/file-lock.ts`, O_EXCL with
  `TASKS_LOCK_*` tunables) — all COMPLETE and reused as-is by the new `hack
  update` write path.
- **§9.7 `.hack` loader** (discovery/layering/secrets/validation/`hack config`
  subcommand) — COMPLETE. The two new `[pipeline]` keys below are added to the
  existing schema map; no loader change.

## Leveraged prior research

Session 011 already mapped the commit-message and CLI surfaces this delta
touches. Reuse, do not re-research:
- `plan/011_5e3dfdb12bd1/architecture/implementation-status.md` — confirms the
  runtime prompts live in `src/agents/prompts.ts` (NOT `PROMPTS.md`), and that
  the `task`/`status` subcommands are registered via a shared `taskAction`
  helper in `src/cli/index.ts` (the new `update` command mirrors this pattern).
- Commit generation boundary: `createCommitMessageAgent()` + the const
  `COMMIT_MESSAGE_SYSTEM` in `src/agents/commit-message-agent.ts`, called from
  `generateCommitMessage(diff)` → `buildCommitMessageUserPrompt(diff)` in
  `src/utils/git-commit.ts`; git ops via `simple-git` helpers in
  `src/tools/git-mcp.ts` (already wraps `git.log(...)` at line 546 — the
  recent-commits helper follows the same pattern).

---

# Feature 1 — Commit Message Style Layer (PRD §5.1 "Commit Message Style")

## Requirement

A generated commit message is governed by **two orthogonal layers**, resolved
independently and applied in sequence:

1. **Position layer** (`PRP_COMMIT_FORMAT`, already implemented) — whether/how
   the backlog position (`1.2.1.1:`) is prepended. Never touches the wording of
   the descriptive message.
2. **Style layer** (`PRP_COMMIT_STYLE`, **NEW**) — the contract for the
   descriptive message `stagecoach` actually writes. Mirrors the
   style-learning and explicit-format-mode model of the `stagecoach` tool the
   pipeline delegates to, so the pipeline's own defaults and `stagecoach`'s
   agree.

### Style resolution modes

- **`PRP_COMMIT_STYLE=auto` (DEFAULT — learned from history):** When no
  explicit style is set, the pipeline learns the project's style from recent
  history. The Smart Commit generation request MUST include the last
  `PRP_COMMIT_STYLE_EXAMPLES` (default **5**) commit messages from the
  repository as **style examples**, with a **hard anti-reuse instruction**:
  match the STYLE of the examples (format, tone, length, whether they carry a
  Conventional-Commit type prefix or a gitmoji), but NEVER copy or reuse their
  wording — produce entirely original wording for THIS change. The examples are
  sent VERBATIM, and the instruction MUST tell the agent to IGNORE any leading
  numeric position prefix (`1.2.1.1:`), which is a position marker the position
  layer adds — not part of the style to imitate and not part of the descriptive
  message to emit. The agent still emits ONLY the descriptive message; the
  position layer is applied afterward by `formatCommitMessage` exactly as
  today. When the repository has **≤1 commit** (nothing to learn), `auto`
  degrades to the `plain` contract so a fresh repo is never asked to imitate
  absent history.
- **`PRP_COMMIT_STYLE=plain` (explicit):** Plain descriptive imperative
  summary — imperative mood, ≤72-char subject, no trailing period, no type
  prefix, no scope, no emoji. This is the **current fixed** `stagecoach` system
  prompt (`COMMIT_MESSAGE_SYSTEM` in `src/agents/commit-message-agent.ts`),
  promoted to an explicit named mode; it is also the `auto` fallback for
  ≤1-commit repos.
- **`PRP_COMMIT_STYLE=conventional` (explicit):** Conventional-Commits contract
  for the descriptive message — `type(scope): description` from the standard
  vocabulary (`feat fix docs style refactor perf test build ci chore revert`),
  scope optional, ~50-char description.
- **`PRP_COMMIT_STYLE=gitmoji` (explicit):** The descriptive subject begins
  with exactly one gitmoji (the emoji character itself, not a `:shortcode:`),
  followed by a space and the description. The canonical gitmoji reference
  table is **compiled into the binary at build time** (no network fetch),
  refreshed with the same verification discipline as the model defaults.

### Mode-conditional system prompt

Because the styles conflict — `plain` forbids a type prefix while
`conventional` requires one — the `stagecoach` agent's system prompt MUST be
built **dynamically from the resolved style mode** (the current hardcoded
`COMMIT_MESSAGE_SYSTEM` becomes the `plain` contract): `auto` injects the
last-N examples + anti-reuse + ignore-position-prefix instructions; each
explicit mode injects its contract verbatim. In every mode the output
discipline is unchanged: emit ONLY the descriptive message (no position
prefix, no `[PRP Auto]` banner, no `Co-Authored-By` trailer — those remain
`formatCommitMessage`'s job).

### Interaction with the position layer

Both layers apply in sequence, independently: the agent generates the
descriptive message under the resolved style contract (and, in `auto`, with
the last-5 examples in context); `formatCommitMessage` then layers the
position prefix (`task-prefix`) or emits it bare (`plain`), exactly as today.
When an explicit style that produces its own prefix (`conventional`,
`gitmoji`) is combined with `PRP_COMMIT_FORMAT=task-prefix`, both prefixes
render and the subject takes the form `<position>: type(scope): description`
(or `<position>: <emoji> description`); a team that wants a clean
Conventional-Commit / gitmoji history sets `PRP_COMMIT_FORMAT=plain` so the
position layer does not double up. (Under `auto`, the same double-up can occur
if the learned style is conventional/gitmoji — that is the project's own voice
being matched, and the same `PRP_COMMIT_FORMAT=plain` remedy applies.)

### Scope & guarantees

- Style examples are sent ONLY for the `stagecoach` descriptive-message
  generation request; they never affect the position layer, the Smart Commit
  Resilience fallback placeholder (`chore: commit-gen failed …`, which carries
  no descriptive message), or any non-generated commit.
- Toggling the style affects only newly generated messages; existing history
  is never rewritten.
- The anti-reuse instruction is **advisory** — it steers the model away from
  verbatim copying of the example wording — and is NOT a mechanical
  duplicate-rejection gate: a generated subject that happens to repeat a recent
  one is still committed, consistent with the pipeline's
  never-fail-on-commit contract (substance is never stranded for a style
  nicety).
- `PRP_COMMIT_STYLE_EXAMPLES=0` disables style learning even under `auto` (no
  examples are sent) and degrades to the `plain` contract.

### Config / env wiring (PRD §9.2.2 + §9.7.5)

Two new tunables, added alongside the existing `PRP_COMMIT_FORMAT`:

| Canonical env var            | `.hack` key                          | Type                                         | Default |
| ---------------------------- | ------------------------------------ | -------------------------------------------- | ------- |
| `PRP_COMMIT_STYLE`           | `[pipeline] commit_style`            | `auto`\|`plain`\|`conventional`\|`gitmoji`   | `auto`  |
| `PRP_COMMIT_STYLE_EXAMPLES`  | `[pipeline] commit_style_examples`   | int ≥ 0                                      | `5`     |

The existing `PRP_COMMIT_FORMAT` description is retitled "Commit-message
**position layer**" to reflect the orthogonal-axes framing (the bullet that
forbids Conventional-Commit *scope* encoding is clarified: it forbids encoding
the *position* as a scope, not a genuine Conventional-Commit type/scope or
gitmoji in the descriptive message).

**Documentation impact (Mode A — doc-with-work):**
- `.env.example` — add the two new canonical env vars (with the same
  deprecation-note discipline as the other `PRP_*` keys). Rides with the
  config-constants subtask.
- JSDoc on the new `getPrpCommitStyle()` / `getPrpCommitStyleExamples()`
  readers, the dynamic system-prompt builder, and the recent-commits helper —
  rides with the implementing subtasks.

---

# Feature 2 — Manual Status Updates: `hack update` (PRD §5.4)

## Requirement

The predecessor `tsk update` UX is preserved: a user can manually rewrite any
item's status from the command line, with **both** the task ID and the target
status fuzzy-matched so the command is as easy to type as possible.

### Command surface

```bash
hack update <task-id> <status> [-f <file>] [--session <hash>] [-o text|json]
```

```bash
hack update P1.M1.T1.S1 ready        # full canonical form
hack update p1.m1.t1.s1 ready        # case-insensitive, dotted
hack update p1m1t1s1 ready           # concatenated, no dots
hack update 1.1.1.1 re               # numeric form (letters not required) + 2-letter status
hack update 1.2 done                 # milestone + synonym status
hack update 2 comp                   # phase + prefix status
```

### Loose task-ID matching

The `<task-id>` is normalized before lookup, so all of the following are
equivalent:

- Canonical: `P1.M1.T1.S1`
- Case-insensitive / unpunctuated: `p1.m1.t1.s1`, `p1m1t1s1`
- Numeric (the `P`/`M`/`T`/`S` letters are **not** required): `1.1.1.1` →
  `P1.M1.T1.S1`, `1.2` → `P1.M2` (milestone)

Segments map positionally Phase → Milestone → Task → Subtask, so `1`, `1.2`,
`1.2.3`, and `1.2.3.4` target a Phase, Milestone, Task, and Subtask
respectively. Trailing segments may be omitted.

### Loose status matching

The `<status>` argument is fuzzy-matched to a canonical status in this order:

1. **Synonym/alias table** (exact, case-insensitive) — for shorthands that are
   not derivable from the canonical word, or that would otherwise be ambiguous:
   - `d`, `done`, `fin`, `finished`, `completed` → **Complete**
   - `re`, `rdy` → **Ready**
2. **Canonical exact** (case-insensitive): `ready`, `Complete`, `FAILED`, …
3. **Unique prefix**: `c`→Complete, `p`→Planned, `i`→Implementing, `o`→Obsolete,
   `f`→Failed, `res`/`research`→Researching, `comp`→Complete, `impl`→Implementing,
   `plan`→Planned, `obs`→Obsolete.
4. **Unique substring**: any substring that matches exactly one status.
5. **Ambiguous** (e.g. `r` matches both Ready and Researching) → error listing
   the candidates. **Unknown** → error listing the valid statuses.

The matchable status set is the lifecycle set from §5.3 plus `Ready`:
`Planned`, `Researching`, `Ready`, `Implementing`, `Complete`, `Failed`,
`Obsolete`. (`Retrying` is an internal transitional status set by the retry
manager and is intentionally **not** manually settable — setting it by hand
would fight the orchestrator. A stuck `Retrying` item is reset by setting it to
`Planned` or `Ready`.)

### Cascade semantics

Updating one item keeps the hierarchy consistent:

- **Setting a parent to `Complete` cascades `Complete` to every descendant**
  (so `hack update 1 done` marks the whole phase tree Complete), exactly like
  the predecessor.
- **Ancestor recompute.** After the target item is changed, every ancestor's
  status is recomputed bottom-up as the **minimum** (least-progressed) status
  among its non-`Failed` children (`Failed` children are excluded unless ALL
  children are `Failed`, in which case the parent becomes `Failed`; `Obsolete`
  is treated as terminal alongside `Complete`, and loses ties to it so a
  fully-done parent reports `Complete`). Marking the last incomplete subtask
  `Complete` promotes its task/milestone/phase to `Complete`; resetting a
  subtask back to `Planned` drops its ancestors to reflect the remaining work.

> **Note on existing code.** `src/utils/task-utils.ts` already has
> `promoteIfAllComplete` + `rollupCompletion`, but those are
> **monotonic promote-to-Complete-only** (they short-circuit on
> `Complete`/`Obsolete` parents and never downgrade). The `hack update`
> cascade is strictly richer: a downward Complete cascade PLUS a bottom-up
> **minimum-status** recompute that can downgrade ancestors (resetting a
> subtask to `Planned` must drop its parents). Implement the new cascade as a
> distinct function; do not weaken the existing monotonic rollup used by the
> orchestrator's automatic status writes.

### Task file discovery

`hack update` resolves the target `tasks.json` with the same priority as
`hack task` / `hack status` (§5.3 Task File Discovery Priority): `--file <path>`
overrides everything; otherwise the latest session is selected (explicit
`--session <hash>` or the latest), preferring a bugfix child's `tasks.json`
over the main session's. Unlike the read-only `status` command, `update` is a
**write**: a missing _discovered_ `tasks.json` (breakdown-in-progress) is a
**hard error** with a clear message, NOT the calm `awaiting_breakdown` notice —
the user must wait for breakdown or point at an explicit `--file`.

### Concurrency & integrity

Every `hack update` is a serialized read-modify-write: it acquires the same
exclusive `tasks.json.lock` (sibling lockfile via `src/core/file-lock.ts`) used
by the orchestrator and research supervisor, validates the result through the
canonical backlog schema, and writes atomically (temp file + rename). It can
therefore never corrupt `tasks.json` or race a concurrent writer (§5.1). A lock
that cannot be acquired within the configured timeout (`TASKS_LOCK_TIMEOUT_MS`)
fails fast with a clear message rather than blocking indefinitely.

### Output

On success it prints `Updated <ID> status to <Status>` to stdout; under
`-o json` it emits `{ "id", "status", "title" }`. Errors (task not found,
ambiguous/unknown status, file not found, lock timeout) print a clear message
to stderr and exit non-zero.

### Acceptance criteria (PRD §5.4)

- `hack update 1.1.1.1 done` sets `P1.M1.T1.S1` to `Complete` and prints a
  success line; `hack task` afterward shows the subtask `Complete`.
- `hack update p1m1t1s1 re` resolves to `P1.M1.T1.S1` → `Ready` (synonym),
  case-insensitively.
- `hack update 1 done` cascades `Complete` to every item under `P1`.
- `hack update <last-incomplete-subtask> comp` promotes its parent
  Task/Milestone/Phase to `Complete` via ancestor recompute.
- `hack update <a-subtask> p` (reset to Planned) drops its Task/Milestone/Phase
  ancestors to reflect the least-progressed child.
- `hack update 9.9.9.9 done` (unknown id) exits non-zero with a clear "not
  found" message.
- `hack update 1.1.1.1 r` exits non-zero with an ambiguity message listing
  `Ready` and `Researching`.
- `hack update 1.1.1.1 bogus` exits non-zero with the list of valid statuses.
- `hack update` writes atomically (temp + rename) under the §5.1 lock, so a
  concurrent writer can never lose an update.

**Documentation impact (Mode A — doc-with-work):**
- JSDoc on the new loose-ID normalizer/matcher, status matcher, and cascade
  function — rides with the implementing subtasks.

---

# Feature 3 (Mode B) — Sync changeset-level documentation

Cross-cutting docs that only make sense once both features land. Per the
two-mode rule (§6.1) this is a final Mode B task depending on every
implementing subtask:

- **`docs/CONFIGURATION.md`** — document the two new commit-style env vars /
  `.hack` keys (`PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES`) and the new
  `hack update` subcommand (flags, fuzzy matching, cascade, lock).
- **`docs/ARCHITECTURE.md`** — extend the existing commit-message section to
  describe the two-layer model (position + style) and add a short note on the
  `hack update` manual-status-rewrite command.
- **`README.md`** — wherever it lists commands or commit behavior, add `hack
  update` and the style layer (the existing `task-prefix`/`plain` table row
  already references `docs/CONFIGURATION.md`).
- Do NOT edit `PRD.md` (human-owned), `tasks.json`, `prd_snapshot.md`, or
  `PROMPTS.md` (the `stagecoach` system prompt is runtime code in
  `src/agents/commit-message-agent.ts`; the legacy `PROMPTS.md` reference does
  not document commit-message style and needs no mirror here).