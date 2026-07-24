# P3.M1.T1.S1 — Codebase Analysis (Proven Facts)

Scope: Add `RESEARCH_DEPTH` + `PARALLEL_RESEARCH` config constants/helpers,
change `DEFAULT_RESEARCH_TIMEOUT_SECONDS` 300→1800, add CLI flags. Foundational —
consumed by S2 (depth-chained supervisor), S3 (docs), S4 (bugfix forwarding).

## §1 — Env-var constant pattern (constants.ts)

The codebase uses a strict 3-part pattern for every env-var-backed config knob:

1. **NAME constant** — a `string` literal holding the env-var name, with full
   JSDoc (`@remarks` explains "the VALUE is read via …").
2. **DEFAULT constant** — the fallback value.
3. **getter function** — reads `process.env[NAME] ?? DEFAULT`, validates, returns.

Confirmed existing exemplars (all in `src/config/constants.ts`):

```ts
// RESEARCH_TIMEOUT block (lines ≈219-271) — THE PRIMARY MIRROR PATTERN
export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';                  // name
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;                 // default (line 249)
export function getResearchTimeoutSeconds(): number {                // getter
  const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
  }
  return raw;
}

// ISSUE_RETRY_MAX block (lines ≈274-326) — secondary mirror (int validation)
export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';
export const DEFAULT_ISSUE_RETRY_MAX = 3;
export function getIssueRetryMax(): number {
  const raw = Number(process.env[ISSUE_RETRY_MAX] ?? DEFAULT_ISSUE_RETRY_MAX);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_ISSUE_RETRY_MAX;
  }
  return raw;
}
```

**Placement:** Both blocks live under the
`// Resilience Tuning (PRD §4.2, §4.5, §9.2.2)` section header (≈line 209). The
new `RESEARCH_DEPTH` (int, default 2) mirrors `ISSUE_RETRY_MAX` EXACTLY. The new
`PARALLEL_RESEARCH` (boolean, default false) is a NEW shape — there is no
existing boolean env-var helper in constants.ts. The closest in-repo precedent
for boolean parsing is `execution-guard.ts:68`:
`process.env.SKIP_BUG_FINDING === 'true'` (EXACT string match, case-sensitive).

## §2 — The 300→1800 change

`DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300` is at constants.ts:249 (architecture doc
says line 198; the actual line is 249 in the working tree — both refer to the
SAME constant). The JSDoc on line ≈237 (`Default deadline (300s = 5min)`) AND
the JSDoc example on line ≈246 (`console.log(DEFAULT_RESEARCH_TIMEOUT_SECONDS);
// 300`) BOTH mention 300 and MUST be updated to `1800` / `30min` for the doc to
stay truthful. PRD §4.2 & §9.2.2 both say default = 1800s (30 min).

## §3 — CLI flag pattern (cli/index.ts)

Global (no-subcommand) options are registered via `program.option(...)` chaining
in the `parseCLIArgs()` function (≈lines 260-356). Examples of relevant shapes:

- **boolean flag, default false:** `.option('--no-cache', '…', false)` (line 290)
  `.option('--continue-on-error', '…', false)` (line 291)
- **number-from-env option:** `.option('--research-concurrency <n>', '…
  (1-10, default: 3, env: RESEARCH_QUEUE_CONCURRENCY)',
  process.env.RESEARCH_QUEUE_CONCURRENCY ?? '3')` (lines 309-313) —
  reads env inline as the commander default.
- **`--no-retry` idiom:** `.option('--retry', '…', true)` then
  `.option('--no-retry', '…', false)` (lines 352-356) — commander's negation
  convention for a boolean.

**For `-r/--parallel-research` (boolean default false):** Use the simple
`.option('-r, --parallel-research', 'Enable background (parallel) PRP research
(default: false, env: PARALLEL_RESEARCH)', false)` form. Do NOT use the
`--no-` negation idiom (PRD §9.2.2 says the flag is `-r`/`--parallel-research`,
a positive enable).

**For `--research-depth <n>` (int default 2):** Mirror the
`--research-concurrency` shape: `.option('--research-depth <n>', 'How many items
ahead the background research supervisor prefetches (default: 2, env:
RESEARCH_DEPTH)', process.env.RESEARCH_DEPTH ?? '2')`.

## §4 — CLIArgs interface & union (cli/index.ts)

- The `CLIArgs` interface (lines 62-141) holds the parsed option shapes. New
  fields: `parallelResearch?: boolean;` and `researchDepth?: number | string;`.
- `ValidatedCLIArgs` (lines 153-…) `extends Omit<CLIArgs, …>`. The depth value
  must be coerced to `number` in the validation block (≈lines 730-770, where
  `parallelism` is parsed). PRD says RESEARCH_DEPTH is a positive int — validate
  `>= 1` (mirror the `parallelism` 1-10 clamp style).
- The return-type union (lines 242-248) is UNCHANGED — these are global options,
  not subcommands.

## §5 — Test pattern (tests/unit/config/constants.test.ts)

Pure & deterministic — NO environment mutation (stays stable under 100%-
coverage gate). Tests assert the NAME constant string, the DEFAULT value, and
the getter's default-when-unset behavior. For getters that read env, the codebase
style is to NOT mutate `process.env` in unit tests (the getter's unset path is
tested; env-set paths are covered by integration). For `PARALLEL_RESEARCH`
(boolean), test default returns `false` when unset.

NOTE: vitest.config.ts enforces 100/100/100/100 on `src/**/*.ts`. The new
constants + helpers + CLI branches are NEW src/ code and MUST be exercised by a
test or coverage fails. Test the happy path (default) + each getter branch.

## §6 — Docs seams (Mode A — rides with the work)

- **`.env.example`** — has themed `# ===` sections. Add `PARALLEL_RESEARCH` and
  `RESEARCH_DEPTH` to a "RESEARCH CONFIGURATION" area (near
  `RESEARCH_QUEUE_CONCURRENCY`, ≈line 96). Also update the `RESEARCH_TIMEOUT`
  line if present (it is NOT currently in .env.example — only in CONFIGURATION.md
  line 151 with the OLD default `300`). Add a commented `# RESEARCH_TIMEOUT=1800`.
- **`docs/CONFIGURATION.md`** line 151 currently shows `| RESEARCH_TIMEOUT | No |
  300 | …`. Update `300`→`1800`. Add `PARALLEL_RESEARCH` and `RESEARCH_DEPTH`
  rows to the research/resilience table (the table spanning ≈lines 140-155).
  PRD §9.2.2 gives exact descriptions.

## §7 — Scope fences & sibling overlap

- **S1 owns:** constants + helpers + CLI flags + the 1800 constant change +
  .env.example + CONFIGURATION.md updates (contract item 3c & 5).
- **S3 ("Update RESEARCH_TIMEOUT default and documentation")** — per plan_status
  S3 is a SEPARATE 1-point subtask. BUT S1's own item_description explicitly
  includes the 300→1800 change (item 3c) AND the docs update (item 5 DOCS).
  Resolution: S1 implements the FULL contract as written (the 1800 change + the
  env/doc rows ride WITH this work per Mode A). S3 then becomes a verification/
  polish pass — but S1 must not leave the constant at 300 or it violates its own
  item_description. Implement item 3c & 5 here; leave S3 to refine if needed.
- **Out of scope:** ResearchQueue changes (S2), bugfix forwarding (S4), any
  logic that CONSUMES these constants. S1 is foundational config ONLY.
- READ-ONLY: PRD.md, tasks.json, prd_snapshot.md, vitest.config.ts.

## §8 — Validation commands (verified)

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # eslint . --ext .ts
npm run format:check        # prettier --check
npm run test:run            # vitest run
npm run validate            # lint + format:check + typecheck + test:run
npm run build               # tsc -p tsconfig.build.json
npx vitest run --coverage   # 100/100/100/100 on src/**/*.ts
```