/**
 * Validation prompt generator module
 *
 * @module agents/prompts/validation-prompt
 *
 * @remarks
 * Provides a type-safe prompt generator for the Validation workflow
 * (PRD §4.4 "The QA & Bug Hunt Loop" step 1). The reasoning-tier agent
 * (VALIDATION_AGENT, default `pizr` — realized at runtime by
 * {@link createQAAgent}) AUTHORS a deterministic, exit-code-driven
 * `validate.sh` from the PRD requirements + the codebase's real tooling.
 *
 * This is a **FILE-AS-CONTRACT** prompt (mirrors
 * {@link createBugHuntPrompt}): the agent's deliverable is a file written
 * to `outputPath`, NOT the chat reply. The pipeline later RUNS that script
 * (via `BashMCP.execute_bash`) and inspects the exit code to enforce
 * abort-on-failure (PRD §4.4) + watchdog-terminal (PRD §9.3.2).
 */

// PATTERN: Import Groundswell prompt creation utilities
import { createPrompt, type Prompt } from 'groundswell';
import { z } from 'zod';

// PATTERN: Import system prompt from sibling prompts file
import { VALIDATION_PROMPT } from '../prompts.js';

/**
 * Create a Validation prompt that instructs the agent to WRITE `validate.sh`
 * to `outputPath` (FILE-AS-CONTRACT).
 *
 * @remarks
 * Returns a Groundswell Prompt configured with:
 * - user: a FILE-AS-CONTRACT `fileBanner` (agent WRITES the script to
 *   `outputPath`) + the pre-merged PRD content.
 * - system: {@link VALIDATION_PROMPT} (authors a deterministic,
 *   `set -euo pipefail` script from PRD + repo tooling).
 * - responseFormat: `z.unknown()` — the FILE is the contract; the chat reply
 *   is a one-line confirmation, so a permissive schema avoids tripping
 *   structured-output validation (mirrors the architect/bug-hunt pattern).
 * - enableReflection: true (for thorough authoring reliability).
 *
 * The returned Prompt can be passed directly to `agent.prompt()`. The caller
 * then verifies the script exists on disk before running it.
 *
 * @param prd - The pre-merged PRD markdown content
 * @param codebasePath - Absolute path to the project root (where the agent
 *   discovers the toolchain — package.json scripts, tsconfig, test runner, etc.)
 * @param outputPath - Absolute path where the agent MUST write `validate.sh`
 * @returns Groundswell Prompt object configured for script authoring
 *
 * @example
 * ```typescript
 * import { createValidationPrompt } from './agents/prompts/validation-prompt.js';
 *
 * const prompt = createValidationPrompt(
 *   prdContent,
 *   process.cwd(),
 *   resolve(sessionPath, 'validate.sh')
 * );
 * const agent = createQAAgent();
 * await retryAgentPrompt(() => agent.prompt(prompt), {
 *   agentType: 'QA',
 *   operation: 'generateValidationScript',
 * });
 * // validate.sh now exists at outputPath; the pipeline runs it next.
 * ```
 */
export function createValidationPrompt(
  prd: string,
  codebasePath: string,
  outputPath: string
): Prompt<string> {
  // FILE-AS-CONTRACT: reasoning models reliably WRITE files but do NOT
  // reliably honor responseFormat for structured output in the conversation.
  // The agent's deliverable is validate.sh at outputPath; the chat reply is a
  // one-line confirmation. The pipeline reads the file back and runs it.
  const fileBanner = `## ⚠️ DELIVERABLE — READ FIRST (overrides any conflicting instruction below)

Your FINAL deliverable is an EXECUTABLE shell script written to this file:

    ${outputPath}

The script (validate.sh) MUST:
- Begin with \`#!/usr/bin/env bash\` and \`set -euo pipefail\`.
- Derive concrete validation commands from the PRD requirements below AND the
  codebase tools discovered at ${codebasePath} (read \`package.json\` scripts,
  \`tsconfig.json\`, the test runner, linters, type-checkers, build tools — and
  any Python tooling such as ruff/mypy/pytest if present).
- Run every applicable gate (lint, typecheck, unit tests, build, plus any
  PRD-specified checks).
- Print a clear one-line context header before each gate (including the exact
  command) so failures are diagnosable from stdout/stderr.
- EXIT NON-ZERO on the first failing gate (\`set -e\` propagates it). Exit 0
  ONLY if ALL gates pass.
- Be non-interactive (no prompts, no TTY assumptions) and deterministic (no
  network calls unless the PRD requires them).

Write ONLY the script to that file (no markdown fence). After writing, return a
one-line confirmation like "validate.sh written to ${outputPath}". The script in
the file is the ONLY thing the system runs; the pipeline enforces its own
\`VALIDATION_TIMEOUT\` watchdog, so do NOT wrap the whole script in an unbounded
\`timeout\`.

---

`;

  return createPrompt({
    user: fileBanner + `## PRD (pre-merged)\n\n${prd}\n`,
    system: VALIDATION_PROMPT,
    responseFormat: z.unknown(), // file is the contract; chat reply is one line
    enableReflection: true,
  }) as Prompt<string>;
}
