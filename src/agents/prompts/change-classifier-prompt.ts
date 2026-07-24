/**
 * Change / Artifact classification prompt generator module
 *
 * @module agents/prompts/change-classifier-prompt
 *
 * @remarks
 * PRD §4.3 (h3.5 "The Delta Workflow" step 1, "Change Classification"). Provides
 * type-safe prompt generators for the two LLM-driven binary classifiers that live
 * in `src/core/change-classifier.ts`:
 *
 * - `createChangeClassificationPrompt(diffSummary)` — renders a structural PRD diff
 *   summary (`DiffSummary` from `diffPRDs()`) into a user turn and returns a
 *   `Prompt<ChangeClassification>` validated against the `COSMETIC | SUBSTANTIVE` enum.
 * - `createArtifactClassificationPrompt(content)` — wraps a generated artifact (e.g.
 *   `delta_prd.md` content) into a user turn and returns a
 *   `Prompt<ArtifactClassification>` validated against the `CLEAN | DIRTY` enum.
 *
 * Groundswell validates the model's emitted token against the Zod enum
 * (`responseFormat`). An out-of-enum token surfaces as `status:'error'` (or
 * `data:null`), which the classifier module throws on as a transient `AgentError`
 * for the P4.M1.T1.S2 retry layer to re-attempt.
 *
 * This is Layer B of the two-layer prompt convention: the system-prompt constant
 * `CHANGE_CLASSIFIER_PROMPT` (Layer A) lives in `src/agents/prompts.ts`.
 */

// PATTERN: Import Groundswell prompt creation utilities
import { createPrompt, type Prompt } from 'groundswell';

// CRITICAL: Use .js extension for ES module imports
// The classification types + Zod schemas are co-located in the classifier module.
import type {
  ChangeClassification,
  ArtifactClassification,
} from '../../core/change-classifier.js';
import {
  ChangeClassificationSchema,
  ArtifactClassificationSchema,
} from '../../core/change-classifier.js';

// PATTERN: The structural diff summary is the classifier's input (PRD §4.3).
import type { DiffSummary } from '../../core/prd-differ.js';

// PATTERN: Import system prompt + the pre-merged declaration from the prompts file.
import {
  CHANGE_CLASSIFIER_PROMPT,
  PRD_PREMERGED_DECLARATION,
} from '../prompts.js';

/**
 * Render a structural PRD diff summary into the change-classification user turn.
 *
 * @param diffSummary - The structural diff summary from `diffPRDs()` (prd-differ.ts).
 * @returns A markdown user turn describing the change, requesting a COSMETIC vs
 *   SUBSTANTIVE classification.
 *
 * @remarks
 * Renders `summaryText`, the stats block (added / modified / removed counts and the
 * list of affected sections), and each `SectionChange` (its type, title, impact, and
 * the old/new content when present). Prepend `PRD_PREMERGED_DECLARATION` per the
 * PRD §2.3 convention shared by every prompt that embeds PRD-derived content.
 */
function constructChangeUserPrompt(diffSummary: DiffSummary): string {
  // Render the stats block.
  const stats = diffSummary.stats;
  const sectionsList =
    stats.sectionsAffected.length > 0
      ? stats.sectionsAffected.map(s => `- ${s}`).join('\n')
      : '- (none)';

  // Render each section change with whatever content is present.
  const changesBlock = diffSummary.changes
    .map((change, index) => {
      const lines: string[] = [
        `### Change ${index + 1}: ${change.sectionTitle}`,
        `- type: ${change.type}`,
        `- impact: ${change.impact}`,
        `- line number: ${change.lineNumber}`,
      ];
      if (change.oldContent !== undefined) {
        lines.push(`- old content:\n\`\`\`\n${change.oldContent}\n\`\`\``);
      }
      if (change.newContent !== undefined) {
        lines.push(`- new content:\n\`\`\`\n${change.newContent}\n\`\`\``);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return `
${PRD_PREMERGED_DECLARATION}

# Change Classification Request

You are classifying a detected change to a Product Requirements Document. Decide
whether the change below is **COSMETIC** (trivial: whitespace / formatting /
reordering / spelling / grammar — no semantic meaning) or **SUBSTANTIVE**
(semantically significant: a requirement was added, removed, expanded, contracted,
or rephrased in a way that alters what must be implemented).

## Diff Summary

${diffSummary.summaryText}

## Stats

- sections added: ${stats.totalAdded}
- sections modified: ${stats.totalModified}
- sections removed: ${stats.totalRemoved}
- sections affected:
${sectionsList}

## Detected Changes

${changesBlock.length > 0 ? changesBlock : '(no structured changes detected)'}

---

Classify this change as exactly \`COSMETIC\` or \`SUBSTANTIVE\`. Emit exactly one token.
`;
}

/**
 * Wrap a generated artifact's content into the artifact-classification user turn.
 *
 * @param content - The artifact text (e.g. `delta_prd.md` content) to classify.
 * @returns A markdown user turn embedding the artifact, requesting a CLEAN vs DIRTY
 *   classification.
 *
 * @remarks
 * Embeds the artifact in a fenced code block, prepends `PRD_PREMERGED_DECLARATION`
 * per the PRD §2.3 convention, and instructs the model to emit exactly `CLEAN` or
 * `DIRTY`.
 */
function constructArtifactUserPrompt(content: string): string {
  return `
${PRD_PREMERGED_DECLARATION}

# Artifact Classification Request

You are classifying a generated artifact. Decide whether the artifact below is
**CLEAN** (well-formed and faithful: internally consistent, free of stray
instructions / hallucinations / leaked tool output / malformed structure) or
**DIRTY** (malformed or contaminated).

## Artifact Content

\`\`\`
${content}
\`\`\`

---

Classify this artifact as exactly \`CLEAN\` or \`DIRTY\`. Emit exactly one token.
`;
}

/**
 * Create a change-classification prompt with structured ChangeClassification output.
 *
 * @remarks
 * PRD §4.3. Returns a Groundswell Prompt configured with:
 *
 * - `user`: the structural diff summary rendered into a markdown user turn
 *   (`constructChangeUserPrompt`).
 * - `system`: `CHANGE_CLASSIFIER_PROMPT` (overrides `createQAAgent()`'s default
 *   `BUG_HUNT_PROMPT` for this call).
 * - `responseFormat`: `ChangeClassificationSchema` — Groundswell validates the
 *   emitted token is exactly `COSMETIC` or `SUBSTANTIVE`.
 * - `enableReflection`: true — error recovery for the structured output.
 *
 * @param diffSummary - The structural diff summary from `diffPRDs()`.
 * @returns A Groundswell `Prompt<ChangeClassification>` ready for `agent.prompt()`.
 */
export function createChangeClassificationPrompt(
  diffSummary: DiffSummary
): Prompt<ChangeClassification> {
  // PATTERN: Use createPrompt with responseFormat for structured output
  return createPrompt({
    user: constructChangeUserPrompt(diffSummary),
    system: CHANGE_CLASSIFIER_PROMPT,
    responseFormat: ChangeClassificationSchema,
    enableReflection: true,
  });
}

/**
 * Create an artifact-classification prompt with structured ArtifactClassification output.
 *
 * @remarks
 * PRD §4.3. Same shape as `createChangeClassificationPrompt`, but the input is the
 * artifact text (e.g. `delta_prd.md` content) and the validated output is `CLEAN` or
 * `DIRTY` via `ArtifactClassificationSchema`.
 *
 * @param content - The generated artifact text to classify.
 * @returns A Groundswell `Prompt<ArtifactClassification>` ready for `agent.prompt()`.
 */
export function createArtifactClassificationPrompt(
  content: string
): Prompt<ArtifactClassification> {
  return createPrompt({
    user: constructArtifactUserPrompt(content),
    system: CHANGE_CLASSIFIER_PROMPT,
    responseFormat: ArtifactClassificationSchema,
    enableReflection: true,
  });
}
