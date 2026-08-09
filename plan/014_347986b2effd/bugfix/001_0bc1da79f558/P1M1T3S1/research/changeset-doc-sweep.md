# Research — P1.M1.T3.S1: Sweep README.md & overview docs for the §2.3 idempotency/marker changeset

> Mode-B changeset-level documentation sweep for BUG-001 (collision-proof markers, T1.S1 Complete) +
> BUG-002 (depth-gate elision, T2.S1 Ready/Implementing). Per-file JSDoc/test comments are already
> updated by those subtasks (Mode A). **This task covers ONLY cross-cutting / overview docs** — README.md
> + docs/*.md — and RECORDS (never edits) recommendations against the human-owned spec.

## 0. The two fixes (the post-fix reality docs must reflect)

- **BUG-001 (T1.S1, Complete)** — the three include-marker comments were made **structurally
  non-resolvable** by changing `@` → `@!` (technique B: `!` is outside the `[A-Za-z0-9_./-]` path class,
  so `RESOLVE_TOKEN`'s group can't start). Confirmed in source `src/core/session-utils.ts`:
  - L331-332, L465-466: `<!-- @!include: path -->` / `<!-- @!end-include -->`
  - L442, L503: `<!-- @!include-ref: ${token} -->`
  - L552: `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->`
  **OLD format (now stale everywhere it appears):** `<!-- @include: path -->` / `<!-- @end-include -->`
  / `<!-- @include-ref: token -->`.
- **BUG-002 (T2.S1, Ready)** — the depth gate (`if (depth >= maxDepth) return content`) no longer
  returns the boundary body UNSCANNED. It now runs a `neutralizeResolvableTokens` scan that **ELIDES**
  resolvable-to-file survivors (markers off → dropped; markers on → `<!-- @!include-ref: token -->`)
  and leaves non-resolvable prose verbatim. Net: `resolve(resolve(x)) === resolve(x)` now holds
  **UNCONDITIONALLY** (within cap → expands; at/beyond cap → resolvable tokens elided, prose verbatim).
  **OLD depth behavior (the "literal survivor" leak):** boundary body returned unscanned → resolvable
  `@token`s survived literal → expanded on a 2nd pass → fixed point broke for deep LINEAR chains or
  lowered `PRD_INCLUDE_MAX_DEPTH`.

## 1. Doc sweep — README.md + docs/*.md

Command: `grep -rni 'distributed PRD|@-include|@include|dedup|elision|elid|idempot|fixed point|resolve(resolve|PRD_INCLUDE_MARKERS|PRD_INCLUDE_MAX_DEPTH|§2.3|marker|RESOLVE_TOKEN' README.md docs/*.md`
(Note: the pattern `@include` does NOT match the new `@!include` — `!` sits between `@` and `i` — so it
isolates the OLD-format references cleanly.)

### 1a. STALE OLD-MARKER-FORMAT references (the 3 edits this task makes)

These overview docs still show the pre-BUG-001 marker byte format and MUST be updated to `@!`:

| File:line | Current (OLD) | Fix to (NEW) |
| --------- | ------------- | ------------ |
| `README.md:135` | `Set PRD_INCLUDE_MARKERS to emit <!-- @include: path --> markers` | `<!-- @!include: path -->` |
| `docs/ARCHITECTURE.md:170` | `resolved output emits <!-- @include: path --> / <!-- @end-include --> markers` | `<!-- @!include: path --> / <!-- @!end-include -->` |
| `docs/CONFIGURATION.md:310` | `resolved output emits <!-- @include: path --> / <!-- @end-include --> markers` | `<!-- @!include: path --> / <!-- @!end-include -->` |

(The `@include-ref` form is not mentioned in overview docs, so only the include/end-include pair needs
the `!` here. Minimal touch — add `!` after each `@` in the marker examples.)

### 1b. Idempotency / depth prose (verified ACCURATE post-fix — NO edit)

- `docs/ARCHITECTURE.md:168` — "Re-resolution is **idempotent** — identical input bytes yield identical
  resolved bytes." This states the guarantee **unconditionally** — which is now TRUE post-BUG-002 (it was
  aspirational before). Not an overclaim, not an undersell. **Leave it.**
- `README.md:132-134` — "recursively with cycle detection up to `PRD_INCLUDE_MAX_DEPTH`, default `10`."
  Describes the cap; does NOT claim literal-survivor behavior. **Accurate — leave it.**
- `docs/CONFIGURATION.md:305,309` — same depth-cap description + the `PRD_INCLUDE_MAX_DEPTH` env row.
  **Accurate — leave them.** (None of these describe the boundary behavior, so there is no old
  "deeper tokens stay literal" claim to retract.)
- `docs/ARCHITECTURE.md:183,207` — resolver pointer + "computed over the fully-resolved, include-expanded
  PRD." **Accurate — leave.**

### 1c. Unrelated matches (NOT touched — listed only to prove they were checked)

`README.md:145` (distributed-PRD feature bullet), `:159,:181` (`NO_ISSUES_FOUND.md` hunt marker),
`:277` (resume idempotently), `:815` (`# assembled from @includes` comment);
`docs/ARCHITECTURE.md:711` (`AgentConfig.thinking` "marker"), `:981` (`NO_ISSUES_FOUND.md` marker),
`:1156-1157` (`.adopted` marker); `docs/CLI_REFERENCE.md:150,170,371` + `docs/CONFIGURATION.md:421,425`
(`prd_changed.marker` / `.pending_delta_hash` — unrelated "marker" file); `docs/user-guide.md:201`
("Deduplication of duplicate messages" — unrelated). **All unrelated to §2.3 PRD-include resolution.**

### 1d. No "literal survivor" / "deeper tokens stay literal" claim exists in overview docs

`grep -rni 'literal|survivor|deeper token|stay literal' README.md docs/*.md` → no overview doc describes
the old depth-boundary behavior. So there is nothing to retract on that axis — the only stale overview
content is the OLD marker byte format (§1a).

## 2. Human-owned spec — spec/02-core-concepts.md §2.3 (READ-ONLY → RECORD recommendations)

The task FORBIDS auto-mutating this spec. Two lines are now subtly inaccurate and should be flagged for
the human spec-owner (recorded in the commit message + this note), NOT edited here:

- **L30** — "resolved output emits `<!-- @include: path -->` / `<!-- @end-include -->` comment markers."
  → **STALE OLD format.** Recommendation: update to `<!-- @!include: path -->` / `<!-- @!end-include -->`
  (and optionally note the `@!include-ref` elision-ref form) to match the collision-proof BUG-001 format.
- **L25** — "`PRD_INCLUDE_MAX_DEPTH` (default 10) remains as a defense-in-depth recursion cap; **dedup
  itself bounds recursion**, so cycles and diamond dependencies terminate without relying on it." →
  **Subtly incomplete.** Dedup bounds CYCLES/DIAMONDS only; deep LINEAR chains (unique files) are NOT
  bounded by dedup. Post-BUG-002 the depth gate also ELIDES resolvable survivors at/beyond the cap, which
  is what makes idempotency UNCONDITIONAL (§2.3 L27) for linear chains. Recommendation: note that the
  depth gate elides resolvable survivors (not just caps recursion), so idempotency holds regardless of
  depth — closing the gap between the "dedup bounds recursion" framing and the unconditional-idempotency
  MUST at L27.

(L26's "no resolvable `@token` of its own" guarantee is the property BUG-001 now enforces structurally —
still accurate; no recommendation. L27's unconditional idempotency MUST is now actually satisfied — no
recommendation.)

## 3. Scope & constraints

- **Mode B / planning:** edit DOCS ONLY (README.md + docs/*.md). Never source, tests, config,
  `PRD.md`, `**/tasks.json`, `prd_snapshot.md`, and **never `spec/02-core-concepts.md`** (human-owned).
- **Minimal touches:** add `!` after `@` in the 3 marker-format references (§1a). Do not rewrite
  accurate prose. Do not add new sections.
- **Mocking:** none (documentation only).

## 4. Deterministic re-verification recipe (for the implementing agent)

```bash
# (a) Find EVERY stale OLD-marker-format reference in overview docs (the edit set).
grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md
# EXPECTED (pre-edit): README.md:135, docs/ARCHITECTURE.md:170, docs/CONFIGURATION.md:310.
# (The pattern intentionally does NOT match the new @!include form.)

# (b) Confirm NO overview doc claims the old literal-survivor depth behavior.
grep -rni 'literal\|survivor\|deeper token\|stay literal' README.md docs/*.md
# EXPECTED: no §2.3-resolution hit (unrelated "literal" matches only, if any).

# (c) After edits, re-run (a) — EXPECTED: zero matches (all migrated to @!include / @!end-include).
grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md
# EXPECTED: empty.

# (d) Confirm the NEW format now appears in the edited docs.
grep -rn '@!include' README.md docs/*.md
# EXPECTED: the 3 edited lines now show @!include.
```

**Decision gate:** Apply (a)'s edits (each `<!-- @include:` → `<!-- @!include:`, `<!-- @end-include -->`
→ `<!-- @!end-include -->`). Leave (1b) prose untouched. Record (2)'s spec recommendations in the commit
message (do NOT edit the spec). Then (c) must be empty and (d) must show the new format.

---

## 5. Executed re-verification (implementation run, P1.M1.T3.S1)

The §4 recipe was re-run during implementation. Captured output below is verbatim from the terminal.

### (a) OLD marker-format references (pre-edit)

```bash
$ grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md
README.md:135:`PRD_INCLUDE_MARKERS` to emit `<!-- @include: path -->` markers; a stale include warns on
docs/ARCHITECTURE.md:170:When `PRD_INCLUDE_MARKERS` is set, resolved output emits `<!-- @include: path -->` / `<!-- @end-include -->` markers around expanded includes; a `.md` token that fails to resolve (a _stale include_) emits a warning on stderr.
docs/CONFIGURATION.md:310:| `PRD_INCLUDE_MARKERS`   | No       | unset   | When set, resolved output emits `<!-- @include: path -->` / `<!-- @end-include -->` markers around expanded includes; a `.md` token that fails to resolve (stale include) emits a stderr warning. |
```

**Result: exactly the 3 expected stale lines** (README.md:135, ARCHITECTURE.md:170, CONFIGURATION.md:310).

### (b) Literal-survivor / depth claims

```bash
$ grep -rni 'literal\|survivor\|deeper token\|stay literal' README.md docs/*.md
# (hits were all UNRELATED to §2.3 resolution: the @-boundary rule for foo@bar.com,
#  the PARALLEL_RESEARCH "literal" value, and template-literal/backtick syntax notes.
#  NO §2.3-resolution literal-survivor claim exists in any overview doc.)
```

**Result: no §2.3-resolution literal-survivor claim to fix.**

### Edits applied (Task C — minimal `@` → `@!` byte sync)

- `README.md:135` — `<!-- @include: path -->` → `<!-- @!include: path -->`
- `docs/ARCHITECTURE.md:170` — `<!-- @include: path -->` / `<!-- @end-include -->` → `<!-- @!include: path -->` / `<!-- @!end-include -->`
- `docs/CONFIGURATION.md:310` — same `@!` pair. (This insertion pushed the row past prettier's
  column width, so `npx prettier --write docs/CONFIGURATION.md` re-aligned the 4-row include-markers
  table's `Description` column by +2 spaces — a mechanical, scoped table reflow; no unrelated prose
  changed.)

### (c) OLD marker format post-edit (MUST be empty)

```bash
$ grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md
# (no output; grep exit 1 = no matches)
```

### (d) NEW `@!include` format post-edit (MUST appear on the 3 edited lines)

```bash
$ grep -rn '@!include' README.md docs/*.md
README.md:135:`PRD_INCLUDE_MARKERS` to emit `<!-- @!include: path -->` markers; a stale include warns on
docs/ARCHITECTURE.md:170:When `PRD_INCLUDE_MARKERS` is set, resolved output emits `<!-- @!include: path -->` / `<!-- @!end-include -->` markers around expanded includes; a `.md` token that fails to resolve (a _stale include_) emits a warning on stderr.
docs/CONFIGURATION.md:310:| `PRD_INCLUDE_MARKERS`   | No       | unset   | When set, resolved output emits `<!-- @!include: path -->` / `<!-- @!end-include -->` markers around expanded includes; a `.md` token that fails to resolve (stale include) emits a stderr warning. |
```

### Decision-gate outcome

- (a) returned the 3 expected stale lines → EDIT branch applied (Task C). ✓
- (b) no §2.3-resolution literal-survivor claim → nothing to retract on the depth axis. ✓
- (c) post-edit OLD-format grep is EMPTY (migration complete). ✓
- (d) post-edit NEW `@!include` grep shows the 3 edited lines. ✓
- Already-correct idempotency/depth prose left untouched (ARCHITECTURE.md:168 unconditional idempotency
  is now TRUE post-BUG-002; README.md:132-134 + CONFIGURATION.md:305 depth-cap descriptions accurate). ✓
- Source confirmed already on `@!` (src/core/session-utils.ts:562/579 + JSDoc) — docs are now synced to
  the resolver's actual output. ✓
- `spec/02-core-concepts.md` NOT modified (human-owned). ✓

### Spec recommendations (recorded in the commit message; spec NOT edited)

- **spec/02-core-concepts.md:30** — shows the OLD marker format `<!-- @include: path -->` /
  `<!-- @end-include -->`. Recommend the spec-owner update to the collision-proof `@!` form
  (`<!-- @!include: path -->` / `<!-- @!end-include -->`) per BUG-001.
- **spec/02-core-concepts.md:25** — "dedup itself bounds recursion" framing is subtly incomplete:
  dedup bounds cycles/diamonds only; deep LINEAR chains are now bounded for idempotency by the
  depth-gate ELISION (BUG-002 — resolvable survivors are elided, not left literal). Recommend noting
  the depth gate elides resolvable survivors so idempotency holds unconditionally (matching the
  unconditional-idempotency MUST at L27) regardless of depth.

> VERIFIED 2026-08-08: overview docs synced to §2.3 `@!` marker format (BUG-001) + unconditional
> idempotency (BUG-002). Edits: README.md:135, ARCHITECTURE.md:170, CONFIGURATION.md:310. Spec
> recommendations recorded (spec/02 L25, L30) — spec NOT edited.

**Suggested commit message:**
`Sync overview docs to §2.3 @! marker format (BUG-001) + unconditional idempotency (BUG-002) [README/ARCHITECTURE/CONFIGURATION]. Spec recs recorded (spec/02 L25, L30) — spec unmodified.`