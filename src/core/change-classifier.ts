/**
 * Change / Artifact LLM classifiers (PRD §4.3, h3.5 "The Delta Workflow" step 1,
 * "Change Classification").
 *
 * @module core/change-classifier
 *
 * @remarks
 * PRD §4.3 mandates an **LLM-driven binary classifier** layered on top of the
 * structural diff produced by `diffPRDs()` (`src/core/prd-differ.ts`):
 *
 * - `classifyChange(diffSummary)` turns a structural `DiffSummary` into a
 *   `COSMETIC` (trivial: whitespace/formatting) vs `SUBSTANTIVE` (semantically
 *   significant) verdict, deciding whether a detected PRD edit is worth spawning a
 *   delta session over.
 * - `classifyArtifact(content)` guards a generated artifact (e.g. `delta_prd.md`)
 *   as `CLEAN` (well-formed and faithful) vs `DIRTY` (malformed / contaminated).
 *
 * ## Scope (P4.M1.T1.S1 vs S2)
 *
 * This module is the **inner LLM call**. It does NOT retry and does NOT apply a
 * protective default — that is **P4.M1.T1.S2** (bounded retry, default 4, plus a
 * fail-to-protective-default of `SUBSTANTIVE` / `DIRTY` on exhaustion). On any
 * non-success / empty / enum-invalid model output this module throws a
 * **transient** `AgentError` (code `PIPELINE_AGENT_LLM_FAILED`) so the S2 retry
 * layer (`isTransientError` in `src/utils/retry.ts`) treats it as retryable. The
 * thrown boundary is exactly what S2 wraps.
 *
 * The agent call is made BARE (`await agent.prompt(prompt)`) — deliberately NOT via
 * `retryAgentPrompt`. S2 owns retry; double-wrapping would compound retry counts and
 * break the protective-default boundary.
 */

import { z } from 'zod';
import type { Agent } from 'groundswell';

// CRITICAL: use .js extension for ES module imports.
// DiffSummary is a type-only import (interface) — import type to avoid any runtime
// import-cycle risk. It is the structural diff summary from diffPRDs() (PRD §4.3).
import type { DiffSummary } from './prd-differ.js';
import { createQAAgent } from '../agents/agent-factory.js';
import {
  createChangeClassificationPrompt,
  createArtifactClassificationPrompt,
} from '../agents/prompts/change-classifier-prompt.js';
import { AgentError } from '../utils/errors.js';
import { getLogger, type Logger } from '../utils/logger.js';
import { retry, createDefaultOnRetry } from '../utils/retry.js';
import { getClassifierRetryMax } from '../config/constants.js';

// PATTERN: lazy logger accessor (mirrors dependency-validator.ts, retry.ts).
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ChangeClassifier'));

/**
 * The two change-classification labels. PRD §4.3.
 *
 * - `COSMETIC` — the change is trivial: whitespace / formatting / reordering /
 *   spelling / grammar; no semantic meaning.
 * - `SUBSTANTIVE` — the change is semantically significant: a requirement was
 *   added, removed, expanded, contracted, or rephrased in a way that alters what
 *   must be implemented.
 */
export type ChangeClassification = 'COSMETIC' | 'SUBSTANTIVE';

/**
 * Zod enum validating the model's emitted change-classification token.
 *
 * @remarks
 * Used as the `responseFormat` of the change-classification prompt so Groundswell
 * validates the output is exactly `COSMETIC` or `SUBSTANTIVE`. An out-of-enum token
 * surfaces as `status:'error'` (or `data:null`), which `classifyChange` throws on.
 */
export const ChangeClassificationSchema = z.enum(['COSMETIC', 'SUBSTANTIVE']);

/**
 * The two artifact-classification labels. PRD §4.3.
 *
 * - `CLEAN` — the artifact is well-formed and faithful (internally consistent,
 *   free of stray instructions / hallucinations / leaked tool output).
 * - `DIRTY` — the artifact is malformed or contaminated.
 */
export type ArtifactClassification = 'CLEAN' | 'DIRTY';

/**
 * Zod enum validating the model's emitted artifact-classification token.
 *
 * @remarks
 * Used as the `responseFormat` of the artifact-classification prompt so Groundswell
 * validates the output is exactly `CLEAN` or `DIRTY`.
 */
export const ArtifactClassificationSchema = z.enum(['CLEAN', 'DIRTY']);

/**
 * Classify a detected PRD change as `COSMETIC` or `SUBSTANTIVE` via an LLM call over
 * the structural `DiffSummary`. PRD §4.3.
 *
 * @remarks
 * Builds a typed `Prompt<ChangeClassification>` from `diffSummary`, invokes the QA
 * agent (`createQAAgent()`) with a BARE `agent.prompt(prompt)` call (no
 * `retryAgentPrompt` — that is the P4.M1.T1.S2 contract), discriminates on
 * `response.status`, and returns the validated `response.data`.
 *
 * @param diffSummary - The structural diff summary from `diffPRDs()`.
 * @returns `'COSMETIC'` or `'SUBSTANTIVE'` on a successful agent response.
 * @throws {AgentError} code `PIPELINE_AGENT_LLM_FAILED` (transient) when
 *   `response.status !== 'success'` or `response.data === null`. This transient
 *   throw is the boundary the S2 retry layer wraps and re-attempts.
 */
export async function classifyChange(
  diffSummary: DiffSummary
): Promise<ChangeClassification> {
  const agent: Agent = createQAAgent();
  const prompt = createChangeClassificationPrompt(diffSummary);

  // BARE call — NO retryAgentPrompt. Retry is the P4.M1.T1.S2 contract.
  const response = await agent.prompt(prompt);

  if (response.status !== 'success' || response.data === null) {
    // NOTE: do NOT use the words 'parse'/'parsing' in this message — isTransientError
    // (retry.ts) treats a message containing them as PERMANENT (not retried). Phrase
    // invalid-output as 'returned no data'. AgentError.code is HARDCODED to
    // PIPELINE_AGENT_LLM_FAILED (errors.ts:423) — transient by default.
    const msg = `change classifier returned no data: ${response.error?.message ?? 'unknown error'}`;
    logger().warn({ status: response.status }, msg);
    throw new AgentError(msg);
  }

  // response.data is validated against ChangeClassificationSchema by Groundswell
  // (responseFormat on the prompt). A value outside the enum surfaces as a non-success
  // response above; an in-enum value is the union literal.
  const result = response.data as ChangeClassification;
  logger().debug({ classification: result }, 'change classified');
  return result;
}

/**
 * Classify a generated artifact (e.g. `delta_prd.md` content) as `CLEAN` or `DIRTY`
 * via an LLM call. PRD §4.3.
 *
 * @remarks
 * Same shape as `classifyChange`. Guards against empty `content` BEFORE calling the
 * agent (an empty artifact is a caller bug, surfaced immediately).
 *
 * @param content - The generated artifact text to classify.
 * @returns `'CLEAN'` or `'DIRTY'` on a successful agent response.
 * @throws {AgentError} code `PIPELINE_AGENT_LLM_FAILED` (transient) when `content`
 *   is empty / whitespace-only, or when `response.status !== 'success'` or
 *   `response.data === null`. This transient throw is the boundary the S2 retry
 *   layer wraps and re-attempts.
 */
export async function classifyArtifact(
  content: string
): Promise<ArtifactClassification> {
  // Guard: empty content is a caller bug — surface it before paying for an LLM call.
  // Throws a transient AgentError (code hardcoded PIPELINE_AGENT_LLM_FAILED) so S2's
  // protective-default can still apply if a caller passes empty input through retry.
  if (!content || content.trim().length === 0) {
    throw new AgentError('artifact classifier received empty content');
  }

  const agent: Agent = createQAAgent();
  const prompt = createArtifactClassificationPrompt(content);

  // BARE call — NO retryAgentPrompt. Retry is the P4.M1.T1.S2 contract.
  const response = await agent.prompt(prompt);

  if (response.status !== 'success' || response.data === null) {
    // NOTE: do NOT use the words 'parse'/'parsing' in this message (see classifyChange).
    const msg = `artifact classifier returned no data: ${response.error?.message ?? 'unknown error'}`;
    logger().warn({ status: response.status }, msg);
    throw new AgentError(msg);
  }

  const result = response.data as ArtifactClassification;
  logger().debug({ classification: result }, 'artifact classified');
  return result;
}

/**
 * Classify a detected PRD change as `COSMETIC` or `SUBSTANTIVE` with
 * TRANSIENT-API RETRY and a PROTECTIVE DEFAULT on exhaustion. PRD §4.3.
 *
 * @remarks
 * Wraps {@link classifyChange} (the inner LLM call) in a bounded `retry()` loop
 * with `maxAttempts = getClassifierRetryMax()` (default 4, configurable via the
 * `CLASSIFIER_RETRY_MAX` env var). Transient API failures (empty output,
 * connection errors, rate limits, overloaded) and the inner classifier's
 * `AgentError(PIPELINE_AGENT_LLM_FAILED)` are retried (via the default
 * `isTransientError`). On exhaustion (all attempts fail) this function FAILS TO THE
 * PROTECTIVE DEFAULT `'SUBSTANTIVE'` and warns — it NEVER returns
 * `'could not classify'`, `undefined`, or throws.
 *
 * Per PRD §4.3: "On exhaustion they MUST fail to the protective/conservative
 * default (treat as SUBSTANTIVE / DIRTY) — never silently fall through to 'could
 * not classify' and proceed unprotected through a SUBSTANTIVE change."
 *
 * Mirrors the stagecoach retry boundary in `src/utils/git-commit.ts` (the LLM
 * boundary wrapped in `retry()` with a catch-and-fallback). `isRetryable` is
 * intentionally OMITTED so it defaults to `isTransientError`.
 *
 * @param diffSummary - The structural diff summary from `diffPRDs()`
 *   (`src/core/prd-differ.ts`).
 * @returns `'COSMETIC'` on a confident trivial change; `'SUBSTANTIVE'` on a
 *          significant change OR on retry exhaustion (protective default).
 */
export async function classifyChangeWithRetry(
  diffSummary: DiffSummary
): Promise<ChangeClassification> {
  const maxAttempts = getClassifierRetryMax();
  try {
    return await retry(() => classifyChange(diffSummary), {
      maxAttempts,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      // isRetryable intentionally OMITTED → defaults to isTransientError
      // (mirrors git-commit.ts). S1 throws AgentError(PIPELINE_AGENT_LLM_FAILED)
      // which is transient (message avoids 'parse'/'parsing'), so it is retried.
      onRetry: createDefaultOnRetry(
        'ChangeClassifier.classifyChange',
        maxAttempts
      ),
    });
  } catch (error) {
    // PRD §4.3 protective default: all retries exhausted → fail SAFE (treat as
    // SUBSTANTIVE). retry() rethrows the last error on exhaustion; this catch
    // applies the protective default instead of letting it escape.
    logger().warn(
      { error, maxAttempts },
      'change classifier exhausted retries; failing to protective default SUBSTANTIVE'
    );
    return 'SUBSTANTIVE';
  }
}

/**
 * Classify a generated artifact (e.g. `delta_prd.md` content) as `CLEAN` or
 * `DIRTY` with TRANSIENT-API RETRY and a PROTECTIVE DEFAULT on exhaustion.
 * PRD §4.3.
 *
 * @remarks
 * Wraps {@link classifyArtifact} in a bounded `retry()` loop (same configuration as
 * {@link classifyChangeWithRetry}). On exhaustion this function FAILS TO THE
 * PROTECTIVE DEFAULT `'DIRTY'` and warns — it NEVER returns
 * `'could not classify'`, `undefined`, or throws.
 *
 * Per PRD §4.3: "On exhaustion they MUST fail to the protective/conservative
 * default (treat as SUBSTANTIVE / DIRTY)."
 *
 * Mirrors the stagecoach retry boundary in `src/utils/git-commit.ts`.
 * `isRetryable` is intentionally OMITTED so it defaults to `isTransientError`.
 *
 * @param content - The artifact text to classify (e.g. `delta_prd.md` content).
 * @returns `'CLEAN'` on a well-formed faithful artifact; `'DIRTY'` on a
 *          contaminated artifact OR on retry exhaustion (protective default).
 */
export async function classifyArtifactWithRetry(
  content: string
): Promise<ArtifactClassification> {
  const maxAttempts = getClassifierRetryMax();
  try {
    return await retry(() => classifyArtifact(content), {
      maxAttempts,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      // isRetryable intentionally OMITTED → defaults to isTransientError
      // (mirrors git-commit.ts). The inner classifyArtifact's transient throws
      // (including the empty-content guard) are retried.
      onRetry: createDefaultOnRetry(
        'ChangeClassifier.classifyArtifact',
        maxAttempts
      ),
    });
  } catch (error) {
    // PRD §4.3 protective default: all retries exhausted → fail SAFE (treat as
    // DIRTY). retry() rethrows the last error on exhaustion; this catch applies
    // the protective default instead of letting it escape.
    logger().warn(
      { error, maxAttempts },
      'artifact classifier exhausted retries; failing to protective default DIRTY'
    );
    return 'DIRTY';
  }
}
