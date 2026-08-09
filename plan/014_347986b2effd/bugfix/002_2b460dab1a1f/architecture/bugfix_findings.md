# Bugfix Findings — per-bug root cause, exact fix sites, test plan, interactions

All three issues are **Minor** (per PRD §2.3 / §Minor). The core include-dedup contract is sound;
these are polish / doc-drift / edge-case correctness fixes. Each is independent (different functions),
but BUG-002 and BUG-003 both edit `src/core/session-utils.ts` (different functions — no overlap).

---

## BUG-001 — Marker format deviates from PRD literal spec; constants.ts JSDoc now stale
**PRD**: §2.3 Markers; Issue h2.3/h3.0; Recommendations h2.5.
**Severity**: Minor. **Decision**: KEEP the collision-proof `@!` marker format (it is correct, tested,
and the PRD §2.3 functional requirements are met); the defect is purely that the **user-facing JSDoc**
is stale. Fix the doc, do not change emitted markers.

### Root cause
`src/config/constants.ts:1282-1290` (JSDoc on `export const PRD_INCLUDE_MARKERS`) documents the OLD
format while the implementation emits the collision-proof `@!` format:
- Stale summary line: `* Environment variable name: emit <!-- @include --> markers …`
- Stale `@remarks`: `When set, resolved include output emits <!-- @include: path --> / <!-- @end-include --> comment markers …`

### Fix site (Mode A — doc rides with this subtask)
- `src/config/constants.ts` — the `PRD_INCLUDE_MARKERS` JSDoc block (summary line + `@remarks`).
  Rewrite to document the **actually-emitted** format:
  - Open/close markers: `<!-- @!include: path -->` / `<!-- @!end-include -->`
  - Elided 2nd+ reference: `<!-- @!include-ref: path -->`
  - One sentence on WHY `@!` (the `!` is outside the token char-class `[A-Za-z0-9_./-]`, making the
    markers structurally non-resolvable → a true idempotent fixed point even with marker-word
    collision files).
  - Keep the existing "stale `.md` token emits a stderr warning" clause.

### No behavioral change
- The `@!` emission in `expandIncludesRecursive` / `elisionRefComment` is unchanged.
- Existing test `BUG-001: markers are STRUCTURALLY non-resolvable — byte-idempotent even with
  marker-word collision files` (prd-markers.test.ts) already locks the behavior.
- `docs/CONFIGURATION.md:310` and `README.md:135` are **already** correct (`@!include`) — no change
  needed there (verify-only in the Mode-B sweep).

### Test plan
No new test required (doc-only JSDoc change; behavior already locked). The implementing agent should
confirm the marker tests still pass and that `npm run docs:check` / typecheck are unaffected.

---

## BUG-002 — Stale `.md` include at the maxDepth gate emits no stderr warning
**PRD**: §2.3 ("A `.md` token that fails to resolve (stale include) MUST emit a stderr warning" —
unconditional MUST); Issue h2.3/h3.1; Recommendations h2.5.
**Severity**: Minor (reachable only at pathological depth, but defeats typo-detection for deep specs).

### Root cause
`neutralizeResolvableTokens(content, baseDir, markers)` in `src/core/session-utils.ts` (called when
`depth >= maxDepth`). For a token that does NOT resolve (ENOENT or a directory), it leaves the token
verbatim (`out += m[0]`) and emits **no** `console.warn`. Its JSDoc explicitly states "Emits NO
stale-include warning (elision = success; verbatim = non-resolving prose, which is silent)." That
framing is wrong for a genuine stale `.md` (e.g. a typo'd include filename deep in the graph).

### Fix site (Mode A)
1. In `neutralizeResolvableTokens`, when a token does NOT resolve AND `token.endsWith('.md')`, emit
   exactly one stderr warning via `console.warn`. Use the **same message format** as the main loop for
   consistency:
   ```ts
   console.warn(
     `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`
   );
   ```
   Place the warn in the non-resolving branch (the `: m[0]` arm). Do NOT warn for elided (resolvable)
   tokens, non-`.md` tokens, or successfully-resolved tokens — only `!resolves && token.endsWith('.md')`.
2. Update the `neutralizeResolvableTokens` JSDoc: replace "Emits NO stale-include warning …" with the
   correct rule: "A non-resolvable `.md` token (ENOENT or directory) at the gate emits exactly one
   stderr warning (PRD §2.3 MUST); elided tokens, non-`.md` survivors, and resolved tokens are silent."
3. Update the `resolvePRD` `@remarks` **STALE-INCLUDE WARNING** bullet: it currently lists
   "depth-exceeded tokens … emit NO warning" — after the fix, a **stale `.md`** at the depth gate DOES
   warn (one per resolve pass). Reword so the list of silent cases excludes "stale `.md` at the gate"
   while still correctly stating that elided/cycle/diamond tokens and successfully-resolved tokens are
   silent, and that a stale `.md` warns exactly once per resolve pass (including on re-resolution of a
   stale survivor — which is spec-correct and does not affect output idempotency).

### Coherence / interaction checks
- **No double-warn**: a gate token only ever passes through `neutralizeResolvableTokens` (the gate
  returns early), never the main loop — so a given stale `.md` warns exactly once per pass.
- **Output idempotency preserved**: `console.warn` does not alter the returned string; the token still
  survives verbatim. Re-resolution re-warns (one per pass, per §2.3) but `resolve(resolve(x)) ===
  resolve(x)` still holds for the OUTPUT. Existing idempotency tests already mock `console.warn`.
- **maxDepth=0 edge**: with the gate firing at the entry, a stale `.md` in the entry now warns — this
  is correct per the unconditional §2.3 MUST.

### Test plan (prd-markers.test.ts — new test, implied TDD)
- Simplest repro from PRD: `g.md = 'G @missing.md END'`, `main.md = '@g.md'`,
  `resolvePRD(main, {maxDepth:1})` → assert `vi.spyOn(console,'warn')` called exactly **1** time, the
  call contains `missing.md`, and output is `'G @missing.md END'`.
- Negative: `g.md = 'G @missing.txt END'` at the gate → warn **not** called (non-`.md` silent).
- Negative: `g.md` references a real `h.md` at the gate (maxDepth=1) → warn **not** called (elided,
  not stale); verify the real `@h.md` is elided (not literal) per existing BUG-002 elision behavior.
- Keep within the existing `describe('resolvePRD — markers, stale warnings, idempotency')` style; use
  a REAL tmpdir + `vi.spyOn(console, 'warn').mockImplementation(() => {})`.

---

## BUG-003 — Symlink aliasing defeats global-flat dedup (visited keys on lexical path)
**PRD**: §2.3 dedup ("keyed on the resolved absolute path", intent: a file expanded at most once);
Issue h2.3/h3.2; Recommendations h2.5 ("Consider keying the dedup visited set on realpathSync").
**Severity**: Minor (edge-case; arguably spec-compliant under a strict lexical reading, but defeats
the dedup INTENT for symlink aliases to the same physical file).

### Root cause
All three dedup keying sites use the **lexical** `path.resolve` result, not the canonical realpath:
- `expandIncludesRecursive`, elision check: `if (visited.has(abs))` where `abs = resolve(baseDir, token)` (~line 516).
- `expandIncludesRecursive`, mark-visited: `visited.add(abs)` after `st.isFile()` (~line 525).
- `resolvePRD`, entry pre-seed: `new Set<string>([absEntry])` where `absEntry = resolve(prdPath)` (~line 716).

Two different paths that are symlinks to the SAME physical file get distinct lexical keys → the file's
content is expanded twice (verified: `real.md='REAL'`, `alias.md`→symlink, `main.md='@real.md
@alias.md'` resolves to `'REAL REAL'`).

### Fix site (Mode A) — must be applied to ALL THREE sites for consistency
1. Import `realpathSync` from `node:fs` (NOT yet imported; `stat` is from `node:fs/promises`).
2. Add a small private helper that computes the canonical dedup key with a safe fallback:
   ```ts
   /** Canonical dedup key: symlink-resolved realpath when resolvable, else the lexical absolute path. */
   function dedupKey(abs: string): string {
     try {
       return realpathSync(abs);
     } catch {
       return abs; // broken symlink / ENOENT / non-resolvable → fall back to lexical key
     }
   }
   ```
   Rationale: `realpathSync` throws for non-existent paths; `visited.add` only ever runs for files
   (after `isFile()`), and the entry pre-seed is an existing file, so realpath succeeds there. The
   fallback keeps the elision `has` check safe for not-yet-stat'd / stale tokens (which are never in
   `visited` anyway, so the fallback key never matches spuriously).
3. Replace the keying at all three sites:
   - `if (visited.has(dedupKey(abs)))` (elision check)
   - `visited.add(dedupKey(abs))` (mark-visited)
   - `new Set<string>([dedupKey(absEntry)])` (entry pre-seed) — **CRITICAL**: if the entry pre-seed is
     not switched to the canonical key, the entry and its first textual encounter would use different
     keys and the self-include elision test (`elides an include pointing back at the entry`) could break
     on platforms where tmpdir is symlinked (e.g. macOS `/var/folders` → `/private/var/folders`).
4. Update JSDoc (Mode A):
   - `expandIncludesRecursive` `@param visited` → note the key is the canonical (realpath) absolute path.
   - `resolvePRD` `@remarks` GLOBAL-FLAT-DEDUP bullet: "keyed on the resolved absolute path" → "keyed
     on the canonical (realpath-resolved) absolute path, so symlink aliases to the same physical file
     dedup correctly". Also update the top-of-file/intro mentions where relevant.

### Coherence / interaction checks
- **Consistency**: `dedupKey` MUST be used uniformly at the `has` check, the `add`, AND the entry
  pre-seed. Missing any one re-introduces a mismatch (e.g. entry elision breaks on macOS tmpdir).
- **Existing tests unaffected**: real (non-symlink) files satisfy `realpathSync(abs) === <normalized
  abs>`; behavior (content appears once) is unchanged. The visited key string may differ from the old
  lexical value on symlinked tmpdirs, but tests assert dedup BEHAVIOR, not the key string.
- **Markers unaffected**: marker tokens (`<!-- @!include … -->`) are never `stat`'d as visited keys
  (they don't match `RESOLVE_TOKEN`); marker format/wording is untouched.
- **Performance**: `realpathSync` adds one sync syscall per `@token` encounter (and once for the
  entry). Dedup bounds encounters to one per file; PRDs are small. Acceptable. Note this trade-off in
  a code comment.

### Test plan (prd-resolve.test.ts — new test, implied TDD)
- PRD repro: `real.md = 'REAL'`; `symlinkSync(join(tmp,'real.md'), join(tmp,'alias.md'))`;
  `main.md = '@real.md @alias.md'`; `resolvePRD(main)` → assert `'REAL '` (single expansion, second
  reference elided), and `out.split('REAL').length === 2` (appears exactly once). Add `symlinkSync`
  to the `node:fs` import.
- Guard: if the test environment cannot create symlinks (rare on CI Linux but possible), skip with a
  clear reason — but the primary platform (dev Linux/macOS) supports `symlinkSync`. Prefer to keep the
  test unconditional; if a guard is added, document why.
- Verify existing diamond/cycle/self-include/entry-back-edge dedup tests still pass (they use real
  files → same canonical key, behavior unchanged).

---

## Cross-bug interaction & ordering
- BUG-001 (constants.ts only), BUG-002 (neutralizeResolvableTokens + 2 JSDoc), BUG-003 (3 keying
  sites + helper + JSDoc) are **independent** — no subtask depends on another. They may run in
  parallel; they edit disjoint regions (constants.ts vs two different functions in session-utils.ts).
- Shared risk: BUG-002 and BUG-003 both touch `src/core/session-utils.ts`. They must not edit the same
  lines. BUG-002 edits `neutralizeResolvableTokens` + the resolvePRD STALE-WARNING bullet; BUG-003
  edits `expandIncludesRecursive` visited sites + the resolvePRD DEDUP bullet + entry pre-seed. No
  line overlap. If serialized, either order is fine.
- The Mode-B doc-sweep task (README / CONFIGURATION / ARCHITECTURE / CLI_REFERENCE) depends on ALL
  implementing subtasks and runs last.