# Design Note — P1.M1.T1.S3: Idempotency, Markers, Stale-Include Warnings

> Captures the non-obvious decisions that govern the S3 implementation. Authored
> alongside the PRP; read before implementing.

## 0. What S3 consumes (the S2 contract — assumed LANDED before S3 runs)

S2 (`resolvePRD`) lands this surface in `src/core/session-utils.ts` (per the S2 PRP):

```ts
// MODULE-PRIVATE worker (not exported). S3 ADDS a `markers: boolean` param.
async function expandIncludesRecursive(
  content: string,
  baseDir: string,
  maxDepth: number,
  depth: number,
  visited: Set<string>,
): Promise<string>;

export async function resolvePRD(prdPath: string, opts?: ResolveOpts): Promise<string>;
```

The worker's substitution site is exactly:

```ts
out += replacement ?? m[0]; // substitute OR keep original bytes
```

And the cycle branch short-circuits: `if (visited.has(abs)) { out += m[0]; last = …; continue; }`.
The depth gate short-circuits at the top: `if (depth >= maxDepth) return content;`.

S3 MODIFIES the worker + `resolvePRD` (add a `markers` param, the stale-warning, and the
marker-wrapped substitution) and EXTENDS `ResolveOpts` with `markers?: boolean` (the field S1
explicitly reserved: `// (S3 will extend this interface with markers?: boolean — do NOT add it in S1.)`).
S3 does NOT recreate `resolvePRD`/the worker — it edits S2's landed versions.

## 1. THE key decision: where the stderr warning goes (NOT the pino logger)

PRD §2.3: "A `.md` token that fails to resolve (stale include) MUST emit a **stderr** warning."

The codebase's structured logger (`src/utils/logger.ts`, pino) writes to **stdout** for BOTH
output modes — verified in `buildRoot()`:
- JSON mode: `pino({ …, base: {} })` → default destination = `process.stdout`.
- Pretty mode: `pino({ … }, pretty({ … }))` → pino-pretty's default destination = `process.stdout`.

So `logger().warn(...)` goes to **stdout**, which violates the literal "stderr" requirement. The
codebase ALREADY uses `console.warn`/`console.error` for user-facing diagnostics in production
code (`src/utils/verify-groundswell-version.ts:964` uses `console.warn`; many utils use
`console.error`). ESLint `no-console` is OFF. Node's `console.warn` writes to `process.stderr`
synchronously (§9.6 "synchronous logging destinations" compliant).

**Decision: S3 emits the stale-include warning via `console.warn(...)`** (→ stderr, sync,
codebase-precedented). This is intentional per PRD §2.3's explicit "stderr" wording; do NOT route
it through the stdout-bound structured logger. (Tests spy `vi.spyOn(console, 'warn')`.)

## 2. Idempotency analysis — what holds, and the one acknowledged edge

PRD §2.3: "Re-resolving already-resolved content MUST yield identical bytes." Expressed as a
fixed point: `resolve(resolve(x)) === resolve(x)`.

The resolver is a pure function of `(content, filesystem-state, maxDepth, markers-flag)`. After
one pass, every `@token` in the output is one of:

| Survivor type | Why it stayed literal | On re-resolve (depth reset to 0) | Idempotent? |
| --- | --- | --- | --- |
| Successfully expanded | (not a survivor — content inlined) | inline content has no residual expandable `@token` (sub-tokens were recursively expanded) | ✅ yes |
| Stale (`.md` or other) | ENOENT / directory (not a file) | re-fails identically → stays literal → same bytes | ✅ yes |
| Cycle back-edge | file EXISTS but already in ancestry | still EXISTS but re-entered at depth 0 → **would re-expand** … ⚠ see below | ⚠ |
| Depth-exceeded | `depth >= maxDepth` gate returned early | re-entered at depth 0 → **would re-expand** | ❌ no |

**Cycle subtlety:** S2 seeds `visited = new Set([absEntry])` and the worker only adds the CURRENT
ancestry on each descent (`new Set(visited).add(abs)`, path-based). On a FRESH re-resolve,
`visited` is re-seeded with just the entry — so a cycle from the first pass is NOT a cycle on
re-resolve (the file genuinely exists and is reachable). HOWEVER: for a SELF-cycle where the
**entry file includes itself** (`a.md` contains `@a.md`, resolved as `resolvePRD('a.md')`), the
entry IS `a.md`, so on re-resolve the inlined content again contains `@a.md` pointing at the
entry → still a cycle → still literal. So self-via-entry cycles ARE idempotent. The only TRUE
non-idempotent survivors are **depth-exceeded** tokens and **non-entry mutual cycles** where the
file exists — both are deliberate safety-valve truncations, not the "fully-resolved document" the
PRD hashes.

**Conclusion:** Idempotency HOLDS for the normal case — every real PRD where all includes resolve
within `maxDepth` (default 10). The depth-exceeded edge is an acknowledged, documented
safety-valve truncation that is intentionally NOT a fixed point (you can't un-truncate). S3's
idempotency tests use within-depth fixtures (the case that actually matters for hash consistency)
and assert byte-equality, with `console.warn` mocked to keep the assertion clean.

## 3. Why markers do NOT break idempotency (the marker format is load-bearing)

PRD §2.3 fixes the marker format: `<!-- @include: path -->` / `<!-- @end-include -->`. With markers
ON, expanded content becomes:
```
<!-- @include: docs/a.md -->
<expanded body>
<!-- @end-include -->
```

Re-scanning this with the boundary regex `(?<![\w./-])@([A-Za-z0-9_./-]+)`:
- `@include` — boundary OK (`!` before `@` is non-path); captures `include`, STOPS at `:` (not a
  path char). `resolve(baseDir, 'include')` → ENOENT → literal. `include` is NOT `.md` → NO stale
  warning. ✅
- `@end-include` — boundary OK; captures `end-include` (`-` is a path char). `resolve(baseDir,
  'end-include')` → ENOENT → literal. Not `.md` → no warning. ✅
- The real path `docs/a.md` after `@include: ` has NO `@` prefix → not a token at all. ✅

So the marker format is deliberately self-protecting: the only `@`-prefixed words it introduces
(`include`, `end-include`) cannot be real `.md` files, so they survive a second pass unchanged.
→ Markers-on output is a fixed point. (The idempotency test proves this empirically.)

## 4. The stale-warning guard (exactly when it fires)

Fires iff ALL of: (a) the token matched the boundary regex, (b) it was NOT a cycle back-edge
(cycle `continue`s before the warning site), (c) `replacement === undefined` (ENOENT or a
directory — i.e. "path does not resolve to an existing file"), AND (d) `token.endsWith('.md')`.
It does NOT fire for: cycles (file exists), depth-exceeded (gate returns before scanning),
non-`.md` missing tokens, or successfully-resolved tokens.

## 5. The boolean getter (first of its kind in constants.ts)

No boolean env parser exists yet (only numeric getters: `getResearchTimeoutSeconds`,
`getPrdIncludeMaxDepth`). S3 adds `getPrdIncludeMarkers()` with truthy semantics that reject the
common "off" spellings: empty/`'0'`/`'false'`/`'no'`/`'off'` → `false`; anything else → `true`;
`undefined` → `false`. Trim + lower before comparing.

## 6. Test file isolation (collision avoidance)

S1 owns `tests/unit/core/prd-includes.test.ts` (LANDED — do not touch). S2 owns
`tests/unit/core/prd-resolve.test.ts` (created in parallel — do not touch). S3 creates a NEW,
distinctly-named file: `tests/unit/core/prd-markers.test.ts` (covers markers + stale warning +
idempotency + the new `getPrdIncludeMarkers` getter). This keeps the three subtasks merge-safe.