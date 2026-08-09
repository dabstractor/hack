# Research — P1.M1.T1.S1 (expandIncludesRecursive: shared visited set + elision)

Rewrites `expandIncludesRecursive` from per-branch ancestry/cycle-detection to
PRD §2.3 global-flat-dedup with elision. S1 = the function rewrite + its JSDoc.
The other two functions' JSDoc (resolvePRD, resolveIncludes) is S2; the test
rewrites are P1.M1.T2.

## 1. Current code (src/core/session-utils.ts:448-510) — verified

```ts
async function expandIncludesRecursive(content, baseDir, maxDepth, depth, visited, markers) {
  if (depth >= maxDepth) return content;                    // KEEP (defense-in-depth now)
  const matches = [...content.matchAll(RESOLVE_TOKEN)];
  let out = '', last = 0;
  for (const m of matches) {
    const idx = m.index!;
    out += content.slice(last, idx);
    const token = m[1];
    const abs = resolve(baseDir, token);

    if (visited.has(abs)) {
      out += m[0];                  // ← LINE 470: CYCLE — leaves @token literal. CHANGE → ELIDE.
      last = idx + m[0].length;
      continue;
    }

    let replacement: string | undefined;
    try {
      const st = await stat(abs);
      if (st.isFile()) {
        const child = await readUTF8FileStrict(abs, 'read include');
        const childVisited = new Set(visited).add(abs);   // ← LINE 481: COPIES set. CHANGE → shared.
        replacement = await expandIncludesRecursive(child, baseDir, maxDepth, depth+1, childVisited, markers);
      }
    } catch (e) { /* ENOENT→undefined; else SessionFileError */ }

    if (replacement === undefined && token.endsWith('.md')) {
      console.warn(`[prd-resolver] stale include '@${token}': ...`);   // KEEP — elision skips via continue
    }
    out += markers && replacement !== undefined
      ? `<!-- @include: ${token} -->\n${replacement}\n<!-- @end-include -->`
      : (replacement ?? m[0]);
    last = idx + m[0].length;
  }
  out += content.slice(last);
  return out;
}
```

resolvePRD (~line 585) seeds `new Set<string>([absEntry])` and calls this. KEEP the seeding.

## 2. The three changes (PRD §2.3 global-flat-dedup)

**(a) DEDUP, NOT ANCESTRY** — line 481: replace `const childVisited = new Set(visited).add(abs);`
with `visited.add(abs);` (mutate the SHARED set, mark BEFORE descending), and pass `visited`
(not `childVisited`) to the recursive call. The set is now global/flat: a diamond (A→C, B→C)
resolves C exactly once.

**(b) ELIDE ON SECOND ENCOUNTER** — line 469-471 (`visited.has(abs)` branch): replace
`out += m[0]; continue;` (leaves @token literal) with ELISION:
- `markers === false` → emit NOTHING (drop the @token entirely; do NOT echo m[0]).
- `markers === true` → emit a stable reference comment naming the path but containing NO
  resolvable @token: `<!-- @include-ref: ${token} -->`. (An HTML comment's path is not preceded
  by `@`, so RESOLVE_TOKEN won't match it on re-scan → idempotent.)
Then `last = idx + m[0].length; continue;` (the `continue` skips the stale-warning + marker-wrap
below, so elision never triggers the stale warning — elision is a SUCCESSFUL resolution, not stale).

**(c) FIRST ENCOUNTER** — no code change; falls out of (a). The first textual occurrence passes
`visited.has(abs)` false → stat/read → `visited.add(abs)` → recurse → marker-wrap as today.

KEEP UNCHANGED: the `depth >= maxDepth` gate (now defense-in-depth only), stat/isFile/ENOENT/
SessionFileError handling, the stale-include warning condition, the EXPANDED-body marker format.

## 3. Why elision (not verbatim) on second encounter — idempotency

A verbatim survivor (`out += m[0]`) would re-expand on a second resolution pass (the @token is
still resolvable) → `resolve(resolve(x)) !== resolve(x)` → breaks hash/snapshot/delta consistency.
Elision (drop, or a non-resolvable comment) leaves nothing resolvable → the resolved document is a
fixed point. PRD §2.3: "Elision — not verbatim — is mandatory."

## 4. JSDoc to rewrite (expandIncludesRecursive only — S1 scope)

Current JSDoc (lines ~417-447) is FACTUALLY WRONG now — it endorses the old behavior:
- "visited.has(abs) cycle check — back-edge @token left literal" → now ELISION.
- "visited set is PATH-BASED (per-branch ancestry): COPIED on each descent... diamond includes
  expand c in BOTH branches. A flat/global set would wrongly deduplicate diamonds." → EXACTLY
  WRONG (now flat/global dedup IS the design).

Rewrite to: global flat dedup (shared set passed by reference, marked before descent),
first-encounter-wins in document order, subsequent references ELIDED (dropped, or a non-resolvable
`<!-- @include-ref -->` comment when markers on), elision emits no stale warning, maxDepth is now
defense-in-depth. Cite PRD §2.3. (resolvePRD + resolveIncludes JSDoc = S2.)

Also rewrite the two inline comments: the former `new Set(visited)` site → "global flat dedup:
mark visited before descending in the SHARED set"; the `visited.has(abs)` branch → "second
encounter: ELIDE".

## 5. ⚠️ EXPECTED transient test failures (owned by P1.M1.T2 — do NOT fix in S1)

`tests/unit/core/prd-resolve.test.ts` asserts the OLD behavior:
- L135 `it('expands a diamond in both branches (path-based visited set)')` — asserts TWO S's
  (`out.split('S').length === 3`). After S1: diamond dedups → ONE S → FAILS.
- L101/110/124 cycle tests — assert the back-edge `@token` stays LITERAL. After S1: cycles elide
  (entry-seeded self/mutual cycles now produce empty/ref-comment, not literal @token) → FAILS.
`tests/unit/core/prd-markers.test.ts`:
- L137 `it('does NOT warn for a cycle back-edge')`, L166/L177 idempotency — may need adjustment
  for elision semantics.

These are EXPECTED — P1.M1.T2.S1/S2 rewrite them. S1's gate is NOT "test suite green"; it is
typecheck + lint + the empirical diamond smoke (C appears once). Do NOT edit tests in S1.

## 6. Validation

- `npm run typecheck` — clean.
- `npm run lint && npm run format:check` — clean (prettier ERROR-enforced; `npm run fix`).
- Empirical diamond smoke (real tmpdir): entry→A→C + entry→B→C resolves C exactly ONCE
  (first encounter expands; second elides). markers=true → second emits `<!-- @include-ref: c -->`.
- `npx vitest run tests/unit/core/prd-resolve.test.ts` — EXPECTED failures at the diamond +
  cycle-literal cases (owned by P1.M1.T2). Run only to CONFIRM the expected failures, not to gate.