# Research — P1.M1.T3.S1: Verify README.md & docs/ARCHITECTURE.md §9.9 G1.4 references post-fix

> Verification research for the changeset-level documentation sync (Mode B). Determines whether the
> G1.4 Blueprint-prompt fix shipped in P1.M1.T1.S1 (commit `363ee37`) makes any existing
> README.md / docs/ARCHITECTURE.md / docs/*.md reference to the G1.x guardrails inaccurate.

## 0. TL;DR (the finding)

**NO EDITS ARE NEEDED to `README.md` or `docs/ARCHITECTURE.md` (or any `docs/*.md`).** Both reference
PRD §9.9 at a high level; `docs/ARCHITECTURE.md` enumerates the construction-time guardrails as a
numeric **range** `G1.1–G1.5` (en-dash, U+2013 — verified by xxd) which already correctly
encompasses G1.4. Neither doc enumerates the individual G1.x bullets per-prompt, and neither
implies G1.4 is Blueprint-only or Builder-only. The `PROMPTS.md` mirror was updated by T1.S1
itself (out of this task's scope). The "no edit" finding must be **recorded** (verification note +
commit message), per the work item's OUTPUT clause.

## 1. What P1.M1.T1.S1 (commit `363ee37`) actually changed

- `src/agents/prompts.ts` — inserted a G1.4 bullet into `PRP_BLUEPRINT_PROMPT`'s gate-construction
  CRITICAL RULES block, between the G1.3 and G1.5 bullets. (`PRP_BUILDER_PROMPT` already had G1.4;
  it was unchanged.)
- `PROMPTS.md` — mirrored the same G1.4 bullet at **line 277** (between G1.3 at L276 and G1.5 at
  L278), in regular markdown. Verified present:
  `277:- **Throwaway artifacts must survive the coder's turn (PRD §9.9 G1.4).** ...`
- `tests/unit/agents/prompts.test.ts` — added a Blueprint G1.4 `it()` case.

So the dual-prompt requirement (Blueprint **and** Builder both carry G1.4) is now satisfied in
code + the `PROMPTS.md` mirror. This task only checks the *other* docs.

## 2. Grep results across README.md + docs/ (the item's specified command)

Command run: `grep -rni 'G1\.4\|throwaway.*surviv\|Blueprint.*gate\|§9\.9\|G1\.1\|G1\.2\|G1\.3\|G1\.5' README.md docs/ARCHITECTURE.md docs/*.md`

Matches found (only these):

| File                 | Line | Content (abridged)                                                                                                          | Enumerates G1.x per-prompt? |
| -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `README.md`          | 151  | "...gates are monotonic terminal-state assertions (PRD §9.9): the executor re-runs every gate as a batch ... neutralizes non-monotonic negative-existence gates." | **No** — high-level only    |
| `docs/ARCHITECTURE.md` | 670 | "Gate Semantics (PRD §9.9). Validation gates are _monotonic terminal-state assertions_ ..."                                  | No (prose)                  |
| `docs/ARCHITECTURE.md` | 673 | "Negative file-existence gates are **forbidden at construction** (REQ-G1: **G1.1–G1.5**) ..."                                | **Range** (en-dash), not per-prompt |
| `docs/ARCHITECTURE.md` | 676 | "...reason citing §9.9, while negated _content_ gates (`! grep …`) execute normally."                                        | No                          |

Full recursive sweep (incl. `docs/api/`, `docs/research/`) returns ONLY `docs/ARCHITECTURE.md:673`
for the G1.x range. No `G1.4` literal, no `throwaway.*surviv`, no `Blueprint.*gate`, no
per-prompt `G1.1`/`G1.2`/`G1.3`/`G1.5` enumeration exists anywhere in README.md or docs/.

## 3. Why each reference is already accurate

- **README.md:151** — A single "Features" bullet describing the §9.9 behavior at the runtime level
  (monotonic assertions; batch re-run; neutralization). It does not list the construction-time
  G1.x rules at all, so adding G1.4 to the Blueprint prompt cannot make it stale. ✅ accurate.
- **docs/ARCHITECTURE.md:670–676** — The "Gate Semantics (PRD §9.9)" paragraph describes REQ-G1
  (forbidden at construction) and REQ-G2 (neutralized at runtime). The construction guardrails are
  cited as a **range `G1.1–G1.5`** using an en-dash (U+2013 — verified via `xxd`:
  `G1.1` + `e2 80 93` + `G1.5`). A numeric range by definition already includes every member,
  **including G1.4**, regardless of which prompt carries it. The paragraph never claims G1.4 lives
  in only one prompt, so it cannot become inaccurate from the dual-prompt fix. ✅ accurate.

## 4. Other doc references checked (none stale, all out of edit scope)

- `docs/CUSTOM_AGENTS.md:236` — links `PRP_BLUEPRINT_PROMPT` → `../PROMPTS.md#L189-L638`. This is a
  **coarse whole-prompt line-range anchor**, not a G1.x reference. T1.S1 inserted one line at
  PROMPTS.md ~L277 (inside the block), so the anchor still points at the Blueprint prompt correctly.
  The anchor end (L638) is now off by ~1 line because the prompt grew, but (a) it is a coarse range
  that still resolves to the prompt, (b) it is **not** a G1.4-accuracy issue, and (c) re-anchoring
  reference doc line numbers is explicitly **out of scope** for this changeset (the work item is
  scoped to §9.9 / G1.4 references only). **Do not touch it.**
- `docs/CUSTOM_AGENTS.md:173,216,481,1929`, `docs/TESTING.md:176`, `docs/WORKFLOWS.md:443`,
  `docs/GROUNDSWELL_GUIDE.md:18,84` — mention the Blueprint prompt by name / file path / a generic
  "Critical Rules" heading. None enumerate G1.x or describe the gate rules. ✅ not stale.

## 5. Authoritative spec (READ-ONLY — do NOT edit)

`spec/16-validation-gates.md:27` defines G1.4 verbatim:
> "G1.4 — Throwaway artifacts survive the coder's turn. The Blueprint and Builder prompts MUST
> instruct the Coder Agent **not** to delete a throwaway artifact (e.g. a spike file) during its
> own turn; any cleanup happens after validation."

The reference docs (README/ARCHITECTURE) are intentionally high-level pointers to §9.9 / REQ-G1 and
do not — and should not — restate this per-prompt. So no doc edit is required to match the spec.

## 6. Recording the finding (since no edit is needed)

The work item's OUTPUT clause: *"If no edits are needed, that fact is recorded in the commit
message."* Precedent in this changeset: every sibling subtask (P1.M1.T1.S1, P1.M1.T2.S1, P1.M1.T2.S2)
has a `research/` note documenting what it did. This task's durable, reviewable artifact is therefore
**this verification note** (the determination that README/ARCHITECTURE are accurate) plus a commit
message that states the outcome. If the orchestrator's commit-of-record for the work item only fires
on file changes, this note is the committed artifact; the commit message carries the "no edit needed"
determination.

## 7. Deterministic re-verification recipe (for the implementing agent)

```bash
# (a) Re-confirm no per-prompt G1.x enumeration / stale G1.4 claim exists in the docs.
grep -rni 'G1\.4\|throwaway.*surviv\|Blueprint.*gate\|§9\.9\|G1\.1\|G1\.2\|G1\.3\|G1\.5' \
  README.md docs/ARCHITECTURE.md docs/*.md
# EXPECTED: README.md:151 (high-level), docs/ARCHITECTURE.md:670,673,676 (range G1.1–G1.5).
# EXPECTED: NO literal "G1.4" match, NO per-prompt enumeration, NO "only the Builder" claim.

# (b) Sanity-check the en-dash range still spans G1.4 (should print the range token).
sed -n '673p' docs/ARCHITECTURE.md | grep -o 'G1.1.G1.5'

# (c) Confirm the T1.S1 mirror is in place in PROMPTS.md (informational — not in edit scope).
grep -n 'G1\.4' PROMPTS.md   # EXPECTED: L277 (Blueprint) + L714/L715 (Builder)
```

**Decision gate:** If (a) returns ONLY the high-level §9.9 / range references above → **no edit**;
record the finding (§6). If (a) returns any line that enumerates G1.x per-prompt or claims/implying
G1.4 is Builder-only → apply the contingency edit in the PRP, then `npx prettier --check <file>`.

---

## 7.1. Executed re-verification (implementation run, P1.M1.T3.S1)

The §7 recipe was re-run during implementation. Captured output below is verbatim from the
terminal (commands executed against the post-T1.S1 tree).

### (a) G1.x / §9.9 grep sweep over README.md + docs/

Command:

```bash
grep -rni 'G1\.4\|throwaway.*surviv\|Blueprint.*gate\|§9\.9\|G1\.1\|G1\.2\|G1\.3\|G1\.5' \
  README.md docs/ARCHITECTURE.md docs/*.md
```

Output (note: `docs/*.md` re-expands `docs/ARCHITECTURE.md`, so its three lines appear twice —
this is grep argument overlap, not duplicate references):

```
README.md:151:- **4-Level Validation**: Syntax, unit tests, integration tests, and manual validation gates — gates are monotonic terminal-state assertions (PRD §9.9): the executor re-runs every gate as a batch on the final tree and neutralizes non-monotonic negative-existence gates.
docs/ARCHITECTURE.md:670:**Gate Semantics (PRD §9.9).** Validation gates are _monotonic terminal-state assertions_: once
docs/ARCHITECTURE.md:673:during its turn). Negative file-existence gates are **forbidden at construction** (REQ-G1: G1.1–G1.5)
docs/ARCHITECTURE.md:676:reason citing §9.9, while negated _content_ gates (`! grep …`) execute normally. This repairs
docs/ARCHITECTURE.md:670:**Gate Semantics (PRD §9.9).** Validation gates are _monotonic terminal-state assertions_: once
docs/ARCHITECTURE.md:673:during its turn). Negative file-existence gates are **forbidden at construction** (REQ-G1: G1.1–G1.5)
docs/ARCHITECTURE.md:676:reason citing §9.9, while negated _content_ gates (`! grep …`) execute normally. This repairs
```

Literal `G1.4` check (should be empty):

```bash
$ grep -rn 'G1\.4' README.md docs/
(none)
```

### (b) En-dash range token at docs/ARCHITECTURE.md:673

```bash
$ sed -n '673p' docs/ARCHITECTURE.md | grep -o 'G1.1.G1.5'
G1.1–G1.5

$ sed -n '673p' docs/ARCHITECTURE.md | grep -o 'G1.1.G1.5' | xxd
00000000: 4731 2e31 e280 9347 312e 350a            G1.1...G1.5
```

The `e2 80 93` bytes are U+2013 (EN DASH) — a numeric **range** that spans G1.4. Intact.

### (c) T1.S1 mirror present in PROMPTS.md (informational — out of edit scope)

```bash
$ grep -n 'G1\.4' PROMPTS.md
277:- **Throwaway artifacts must survive the coder's turn (PRD §9.9 G1.4).** ...
714:   **Do not delete throwaway / spike artifacts during your turn (PRD §9.9 G1.4).** ...
```

### Decision-gate outcome

- (a) returned ONLY the expected high-level §9.9 reference (README.md:151) and the ARCHITECTURE.md
  §9.9 paragraph / `G1.1–G1.5` range (docs/ARCHITECTURE.md:670, 673, 676).
- No literal `G1.4`, no per-prompt G1.x enumeration, and no "G1.4 is Builder-only" claim exists
  in README.md or any `docs/*.md`.
- (b) the `G1.1–G1.5` en-dash range is intact and spans G1.4.
- (c) the T1.S1 outputs this task verifies against are present.

**→ Decision gate routes to the NO-EDIT branch.** No `README.md` or `docs/*.md` file was modified
for G1.4-accuracy reasons. `npx prettier --check` is N/A (no doc edited). No out-of-scope file
(`PRD.md`, `spec/*`, `tasks.json`, `prd_snapshot.md`, `src/**`, `tests/**`, `PROMPTS.md`,
`.gitignore`) was modified by this task (the only working-tree changes attributable to this task
live under `plan/.../P1M1T3S1/` — this note).

> VERIFIED 2026-08-06: README.md + docs/ARCHITECTURE.md (+ docs/*.md) accurate post-T1.S1 G1.4
> fix. Edit applied: none. Determination: NO-EDIT branch (grep returned only high-level §9.9
> references + the `G1.1–G1.5` en-dash range at docs/ARCHITECTURE.md:673, which spans G1.4).

**Suggested commit message (NO-EDIT branch):**
`Verify README/ARCHITECTURE §9.9 G1.4 references accurate post-T1.S1 fix; no doc edits needed`