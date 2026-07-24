# Research: PRD selector scheme + block parsing (P1.M2.T1.S2)

Empirically verified against `plan/008_15504f60a0ef/prd_snapshot.md` (the RESOLVED
document) and `plan/008_15504f60a0ef/prd_index.txt` (the Architect-agent index) on
2026-07-24. All counts below are from direct probes, not assumptions.

## 1. The selector scheme (must be byte-compatible with the Architect agent)

`prd_index.txt` and the live `tasks.json` `prd_selectors` use ONE convention:

| Selector form           | Meaning                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `h{level}.{N}` (h1-h6)  | the `N`-th heading of that level, **counted globally across the whole document in source order** (N is NOT reset per parent). |
| `code.N`                | the N-th fenced code block (```` ``` ````), 0-indexed, global.  |
| `para.N`                | the N-th paragraph, 0-indexed, global.                          |
| `list.N`                | the N-th list, 0-indexed, global.                               |
| `table.N`               | the N-th table, 0-indexed, global.                              |
| `quote.N`               | the N-th block quote, 0-indexed, global.                        |

**Per-level-global heading index — PROOF.** `parsePRDSections(prd_snapshot)` yields
heading counts `{1:1, 2:9, 3:24, 4:19}` which EXACTLY match `prd_index.txt`
(`h1.0`; `h2.0`..`h2.8`=9; `h3.0`..`h3.23`=24; `h4.0`..`h4.18`=19). And the h3
indices are continuous across parent sections (h3.0..h3.2 under "2.", h3.3..h3.8
under "4.", …) — i.e. the counter is global per level, NOT reset per parent.

⇒ `generateSectionIndex` MUST assign heading indices by filtering
`parsePRDSections` output to `level === L` (for L in 1..6) and enumerating in
document order. **Exclude level 0** (the implicit "Introduction" — prd_index.txt
has no `h0`).

## 2. `parsePRDSections` is the right heading primitive — and is code-fence-SAFE here

- `parsePRDSections` (`src/core/prd-differ.ts:179`) returns flat `{level,title,
  content,lineNumber}` in document order. It is diff-oriented but the heading
  DETECTION is exactly what we need.
- **Code-fence blind spot:** its header regex `/^(#{1,6})\s+(.+)$/` would treat a
  `# comment` line INSIDE a ```` ``` ```` block as a heading. For the CURRENT
  resolved doc this is a NON-ISSUE: `awk` confirms **0** heading-like lines inside
  fences (counts match the Architect exactly). For robustness across OTHER PRDs,
  the generator should still compute fenced line-ranges and SKIP any heading whose
  `lineNumber` falls inside a fence (matches how a human/LLM reads the rendered
  doc). Cheap, defensive, a no-op for the live doc.
- Use `parsePRDSections` AS-IS (import from `./prd-differ.js`). Do NOT modify
  `prd-differ.ts` — it owns diff logic (`diffPRDs`/`hasSignificantChanges`); a
  change there risks the delta workflow. Reuse, don't extend, the source file.

## 3. Block parsing (code/para/list/table/quote) — definitions that match counts

A single line-walker over the resolved doc reproduces the `prd_index.txt` summary
line for 4 of 5 types:

```
mine:        code:6 para:85 list:58 table:4 quote:1
prd_index:   code:6 para:85 list:50 table:4 quote:1
```

Working definitions (deterministic, document-order, code-fence-aware):

- **code block** — a line matching `^\s*```` ` opens one; the block runs to the
  next `^\s*```` ` (or EOF). Count = number of fence PAIRS. → **6 ✓ exact**.
- **table** — a maximal run of consecutive lines matching `^\|.*\|\s*$`. → **4 ✓ exact**.
- **quote** — a maximal run of lines starting with `>`. → **1 ✓ exact**.
- **paragraph** — a maximal run of non-blank lines that are not a heading, not a
  fence line, not a list-item, not a table row, not a quote line, terminated by a
  blank line or a boundary of any of the above. → **85 ✓ exact**.
- **list** — a maximal run of list-item lines (`^\s*([-*+]|\d+\.)\s+`). → **58 vs
  Architect's 50** (see caveat below).

### List-count caveat (58 vs 50) — ACCEPTABLE, here's why

"Where one list ends and another begins" is genuinely fuzzy for blank-line-separated
items / mixed markers. The Architect LLM counts 50; a deterministic TS rule counts
58. **This does not matter for correctness in practice**, for three reasons:

1. **No real selector references a block.** All 63 `prd_selectors` in the live
   `tasks.json` are HEADINGS (`h3.2`, `h2.1`, `h4.7`, …). Verified by walking the
   parsed JSON — zero `code.N`/`para.N`/`list.N`/`table.N` selectors exist.
2. **Headings are byte-exact** (§1 proof) — the only selectors that actually get
   looked up resolve correctly.
3. **S3 has a full-PRD fallback.** Per PRD §4.2, "when selectors are absent OR
   extraction fails, the full PRD is used." A `list.N` that doesn't resolve (or
   resolves to the "wrong" block under a fuzzy count) just triggers fallback —
   graceful degradation, never corruption.

⇒ Implement lists with a clear, documented rule (maximal run of list-item lines);
accept the ~8 discrepancy; document it in JSDoc. Do NOT chase the LLM's exact 50.

## 4. The resolved-document invariant (input contract)

- `generateSectionIndex(resolvedPRD: string)` takes the **already-resolved** PRD
  string. The resolver is `resolvePRD(prdPath): Promise<string>`
  (`src/core/session-utils.ts:564`); the resolved content is materialized into
  `prd_snapshot.md` via `writePRDSnapshot({resolvedContent})` (session-utils.ts:1040).
- **The generator does NO file I/O.** The caller (S3 at PRP-generation time, or the
  breakdown path) passes the resolved string. Determinism = same string in ⇒ same
  `SectionIndex` out. SYNC function (matches the contract signature with no Promise).
- This is why the index is computed "over the resolved document": include directives
  are already expanded, so `h3.N` / `code.N` indices are stable regardless of how
  many `@path` files the raw PRD scattered across.

## 5. Section TEXT representation (what each selector maps to)

- **heading `h{L}.{N}`** — the EXACT source slice from the heading's line through
  the line before the next heading of any level (or EOF). Reconstructed via
  `parsePRDSections` boundaries (each section's `lineNumber` + the next section's
  `lineNumber`). Faithful to the source (preserves header spacing/body). This is
  what the Researcher LLM consumes as "the section".
- **code/para/list/table/quote** — the exact source lines of that block.

## 6. Disjointness + scope

- NEW module `src/core/prd-selector.ts`; NEW test `tests/unit/core/prd-selector.test.ts`;
  barrel add in `src/core/index.ts`. DISJOINT from the parallel P1.M2.T1.S1
  (`models.ts`, `fix-cycle-workflow.ts`, `models.test.ts`) and from P1.M1.T2.S3 (prompts).
- OUT OF SCOPE: selector extraction / full-PRD fallback (S3), populating
  `prd_selectors` (Architect agent's job), writing `prd_index.txt` (Architect agent),
  modifying `prd-differ.ts`, any `docs/*.md` (DOCS = Mode A: JSDoc only).