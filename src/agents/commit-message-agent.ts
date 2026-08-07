/**
 * Stagecoach commit-message generation agent
 *
 * @module agents/commit-message-agent
 *
 * @remarks
 * Thin factory that builds a lightweight Groundswell agent for generating
 * descriptive commit messages from a staged diff (PRD §5.1
 * "Smart Commit Resilience" — the `stagecoach` LLM tool).
 *
 * **Design decisions (PRP P3.M1.T3.S1)**:
 * - Reuses {@link createBaseConfig} with persona `'researcher'` and role
 *   `'research'` (balanced tier, normal budget, full harness/env wiring) —
 *   NO expansion of the `AgentPersona` union or `PERSONA_TOKEN_LIMITS`.
 * - Carries NO MCP tools: the agent reads the diff from the prompt text, so
 *   tool access would only let it re-read files (slow, leaky, unnecessary).
 * - `enableReflection: false` — single-shot generation; a reflection loop would
 *   add a second LLM round-trip for a trivial task.
 * - `enableCache: false` — every diff is unique, so cache never hits and would
 *   only waste a round-trip.
 * - `maxTokens: 512` — a commit message is tiny; keeps the call cheap and fast.
 *
 * The agent emits ONLY the commit message (subject + optional body). The caller
 * (`generateCommitMessage` in `src/utils/git-commit.ts`) wraps the output via
 * `formatCommitMessage`, which layers the standardized task-prefix (or emits the
 * subject plain per PRD §5.1) and appends the Co-Authored-By trailer. The
 * system prompt forbids the agent from emitting the prefix/trailer.
 *
 * This is the generation boundary that P3.M1.T4.S1 wraps with retry. The
 * generation call is transient-API-sensitive — a generation timeout is LLM-API
 * slowness, not a stuck subprocess — so the boundary throws `AgentError`
 * (hardcoded `PIPELINE_AGENT_LLM_FAILED` → classified transient by
 * `isTransientError`) on every failure mode.
 *
 * @example
 * ```typescript
 * import { createCommitMessageAgent } from './agents/commit-message-agent.js';
 * import { createPrompt } from 'groundswell';
 * import { z } from 'zod';
 *
 * const agent = createCommitMessageAgent();
 * const prompt = createPrompt({ user: '<diff here>', responseFormat: z.string() });
 * const r = await agent.prompt(prompt);
 * if (r.status === 'success') {
 *   console.log(r.data); // 'feat(api): add endpoint'
 * }
 * ```
 */

import { createAgent, type Agent } from 'groundswell';
import { createBaseConfig } from './agent-factory.js';
import { getLogger } from '../utils/logger.js';
import type { PrpCommitStyle } from '../config/constants.js';

let _logger: ReturnType<typeof getLogger> | undefined;
const logger = () => (_logger ??= getLogger('CommitMessageAgent'));

/**
 * System prompt instructing the agent to emit a plain descriptive imperative
 * summary (PRD §5.1 "Commit Message Format (Standardized Task-Prefix)").
 *
 * @remarks
 * PRD §5.1 forbids Conventional-Commit type/scope and the `[PRP Auto]` banner —
 * the standardized task-prefix (`<phase>.<milestone>.<task>[.<subtask>]:`)
 * carries the item's position, so a type prefix and a work-item id in the
 * subject are redundant. The agent therefore emits ONLY the plain descriptive
 * subject (+ optional WHY body); the caller (`formatCommitMessage` in
 * `src/utils/git-commit.ts`) layers the task-prefix and appends the
 * Co-Authored-By trailer. Hard rules ensure the output is a bare message the
 * caller can wrap — a verbose agent output would corrupt the commit.
 */
const COMMIT_MESSAGE_SYSTEM = `You generate concise git commit messages from staged diffs.

Write a PLAIN DESCRIPTIVE summary of the change (imperative mood).
- Subject line in imperative mood, ≤72 characters, no trailing period.
- Do NOT add a Conventional-Commit type prefix (no "feat:", "fix:", "refactor:", etc.) and do NOT add a "(scope)" — the caller layers the task-position prefix separately.
- Do NOT reference any work-item id (e.g. P3.M1.T3.S1) in the subject — the caller's task-prefix already encodes the position.
- Optional blank line + body explaining WHY (not WHAT — the diff shows what).

HARD RULES:
- Output ONLY the commit message (subject + optional body). No explanation.
- No markdown fences, no leading/trailing whitespace, no preamble.
- Do NOT include "[PRP Auto]", "Co-Authored-By", or any trailer — the caller adds those.
- If the diff is empty or whitespace-only, output the single word "skip".`;

/**
 * Shared output discipline appended to the `conventional`, `gitmoji`, and
 * `auto`-with-examples system prompts (PRD §5.1 "Mode-conditional system
 * prompt").
 *
 * @remarks
 * The `plain` contract ({@link COMMIT_MESSAGE_SYSTEM}) already carries its own
 * discipline wording verbatim, so it is NOT refactored to reuse this constant
 * — `buildCommitMessageSystemPrompt('plain')` must return
 * {@link COMMIT_MESSAGE_SYSTEM} byte-for-byte. The three NEW contracts append
 * this shared block so every mode enforces the identical output shape: the
 * agent emits ONLY the descriptive message; the caller (`formatCommitMessage`
 * in `src/utils/git-commit.ts`) layers the standardized task-prefix and the
 * Co-Authored-By trailer.
 */
const COMMIT_MESSAGE_DISCIPLINE = `OUTPUT DISCIPLINE (every mode):
- Emit ONLY the descriptive commit message (subject + optional body). No explanation, no preamble.
- Do NOT include any position prefix like "1.2.1.1:" — the caller (formatCommitMessage) adds it.
- Do NOT include "[PRP Auto]" or any banner.
- Do NOT include "Co-Authored-By" or any trailer — the caller adds it.
- No markdown fences, no leading/trailing whitespace.
- If the diff is empty or whitespace-only, output the single word "skip".`;

/**
 * `conventional`-mode system prompt (PRD §5.1) — Conventional Commits format.
 *
 * @remarks
 * Subject form `type(scope): description` with the standard 11-type
 * vocabulary, optional scope, imperative-mood lowercase ~50-char description.
 * Appends {@link COMMIT_MESSAGE_DISCIPLINE}.
 */
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

/**
 * Full canonical gitmoji reference table (72 entries, source: gitmoji.dev),
 * embedded as a build-time template literal so the agent can pick the right
 * emoji with NO runtime network fetch (PRD §5.1).
 */
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

/**
 * `gitmoji`-mode system prompt (PRD §5.1). Subject form `<emoji> <description>`
 * — EXACTLY ONE gitmoji emoji CHARACTER (not a `:shortcode:`), then a space,
 * then the description. Embeds the full {@link GITMOJI_REFERENCE_TABLE} inline
 * and appends {@link COMMIT_MESSAGE_DISCIPLINE}.
 */
const GITMOJI_COMMIT_SYSTEM = `You generate concise git commit messages from staged diffs using a gitmoji subject.

Write the subject as: <emoji> <description>
- The subject MUST begin with EXACTLY ONE gitmoji emoji CHARACTER (not a ":shortcode:"), followed by
  a single space, then the description.
- Pick the emoji that best matches the change from the reference table below.
- "description" in imperative mood, lowercase, no trailing period.

GITMOJI REFERENCE TABLE (select the emoji that best matches the change):
${GITMOJI_REFERENCE_TABLE}

${COMMIT_MESSAGE_DISCIPLINE}`;

/**
 * Build the `auto`-mode system prompt when the repository has enough history
 * to learn from (PRD §5.1).
 *
 * @param examples - The full recent commit messages (newest-first), supplied
 *   by `generateCommitMessage` via `getRecentCommitMessages`. Listed VERBATIM
 *   (trimmed) as a STYLE reference.
 * @returns The META block: the examples as style reference + style-matching
 *   instructions (incl. advisory anti-reuse + ignore-position-prefix) + the
 *   shared {@link COMMIT_MESSAGE_DISCIPLINE}.
 */
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

/**
 * Build the mode-conditional stagecoach commit-message system prompt
 * (PRD §5.1 "Commit Message Style — Mode-conditional system prompt").
 *
 * @remarks
 * Returns the system-prompt string for the resolved {@link PrpCommitStyle}:
 *
 * - **`plain`** → {@link COMMIT_MESSAGE_SYSTEM} verbatim. A plain descriptive
 *   imperative summary; no Conventional-Commit type/scope (PRD §5.1 forbids it
 *   because the standardized task-prefix already encodes the item's position).
 * - **`conventional`** → {@link CONVENTIONAL_COMMIT_SYSTEM}: Conventional
 *   Commits `type(scope): description` with the standard 11-type vocabulary.
 * - **`gitmoji`** → {@link GITMOJI_COMMIT_SYSTEM}: a subject beginning with
 *   EXACTLY ONE gitmoji emoji CHARACTER (not a `:shortcode:`) + space +
 *   description, with the full 72-entry reference table embedded inline.
 * - **`auto`** → learns from `examples` when there is enough history; otherwise
 *   degrades (see below).
 *
 * **`auto` degradation rule (PRD §5.1):** when `examples` is `undefined`, an
 * empty array, OR contains `≤ 1` message (i.e. the repository has "≤1 commit —
 * nothing to learn"), `auto` degrades to the `plain` contract
 * ({@link COMMIT_MESSAGE_SYSTEM}). Only `auto` with `length > 1` examples
 * produces the learned-style META block via {@link buildAutoSystemPrompt}.
 *
 * **Explicit modes ignore `examples`** (PRD §5.1: "history examples are omitted
 * entirely in explicit modes"). Passing `examples` to `plain`/
 * `conventional`/`gitmoji` does not change their output.
 *
 * **Anti-reuse is ADVISORY, not a mechanical gate** (PRD §5.1 "Scope &
 * guarantees"): this function injects the anti-reuse *instruction text* into the
 * `auto` prompt; it does NOT post-process, inspect, or reject the model's
 * output. A generated subject that happens to repeat a recent one is still
 * committed — duplicate rejection is explicitly out of scope.
 *
 * This is a PURE function: no I/O, no agent instantiation, no env reads. The
 * resolved `style` and `examples` are passed in by the caller
 * (`generateCommitMessage` in `src/utils/git-commit.ts`, P1.M1.T4.S1) via
 * `getPrpCommitStyle` + `getRecentCommitMessages`.
 *
 * @param style - The resolved commit style (one of the {@link PrpCommitStyle}
 *   variants).
 * @param examples - Optional recent commit messages (newest-first) for `auto`
 *   mode learning. Ignored by explicit modes.
 * @returns The system-prompt string for the agent.
 *
 * @example
 * ```typescript
 * const prompt = buildCommitMessageSystemPrompt('conventional');
 * const promptWithHistory = buildCommitMessageSystemPrompt('auto', recentMsgs);
 * ```
 */
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
        : COMMIT_MESSAGE_SYSTEM; // ≤1 example / none / EXAMPLES=0 → degrade to plain (PRD §5.1)
    default: {
      // Exhaustiveness guard: adding a 5th PrpCommitStyle variant becomes a
      // compile error here rather than a silent fall-through.
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}

/**
 * Create the stagecoach commit-message-generation agent.
 *
 * @remarks
 * Returns a lightweight Groundswell {@link Agent} configured for single-shot
 * commit-message generation. Reuses the `researcher` persona (balanced tier)
 * via {@link createBaseConfig} and overrides the name, system prompt, and token
 * budget — NO `mcps` field (the agent reads the diff from the prompt text).
 *
 * **Stateless single-shot** (PRD §9.3.2 / P3.M2.T3.S1): the `researcher` base
 * config has `stateless: false` (researcher is NOT in {@link STATELESS_PERSONAS}),
 * so the override forces `stateless: true` here — the agent reads a staged diff
 * and emits one message, never resuming a session.
 *
 * @param systemPrompt - Optional custom system prompt. Defaults to the
 *   {@link COMMIT_MESSAGE_SYSTEM} plain contract for backward compatibility
 *   (existing no-arg callers get identical behavior). When provided, it
 *   overrides the default — consumed by {@link generateCommitMessage}
 *   (P1.M1.T4.S1), which passes the style-resolved prompt from
 *   {@link buildCommitMessageSystemPrompt} (P1.M1.T3.S1).
 *
 * @returns Configured Groundswell Agent instance.
 *
 * @example
 * ```typescript
 * // Default (plain contract) — existing behavior:
 * const agent = createCommitMessageAgent();
 * // Dynamic prompt (style-resolved by buildCommitMessageSystemPrompt):
 * const styled = createCommitMessageAgent(buildCommitMessageSystemPrompt('conventional'));
 * const prompt = createPrompt({ user: diff, responseFormat: z.string() });
 * const r = await agent.prompt(prompt);
 * ```
 */
export function createCommitMessageAgent(systemPrompt?: string): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM,
    maxTokens: 512,
    enableReflection: false,
    enableCache: false,
    stateless: true, // single-shot stagecoach; overrides researcher base (P3.M2.T3.S1)
  };
  logger().debug(
    { persona: 'researcher', model: config.model },
    'Creating commit-message agent'
  );
  return createAgent(config);
}
