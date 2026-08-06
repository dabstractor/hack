// One-shot generator for the P1.M1.T2.S1 PRP JSON deliverable.
// context is read literally from context.md; arrays use single-quoted JS
// strings (backticks and double-quotes are literal in single quotes; we avoid
// apostrophes and backslashes inside them).
import * as fs from 'node:fs';
import * as path from 'node:path';

const dir = 'plan/011_5e3dfdb12bd1/research/P1_M1_T2_S1';
const context = fs.readFileSync(path.join(dir, 'context.md'), 'utf8').trimEnd();

const taskId = 'P1.M1.T2.S1';

const objective =
  'Add throwaway-survival (PRD section 9.9.2 G1.4) and terminal-state batch-re-execution guidance to PRP_BUILDER_PROMPT in src/agents/prompts.ts, phrased to compose with the existing FORBIDDEN ACTIONS block, and assert the new wording via a prompt-text describe block in tests/unit/agents/prompts.test.ts. Do NOT alter the JSON output contract at the end of the prompt.';

const implementationSteps = [
  'In src/agents/prompts.ts, locate PRP_BUILDER_PROMPT (template literal, opens L678, closes L762). Find step 4. Progressive Validation (header at L731) and its sub-paragraph line "Each level must pass before proceeding to the next." (L739). Do NOT touch the FORBIDDEN ACTIONS block (L683) or the JSON output contract (L751 onward).',
  'Immediately after the "Each level must pass before proceeding to the next." line and before the blank line plus "5. Completion Verification" (L741), insert two bold markdown sub-paragraphs at 3-space indent (matching the sibling step-4 sub-paragraphs): (a) "Terminal-state gate re-execution (PRD section 9.9)." stating the executor RE-RUNS every validation gate as a single BATCH against the FINAL filesystem state, so every gate must be a monotonic terminal-state assertion; (b) "Do not delete throwaway / spike artifacts during your turn (PRD section 9.9 G1.4)." stating any spike/scratch/throwaway artifact MUST survive on disk until AFTER validation and cleanup runs only once gates have passed.',
  'In the G1.4 sub-paragraph, explicitly cross-reference the FORBIDDEN ACTIONS block: state this rule "composes with -- and does not relax --" that block, which still forbids rm / git rm / git clean / mv on PRD.md, PRP.md, and plan/; here the additional protected class is the work artifact the coder created. This makes the two rules (pipeline-state protection vs work-artifact survival) non-contradictory.',
  'Escape EVERY inline backtick in the two new sub-paragraphs with a leading backslash in the source (the surrounding string is a JS template literal, so an unescaped backtick terminates the literal and breaks npm run typecheck). Introduce NO dollar-brace interpolation sequence. Use plain single quotes, angle brackets, pipes, and slashes verbatim. Keep the exact distinctive substrings the tests assert: terminal-state gate re-execution; re-runs every validation gate as a single BATCH; FINAL filesystem state; monotonic terminal-state assertion; G1.4; throwaway; spike; do not delete throwaway; during your turn; after validation; composes with; does not relax.',
  'In tests/unit/agents/prompts.test.ts add a new describe block named "PRP_BUILDER_PROMPT throwaway-survival + terminal-state re-execution (PRD section 9.9 G1.4)" with five it() cases: (1) toMatch the terminal-state phrases; (2) toContain G1.4 plus toMatch throwaway/spike/do-not-delete/during-your-turn/after-validation; (3) toMatch composes-with and does-not-relax plus toContain the FORBIDDEN ACTIONS header and the backtick-wrapped rm/PRD.md/plan/ tokens (mirror the existing critical-file deletion prohibition block backtick-in-toContain quoting); (4) indexOf ordering eachLevelIdx less than guidanceIdx less than contractIdx, plus the JSON contract markers still present; (5) pre-existing anchors survive. PRP_BUILDER_PROMPT is already imported at L15 so no import change is needed.',
  'Run npm run typecheck, then npx vitest run tests/unit/agents/prompts.test.ts (expect new block green plus 49 baseline green), then npm run lint. Finally run git diff --stat and confirm only src/agents/prompts.ts and tests/unit/agents/prompts.test.ts changed; confirm the JSON output contract near the end of PRP_BUILDER_PROMPT is byte-identical. Do NOT edit PRP_BLUEPRINT_PROMPT, src/agents/prp-executor.ts, src/core/models.ts, PROMPTS.md, or PRD.md.'
];

const validationGates = [
  { level: '1', command: 'npm run typecheck' },
  { level: '2', command: 'npx vitest run tests/unit/agents/prompts.test.ts' },
  { level: '3', command: 'npm run lint' },
  { level: '4', command: null }
];

const successCriteria = [
  { description: 'PRP_BUILDER_PROMPT contains a "Terminal-state gate re-execution (PRD section 9.9)" sub-paragraph stating the executor re-runs every validation gate as a batch against the FINAL filesystem state, and that every gate must be a monotonic terminal-state assertion.' },
  { description: 'PRP_BUILDER_PROMPT contains a G1.4 sub-paragraph ("PRD section 9.9 G1.4") instructing the coder MUST NOT delete a throwaway/spike artifact during its own turn and that cleanup happens only after validation.' },
  { description: 'The G1.4 wording explicitly composes with the existing FORBIDDEN ACTIONS block (phrases composes with and does not relax) and does not contradict it -- pipeline-state files remain rm/git rm/git clean/mv protected while the work artifact is additionally kept alive until validation completes.' },
  { description: 'The two new sub-paragraphs are placed inside step 4 (Progressive Validation), after "Each level must pass before proceeding to the next." and before "5. Completion Verification"; the JSON output contract at the end of the prompt (Strictly output your results in this JSON format, the result object, and the PRP-README placeholder) is byte-for-byte unchanged.' },
  { description: 'The pre-existing PRP_BUILDER_PROMPT anchors survive unchanged: the FORBIDDEN ACTIONS block (rm/git rm/git clean/mv on PRD.md/PRP.md/plan/ and NOT temporary), "Each level must pass before proceeding to the next", "Failure Protocol", "One-Pass Implementation Success", "Execute BASE PRP".' },
  { description: 'npm run typecheck passes (template literal compiles -- all backticks escaped, no stray dollar-brace interpolation); npx vitest run tests/unit/agents/prompts.test.ts passes with the new describe block green AND all 49 baseline tests green; npm run lint passes.' },
  { description: 'git diff --stat touches only src/agents/prompts.ts and tests/unit/agents/prompts.test.ts -- PRP_BLUEPRINT_PROMPT, src/agents/prp-executor.ts, src/core/models.ts ValidationGate, PROMPTS.md, and PRD.md are untouched.' }
];

const references = [
  'PRD section 9.9.2 REQ-G1 G1.4 (throwaway artifacts survive the coder turn) and section 6.3 (terminal-state re-execution) -- the canonical behavior to encode (already-merged document)',
  'PRD section 9.9.1 Problem -- the spike create/run/delete lifecycle that makes a post-delete tree fail existence gates',
  'src/agents/prompts.ts -- PRP_BUILDER_PROMPT template literal L678 to L762; FORBIDDEN ACTIONS block at L683; step 4 Progressive Validation at L731; insert point "Each level must pass before proceeding to the next." at L739; step 5 at L741; JSON output contract at L751',
  'tests/unit/agents/prompts.test.ts -- imports PRP_BUILDER_PROMPT at L15; existing describe(critical-file deletion prohibition) block (backtick-in-toContain pattern) and describe(PRP_BLUEPRINT_PROMPT gate monotonicity rules) block (toContain/toMatch pattern) as the templates to mirror',
  'plan/011_5e3dfdb12bd1/architecture/implementation-status.md section A.2 (Builder prompt insertion points) and section C (test surfaces)',
  'plan/011_5e3dfdb12bd1/prps/P1_M1_T1_S1.md -- the parallel sibling (Blueprint G1.1/G1.2/G1.3/G1.5) whose structure and test block this Builder-side task follows',
  'https://vitest.dev/api/ -- Vitest expect.toContain and expect.toMatch assertion API'
];

const obj = { taskId, objective, context, implementationSteps, validationGates, successCriteria, references };
const outPath = 'plan/011_5e3dfdb12bd1/prps/P1_M1_T2_S1.json';
fs.writeFileSync(outPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
console.log('WROTE', outPath, 'bytes=', fs.statSync(outPath).size);
