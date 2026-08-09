# System Context: Include Dedup Delta (Session 014)

## Delta Summary

The PRD §2.3 include-resolution semantics change from **per-branch ancestry / cycle
detection** to **global flat dedup with elision**. A given file is now expanded at most
once across the entire resolution; subsequent references are elided (dropped, or replaced
by a non-resolvable marker comment).

## Change Site (Single File)

**`src/core/session-utils.ts`** — the include resolver subsystem:

### Functions to Modify

1. **`expandIncludesRecursive(content, baseDir, maxDepth, depth, visited, markers)`** (private, ~line 448)
   - **Current**: `visited` is a path-based per-branch ancestry set. Each descent copies the
     set: `const childVisited = new Set(visited).add(abs)`. Diamond includes expand the shared
     file in BOTH branches. The `visited.has(abs)` branch leaves the `@token` literal:
     `out += m[0]; continue;`.
   - **New**: `visited` is a single global flat set keyed on resolved absolute path. Mutate
     the shared set: `visited.add(abs)` BEFORE descending, pass the SAME set down (no copy).
     When `visited.has(abs)` is already true, ELIDE the token — drop it entirely (no markers)
     or emit a stable reference comment containing no resolvable `@token` (markers on).
   - Max-depth gate (`depth >= maxDepth`) is unchanged — now defense-in-depth only.
   - Stale-include warning (`.md` token + ENOENT/dir) is unchanged — elision is a successful
     resolution, not a stale token.

2. **`resolvePRD(prdPath, opts)`** (public, ~line 569)
   - Seeds `visited` with `new Set<string>([absEntry])` — KEEP this (entry pointing back at
     itself is elided, not cycled). No logic change; JSDoc only.

3. **`resolveIncludes(content, baseDir, opts)`** (public, ~line 371)
   - Single-level resolver. NOT the dedup target (it does not recurse). JSDoc-only update to
     cross-reference the new dedup model and note it is the non-recursive entry point.

### Supporting Pieces (No Changes)

- `INCLUDE_TOKEN` / `RESOLVE_TOKEN` — identical regexes, boundary rules unchanged
- `readUTF8FileStrict` — strict UTF-8 reader, unchanged
- `getPrdIncludeMaxDepth()` — default 10, unchanged
- `getPrdIncludeMarkers()` — boolean env getter, unchanged

## JSDoc to Rewrite (Mode A — rides with the work)

All three functions' JSDoc currently **actively describes and endorses the old per-branch
behavior** and must be rewritten to describe global-flat-dedup + elision, citing §2.3:

| Function | Old JSDoc Claims (WRONG now) | What to Say Instead |
|---|---|---|
| `expandIncludesRecursive` | "The `visited` set is PATH-BASED (per-branch ancestry)... diamond includes expand `c` in BOTH branches. A flat/global set would wrongly deduplicate diamonds." | Global flat dedup: shared set, first-encounter wins, subsequent refs elided. Cite §2.3. |
| `resolvePRD` | "CYCLE DETECTION: a path-based visited `Set`... Diamond includes still expand `c` in both branches (the visited set is per-branch, not flat)." | Global flat dedup with elision. Entry seeded. Idempotent fixed point. Cite §2.3. |
| `resolveIncludes` | References S1/S2/S3 staging; mentions cycle detection as S2 feature. | Cross-reference the recursive resolver's new dedup model; clarify single-level is NOT dedup-aware. |

Inline comments at the `new Set(visited)` site and the `visited.has(abs)` branch must also be
rewritten.

## Downstream Consumers (NO Changes Needed)

All consumers call `resolvePRD()` and read its output verbatim. The resolved document becomes
**smaller** (deduplicated) but remains a valid merged document:

| Consumer | File | Usage |
|---|---|---|
| `hashPRD` / `hashPRDContent` | session-utils.ts | Hashes resolved string → delta detection |
| `snapshotPRD` | session-utils.ts | Writes resolved string to `prd_snapshot.md` |
| `SessionManager.initialize` | session-manager.ts:397 | Resolves once → hash + snapshot |
| `SessionManager` (delta) | session-manager.ts:806 | Resolves new PRD for delta comparison |
| `PRPPipeline` | prp-pipeline.ts:52 | Resolves PRD for pipeline |
| `prd-selector.ts` | prd-selector.ts:22,163 | Indexes resolved string for selector queries |

**Idempotency guarantee**: `resolve(resolve(x)) === resolve(x)` (fixed point) is the property
that ensures hash/snapshot/delta consistency (§4.1, §4.3).

## Out of Scope

- §9.2.9 and §9.7.5 table reflows (cosmetic only, no code impact)
- `PRD_INCLUDE_MAX_DEPTH` behavior (unchanged)
- Stale-include stderr warning (unchanged)
- Marker format around EXPANDED bodies (unchanged — `<!-- @include: path -->` / `<!-- @end-include -->`)
- No Mode B (changeset-level) docs — internal subsystem, no README/feature-blurb
- `resolveIncludes` single-level dedup across siblings — NOT the diamond problem, out of scope