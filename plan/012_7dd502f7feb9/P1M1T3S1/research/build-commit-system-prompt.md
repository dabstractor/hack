# Research — P1.M1.T3.S1: `buildCommitMessageSystemPrompt(style, examples?)`

> PRD §5.1 "Commit Message Style (Learning & Explicit Modes)" — the mode-conditional system-prompt
> builder. This task adds ONE exported pure function to `src/agents/commit-message-agent.ts` that
> returns the style-conditional system-prompt string consumed (in T3.S2) by the
> `createCommitMessageAgent` factory. Architecture spec: `plan/012_7dd502f7feb9/architecture/implementation-status.md §F1.E`.

## 0. Scope boundary (critical)

- **THIS TASK (T3.S1) adds ONLY `buildCommitMessageSystemPrompt(style, examples?)` + its module
  constants + its unit tests.** It does NOT touch the `createCommitMessageAgent` factory — that
  factory refactor (accepting an optional `systemPrompt`) is **T3.S2** (`Refactor
  createCommitMessageAgent to accept dynamic system prompt`, status Planned). The factory change is
  out of scope here.
- The function is **pure** (string-in/string-out). It does NOT call `createBaseConfig`, `createAgent`,
  or `getLogger`, so the existing `vi.mock('../../../src/agents/agent-factory.js')` and
  `vi.mock('groundswell')` in the test file do not interfere (they just go unused for the new tests).
- Files touched: `src/agents/commit-message-agent.ts` (add) + `tests/unit/agents/commit-message-agent.test.ts` (add describe block). **Nothing else.**

## 1. Verified current state of the target file

`src/agents/commit-message-agent.ts` (read in full):
- Module-private `const COMMIT_MESSAGE_SYSTEM` (the "plain" contract) — lines ~64–78 (the template
  literal). **This IS the plain mode's contract, returned VERBATIM.** Do NOT refactor it.
- `export function createCommitMessageAgent(): Agent` (line ~108) — the factory; **untouched by S1**.
- Only export today: `createCommitMessageAgent`. We ADD `buildCommitMessageSystemPrompt`.
- Imports today: `createAgent, type Agent` from `groundswell`; `createBaseConfig` from `./agent-factory.js`; `getLogger` from `../utils/logger.js`.
- ADD import: `import type { PrpCommitStyle } from '../config/constants.js';` (type-only — no runtime
  dep; the value `getPrpCommitStyle` lives in constants.ts and is read by T4, not here).

## 2. The input type (from completed P1.M1.T1.S1)

`src/config/constants.ts:828`:
```ts
export type PrpCommitStyle = 'auto' | 'plain' | 'conventional' | 'gitmoji';
```
`getPrpCommitStyle()` returns one of these four (case-insensitive, default `'auto'`).
`getPrpCommitStyleExamples()` returns a non-negative int (default 5; `0` is valid and disables
learning). **These getters are T4's concern; S1's function just receives a resolved `style` + an
optional `examples` array.** The `examples` come from T2.S1's `getRecentCommitMessages(count)`
(newest-first full messages) — T4 passes them in.

## 3. The exact function contract (from §F1.E + PRD §5.1)

```ts
/**
 * Build the mode-conditional stagecoach system prompt (PRD §5.1 commit-message style layer).
 * ...JSDoc (Mode A) — see PRP §"Implementation Tasks Task 1 (b)"...
 */
export function buildCommitMessageSystemPrompt(
  style: PrpCommitStyle,
  examples?: readonly string[]
): string
```

Decision table (implemented as a `switch (style)`):

| style        | examples                                 | Returns |
| ------------ | ---------------------------------------- | ------- |
| `plain`      | (ignored)                                | `COMMIT_MESSAGE_SYSTEM` verbatim |
| `conventional` | (ignored)                              | `CONVENTIONAL_COMMIT_SYSTEM` (new) |
| `gitmoji`    | (ignored)                                | `GITMOJI_COMMIT_SYSTEM` (new, embeds table) |
| `auto`       | provided AND `examples.length > 1`       | META block (examples verbatim + anti-reuse + ignore-position-prefix) + `COMMIT_MESSAGE_DISCIPLINE` |
| `auto`       | undefined / empty / `length <= 1`        | `COMMIT_MESSAGE_SYSTEM` (degrade to plain) |

**Degradation rule (PRD §5.1):** "When the repository has ≤1 commit (nothing to learn), `auto`
degrades to the `plain` contract." → in the function, `auto` with `!examples || examples.length <= 1`
returns `COMMIT_MESSAGE_SYSTEM`. (Note `length === 1` ALSO degrades — PRD says "≤1".)
**Explicit modes IGNORE `examples`** (defensive; the caller/T4 omits them for explicit modes per
PRD "history examples are omitted entirely in explicit modes").

## 4. Shared output discipline (PRD §5.1 "Mode-conditional system prompt")

> "In every mode the output discipline is unchanged: emit ONLY the descriptive message (no position
> prefix, no `[PRP Auto]` banner, no `Co-Authored-By` trailer — those remain `formatCommitMessage`'s
> job)."

Define a NEW module constant `COMMIT_MESSAGE_DISCIPLINE` (do NOT touch `COMMIT_MESSAGE_SYSTEM`) and
append it to the `conventional`, `gitmoji`, and `auto`-with-examples contracts. `plain` returns the
existing `COMMIT_MESSAGE_SYSTEM` unchanged (it already contains its own discipline):

```ts
const COMMIT_MESSAGE_DISCIPLINE = `OUTPUT DISCIPLINE (every mode):
- Emit ONLY the descriptive commit message (subject + optional body). No explanation, no preamble.
- Do NOT include any position prefix like "1.2.1.1:" — the caller (formatCommitMessage) adds it.
- Do NOT include "[PRP Auto]" or any banner.
- Do NOT include "Co-Authored-By" or any trailer — the caller adds it.
- No markdown fences, no leading/trailing whitespace.
- If the diff is empty or whitespace-only, output the single word "skip".`;
```

## 5. Ready-to-paste contract strings

### 5a. CONVENTIONAL_COMMIT_SYSTEM (new)
```ts
const CONVENTIONAL_COMMIT_SYSTEM = `You generate concise git commit messages from staged diffs in Conventional Commits format.

Write the subject as: type(scope): description
- "type" is REQUIRED and MUST be one of: feat fix docs style refactor perf test build ci chore revert
  (feat = new feature, fix = bug fix, docs = documentation only, style = formatting/whitespace,
   refactor = neither bug fix nor feature, perf = performance improvement, test = adding/correcting
   tests, build = build system/external deps, ci = CI config, chore = other non-src/test changes,
   revert = reverts a previous commit).
- "(scope)" is OPTIONAL — include it only when a clear scope (module/component) applies.
- "description" in imperative mood, ~50 characters, lowercase, no trailing period.

${COMMIT_MESSAGE_DISCIPLINE}`;
```

### 5b. GITMOJI_COMMIT_SYSTEM + GITMOJI_REFERENCE_TABLE (new)
The subject begins with exactly ONE gitmoji emoji CHARACTER (not a `:shortcode:`), then a space, then
the description. The full canonical table (72 entries, from gitmoji.dev) is embedded inline so the
agent can pick the right emoji:

```ts
const GITMOJI_REFERENCE_TABLE = `🎨 improve structure / format of the code
⚡️ improve performance
🔥 remove code or files
🐛 fix a bug
🚑 critical hotfix
✨ introduce new features
📝 update documentation
🚀 deploy stuff
💄 add or update the UI and style files
🎉 begin a project
✅ add, update, or pass tests
🔒 fix security or privacy issues
🔖 release / version tags
🚨 fix compiler / linter warnings
🚧 work in progress
💚 fix CI build
⬇️ downgrade dependencies
⬆️ upgrade dependencies
📌 pin dependencies to specific versions
👷 add or update CI build system
📈 add or update analytics or track code
♻️ refactor code
➕ add a dependency
➖ remove a dependency
🔧 add or update configuration files
🔨 add or update development scripts
🌐 internationalization and localization
✏️ fix typos
💩 write bad code that needs to be improved
⏪️ revert changes
🔀 merge branches
📦️ add or update compiled files or packages
👽️ update code due to external API changes
🚚 move or rename resources
📄 add or update license
💥 introduce breaking changes
🍱 add or update assets
♿️ improve accessibility
💡 add or update comments in source code
🍻 write code drunkenly
💬 update text and literals
🗃️ perform database related changes
🔊 add or update logs
🔇 remove logs
👥 add or update contributors
🚸 improve user experience / usability
🏗️ make architectural changes
📱 work on responsive design
🤡 mock things
🥚 add or update an easter egg
🙈 add or update a .gitignore file
📸 add or update snapshots
⚗️ perform experiments
🔍 improve SEO
🏷️ add or update types
🌱 add or update seed files
🚩 add, update, or remove feature flags
🥅 catch errors
💫 add or update animations and transitions
🗑️ deprecate code that needs to be cleaned up
🛂 work on code related to authorization
🩹 simple fix for a non-critical issue
🧐 data exploration
⚰️ remove dead code
🧪 add a failing test
👔 add or update business logic
🩺 add or update healthcheck
🧱 infrastructure related changes
🧵 add or update code related to multithreading or concurrency
🦺 add or update code related to validation`;

const GITMOJI_COMMIT_SYSTEM = `You generate concise git commit messages from staged diffs using a gitmoji subject.

Write the subject as: <emoji> <description>
- The subject MUST begin with EXACTLY ONE gitmoji emoji CHARACTER (not a ":shortcode:"), followed by
  a single space, then the description.
- Pick the emoji that best matches the change from the reference table below.
- "description" in imperative mood, lowercase, no trailing period.

GITMOJI REFERENCE TABLE (select the emoji that best matches the change):
${GITMOJI_REFERENCE_TABLE}

${COMMIT_MESSAGE_DISCIPLINE}`;
```
(Source: `plan/012_7dd502f7feb9/architecture/external-deps.md` "Gitmoji Reference Table", 72 entries.
The PRD requires this compiled-in at build time, no network fetch. `external-deps.md §Implementation note` says embed it as a template literal — done above.)

### 5c. auto-with-examples META block (built dynamically)
```ts
function buildAutoSystemPrompt(examples: readonly string[]): string {
  const listing = examples.map((m, i) => `${i + 1}. ${m.trim()}`).join('\n');
  return `You generate a git commit message for THIS change by MATCHING THE STYLE of the repository's recent commits below.

RECENT COMMIT MESSAGES (STYLE reference only — do NOT copy their wording):
${listing}

STYLE-MATCHING INSTRUCTIONS:
- Match the FORMAT, TONE, and LENGTH of the examples.
- Observe whether they carry a Conventional-Commit type prefix (e.g. "feat:", "fix:"), a gitmoji emoji, or plain prose — and MATCH that convention.
- ANTI-REUSE (advisory, not a hard gate): NEVER copy or reuse the examples' wording. Produce entirely ORIGINAL wording that describes THIS change.
- IGNORE any leading numeric position prefix on the examples (e.g. "1.2.1.1:") — that is a position marker added separately by the caller, NOT part of the style to imitate and NOT part of the message you emit.

${COMMIT_MESSAGE_DISCIPLINE}`;
}
```

### 5d. The switch body
```ts
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
      : COMMIT_MESSAGE_SYSTEM; // ≤1 example / none / EXAMPLES=0 → degrade to plain
  default: {
    const _exhaustive: never = style;
    return _exhaustive; // exhaustiveness guard (TS complains if a 5th mode is ever added)
  }
}
```

## 6. Anti-reuse is ADVISORY (not a mechanical gate) — PRD §5.1 "Scope & guarantees"

> "The anti-reuse instruction is advisory — it steers the model away from verbatim copying of the
> example wording — and is NOT a mechanical duplicate-rejection gate: a generated subject that
> happens to repeat a recent one is still committed."

So the function does NOT post-process / reject outputs. It only injects the instruction text. The
JSDoc (Mode A requirement) must state this.

## 7. Existing test patterns to mirror

`tests/unit/agents/commit-message-agent.test.ts`:
- `vi.mock('../../../src/agents/agent-factory.js', ...)` and `vi.mock('groundswell', ...)` are
  module-level. For `buildCommitMessageSystemPrompt` (pure, no mocks needed) they simply go unused —
  no conflict.
- Import the function: `import { buildCommitMessageSystemPrompt } from '../../../src/agents/commit-message-agent.js';`
- Add a sibling `describe('buildCommitMessageSystemPrompt', () => { … })` block (same file, after the
  existing `createCommitMessageAgent` describe). The existing `createCommitMessageAgent` tests stay
  GREEN unchanged (S1 does not touch the factory).
- Assertion style: `expect(prompt).toContain(...)`, `expect(prompt).toMatch(/.../i)`,
  `expect(prompt).toBe(...)` for the plain/auto-degrade equality to `COMMIT_MESSAGE_SYSTEM` text.

## 8. Validation commands (verified from package.json)

```bash
npx vitest run tests/unit/agents/commit-message-agent.test.ts   # new describe + all existing GREEN
npm run typecheck         # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint              # eslint . --ext .ts — clean
npm run format:check      # prettier --check **/*.{ts,...,md} — clean
```
(All four are the project's standard gates; `prebuild` runs `lint && typecheck`.)