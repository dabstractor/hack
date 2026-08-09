# Research Notes — P1.M1.T4.S1

## Sweep README.md for include-marker / dedup / stale-warning accuracy

Mode-B final documentation sweep for the Distributed-PRD Include Dedup bugfix (BUG-001/002/003).
README.md is PROSE documentation — no tests. The contract: verify README against the shipped
post-fix behavior and make **minimal, accurate edits only where prose is now wrong or misleading**;
if already accurate, make NO edit and note that.

---

## 1. Authoritative finding — README is ALREADY ACCURATE

The architecture spec `system_context.md` §Documentation Surface (L97-98) explicitly states:

```
- docs/CONFIGURATION.md:310 — already correct (@!include/@!end-include). Verify only.
- README.md:135,145 — already correct (@!include). Verify only; possibly note symlink-safe dedup.
```

So the architecture analysis already concluded README's marker prose is correct. The task is a
**verification pass** that confirms this against the actual shipped code, with an optional (judgment
call) symlink-dedup note.

## 2. README.md current prose (verbatim — the 3 relevant regions)

### Region A — L129–141: "## Distributed (Multi-File) PRDs" section
```
## Distributed (Multi-File) PRDs

A PRD can be authored across multiple files and assembled into one canonical document at load
time (PRD §2.3). An `@path/to/file.md` token is an _include directive_ — replaced inline by the
referenced file's contents (resolved project-root-relative to the entry PRD's directory,
recursively with cycle detection up to `PRD_INCLUDE_MAX_DEPTH`, default `10`). Set
`PRD_INCLUDE_MARKERS` to emit `<!-- @!include: path -->` markers; a stale include warns on
stderr. Hashing, `prd_snapshot.md`, delta detection, and `prd_selectors`/mdsel all operate over
the **fully-resolved** document, so a split PRD behaves identically to a monolithic one.
`prd_selectors` additionally scope each researcher to only the relevant PRD sections. See
[Configuration](docs/CONFIGURATION.md#distributed-prds) for the env knobs.
```

### Region B — L145: Features bullet
```
- **Distributed (Multi-File) PRDs**: `@include` directives assemble a canonical resolved
  document; `prd_selectors` scope each researcher to relevant PRD sections.
```

### Region C — L815: project-tree comment
```
├── spec/SPEC.md            # Master product requirements (assembled from @includes)
```

## 3. Shipped post-fix behavior (source-of-truth — verified)

### (a) Marker format — src/core/session-utils.ts
- **L560** (markers on, EXPANDED include): `` `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->` ``
- **L577** (markers on, ELIDED 2nd+ encounter): `` `<!-- @!include-ref: ${token} -->` ``
- Vocabulary: `@!include` (open), `@!end-include` (close), `@!include-ref` (elided ref). The `@!`
  prefix is the deliberate collision-proof technique (BUG-001 fixed the constants.ts JSDoc to
  match; the emitted code was already `@!`).

### (b) Stale-include warning — src/core/session-utils.ts
- **L589–590**: `console.warn('[prd-resolver] stale include ...')` via `console.warn` (→ stderr).
- **Post-BUG-002 (T2.S1, Complete):** the warning is now emitted UNCONDITIONALLY — including for a
  stale `.md` token that lands at the maxDepth depth-gate (the `neutralizeResolvableTokens` path
  now routes stale `.md` detection through the shared warning). So "a stale include warns on
  stderr" is now fully accurate with NO depth-gate exception.

### (c) Dedup keying — src/core/session-utils.ts
- **Post-BUG-003 (T3.S1, Implementing):** the visited set keys on `dedupKey(abs)` =
  `realpathSync(abs)` with lexical fallback — the CANONICAL (realpath-resolved) absolute path. Two
  symlink aliases to one physical file now dedup (content appears once). Markers/messages/stat/
  recursion/elision output UNCHANGED.

## 4. Verification matrix — README claim vs. shipped behavior

| README location | Claim | Shipped behavior | Verdict |
|-----------------|-------|------------------|---------|
| L135 `<!-- @!include: path -->` | The marker emitted when PRD_INCLUDE_MARKERS is set | L560 emits `<!-- @!include: ${token} -->` (the open marker) | ✅ **ACCURATE** — matches the emitted open marker byte-for-byte (`path` ≡ `token` ≡ the matched include path) |
| L135–136 "a stale include warns on stderr" | Stale includes produce a stderr warning | L589–590 `console.warn(...)`; post-BUG-002 unconditional incl. depth-gate | ✅ **ACCURATE** — fully correct post-BUG-002 (no depth-gate exception remains) |
| L132 "`@path/to/file.md` token is an include directive" | Directive syntax | The resolver matches `@<token>` tokens | ✅ ACCURATE |
| L132 "cycle detection up to `PRD_INCLUDE_MAX_DEPTH`, default `10`" | Depth bound | `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10` | ✅ ACCURATE |
| L145 "`@include` directives" (Features bullet) | Shorthand for include directives | The directive is `@path`, not a literal `@include` token | ⚠️ IMPRECISE but NOT WRONG — the body (L132) clarifies it; "include directives" is a reasonable term. Not one of the 3 contract concerns. |
| L815 "assembled from @includes" | Generic shorthand | `@path` includes | ✅ fine (generic, not a marker claim) |
| (no dedup mention anywhere) | n/a | Dedup now symlink-safe (canonical key) | ➖ **N/A** — README describes include resolution but NOT dedup, so there is no dedup prose to reconcile |

**Bottom line: all three contract concerns (a/b/c) are ALREADY satisfied.** The marker example is
accurate; the stale-warning prose is accurate post-BUG-002; there is no dedup description to make
inconsistent. **The expected outcome of this task is: NO EDIT (or at most an optional dedup note).**

## 5. The ONE optional judgment call — the symlink-dedup note

The architecture doc says "possibly note symlink-safe dedup." Analysis:

- README's Distributed section describes **include resolution** (directives, markers, depth,
  stale warning, fully-resolved semantics) but does NOT describe **dedup** at all. There is no
  "each file imported once" sentence to correct.
- Contract scope: "Make minimal, accurate edits only where prose is now wrong or misleading."
  Adding a NEW dedup sentence is **enhancement, not correction** of wrong/misleading prose.
- Contract: "If README is already accurate, make NO edit."
- Dedup is an internal correctness property (PRD §2.3), not a user-facing knob. README's current
  prose ("a split PRD behaves identically to a monolithic one") already conveys the user-facing
  guarantee; the dedup mechanism is an implementation detail.

**Recommendation: do NOT add the symlink-dedup note.** It is out of the accuracy-sweep scope
(enhancement, not correction), README is accurate as-is, and the contract favors minimal/no edits.
If the implementer judges the Distributed section reads naturally with a brief dedup mention, the
MAXIMUM acceptable addition is ONE clause — but the strong default is **no edit**.

## 6. Validation commands (verified in package.json)

```
npm run docs:check     # tsx scripts/check-docs.ts — docs-consistency check
npm run format:check   # prettier --check **/*.{ts,js,json,md,yml,yaml}
```
(No tests — this is prose documentation. If an edit IS made, also run `npm run format` to apply
prettier, then re-check.)

## 7. Defensive: what IF verification finds something wrong?

Line numbers in the task contract (L135, L145) are from the architecture analysis snapshot and MAY
have drifted. The implementer MUST re-verify against the LIVE README (grep, not line number). If —
and only if — the live README contains WRONG prose (e.g. an `@include:` without the `!`, or a
"no warning at max depth" carve-out), make the minimal correction:

- Wrong marker format (`@include:` → `@!include:`): correct to `<!-- @!include: path -->` /
  `@!end-include` / `@!include-ref` matching source L560/L577.
- Wrong stale-warning carve-out: correct to unconditional "a stale include warns on stderr"
  (remove any depth-gate exception language).
- Wrong dedup description: reword to "canonical (realpath-resolved) absolute path" keying.

Each correction is a prose micro-edit; run `npm run format` after. But per §4, NONE of these are
expected — README is already accurate.

## 8. Work-log documentation (required by contract)

Whether or not an edit is made, the implementer records the outcome in the work log / validation
report:
- "README.md verified against shipped include-marker / stale-warning / dedup behavior — [all
  accurate | <list of minimal corrections made>]."
- If NO edit: "No edit required; README.md L<…> already matches the post-BUG-001/002/003 shipped
  behavior (marker `@!include`, unconditional stale stderr warning, no dedup prose to reconcile)."
- If an edit: cite the exact before/after and the source line it now matches.