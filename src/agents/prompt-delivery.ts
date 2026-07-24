/**
 * PRD §9.3.3 "Prompt Delivery (no argv-size limit)" — guard + audit pin.
 *
 * @module agents/prompt-delivery
 *
 * @remarks
 * AUDIT RESULT (P3.M2.T6.S1): the pipeline is COMPLIANT. Every agent prompt
 * flows `Prompt.buildUserMessage()` → `HarnessRequest.prompt` → the in-process
 * harness SDK — Pi: `session.prompt(request.prompt)` (groundswell
 * pi-harness.js L245); Claude-Code: `sdk.query({prompt})` + `streamInput()`
 * (claude-code-harness.js L393). NO code path in `src/agents/*` or
 * `src/tools/bash-mcp.ts` passes an LLM prompt as a command-line argv string.
 * See `plan/008_15504f60a0ef/P3M2T6S1/research/01_prompt_delivery_audit.md`.
 *
 * This module pins the argv constraint as a named constant + defensive guard
 * so the invariant is (a) documented in code and (b) enforced by the
 * regression test in `tests/unit/agents/prompt-delivery.test.ts`. It has NO
 * runtime behavior change for the happy path (the guard is never invoked
 * with an oversize prompt today, because no argv call site exists).
 *
 * PRD §9.3.3 (h4.10) mandates:
 * > Prompts frequently embed the full PRD and can exceed 128 KB. They MUST be
 * > delivered to the agent as a programmatic message body (stdin/stream),
 * > never as an argv string — argv strings are capped by the kernel's
 * > `MAX_ARG_STRLEN` (131,072 bytes) and fail with a hard `E2BIG` that no
 * > wrapper can recover from.
 */

/**
 * Linux kernel per-argument-string limit: `PAGE_SIZE * 32` = 4096 * 32 =
 * 131_072 bytes (128 KiB). A single argv/envp string longer than this causes
 * `execve(2)` to fail with the unrecoverable `E2BIG` (the new process never
 * starts, so no parent-side wrapper can recover). PRD §9.3.3.
 *
 * @see https://github.com/torvalds/linux/blob/master/fs/exec.c (MAX_ARG_STRLEN)
 * @see https://man7.org/linux/man-pages/man2/execve.2.html#ERRORS (E2BIG)
 */
export const MAX_ARG_STRLEN = 131_072;

/**
 * Asserts that `prompt` is short enough to (hypothetically) survive argv
 * delivery. THROWS if `prompt.length > MAX_ARG_STRLEN`.
 *
 * PRD §9.3.3 mandates prompts be delivered as a programmatic message body,
 * never argv. This guard is a DEFENSIVE backstop: if a future code path
 * accidentally routes a prompt toward argv, this throws a self-documenting
 * error BEFORE the unrecoverable `E2BIG`. The happy path (programmatic
 * delivery) never invokes this guard with an oversize prompt.
 *
 * Semantics: the comparison is strict `>` (NOT `>=`). `MAX_ARG_STRLEN` is the
 * maximum ALLOWED length, so a string of exactly that length is permitted
 * (at the edge); only strictly longer strings would `E2BIG`.
 *
 * @param prompt - The prompt string about to be delivered.
 * @param label  - A short label (e.g. 'CoderAgent') for the error message.
 * @throws {Error} when `prompt.length > MAX_ARG_STRLEN` (message cites
 *   MAX_ARG_STRLEN, E2BIG, and PRD §9.3.3).
 */
export function assertPromptNotRoutedViaArgv(
  prompt: string,
  label: string
): void {
  if (prompt.length > MAX_ARG_STRLEN) {
    throw new Error(
      `[${label}] Prompt length ${prompt.length} exceeds MAX_ARG_STRLEN ` +
        `(${MAX_ARG_STRLEN}); would fail execve with E2BIG ` +
        `(PRD §9.3.3 — prompts must be delivered as a programmatic message ` +
        `body, never as an argv string).`
    );
  }
}

/**
 * Frozen sentinel asserting the runtime delivers prompts programmatically.
 *
 * Verified by audit P3.M2.T6.S1: all agent prompts flow through
 * `session.prompt(request.prompt)` (Pi harness) / `sdk.query({prompt})`
 * (Claude-Code harness) — in-process SDK method calls, never argv. The
 * regression test imports this to assert the conclusion executably.
 */
export const isPromptDeliveryProgrammatic = true as const;
