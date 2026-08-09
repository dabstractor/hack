# Research — P1.M1.T1.S2 (rewrite JSDoc on resolvePRD + resolveIncludes for the new dedup model)

S2 is the documentation-half of the dedup rewrite (Mode A). S1 (LANDED) rewrote
`expandIncludesRecursive` to GLOBAL-FLAT-DEDUP + ELISION and already rewrote ITS OWN JSDoc
(L425-463 — the terminology template). **S2 rewrites the JSDoc on the two PEER functions**
(`resolvePRD`, `resolveIncludes`) + the IDENTITY @remarks that references resolvePRD, so all three
functions' docs describe the new model consistently. No code logic changes — JSDoc + inline comments only.

## 1. S1 is LANDED — consume its terminology, don't touch its function

`expandIncludesRecursive` JSDoc (L425-463) is the CANONICAL wording for the new model — match it:
- "GLOBAL-FLAT-DEDUP": `visited` is a SINGLE shared set, passed by REFERENCE (never copied per
  descent); first textual encounter expands; every later reference ELIDES.
- "ELISION on second+ encounter": dropped (markers off) or `<!-- @include-ref: ${token} -->` (markers on);
  idempotent (comment has no resolvable `@token`); a SUCCESSFUL resolution (never triggers stale-warning).
- "idempotent fixed point: `resolve(resolve(x)) === resolve(x)`".
- "`maxDepth` is now DEFENSE-IN-DEPTH only — dedup bounds recursion to one import per file".
- "`baseDir` is the ENTRY PRD's directory, passed UNCHANGED on every descent".
S1 owns `expandIncludesRecursive` (code + JSDoc + inline comments L464-535). **S2 must NOT touch it.**

## 2. resolvePRD JSDoc (L544-592) — the stale bullets to rewrite

Current @remarks bullets (verbatim, with the OLD per-branch model):
- **IDEMPOTENCY** (L548-552): says "for any within-depth fixture... depth-exceeded is an intentional
  safety-valve truncation that is NOT a fixed point." → REWRITE: TRUE FIXED POINT
  (`resolve(resolve(x)) === resolve(x)`); dedup-via-elision leaves no resolvable survivors; cite §4.1/§4.3.
  (Match S1's expandIncludesRecursive framing.)
- **CYCLE DETECTION** (L553-559): "a path-based visited Set (absolute paths of the current ancestry)...
  Diamond includes still expand c in both branches (the visited set is per-branch, not flat)." → REPLACE
  with **GLOBAL FLAT DEDUPLICATION**: single shared visited set keyed on resolved absolute path; first
  encounter expands inline; subsequent references (diamond/cycle/back-edge) ELIDED; entry pre-seeded;
  cycles+diamonds terminate without relying on maxDepth. Cite §2.3.
- **MAX DEPTH** (L560-562): currently the primary bound. → UPDATE: now DEFENSE-IN-DEPTH only (dedup
  bounds recursion; the depth>=maxDepth gate is a backstop).
- **MARKERS** (L563-569): describes `<!-- @include: path -->`/`<!-- @end-include -->` for EXPANDED
  includes; "Literal survivors (missing/dir/cycle/depth) are never wrapped." → ADD the marker-reference-
  comment behavior for ELIDED refs (`<!-- @include-ref: token -->`); fix "cycle/depth" → cycles now elide
  (not literal survivors); depth-exceeded is the rare defense-in-depth case.
- **BASE INVARIANT** (L570-571): UNCHANGED.
- **STALE-INCLUDE WARNING** (L572-577): UNCHANGED per contract (still accurate: elision is successful
  resolution → no warning; only ENOENT/dir triggers it). Minor: "cycle back-edges" phrasing still holds
  (they elide = successful = no warning).
- **Summary line L579**: "Missing files, directories, and cycle back-edges stay verbatim." → FIX: cycle
  back-edges now ELIDE (dropped/ref-comment), NOT verbatim. Reword to "Missing files and directories
  stay verbatim; already-imported references (cycles/diamonds/back-edges) are ELIDED."
- **Inline comment L600** (in resolvePRD body): "S3: marker toggle (opts wins over env)" → drop the "S3".

## 3. resolveIncludes JSDoc (L336-369) — stale S1/S2/S3 staging → single-level + not-dedup-aware

Current @remarks (L339-343): "**SINGLE-LEVEL in S1**: ... recursive expansion + cycle detection = S2;
markers + stale-include warnings = S3." This staging language is STALE (the recursive resolver landed).
resolveIncludes is STILL single-level (it does not recurse, does not maintain a visited set) — that part
is accurate. REWRITE:
- State resolveIncludes is the SINGLE-LEVEL primitive: each `@token` is replaced inline by its file's
  contents verbatim; substituted content is NOT re-scanned.
- State it is **NOT dedup-aware**: it does not recurse and does not maintain a visited set, so it does
  NOT elide duplicates or bound cycles. (A diamond through it would duplicate; a cycle through it would
  recurse unbounded up to maxDepth.)
- Cross-reference {@link resolvePRD} / {@link expandIncludesRecursive} as the recursive, dedup-aware
  production path; resolveIncludes is a low-level primitive (currently exercised by unit tests; not the
  production entry point — resolvePRD is).
- KEEP the BOUNDARY + EXISTENCE rules (L345-353) — those are accurate; just drop the "idempotency-friendly
  for S3" (L353) trailing phrase.
Also fix:
- **ResolveOpts.maxDepth @remarks** (L324-327): "In S1 this is honored only as the base-case depth gate
  ... The recursive depth-decrementing loop lands in S2." → STALE. Rewrite: maxDepth is the defense-in-
  depth recursion cap (default {@link getPrdIncludeMaxDepth}); resolvePRD's recursive resolver honors it
  as a backstop (dedup is the primary bound); resolveUses it as its single-level gate.
- **resolveIncludes body inline comment L400**: "missing → silent verbatim (S3 adds the .md-token stderr
  warning)." → the stale-include warning lives in `expandIncludesRecursive` now (not "S3"). resolveIncludes
  itself is silent on stale includes. Reword to reference expandIncludesRecursive.

## 4. IDENTITY @remarks (L241) — "(S3)" → true fixed point

"Idempotency of {@link resolvePRD} (S3) makes a single resolution safe." → the "(S3)" staging tag is
stale. Rewrite: "resolvePRD produces a TRUE FIXED POINT (`resolve(resolve(x)) === resolve(x)`, PRD §2.3),
so a single resolution is safe." (The surrounding text about hashing the RESOLVED doc is accurate — keep it.)

## 5. Out of scope (do NOT touch)

- `expandIncludesRecursive` code + JSDoc + inline comments (L425-535) — S1 OWNS this function entirely.
- `src/config/constants.ts:1290` ("consumed by S1's resolveIncludes") — different file; the contract
  scopes S2 to `src/core/session-utils.ts`. Flag it but do not edit.
- Test rewrites (diamond/cycle/idempotency) — P1.M1.T2 (separate subtask).
- Any CODE LOGIC — S2 is JSDoc + inline comments ONLY.

## 6. Why resolveIncludes is still single-level (accuracy note)

resolveIncludes is NOT consumed in `src/` production code (only in `tests/unit/core/prd-includes.test.ts`
+ a constants.ts JSDoc reference). The production path is `resolvePRD` → `expandIncludesRecursive`
(recursive, dedup-aware). So resolveIncludes' JSDoc must honestly describe it as a single-level LOW-LEVEL
primitive (not the production resolver), and cross-reference the recursive path. This is the accurate
framing — do NOT claim it dedups.

## 7. Validation

- `npm run typecheck` (comments don't affect types, but confirms no accidental code edit) → clean.
- `npm run lint && npm run format:check` → clean (JSDoc reformatting may need `npm run fix`).
- `npx vitest run tests/unit/core/prd-includes.test.ts tests/unit/core/prd-resolve.test.ts` → UNCHANGED
  (S2 is comments-only; no behavior change). Do NOT run full suite as the gate (T2's test rewrites are
  separate and may be in flux).
- grep: NO remaining stale staging tags ("= S2", "= S3", "(S1)", "(S3)", "per-branch, not flat",
  "NOT a fixed point", "recursive depth-decrementing loop lands in S2") in the resolvePRD/resolveIncludes/
  IDENTITY blocks (the expandIncludesRecursive block may retain "S3" inline comments — that's S1's scope).