# Research — P1.M3.T1.S1: Add `PRP_COMMIT_FORMAT` config getter to `constants.ts`

## 1. Architecture contract (the authoritative spec)

`plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-003-commit-format.md` → section
"S1 — config (Mode A docs: update `docs/CONFIGURATION.md`)" prescribes the **verbatim** block:

```ts
export const PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT';
export const DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const;
export type PrpCommitFormat = 'task-prefix' | 'plain';
export function getPrpCommitFormat(): PrpCommitFormat {
  const raw = process.env[PRP_COMMIT_FORMAT];
  if (raw === undefined) return DEFAULT_PRP_COMMIT_FORMAT;
  const v = raw.trim();
  return v === 'plain' ? 'plain' : 'task-prefix';   // any unknown value → default task-prefix
}
```

- Default `'task-prefix'` (PRD §5.1: "PRP_COMMIT_FORMAT=task-prefix (DEFAULT)").
- `'plain'` is the opt-out.
- **Any unknown/empty value → `task-prefix`** (the ternary `v === 'plain' ? 'plain' : 'task-prefix'`
  returns `task-prefix` for `''`, `'garbage'`, `'TASK-PREFIX'` (case-sensitive!), whitespace, etc.).
- **Mode A docs ride with this work**: update `docs/CONFIGURATION.md` commit-config block.

## 2. The two patterns this getter fuses (from item CONTRACT §3)

- **Structure = the `COMMIT_RETRY_MAX` triple** (`src/config/constants.ts` ~449–483): a sibling
  `export const <NAME> = '<NAME>'` + `export const DEFAULT_<NAME> = …` + `export function get<Name>(…): T`.
- **String-getter style = `getValidationAgent`** (`src/config/constants.ts:740–748`):
  ```ts
  export function getValidationAgent(): string {
    const raw = process.env[VALIDATION_AGENT];
    if (raw === undefined) {
      return DEFAULT_VALIDATION_AGENT;
    }
    const trimmed = raw.trim();
    return trimmed === '' ? DEFAULT_VALIDATION_AGENT : trimmed;
  }
  ```
  → `raw === undefined` → default; else trim; ternary fallback. **`getPrpCommitFormat` follows this
  exactly** but narrows the return to the two-value union instead of echoing the raw value.

## 3. Exact insertion site (VERIFIED against HEAD)

The Commit-Resilience block ENDS at `getCommitRetryDelayCapMs` (`src/config/constants.ts:674` is the
closing `}`), immediately followed by the `// ===…` "Validation Control (PRD §4.4, §9.2.2)" header
(lines 676–678). Verified via `sed -n '670,685p'`:

```
670    if (Number.isNaN(raw) || raw <= 0) {
671      return DEFAULT_COMMIT_RETRY_DELAY_CAP_MS;
672    }
673    return Math.floor(raw);
674  }                                  ← end of getCommitRetryDelayCapMs
675
676  // ============================
677  // Validation Control (PRD §4.4, §9.2.2)
678  // ============================
```

**Placement decision: insert the new `PRP_COMMIT_FORMAT` section immediately AFTER line 674 (the
commit-resilience block) and BEFORE line 676 (the Validation Control header).** Rationale: it is a
COMMIT-family knob (PRD §5.1 "Commit Message Format") that governs `formatCommitMessage` (the same
§5.1 surface as `COMMIT_RETRY_*`). Grouping it with the commit block — NOT inside Validation Control
— keeps the file's topical grouping intact. Add a new section banner:
```
// =============================================================================
// Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1
// =============================================================================
```

## 4. JSDoc style every export must carry (verified from getCommitRetryMax + getValidationAgent)

Every export in this section has: a `/** … */` block with a one-line summary, a `@remarks` paragraph
citing the PRD section, a fenced `@example` showing the import + a `console.log` of the value, and
the getter adds `@returns`. The type export needs its own JSDoc too (see e.g. how `DEFAULT_…`
constants are documented). The getter's `@remarks` must note the trim-empty + unknown→default guard
(mirroring `getValidationAgent`'s `@remarks` about the empty-string guard). Four exports ⇒ four JSDoc
blocks: `PRP_COMMIT_FORMAT` (const), `DEFAULT_PRP_COMMIT_FORMAT` (const), `PrpCommitFormat` (type),
`getPrpCommitFormat` (function).

## 5. Test pattern (VERIFIED — the two sibling files)

- `tests/unit/config/commit-retry.test.ts` — the COMMIT-family sibling (tests
  `getCommitRetryMax`/`getCommitRetryDelayMs`/`getCommitRetryDelayCapMs`). Structure: `beforeEach`
  `delete process.env.<VAR>`; `afterEach` `vi.unstubAllEnvs()`; `(a)`..`(f)` cases; `vi.stubEnv(VAR, …)`.
- `tests/unit/config/validation-config.test.ts` — the STRING-getter sibling (tests
  `getValidationAgent`/`getValidationTimeoutSeconds`). SAME structure; the string-getter cases:
  `(a)` unset→default, `(b)` honors stubbed value, `(c)` empty→default, `(d)`/`(e)` … .

**New file `tests/unit/config/prp-commit-format.test.ts`** mirrors these two. The item MOCKING §5
mandates four cases; I add two more for robustness (explicit `task-prefix`, whitespace, case-sensitivity):

| case | env | expected | why |
|------|-----|----------|-----|
| (a) | unset | `'task-prefix'` | default (PRD §5.1) |
| (b) | `'plain'` | `'plain'` | opt-out honored |
| (c) | `'task-prefix'` | `'task-prefix'` | explicit default value honored |
| (d) | `'garbage'` | `'task-prefix'` | unknown → default (item) |
| (e) | `''` | `'task-prefix'` | empty → default (item; trim-empty analog) |
| (f) | `'  plain  '` | `'plain'` | trim honored → plain |
| (g) | `'TASK-PREFIX'` / `'Plain'` | `'task-prefix'` | case-SENSITIVE match (documented quirk) |

Coverage: all three branches of the getter are hit — `raw === undefined` (a), `v === 'plain'` true
(b,f), `v === 'plain'` false (c,d,e,g). `vitest.config.ts` enforces 100% global coverage.

## 6. Consumer contract (S2 — P1.M3.T1.S2, do NOT implement here)

`formatCommitMessage` in `src/utils/git-commit.ts:108` (current: `return \`[PRP Auto] ${message}…\``)
is reworked in S2 to consume `getPrpCommitFormat()`. This PRP only ships the **exported** getter +
constants + type. The import path S2 will use: `import { getPrpCommitFormat, type ItemPosition } from
'../config/constants.js'` (git-commit.ts is at `src/utils/`, constants at `src/config/` → `../config/`).
→ The getter, const, default, and type MUST all be `export`ed (they are, per the verbatim block).

## 7. Docs (Mode A) — CONFIGURATION.md commit-config block

The commit-config rows live in the **"Resilience Tuning"** table (`docs/CONFIGURATION.md` ~158–167),
which holds `COMMIT_RETRY_MAX`/`COMMIT_RETRY_DELAY`/`COMMIT_RETRY_DELAY_CAP`/`CLASSIFIER_RETRY_MAX`.
PRD §5.1 groups all of these as commit-config. Add a new row for `PRP_COMMIT_FORMAT` following the
exact table pattern (Required `No`, Default `task-prefix`, Description citing §5.1 + the `plain`
opt-out). Verified the table is pipe-delimited markdown with `| <VAR> | No | <default> | <desc> |`.

**GOTCHA:** `PRP_COMMIT_FORMAT` is a FORMAT toggle, not a resilience knob — but the architecture doc
names the Resilience-Tuning commit rows as the "commit-config block", and there is NO separate
"Commit Message Format" section. Adding it to the existing commit rows (with a §5.1 reference in the
description) is the correct, lowest-friction placement; the description makes the semantics clear.

## 8. npm scripts (VERIFIED — package.json)

```
"fix": "npm run lint:fix && npm run format"
"typecheck": "tsc --noEmit -p tsconfig.build.json"
"lint": "eslint . --ext .ts"
"format:check": "prettier --check \"**/*.{ts,js,json,md,yml,yaml}\""
"test:run": "vitest run"
```

Gate = `npm run fix && npm run typecheck && npm run lint && npm run format:check` + the targeted
`tests/unit/config/prp-commit-format.test.ts`. Do NOT run the full `npm run test:run` — it is
pre-existing red (bugfix BUG-004, 178 failures, P1.M4 scope). The `as const` on
`DEFAULT_PRP_COMMIT_FORMAT` is REQUIRED so the getter's return type `PrpCommitFormat` is assignable
without a cast (mirrors `DEFAULT_VALIDATION_AGENT = 'pizr' as const`).

## 9. Disjointness vs siblings

- **S2 (P1.M3.T1.S2)** consumes this getter in `git-commit.ts` — different file; this PRP is its
  prerequisite (S2's contract depends on the exported symbol existing). No overlap.
- **P1.M2.T2.S1** (parallel, in flight) edits `prp-pipeline.ts` + its test — totally disjoint file
  surface. No merge conflict.
- This PRP edits ONLY: `src/config/constants.ts` (additive, end of commit block) + NEW
  `tests/unit/config/prp-commit-format.test.ts` + `docs/CONFIGURATION.md` (one table row). Nothing else.