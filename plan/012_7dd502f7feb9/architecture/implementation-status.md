# Session 012 — Implementation Status (research surfaces)

Exact files, line ranges, interfaces, and integration points the two new
features touch. All line numbers verified against the working tree at
session-creation time.

---

## Feature 1 — Commit Message Style Layer (PRD §5.1)

### F1.A — Config constants (`src/config/constants.ts`)

The existing `PRP_COMMIT_FORMAT` block (the "position layer") lives at the
bottom of the file, starting around the comment block
`// Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1`. The pattern is:

1. **Env-var name const**: `export const PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT';`
2. **Default const**: `export const DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const;`
3. **Type union**: `export type PrpCommitFormat = 'task-prefix' | 'plain';`
4. **Getter**: `export function getPrpCommitFormat(): PrpCommitFormat { … }`

**Two new tunables to add** (following the exact same pattern, appended right
after the `PRP_COMMIT_FORMAT` block):

| Const                          | Value                        | Type                                               | Default | Getter                       |
| ------------------------------ | ---------------------------- | -------------------------------------------------- | ------- | ---------------------------- |
| `PRP_COMMIT_STYLE`             | `'PRP_COMMIT_STYLE'`         | `'auto' \| 'plain' \| 'conventional' \| 'gitmoji'` | `'auto'`| `getPrpCommitStyle()`        |
| `PRP_COMMIT_STYLE_EXAMPLES`    | `'PRP_COMMIT_STYLE_EXAMPLES'`| `number` (int ≥ 0)                                 | `5`     | `getPrpCommitStyleExamples()`|

**Getter semantics:**
- `getPrpCommitStyle()`: trim + lowercase the env value; return the matching
  mode or `DEFAULT_PRP_COMMIT_STYLE` (`'auto'`) for any unrecognized/empty
  value. Unlike `getPrpCommitFormat()` (which uses case-sensitive `'plain'`
  match), the style getter should be **case-insensitive** because it has four
  valid values (lowercasing avoids `'Auto'`/`'Conventional'` typos → default).
- `getPrpCommitStyleExamples()`: `Number(... ?? 5)` + `NaN`/`<0` → `5` guard
  (mirror `getCommitRetryMax()` but allow `0` — `0` disables examples under
  `auto` per PRD).

**New type:**
```ts
export type PrpCommitStyle = 'auto' | 'plain' | 'conventional' | 'gitmoji';
```

### F1.B — `.hack` schema (`src/config/hack-config.ts`)

**`SCHEMA_MAP`** (the authoritative env-seed table, line ~140): the existing
`commit_format` entry is at line ~264:
```ts
{
  section: 'pipeline',
  key: 'commit_format',
  envVar: 'PRP_COMMIT_FORMAT',
  type: 'string',
  defaultValue: 'task-prefix',
  acceptedValues: ['task-prefix', 'plain'],
},
```
**Add two new entries** immediately after `commit_format` (same `[pipeline]`
section):
```ts
{
  section: 'pipeline',
  key: 'commit_style',
  envVar: 'PRP_COMMIT_STYLE',
  type: 'string',
  defaultValue: 'auto',
  acceptedValues: ['auto', 'plain', 'conventional', 'gitmoji'],
},
{
  section: 'pipeline',
  key: 'commit_style_examples',
  envVar: 'PRP_COMMIT_STYLE_EXAMPLES',
  type: 'int',
  defaultValue: 5,
},
```

**`HACK_CONFIG_SCHEMA`** (the validation map, line ~630): the existing
`pipeline` section has:
```ts
pipeline: {
  parallel_research: { type: 'boolean' },
  research_depth: { type: 'int', min: 1 },
  research_timeout_seconds: { type: 'int', min: 1 },
  issue_retry_max: { type: 'int', min: 0 },
  commit_format: { type: 'string', enum: ['task-prefix', 'plain'] },
},
```
**Add** two fields to the `pipeline` section:
```ts
  commit_style: { type: 'string', enum: ['auto', 'plain', 'conventional', 'gitmoji'] },
  commit_style_examples: { type: 'int', min: 0 },
```

`HACK_KEY_TO_ENV` (line ~523) is **derived** from `SCHEMA_MAP` via
`Object.fromEntries(...)` — NO manual edit needed; it auto-includes the new
keys.

### F1.C — `.env.example`

Currently `.env.example` does NOT have a `PRP_COMMIT_FORMAT` entry. The Smart
Commit Resilience section (lines 116–120) has the `COMMIT_RETRY_*` vars. The
new style vars should go in a new subsection immediately after that block,
titled e.g. `# --- Commit Message Style (PRD §5.1) ---`:

```
# --- Commit Message Style (PRD §5.1) ---
# PRP_COMMIT_STYLE: how stagecoach writes the DESCRIPTIVE commit message
#   auto (DEFAULT): learns from recent history (last N commits as style examples)
#   plain: imperative mood, no type prefix/scope/emoji
#   conventional: type(scope): description (Conventional Commits)
#   gitmoji: <emoji> description
# PRP_COMMIT_STYLE=auto
#
# PRP_COMMIT_STYLE_EXAMPLES: number of recent commits used as style examples
# under `auto` (default: 5; 0 disables learning → degrades to `plain`)
# PRP_COMMIT_STYLE_EXAMPLES=5
```

### F1.D — Recent-commits helper (`src/tools/git-mcp.ts`)

A new exported async function following the `gitFileHistory` pattern (line
~539). Uses `simpleGit(repoPath).log({ maxEntries: count })` and returns the
**message text** of each commit (the `message` field on each log entry, which
is the full commit message — subject + body). The caller will split to subject
if needed; for style examples, the full message is most useful.

```ts
export async function getRecentCommitMessages(
  count: number,
  repoPath?: string
): Promise<string[]>
```

**Key details:**
- `count === 0` → return `[]` (no log call).
- Repo path validated via the existing `validateRepositoryPath` helper (line
  ~202).
- `git.log({ maxEntries: count })` returns entries newest-first; the `.all`
  array's `.message` fields are returned.
- A repo with fewer than `count` commits returns all available (no error).
- Exported in the `export { ... }` block at line ~830.

### F1.E — Dynamic system-prompt builder (`src/agents/commit-message-agent.ts`)

The existing `COMMIT_MESSAGE_SYSTEM` constant (lines ~64–78) is the `plain`
contract. It becomes the `plain` mode's contract text. The factory
`createCommitMessageAgent()` (line ~100) currently hardcodes
`system: COMMIT_MESSAGE_SYSTEM`.

**New function:**
```ts
export function buildCommitMessageSystemPrompt(
  style: PrpCommitStyle,
  examples?: readonly string[]
): string
```

**Per-mode contracts:**

1. **`plain`**: The EXISTING `COMMIT_MESSAGE_SYSTEM` text verbatim (imperative
   mood, ≤72 chars, no type prefix/scope/emoji, no position prefix, no
   trailer). This is also the `auto` fallback for ≤1-commit repos and
   `EXAMPLES=0`.

2. **`conventional`**: Same output discipline (ONLY the descriptive message,
   no position prefix/trailer) but the formatting rule is:
   `type(scope): description` from the standard vocabulary
   (`feat fix docs style refactor perf test build ci chore revert`), scope
   optional, ~50-char description.

3. **`gitmoji`**: Same output discipline but the subject begins with exactly
   one gitmoji (the emoji character, not `:shortcode:`), followed by a space
   and the description. A **compiled-in** gitmoji reference table is included
   in the system prompt (the canonical set from gitmoji.dev: 🎨 improve
   format/structure, ⚡️ performance, 🔥 remove code/files, 🐛 fix bug, 🚑
   critical fix, ✨ introduce new features, 📝 documentation, 🚀 deploy stuff,
   💄 UI/style, 🎉 initial commit, ✅ update tests, 🔒 security, 🔖 release,
   🚨 linter/formatter, 🚧 WIP, 💚 fix CI build, ⬇️ downgrade dep, ⬆️ upgrade
   dep, 📌 pin dep, 👷 CI config, 📈 analytics, ♻️ refactor, ➕ add dep, ➖
   remove dep, 🔧 config files, 🌐 i18n, ✏️ fix typo, 💩 quick hack/wrong,
   ⏪ revert, 🔀 merge branches, 📦️ update compiled files, 👽 update due to
   external API, 🚚 move/rename, 📄 license, 💥 breaking change, 🍱 add/update
   assets, ♿️ accessibility, 💡 comment source code, 🍻 beer, 💬 text/literals,
   🗃️ db/registry, 🔊 add logs, 🔇 remove logs, 👥 contributors, 🚸 UX, 🏗️
   architecture, 📱 responsive design, 🤡 mock, 🥚 easter egg, 🙈 ignore,
   📸 snapshot tests, ⚗️ experiment, 🔍 SEO, 🏷️ types, 🌱 seed, 🚩 flags,
   🥅 catch errors, 💫 animation, 🗑️ deprecation, 🛂 auth, 🩹 simple fix, 🧐
   data exploration, ⚰️ dead code removal, 🧪 failing tests, 👔 business, 🩺
   healthcheck, 🧱 infrastructure, 🧵 multithreading, 🦺 validation).

4. **`auto`** (with examples): Start with a META instruction block that:
   - Lists the N example messages VERBATIM (trimmed).
   - Instructs the agent to **match their STYLE** (format, tone, length,
     whether they carry a type prefix or gitmoji).
   - **Anti-reuse instruction**: NEVER copy or reuse the examples' wording —
     produce entirely original wording for THIS change.
   - **Ignore position prefix**: tell the agent to IGNORE any leading numeric
     position prefix (`1.2.1.1:`) in the examples — that is a position marker
     added by the position layer, NOT part of the style to imitate.
   - Then append the same output discipline as `plain` (ONLY the descriptive
     message, no position prefix, no trailer).
   
   When `auto` has **no examples** (≤1 commit repo or `EXAMPLES=0`), degrade
   to the `plain` contract.

**Factory change:**
```ts
export function createCommitMessageAgent(
  systemPrompt?: string
): Agent
```
`system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM` — defaults to the `plain`
contract for backward compatibility (existing callers that don't pass it get
the same behavior).

### F1.F — Wire into `generateCommitMessage` (`src/utils/git-commit.ts`)

The current `generateCommitMessage(diff)` (line ~290) calls
`createCommitMessageAgent()` with no args. **Change** to:

1. Resolve style mode: `const style = getPrpCommitStyle();`
2. If `style === 'auto'`:
   - `const examplesCount = getPrpCommitStyleExamples();`
   - If `examplesCount > 0`: `const examples = await getRecentCommitMessages(examplesCount);`
   - If `examples.length <= 1`: degrade to `plain` (PRD: "≤1 commit → plain")
   - Else: build system prompt with examples
3. Else (explicit mode): build system prompt without examples
4. `const system = buildCommitMessageSystemPrompt(resolvedStyle, examples);`
5. `const agent = createCommitMessageAgent(system);`
6. Rest of the function unchanged.

**Import additions** at the top of `git-commit.ts`:
- `getPrpCommitStyle, getPrpCommitStyleExamples` from `../config/constants.js`
- `getRecentCommitMessages` from `../tools/git-mcp.js`
- `buildCommitMessageSystemPrompt` from `../agents/commit-message-agent.js`

**Note:** `generateCommitMessage` is already `async` — the `getRecentCommitMessages`
call is fine. The retry wrapper in `smartCommit` already wraps this function, so
the additional git-log call happens inside the retry boundary (acceptable: git
log is a fast local operation, not a transient API call).

### F1.G — Test surfaces

- **`tests/unit/config/`** — add a test file for the new getters (mirror the
  existing config constants test pattern: set `process.env`, call getter,
  assert result; unset, assert default).
- **`tests/unit/agents/commit-message-agent.test.ts`** — add a
  `describe('buildCommitMessageSystemPrompt')` block asserting each mode
  produces the right contract text; `auto` with examples includes the examples
  + anti-reuse + ignore-position-prefix instructions; `auto` with no examples
  degrades to plain; `createCommitMessageAgent(systemPrompt)` passes the
  prompt through.
- **`tests/unit/utils/git-commit.test.ts`** — add tests for the
  `generateCommitMessage` style resolution path (mock
  `getRecentCommitMessages` and the agent factory; assert `auto` fetches
  examples, `plain`/`conventional`/`gitmoji` don't).
- **`tests/unit/tools/git-mcp.test.ts`** (or equivalent) — add a test for
  `getRecentCommitMessages` (mock simpleGit).

---

## Feature 2 — Manual Status Updates: `hack update` (PRD §5.4)

### F2.A — Loose task-ID normalizer & matcher (`src/utils/task-utils.ts`)

Two new exported pure functions:

1. **`normalizeTaskId(looseId: string): number[] | null`**
   - Strip all non-alphanumeric chars, then extract digit groups.
   - `P1.M1.T1.S1` → `[1,1,1,1]`; `p1m1t1s1` → `[1,1,1,1]`; `1.1.1.1` →
     `[1,1,1,1]`; `1.2` → `[1,2]`; `1` → `[1]`.
   - Upper bound: 4 segments (Phase/Milestone/Task/Subtask). More → `null`.
   - Empty/whitespace → `null`.
   - Algorithm: remove all non-digit-non-dot chars, split on `.`, filter empty,
     `Number()`. Actually simpler: extract all digit sequences via regex
     `/\d+/g`, cap at 4.

2. **`findItemByLooseId(backlog: Backlog, looseId: string): { item: HierarchyItem, canonicalId: string } | null`**
   - Normalize the loose ID to segments.
   - Walk the tree positionally: `segments[0]` → phase index (1-based),
     `segments[1]` → milestone, `segments[2]` → task, `segments[3]` → subtask.
   - Trailing segments may be omitted (fewer segments = higher-level item).
   - Out-of-bounds index → `null`.
   - Returns the found item + its canonical ID string (for output messaging).

**Existing `findItem`** (line ~90) does exact-id matching against the `id`
field. The new function is a separate, looser matcher. Do NOT modify `findItem`.

### F2.B — Loose status matcher (`src/utils/task-utils.ts`)

One new exported function:

**`matchStatus(input: string): { status: Status } | { error: string, candidates: string[] }`**

The matchable set (PRD §5.4): `Planned, Researching, Ready, Implementing,
Complete, Failed, Obsolete` (7 statuses — `Retrying` is NOT manually settable).

**Matching order:**
1. **Synonym table** (exact, case-insensitive):
   - `d, done, fin, finished, completed` → `Complete`
   - `re, rdy` → `Ready`
2. **Canonical exact** (case-insensitive): input matches one of the 7.
3. **Unique prefix**: input is a prefix of exactly one status.
4. **Unique substring**: input is a substring of exactly one status.
5. **Ambiguous** (multiple matches) → error listing candidates.
6. **Unknown** (no matches) → error listing all 7 valid statuses.

**Note on `re`**: `re` is a SYNONYM for `Ready` (step 1), so it never reaches
the prefix matcher where `re` would also match `Ready` and `Researching` →
the synonym table preempts that ambiguity. But a raw prefix `r` (not a
synonym) would match both `Ready` and `Researching` → ambiguous error.

### F2.C — Status cascade engine (`src/utils/task-utils.ts`)

**Two new pure functions** (distinct from the existing monotonic
`promoteIfAllComplete` / `rollupCompletion`):

1. **`cascadeCompleteDown(item: HierarchyItem): HierarchyItem`**
   - Returns a deep-cloned item with `status: 'Complete'` and ALL descendants
     recursively set to `Complete`.
   - Works on any level (Phase/Milestone/Task/Subtask). A Subtask has no
     descendants → just returns `{ ...subtask, status: 'Complete' }`.

2. **`recomputeAncestorsUp(backlog: Backlog, changedItemId: string): Backlog`**
   - After a status change at any level, walks UP the ancestor chain
     (Subtask → Task → Milestone → Phase) and recomputes each ancestor's status
     as the **minimum** (least-progressed) status among its children.
   - **Status ordering** for the "minimum" operation (from PRD §5.4):
     `Planned < Researching < Ready < Implementing < Complete` — but with
     special handling:
     - `Failed` children are **excluded** from the min UNLESS ALL children are
       `Failed` → parent becomes `Failed`.
     - `Obsolete` is **terminal** alongside `Complete`, and loses ties to it:
       a parent with all children Complete/Obsolete (mixed) → `Complete`.
     - `Retrying` is excluded from manual-settable but exists in the tree —
       treat it as `Implementing`-equivalent for the min (or exclude it; the
       PRD doesn't specify because `hack update` doesn't set `Retrying`).
   - This CAN downgrade ancestors: setting a subtask back to `Planned` drops
     its ancestors to reflect the least-progressed child.

**Important:** These functions operate on the Backlog tree and return new
immutable copies (following the `updateItemStatus` structural-sharing pattern).
The CLI handler composes them: clone → set target → (if Complete) cascade
down → recompute up.

**Do NOT modify** the existing `promoteIfAllComplete` (line ~313) or
`rollupCompletion` (line ~343) — they are monotonic promote-only and used by
the orchestrator's automatic status writes.

### F2.D — `hack update` CLI command (`src/cli/index.ts`)

**Registration** — mirror the `taskAction` shared handler pattern (line ~626).
Add a new `.command('update')` with Commander:

```ts
program
  .command('update')
  .description('Manually update a task status (PRD §5.4)')
  .argument('<task-id>', 'Task ID (loose match: P1.M1.T1.S1, 1.1.1.1, p1m1t1s1, 1.2)')
  .argument('<status>', 'Target status (loose match: done, re, comp, ready)')
  .option('-f, --file <path>', 'Override tasks.json file path')
  .option('--session <hash>', 'Target specific session by hash')
  .option('-o, --output <format>', 'Output format (text, json)', 'text')
  .action(updateAction);
```

**Action handler logic:**
1. **File discovery** — identical to `taskAction` (lines ~634–710): `--file`
   override → `--session` hash → latest session → prefer bugfix child
   `tasks.json` over main. BUT: unlike the read-only `task`/`status` commands,
   `update` is a WRITE — a missing discovered `tasks.json` is a **hard error**
   (NOT the calm `awaiting_breakdown` notice).
2. **Parse args** — `normalizeTaskId` + `findItemByLooseId` to resolve the
   target item; `matchStatus` to resolve the target status.
3. **Lock + RMW** — use `withLockedTasksJSON(sessionDir, (backlog) => { … })`:
   - Find the target item in the locked backlog.
   - Set its status.
   - If `Complete`: `cascadeCompleteDown` the subtree.
   - `recomputeAncestorsUp` the ancestor chain.
   - Return the mutated backlog (validation + atomic write happen inside
     `withLockedTasksJSON` via `writeTasksJSON`).
4. **Output** — `Updated <ID> status to <Status>` (text) or
   `{ "id", "status", "title" }` (json) on success.
5. **Errors** — task not found, ambiguous/unknown status, file not found,
   lock timeout → stderr message + non-zero exit.

**Session dir resolution:** `dirname(tasksFile)` gives the session dir (same
as the `taskAction` pattern). This is what `withLockedTasksJSON` needs.

**Schema validation:** `writeTasksJSON` already validates via
`BacklogSchema.parse()` before writing. The cascade should produce a
schema-valid backlog; if it doesn't, the write fails with a clear error.

### F2.E — Test surfaces

- **`tests/unit/utils/task-utils.test.ts`** — add `describe` blocks for
  `normalizeTaskId`, `findItemByLooseId`, `matchStatus`,
  `cascadeCompleteDown`, `recomputeAncestorsUp`. The existing task-utils tests
  provide the fixture pattern (build small Backlog trees).
- **`tests/unit/cli/`** — add an `update-command.test.ts` (or extend
  `index.test.ts`) testing the CLI action: file discovery, arg parsing, lock
  acquisition, cascade application, output formats, error paths (not found,
  ambiguous, unknown status, missing file).

---

## Feature 3 — Cross-cutting documentation (Mode B)

Files to update (after ALL implementing subtasks land):

| File                     | What to add                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `docs/CONFIGURATION.md`  | Two new env-var rows + `.hack` key entries; `hack update` subcommand section  |
| `docs/ARCHITECTURE.md`   | Two-layer commit model (position + style); `hack update` short note           |
| `README.md`              | `hack update` in commands list; style layer in commit-behavior section        |

**Do NOT edit:** `PRD.md`, `tasks.json`, `prd_snapshot.md`, `PROMPTS.md`.