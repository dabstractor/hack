# PRP — P1.M1.T3.S1: `buildCommitMessageSystemPrompt(style, examples?)` — four style contracts + gitmoji reference table + auto example injection

> PRD §5.1 **"Commit Message Style (Learning & Explicit Modes)"** — the **mode-conditional
> stagecoach system-prompt builder**. Adds ONE exported pure function to
> `src/agents/commit-message-agent.ts` that returns the style-conditional system-prompt string for
> the four `PrpCommitStyle` modes (`auto`/`plain`/`conventional`/`gitmoji`), with the full gitmoji
> reference table compiled inline for `gitmoji` and example-injection + anti-reuse for `auto`. The
> function is consumed by **P1.M1.T3.S2** (factory refactor — out of scope here) and wired by
> **P1.M1.T4.S1** (`generateCommitMessage`). Architecture spec:
> `plan/012_7dd502f7feb9/architecture/implementation-status.md §F1.E`.

---

## Goal

**Feature Goal**: Add `export function buildCommitMessageSystemPrompt(style: PrpCommitStyle,
examples?: readonly string[]): string` to `src/agents/commit-message-agent.ts` implementing PRD §5.1's
mode-conditional system prompt: `plain` → existing `COMMIT_MESSAGE_SYSTEM` verbatim; `conventional` →
a NEW `type(scope): description` contract (standard vocabulary); `gitmoji` → a NEW contract with the
full ~72-entry gitmoji reference table compiled inline (emoji character, not `:shortcode:`); `auto`
with `>1` examples → a META block listing the examples VERBATIM (trimmed) + match-style +
anti-reuse + ignore-position-prefix instructions; `auto` with ≤1/none examples → degrade to `plain`.

**Deliverable**:
1. **`src/agents/commit-message-agent.ts`** — (a) the new exported `buildCommitMessageSystemPrompt`
   function + its JSDoc (Mode A); (b) new module-private constants `CONVENTIONAL_COMMIT_SYSTEM`,
   `GITMOJI_COMMIT_SYSTEM`, `GITMOJI_REFERENCE_TABLE`, `COMMIT_MESSAGE_DISCIPLINE`, and a
   `buildAutoSystemPrompt(examples)` helper; (c) `import type { PrpCommitStyle } from '../config/constants.js';`.
   **The existing `COMMIT_MESSAGE_SYSTEM` const and the `createCommitMessageAgent` factory are
   UNCHANGED** (the factory refactor is T3.S2).
2. **`tests/unit/agents/commit-message-agent.test.ts`** — add a sibling
   `describe('buildCommitMessageSystemPrompt')` block asserting every branch of the decision table;
   all existing `createCommitMessageAgent` tests stay GREEN untouched.

**Success Definition**:
- `buildCommitMessageSystemPrompt('plain')` returns the existing `COMMIT_MESSAGE_SYSTEM` text byte-for-byte.
- `'conventional'` returns a contract containing `type(scope): description`, the full vocabulary
  (`feat … revert`), imperative mood, ~50-char, and the output discipline.
- `'gitmoji'` returns a contract that (i) instructs exactly ONE emoji character + space + description,
  (ii) embeds the full gitmoji table (incl. `✨`, `🐛`, `♻️`, …), and (iii) carries the discipline.
- `'auto'` with `['a','b']` (length 2) returns a META block containing both examples VERBATIM
  (trimmed), an anti-reuse instruction (`NEVER copy`/`ORIGINAL`), an ignore-position-prefix
  instruction (`1.2.1.1:` / `IGNORE`), and the discipline.
- `'auto'` with `undefined`, `[]`, or a single example (`['a']`) returns the `plain` contract
  (`COMMIT_MESSAGE_SYSTEM`) — the ≤1-degradation rule.
- Explicit modes (`plain`/`conventional`/`gitmoji`) IGNORE the `examples` argument (passing examples
  does not change their output).
- `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN (new describe + all existing);
  `npm run typecheck` exit 0; `npm run lint` clean; `npm run format:check` clean.
- **No other files modified.** No factory change (T3.S2), no `generateCommitMessage` wiring (T4),
  no docs (T3 docs are P1.M3, a separate milestone).

## User Persona

N/A — internal pipeline function. Indirect "users" are (a) the `stagecoach` LLM, which receives the
contract that shapes the generated commit message, and (b) downstream teams whose commit history
style (`PRP_COMMIT_STYLE`) this ultimately honors.

## Why

- **Implements the §5.1 "Mode-conditional system prompt" requirement.** The four styles conflict
  (`plain` forbids a type prefix; `conventional` requires one; `gitmoji` requires an emoji), so the
  agent's system prompt MUST be built dynamically from the resolved mode. The current hardcoded
  `COMMIT_MESSAGE_SYSTEM` becomes the `plain` contract; the other three modes are new.
- **Unblocks T3.S2 + T4.** T3.S2's factory refactor and T4's `generateCommitMessage` wiring both
  need a single function that turns `{style, examples}` → a system-prompt string. This is it.
- **Low risk, additive + pure.** A string-in/string-out function with no I/O, no agent instantiation,
  no env reads (the resolved `style` and `examples` are passed in by T4). Existing factory behavior is
  byte-for-byte preserved (`COMMIT_MESSAGE_SYSTEM` untouched).
- **Scope discipline.** S1 = the builder + module constants + unit tests (THIS task). S2 = factory
  refactor (different lines). T4 = `generateCommitMessage` wiring (different file `src/utils/git-commit.ts`).
  The helper `getRecentCommitMessages` is T2.S1 (parallel, different file). **Zero file-overlap.**

## What

### User-visible behavior
None directly (internal prompt construction). Indirectly, once T3.S2 + T4 land: the stagecoach agent
generates commit messages whose descriptive-message style matches the resolved `PRP_COMMIT_STYLE`
(plain / Conventional Commits / gitmoji, or learned from recent history under `auto`).

### Technical requirements (exact contract)

**Decision table** (implemented as `switch (style)`):

| `style`      | `examples`                       | Returns |
| ------------ | -------------------------------- | ------- |
| `plain`      | ignored                          | `COMMIT_MESSAGE_SYSTEM` (existing, verbatim) |
| `conventional` | ignored                        | `CONVENTIONAL_COMMIT_SYSTEM` (new) |
| `gitmoji`    | ignored                          | `GITMOJI_COMMIT_SYSTEM` (new, embeds `GITMOJI_REFERENCE_TABLE`) |
| `auto`       | defined AND `length > 1`         | `buildAutoSystemPrompt(examples)` (META + discipline) |
| `auto`       | `undefined` / `[]` / `length ≤ 1` | `COMMIT_MESSAGE_SYSTEM` (degrade to plain) |

- **Degradation rule (PRD §5.1):** `auto` with ≤1 example → plain. `examples.length === 1` ALSO
  degrades (PRD: "≤1 commit").
- **Explicit modes IGNORE `examples`** (PRD: "history examples are omitted entirely in explicit
  modes") — passing `examples` to `plain`/`conventional`/`gitmoji` does not change their output.
- **Exhaustiveness guard:** the `switch` includes a `default: { const _exhaustive: never = style; … }`
  arm so TypeScript flags it if a 5th `PrpCommitStyle` variant is ever added.
- **Output discipline is identical across all modes** (PRD §5.1): emit ONLY the descriptive message;
  no position prefix (`1.2.1.1:`), no `[PRP Auto]` banner, no `Co-Authored-By` trailer (those remain
  `formatCommitMessage`'s job). `plain` already carries it in `COMMIT_MESSAGE_SYSTEM`; the three new
  contracts append a NEW shared `COMMIT_MESSAGE_DISCIPLINE` constant.
- **Anti-reuse is ADVISORY, not a mechanical gate** (PRD §5.1 "Scope & guarantees"): the function
  injects the anti-reuse instruction text; it does NOT post-process or reject outputs. State this in
  the JSDoc.

### Success Criteria
- [ ] `buildCommitMessageSystemPrompt` exported with the exact signature `(style: PrpCommitStyle, examples?: readonly string[]): string`.
- [ ] `plain` returns `COMMIT_MESSAGE_SYSTEM` verbatim; existing `COMMIT_MESSAGE_SYSTEM` const is unchanged.
- [ ] `conventional` contract contains `type(scope): description`, all 11 types, imperative, ~50-char, + discipline.
- [ ] `gitmoji` contract instructs exactly one emoji character (not `:shortcode:`) + space + description, embeds the full gitmoji table, + discipline.
- [ ] `auto` + `length > 1` examples returns a block with the examples verbatim (trimmed), an
      anti-reuse instruction, an ignore-position-prefix instruction, and the discipline.
- [ ] `auto` + `undefined` / `[]` / single example returns `COMMIT_MESSAGE_SYSTEM`.
- [ ] Explicit modes ignore `examples` (conventional/gitmoji with examples passed still return their contract).
- [ ] JSDoc documents each mode's contract, the ≤1→plain degradation rule, and the advisory (non-gate) anti-reuse nature (Mode A).
- [ ] `createCommitMessageAgent` factory UNCHANGED; `COMMIT_MESSAGE_SYSTEM` UNCHANGED.
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN; `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
current file (with the verbatim `COMMIT_MESSAGE_SYSTEM`), the exact `PrpCommitStyle` type + import
path, the ready-to-paste contract strings (conventional / gitmoji table / discipline / auto META /
switch body), the decision table, the test patterns to mirror, the scope boundary (do not touch the
factory), and the verified validation commands are all below.

### Documentation & References
```yaml
# MUST READ — the ready-to-paste contract strings + full 72-entry gitmoji table + switch body + test plan
- docfile: plan/012_7dd502f7feb9/P1M1T3S1/research/build-commit-system-prompt.md
  section: "5. Ready-to-paste contract strings", "3. The exact function contract", "6. Anti-reuse is ADVISORY", "7. Existing test patterns"
  why: Copy-ready TS for COMMIT_MESSAGE_DISCIPLINE / CONVENTIONAL_COMMIT_SYSTEM / GITMOJI_REFERENCE_TABLE
        (all 72 entries) / GITMOJI_COMMIT_SYSTEM / buildAutoSystemPrompt / the switch body, plus the
        degradation rule and the exact describe-block assertions.
  critical: The gitmoji table MUST be the full canonical set (72 entries) embedded as a template
        literal — the agent selects from it. Do NOT fetch at runtime.

# MUST READ — the architecture spec for this exact task
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F1.E — Dynamic system-prompt builder"
  why: Pins the function signature, the per-mode contracts, the ≤1-degradation, and the (T3.S2) factory
        change boundary (NOT this task).
  critical: §F1.E's "Factory change" (createCommitMessageAgent(systemPrompt?)) is T3.S2, NOT S1.

# MUST READ — the gitmoji source table + conventional vocabulary + their layer relationship
- docfile: plan/012_7dd502f7feb9/architecture/external-deps.md
  section: "Gitmoji Reference Table", "Conventional Commits Vocabulary", "Relationship with the position layer"
  why: Authoritative 72-entry gitmoji table (emoji/code/description) + the 11 conventional types + the
        note that conventional/gitmoji + task-prefix both render by design.

# AUTHORITATIVE SPEC — the style-layer PRD text
- docfile: PRD.md   # (provided in selected_prd_content §5.1 "Commit Message Style")
  section: §5.1 "Commit Message Style (Learning & Explicit Modes)" → "Mode-conditional system prompt" + "Scope & guarantees"
  why: The ≤1-degradation, the verbatim example injection, the ignore-position-prefix instruction, the
        advisory (non-gate) anti-reuse, and the "explicit modes replace the examples block" rule.

# INPUT TYPE — from completed P1.M1.T1.S1
- file: src/config/constants.ts
  section: line 828 (`export type PrpCommitStyle = 'auto' | 'plain' | 'conventional' | 'gitmoji';`)
  why: The `style` parameter type. Import TYPE-ONLY: `import type { PrpCommitStyle } from '../config/constants.js';`
  gotcha: Do NOT import `getPrpCommitStyle`/`getPrpCommitStyleExamples` here — the resolved style and
        examples are passed IN by T4. This function does no env reads.

# EDIT TARGET — the file being extended (read it first; do NOT refactor COMMIT_MESSAGE_SYSTEM)
- file: src/agents/commit-message-agent.ts
  why: `COMMIT_MESSAGE_SYSTEM` const (~L64-78) = the plain contract, returned VERBATIM. Add the new
        function + constants AFTER it, BEFORE the `createCommitMessageAgent` factory (~L108). Add the
        PrpCommitStyle type import to the existing import block at the top.
  pattern: Template-literal consts (see COMMIT_MESSAGE_SYSTEM) + a JSDoc'd exported function (see the
        factory's JSDoc style). Pure function — no createBaseConfig/createAgent/getLogger calls.
  gotcha: Do NOT touch `createCommitMessageAgent` (T3.S2 owns it). Do NOT change COMMIT_MESSAGE_SYSTEM.

# INPUT-SOURCE CONTRACT (parallel, T2.S1) — what `examples` contains
- docfile: plan/012_7dd502f7feb9/P1M1T2S1/PRP.md
  section: "Goal" / "Success Definition"
  why: `getRecentCommitMessages(count)` returns the FULL message (subject+body) of each of the last
        `count` commits, newest-first. T4 passes that array as `examples`. `count === 0 → []` (disables
        learning). So `examples` may be `[]` or short — the ≤1-degradation handles that.

# CONSUMER (downstream, T3.S2 — do NOT implement here)
- file: src/agents/commit-message-agent.ts   # createCommitMessageAgent(systemPrompt?) — T3.S2
  why: T3.S2 will make the factory accept the prompt this function returns. Reference only; out of scope.

# TEST PATTERN — the test file being extended
- file: tests/unit/agents/commit-message-agent.test.ts
  why: Mirror its `describe`/`it`/`expect(...).toContain|toMatch|toBe` style for the new
        `describe('buildCommitMessageSystemPrompt')` block. The file's module-level
        `vi.mock('agent-factory.js')` + `vi.mock('groundswell')` are harmless for the pure function.
```

### Current Codebase tree (edit surface)

```bash
src/agents/commit-message-agent.ts        # EDIT: add buildCommitMessageSystemPrompt + constants + import
  ├─ const COMMIT_MESSAGE_SYSTEM (~L64)   # UNCHANGED — the plain contract (returned verbatim by plain/auto-degrade)
  ├─ function buildCommitMessageSystemPrompt  ← NEW (exported, pure)
  │    ├─ const COMMIT_MESSAGE_DISCIPLINE     ← NEW (module-private, shared by conventional/gitmoji/auto)
  │    ├─ const CONVENTIONAL_COMMIT_SYSTEM    ← NEW
  │    ├─ const GITMOJI_REFERENCE_TABLE       ← NEW (72-entry template literal)
  │    ├─ const GITMOJI_COMMIT_SYSTEM         ← NEW (embeds GITMOJI_REFERENCE_TABLE + discipline)
  │    ├─ function buildAutoSystemPrompt(ex)  ← NEW (module-private helper)
  │    └─ switch (style) { plain | conventional | gitmoji | auto(with/≤1) | never-guard }
  └─ function createCommitMessageAgent (~L108) # UNCHANGED (T3.S2 owns the factory refactor)

src/config/constants.ts                   # READ-ONLY (PrpCommitStyle type, L828) — T1.S1 (Complete)
src/tools/git-mcp.ts                      # READ-ONLY (getRecentCommitMessages) — T2.S1 (parallel)
src/utils/git-commit.ts                   # READ-ONLY (generateCommitMessage) — T4.S1 (consumer, Planned)

tests/unit/agents/commit-message-agent.test.ts   # EDIT: add describe('buildCommitMessageSystemPrompt')
```

### Desired Codebase tree with files to be added/changed

```bash
src/agents/commit-message-agent.ts        # EDIT — add export + 4 consts + 1 helper + import type
tests/unit/agents/commit-message-agent.test.ts  # EDIT — add one describe block
# (no new files; no other files touched)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (scope): Do NOT modify createCommitMessageAgent (T3.S2) or COMMIT_MESSAGE_SYSTEM (the plain
//   contract — returned VERBATIM). This task is purely ADDITIVE: new function + new consts + import.

// CRITICAL (degradation threshold): auto degrades to plain when examples is undefined, empty, OR
//   length <= 1 (NOT length === 0). PRD §5.1: "≤1 commit → plain". So a SINGLE example also degrades.

// GOTCHA (explicit modes ignore examples): plain/conventional/gitmoji MUST ignore the examples arg.
//   Do not branch on examples for those modes. (T4 will not pass examples for explicit modes anyway,
//   but the function must be defensive.)

// GOTCHA (emoji vs shortcode): gitmoji contract MUST tell the agent to emit the EMOJI CHARACTER (e.g.
//   ✨), NOT a ":shortcode:" (e.g. :sparkles:). The table is a reference; the emitted subject uses the char.

// GOTCHA (anti-reuse is advisory): per PRD §5.1 "Scope & guarantees", the anti-reuse instruction is
//   advisory steering — NOT a duplicate-rejection gate. The function injects instruction text only;
//   it never inspects/rejects the model's output. State this in the JSDoc.

// GOTCHA (type-only import): import PrpCommitStyle as a TYPE (`import type {…}`) — no runtime coupling
//   to constants.ts. The resolved style value is passed in by the caller (T4).

// GOTCHA (exhaustiveness): add a `default: { const _exhaustive: never = style; }` arm so adding a 5th
//   PrpCommitStyle variant later is a compile error rather than a silent fall-through.
```

## Implementation Blueprint

### Data models and structure
N/A — no data models. The function is a pure `(PrpCommitStyle, readonly string[]?) => string`. The
only "structures" are the module-private prompt-string constants + the `buildAutoSystemPrompt`
helper. `PrpCommitStyle` (the input union) is defined in `src/config/constants.ts` (T1.S1).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/agents/commit-message-agent.ts — add the builder + constants + import
  - (a) IMPORT: add `import type { PrpCommitStyle } from '../config/constants.js';` to the top import block.
  - (b) CONSTS (place AFTER COMMIT_MESSAGE_SYSTEM, BEFORE createCommitMessageAgent):
        COMMIT_MESSAGE_DISCIPLINE, CONVENTIONAL_COMMIT_SYSTEM, GITMOJI_REFERENCE_TABLE (full 72 entries),
        GITMOJI_COMMIT_SYSTEM — COPY-READY text in research note §5a/§5b/§4.
  - (c) HELPER: module-private `function buildAutoSystemPrompt(examples: readonly string[]): string`
        — COPY-READY in research note §5c (lists examples verbatim trimmed + style-match + anti-reuse
        + ignore-position-prefix + COMMIT_MESSAGE_DISCIPLINE).
  - (d) EXPORT FUNCTION: `buildCommitMessageSystemPrompt(style, examples?)` with the switch body
        (research note §5d) + JSDoc (Mode A: each mode's contract, ≤1→plain rule, advisory anti-reuse).
  - FOLLOW pattern: existing COMMIT_MESSAGE_SYSTEM template literal + the factory's JSDoc style.
  - NAMING: UPPER_SNAKE consts; camelCase buildCommitMessageSystemPrompt / buildAutoSystemPrompt.
  - PLACEMENT: commit-message-agent.ts (same module as the contract it serves).
  - DO NOT: touch COMMIT_MESSAGE_SYSTEM or createCommitMessageAgent.

Task 2: EDIT tests/unit/agents/commit-message-agent.test.ts — add describe('buildCommitMessageSystemPrompt')
  - IMPORT: add `buildCommitMessageSystemPrompt` to the existing import from
        '../../../src/agents/commit-message-agent.js'.
  - ADD a sibling describe block (AFTER the existing createCommitMessageAgent describe) with it() cases:
        * plain → toBe the plain contract (assert it contains 'imperative', '≤72', forbids type prefix).
        * conventional → contains 'type(scope)', all 11 vocab words ('feat'…'revert'), '~50', 'imperative',
          discipline ('position prefix' / 'Co-Authored-By' prohibitions).
        * gitmoji → contains 'ONE ... emoji', instructs NOT ':shortcode:', embeds table (toContain '✨',
          '🐛', '♻️', '🔥'), discipline.
        * auto + 2 examples → toContain BOTH example strings trimmed, /NEVER copy|ORIGINAL/i,
          /IGNORE.*position prefix|1\.2\.1\.1/i, discipline.
        * auto + undefined → toBe SAME string as buildCommitMessageSystemPrompt('plain') (degradation).
        * auto + [] → degrades to plain (same assertion).
        * auto + single example ['only one'] → degrades to plain.
        * conventional WITH examples passed → unchanged (=== conventional without examples) — proves explicit modes ignore examples.
        * gitmoji WITH examples passed → unchanged (=== gitmoji without examples).
  - FOLLOW pattern: existing describe/it/expect(...).toContain|toMatch|toBe style; the module-level
        vi.mock(...) calls are harmless (the pure function doesn't call them).
  - NAMING: it('plain mode returns the plain contract verbatim'), etc.
  - COVERAGE: every switch arm + the ≤1-degradation (undefined/empty/single) + the explicit-ignores-examples rule.
  - PRESERVE: all existing createCommitMessageAgent tests untouched and GREEN.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the switch body with degradation + exhaustiveness (research note §5d)
export function buildCommitMessageSystemPrompt(
  style: PrpCommitStyle,
  examples?: readonly string[]
): string {
  switch (style) {
    case 'plain':
      return COMMIT_MESSAGE_SYSTEM;
    case 'conventional':
      return CONVENTIONAL_COMMIT_SYSTEM;
    case 'gitmoji':
      return GITMOJI_COMMIT_SYSTEM;
    case 'auto':
      return examples && examples.length > 1
        ? buildAutoSystemPrompt(examples)
        : COMMIT_MESSAGE_SYSTEM; // ≤1 / none / EXAMPLES=0 → degrade to plain (PRD §5.1)
    default: {
      const _exhaustive: never = style; // compile error if a 5th PrpCommitStyle is added
      return _exhaustive;
    }
  }
}

// PATTERN: auto META block — examples VERBATIM (trimmed), match STYLE, anti-reuse, ignore position prefix
function buildAutoSystemPrompt(examples: readonly string[]): string {
  const listing = examples.map((m, i) => `${i + 1}. ${m.trim()}`).join('\n');
  return `You generate a git commit message for THIS change by MATCHING THE STYLE ...\n` +
    `RECENT COMMIT MESSAGES (STYLE reference only — do NOT copy their wording):\n${listing}\n\n` +
    `STYLE-MATCHING INSTRUCTIONS:\n- Match FORMAT/TONE/LENGTH ...\n- ANTI-REUSE (advisory, not a hard gate): NEVER copy ... ORIGINAL wording ...\n- IGNORE any leading numeric position prefix (e.g. "1.2.1.1:") ...\n\n${COMMIT_MESSAGE_DISCIPLINE}`;
}

// GOTCHA (above): plain returns COMMIT_MESSAGE_SYSTEM UNCHANGED — do not refactor it to reuse COMMIT_MESSAGE_DISCIPLINE.
// GOTCHA (above): gitmoji table is the full 72-entry canonical set, embedded as ONE template literal (no runtime fetch).
```

### Integration Points
```yaml
IMPORTS (src/agents/commit-message-agent.ts):
  - add: "import type { PrpCommitStyle } from '../config/constants.js';"   # type-only, no runtime coupling

EXPORTS (src/agents/commit-message-agent.ts):
  - add: "export function buildCommitMessageSystemPrompt(...)"   # NEW public API
  - keep: "export function createCommitMessageAgent(): Agent"    # UNCHANGED (T3.S2 will change its signature)

DOWNSTREAM CONSUMERS (NOT this task — reference only):
  - T3.S2: createCommitMessageAgent(systemPrompt?) — passes this function's output as the agent's system prompt.
  - T4.S1: generateCommitMessage — resolves style via getPrpCommitStyle(), fetches examples via
           getRecentCommitMessages(getPrpCommitStyleExamples()), builds the prompt, passes to the factory.

NONE OF: src/utils/git-commit.ts (T4), src/tools/git-mcp.ts (T2.S1), src/config/constants.ts (T1.S1),
         docs/* (P1.M3), PRD.md, spec, tasks.json.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0 (confirms type-only import + switch exhaustiveness)
npm run lint             # eslint . --ext .ts — clean
npm run format:check     # prettier --check **/*.{ts,js,json,md,yml,yaml} — clean (run `npm run format` if it flags the new file)
# Expected: zero errors. If the emoji-heavy gitmoji const trips prettier/eslint, run `npm run format` then re-check.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/agents/commit-message-agent.test.ts   # new describe + ALL existing createCommitMessageAgent tests GREEN
# Expected: every it() in the new describe passes; the 9 existing factory tests are unchanged & GREEN.
#   If a degradation test fails, confirm `examples.length <= 1` (not `=== 0`) and that single-example degrades.
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm the factory + consumers are UNCHANGED (this task is purely additive — no runtime wiring yet).
grep -n 'createCommitMessageAgent' src/utils/git-commit.ts   # STILL calls createCommitMessageAgent() with no args (T4 will change this)
npm run typecheck   # the consumer file still typechecks against the unchanged factory signature
# Expected: git-commit.ts:321 still reads `createCommitMessageAgent()`; typecheck green. No behavior change at runtime (T3.S2/T4 wire it).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual sanity: print each mode's prompt and eyeball the contracts (no agent call needed).
npx tsx -e "import { buildCommitMessageSystemPrompt } from './src/agents/commit-message-agent.js'; for (const s of ['plain','conventional','gitmoji'] as const) { console.log('=== '+s+' ==='); console.log(buildCommitMessageSystemPrompt(s).slice(0,400)); } console.log('=== auto(2 ex) ==='); console.log(buildCommitMessageSystemPrompt('auto',['1.2.1.1: feat(api): add endpoint','fix(ui): tighten padding']).slice(0,500)); console.log('=== auto(1 ex) degrades ==='); console.log(buildCommitMessageSystemPrompt('auto',['only one']).slice(0,120));"
# Expected: plain prints the existing imperative contract; conventional shows type(scope)+vocab; gitmoji shows the table;
#   auto(2 ex) shows both examples + anti-reuse + ignore-prefix; auto(1 ex) prints the PLAIN contract (degradation).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1–4 all pass; `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN (new + existing).
- [ ] `createCommitMessageAgent` factory and `COMMIT_MESSAGE_SYSTEM` const byte-for-byte UNCHANGED.

### Feature Validation
- [ ] Every switch arm implemented + the ≤1-degradation (undefined / empty / single) verified by tests.
- [ ] Explicit modes (`plain`/`conventional`/`gitmoji`) proven to ignore the `examples` argument.
- [ ] `gitmoji` embeds the full 72-entry table and instructs the emoji CHARACTER (not `:shortcode:`).
- [ ] `auto` with `>1` examples lists them VERBATIM (trimmed) + anti-reuse + ignore-position-prefix.

### Code Quality Validation
- [ ] Type-only import of `PrpCommitStyle` (no runtime coupling to `constants.ts`).
- [ ] Exhaustiveness `never` guard in the switch.
- [ ] JSDoc (Mode A) documents each mode's contract, the ≤1→plain rule, and the advisory anti-reuse.
- [ ] Naming/placement match the file's conventions (UPPER_SNAKE consts, camelCase functions).

### Documentation & Deployment
- [ ] No docs changes in this task (P1.M3 owns changeset docs — separate milestone).
- [ ] No env-var additions (the getters already exist from T1.S1).

---

## Anti-Patterns to Avoid
- ❌ Don't refactor `COMMIT_MESSAGE_SYSTEM` to reuse `COMMIT_MESSAGE_DISCIPLINE` — `plain` must return it VERBATIM; keep the duplication between the plain contract's own discipline and the shared `COMMIT_MESSAGE_DISCIPLINE`.
- ❌ Don't modify `createCommitMessageAgent` — that factory refactor is T3.S2.
- ❌ Don't gate on `examples.length === 0` — the degradation threshold is `<= 1` (a single example also degrades, per PRD "≤1 commit").
- ❌ Don't branch on `examples` for explicit modes — they ignore it entirely.
- ❌ Don't fetch the gitmoji table at runtime — it MUST be compiled-in (template literal) per PRD §5.1.
- ❌ Don't emit a `:shortcode:` in the gitmoji contract — instruct the emoji CHARACTER.
- ❌ Don't make the anti-reuse a hard gate (rejecting outputs) — PRD §5.1 says it is advisory only.
- ❌ Don't wire this into `generateCommitMessage` (T4) or read `getPrpCommitStyle` here — this function is pure and receives resolved inputs.
- ❌ Don't run the full TS test suite and treat unrelated pre-existing diagnostics as this task's failure — run the targeted test file (Level 2) for the component under change.