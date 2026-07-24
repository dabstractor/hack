# Key Function Signatures & Patterns (Reference for PRP Agents)

## Session Utilities (`src/core/session-utils.ts`)

```ts
// Line 99 — atomic write (temp + rename, no lock)
export async function atomicWrite(targetPath: string, data: string): Promise<void>

// Line 235 — current hashing (reads RAW file)
export async function hashPRD(prdPath: string): Promise<string>

// Line 404 — write tasks.json (BacklogSchema.parse → atomicWrite)
export async function writeTasksJSON(sessionPath: string, backlog: Backlog): Promise<void>

// Line 499 — read tasks.json
export async function readTasksJSON(sessionPath: string): Promise<Backlog>
```

## Session Manager (`src/core/session-manager.ts`)

```ts
// Line ~294 — initialize (creates/loads session)
async initialize(): Promise<void>

// Line ~548 — load existing session
async loadSession(sessionPath: string): Promise<SessionState>

// Line ~610 — create delta session
async createDeltaSession(newPRDPath: string): Promise<SessionState>

// Line ~706 — save backlog
async saveBacklog(backlog: Backlog): Promise<void>

// Line ~754 — flush pending updates (batched)
async flushUpdates(): Promise<void>

// Line ~1383 — static find session by hash
static async findSessionByHash(sessionHash: string, planDir: string): Promise<string | null>
```

## Config (`src/config/constants.ts`, `environment.ts`, `types.ts`)

```ts
// constants.ts:43
export const MODEL_NAMES = { opus: 'glm-5.2', sonnet: 'glm-5.2', haiku: 'glm-5-turbo' } as const;

// constants.ts:65
export const MODEL_ENV_VARS = { opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL', sonnet: '...', haiku: '...' } as const;

// constants.ts:78
export const REQUIRED_ENV_VARS = { apiKey: 'ANTHROPIC_API_KEY', baseURL: 'ANTHROPIC_BASE_URL' } as const;

// constants.ts:198
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;

// types.ts:24
export type ModelTier = 'opus' | 'sonnet' | 'haiku';

// environment.ts
export function getModel(tier: ModelTier): string
export function qualifyModel(name: string): string
export function configureEnvironment(): void
export function getResolvedProvider(): string
```

## Agent Factory (`src/agents/agent-factory.ts`)

```ts
// Line 171 — base config (all personas default to getModel('sonnet'))
function createBaseConfig(persona: AgentPersona): AgentConfig

// Line 221 — architect (sonnet, TASK_BREAKDOWN_PROMPT)
export function createArchitectAgent(): Agent

// Line 252 — researcher (sonnet, PRP_BLUEPRINT_PROMPT)
export function createResearcherAgent(): Agent

// Line 283 — coder (OVERRIDES to getModel('haiku'), PRP_BUILDER_PROMPT)
export function createCoderAgent(): Agent

// Line 315 — qa (sonnet, BUG_HUNT_PROMPT)
export function createQAAgent(): Agent

// No session/sessionId/persistence field in AgentConfig
```

## Git Commit (`src/utils/git-commit.ts`)

```ts
// Line 131 — single-phase smart commit
export async function smartCommit(sessionPath: string, message: string): Promise<string | null>

// Protected files (NOT committed via smartCommit)
const PROTECTED_FILES = ['PRD.md', 'prd_snapshot.md', 'delta_prd.md', 'delta_from.txt', 'TEST_RESULTS.md'];
```

## Research Queue (`src/core/research-queue.ts`)

```ts
export class ResearchQueue {
  constructor(sessionManager, maxSize = 3, noCache = false, cacheTtlMs = 24h)
  async enqueue(task: Task|Subtask, backlog: Backlog): Promise<void>
  async waitForPRP(taskId: string): Promise<PRPDocument>
  async researchNow(task: Task, backlog: Backlog, issueFeedback?): Promise<PRPDocument>
  async deletePRP(taskId: string): Promise<void>
  isAbandoned(taskId: string): boolean
}
```

## Task Orchestrator (`src/core/task-orchestrator.ts`)

```ts
// Line ~560 — execute single subtask
async executeSubtask(subtask: Subtask): Promise<void>

// Line ~1000 — recover after agent run
async #recoverAfterAgentRun(itemId: string, result: PRPExecutionResult): Promise<void>
```

## PRD Differ (`src/core/prd-differ.ts`)

```ts
export function parsePRDSections(prd: string): PRDSection[]  // line 179 — reusable section parser
export function diffPRDs(oldPRD: string, newPRD: string): DiffSummary
export function hasSignificantChanges(diff: DiffSummary): boolean  // DEAD CODE — never called
```

## Bug Hunt Workflow (`src/workflows/bug-hunt-workflow.ts`)

```ts
export class BugHuntWorkflow extends Workflow {
  constructor(prdContent: string, completedTasks: Task[])
  public async writeBugReport(sessionPath: string, testResults: TestResults): Promise<void>  // line 404
  async run(sessionPath?: string): Promise<TestResults>
}
```

## CLI (`src/cli/index.ts`)

```ts
// Subcommand registration pattern (commander.js):
program.command('task')
  .description('Display and query pipeline tasks')
  .argument('[action]', '...', '')
  .option('-f, --file <path>', '...')
  .action(async (action, options) => { ... process.exit(0); });

// Parse result union type:
| { subcommand: 'inspect'; ... }
| { subcommand: 'task'; ... }
| ... // ValidatedCLIArgs (default pipeline)
```

## Pipeline (`src/workflows/prp-pipeline.ts`)

```ts
export class PRPPipeline extends Workflow {
  // 23 positional constructor args
  async initializeSession(): Promise<void>    // creates SessionManager + TaskOrchestrator
  async handleDelta(): Promise<void>           // line 627
  async decomposePRD(): Promise<void>          // architect agent → tasks.json
  async executeBacklog(): Promise<void>        // task-orchestrator execution loop
  async runQACycle(): Promise<void>            // line 1112
  async run(): Promise<PipelineResult>         // line 1728
}
```

## Models (`src/core/models.ts`)

```ts
// Line 175
export type Status = 'Planned' | 'Researching' | 'Ready' | 'Implementing' | 'Retrying' | 'Complete' | 'Failed' | 'Obsolete';

// Line 273 — Subtask (NO prd_selectors field)
export interface Subtask {
  readonly id: string;
  readonly type: 'Subtask';
  readonly title: string;
  readonly status: Status;
  readonly story_points: number;
  readonly dependencies: string[];
  readonly context_scope: string;
}

// Line 360 — Zod schema mirrors Subtask exactly
export const SubtaskSchema: z.ZodType<Subtask> = z.object({ ... });
```