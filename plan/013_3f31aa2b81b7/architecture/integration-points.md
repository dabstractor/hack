# Integration Points — exact verified change sites (PRD §9.2.9)

> Every reference below was read directly during research. PRP agents: re-verify the exact
> line before editing (line numbers shift as files change), but the SYMBOLS and PATTERNS are
> authoritative.

## A. `src/config/constants.ts` (52KB) — env-var getters + new reasoning constants

- **Pattern to follow:** `getValidationAgent()` at **constants.ts:993-1004** and
  `getBugFinderAgent()` at **constants.ts:1134-1145**. Both: `const raw = process.env[KEY];
  if (raw === undefined) return DEFAULT; const trimmed = raw.trim(); return trimmed === '' ?
  DEFAULT : trimmed;`. The new reasoning getters ADD: lowercase + vocabulary validation +
  hard-throw on invalid (these existing getters are free-string, so they do NOT validate —
  the reasoning getters must).
- **Env-name constant pattern:** `export const VALIDATION_AGENT = 'VALIDATION_AGENT';`
  (constants.ts:954). Mirror for `PRP_REASONING_AGENT`, `PRP_REASONING_BREAKDOWN_AGENT`,
  `PRP_REASONING_BUG_FINDER_AGENT`, `PRP_REASONING_VALIDATION_AGENT`, `PRP_REASONING_IMPL_AGENT`.
- **Vocabulary array pattern:** follow existing accepted-value arrays in `hack-config.ts`
  (e.g. `acceptedValues: ['pi','claude-code']`). New `REASONING_LEVELS` (lowercase):
  `['off','minimal','low','medium','high','xhigh']`.
- **Defaults:** agent=`high`, breakdown=`high`, bug_finder=`high`, validation=`high`, impl=`off`.
- Add a new section header `// Reasoning Configuration (PRD §9.2.9)` near the Bug Hunt /
  Validation Control sections.

## B. `src/config/types.ts` — new `ReasoningConfigError`

- **Pattern to follow:** `AuthPreflightError` class at **types.ts:219-237** (extends Error,
  `this.name`, builds an actionable message via a helper like `buildPreflightMessage` at
  types.ts:260) and `HackConfigError` at **types.ts:241**.
- `ReasoningConfigError` message MUST name: the offending env-var/key, the bad value, and the
  accepted levels (case-insensitive). e.g.
  `Invalid reasoning level for 'PRP_REASONING_AGENT': 'ultra'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.`

## C. `src/agents/agent-factory.ts` — type reconcile + factory decoupling

- **`ThinkingLevel` type:123** — change `'off'|'low'|'medium'|'high'|'xhigh'|'max'` → alias
  `export type ThinkingLevel = ReasoningLevel` (import from constants.ts). **Add `minimal`,
  drop `max`.**
- **JSDoc:114-122** (above ThinkingLevel) — currently claims pipeline "intentionally EXCLUDES
  `minimal`" vs the pi SDK. This is now WRONG (see external-deps.md §2: the pi SDK vocabulary
  is IDENTICAL to §9.2.9). Rewrite to state the pipeline mirrors pi/§9.2.9 exactly.
- **`ROLE_CONFIG`:248-256** — remove `thinking` from the values; keep `tier` only:
  `Record<ModelRole, { readonly tier: ModelTier }>`. (`reasoning: { tier: 'balanced' }` — the
  `thinking: 'xhigh'` pin is DELETED; the level now comes from the per-identity getter.)
- **`createBaseConfig`:303-345** — currently destructures `{ tier, thinking } = ROLE_CONFIG[role]`.
  Change to: tier from `ROLE_CONFIG[role].tier` (unchanged model resolution via `getModel(tier)`),
  and accept a NEW explicit `thinking: ThinkingLevel` param composed onto the returned config,
  INDEPENDENT of the tier. Update the `role` default + JSDoc. This severs the coupling.
- **Factory wiring (each calls its getter):**
  - `createArchitectAgent:337` → `createBaseConfig('architect','reasoning', getReasoningBreakdown())`
  - `createResearcherAgent:373` → `createBaseConfig('researcher','research', getReasoningAgent())`
  - `createCoderAgent:403` → `createBaseConfig('coder','implementation', getReasoningImpl())`
  - `createCleanupAgent` → `createBaseConfig('cleanup','implementation', 'off')` (mechanical; documented)
  - `createQAAgent:453` → NEW signature `createQAAgent(reasoningLevel: ReasoningLevel)`; body
    `createBaseConfig('qa','reasoning', reasoningLevel)`. Update JSDoc (currently says
    "balanced tier @ xhigh"; rewrite to "level resolved by caller per §9.2.9").
- Update all `xhigh`-pinned JSDoc/comments in this file (lines 114,163,235,243,293,340,435-440)
  to the §9.2.9 defaults (`high` default, configurable).

## D. `src/agents/commit-message-agent.ts:361` — createBaseConfig caller

- `createBaseConfig('researcher', 'research')` → add the explicit thinking arg: `'off'`
  (single-shot commit-message generation; mechanical, documented decision). Update its JSDoc.

## E. The four `createQAAgent` call sites — pass resolved getter

| File:line | New call |
|-----------|----------|
| `src/workflows/bug-hunt-workflow.ts:273` | `createQAAgent(getReasoningBugFinder())` |
| `src/workflows/validation-workflow.ts:235` | `createQAAgent(getReasoningValidation())` |
| `src/workflows/delta-analysis-workflow.ts:121` | `createQAAgent(getReasoningAgent())` (research-leaning) |
| `src/core/change-classifier.ts:112` (`classifyChange`) | `createQAAgent(getReasoningAgent())` (research-leaning) |
| `src/core/change-classifier.ts:161` (`classifyArtifact`) | `createQAAgent(getReasoningAgent())` (research-leaning) |

Each file adds `import { getReasoning... } from '../config/constants.js'`. The bug-finder and
validation callers now resolve INDEPENDENT levels (the core §9.2.9 requirement).

## F. `src/config/hack-config.ts` — .hack schema (SCHEMA_MAP + HACK_CONFIG_SCHEMA)

- **SCHEMA_MAP (starts :189):** add 5 entries, section `'reasoning'`, mirroring the `[harness]`
  enum entry at :222-230 (which has `acceptedValues`). e.g.
  `{ section:'reasoning', key:'agent', envVar:'PRP_REASONING_AGENT', type:'string', defaultValue:'high', acceptedValues:['off','minimal','low','medium','high','xhigh'] }`
  (and breakdown_agent=`high`, bug_finder_agent=`high`, validation_agent=`high`, impl_agent=`off`).
- **HACK_CONFIG_SCHEMA:632** (the VALIDATION authority): add
  `reasoning: { agent:{type:'string',enum:[...]}, breakdown_agent:{...}, bug_finder_agent:{...}, validation_agent:{...}, impl_agent:{...} }`,
  mirroring `harness: { name:{type:'string',enum:['pi','claude-code']} }` at :641.
- **Case-insensitivity (REQUIRED, §9.2.9 #2):** the loader's enum check at **:898-903**
  (`!spec.enum.includes(value as string)` → throw `... is not one of the accepted values [...]`)
  is CASE-SENSITIVE. The reasoning values must be accepted case-insensitively. Fix: normalize
  the parsed value to lowercase before the enum check for `[reasoning]` keys (or make the
  reasoning enum comparison case-insensitive). Ensure the thrown message is actionable
  (already names section+key+file+value+accepted — §9.7.7).
- **AUTO-DERIVED (no edit needed — verify only):**
  - `HACK_KEY_TO_ENV` (:535) — derived from SCHEMA_MAP via filter(`envVar`).
  - init template — `ConfigCommand.#buildTemplate()` (`src/cli/commands/config.ts:207`) iterates
    SCHEMA_MAP by section → a `[reasoning]` block is emitted automatically.
  - `hack config show --src` — `#showAction` (config.ts:327-416) iterates SCHEMA_MAP and
    resolves value+source per entry → reasoning rows appear automatically with winning layer.

## G. `src/index.ts` — startup fail-fast

- **Startup sequence (main(), verified):** `loadHackConfig()` :156 → `applyHackCliDefaults`
  :167 → PRD-exists check → `configureEnvironment()` :181 → logger → dry-run/validate-prd
  early-returns → `configureHarness()` :261 → `await runAuthPreflight()` :266 →
  `await ensureHarnessInitialized()` → agent creation.
- **Insertion point for reasoning fail-fast:** AFTER `configureEnvironment()` (:181, so env is
  resolved incl. .hack seeding) and the credential-free early-returns, BEFORE any agent is
  created — i.e. alongside/after `runAuthPreflight()` (:266). Call `validateAllReasoningLevels()`
  (new, constants.ts) which invokes all five getters; a bad env value throws
  `ReasoningConfigError`.
- **Error rendering:** add a `main().catch` arm (mirroring the existing arms at :402-431 for
  `AuthPreflightError`/`HackConfigError`): `if (error instanceof ReasoningConfigError)
  { console.error(\`\n❌ ${error.message}\`); process.exit(1); }`. No stack trace (actionable
  one-liner, §9.7.7 discipline).

## H. `.env.example` + repo `./.hack`

- **`.env.example`:** add a `# Reasoning Levels (PRD §9.2.9)` subsection after the
  `# MODEL CONFIGURATION` block (starts :40). Document the five vars + six valid levels +
  defaults + the "model and reasoning are independent axes" note + empty-value→default +
  invalid→hard-error.
- **`./.hack` (repo config, optional discoverability):** add a commented `[reasoning]` block
  (the init template would emit it; back-porting a commented block aids discoverability for
  users reading the committed config). Not required for behavior (defaults apply when absent).