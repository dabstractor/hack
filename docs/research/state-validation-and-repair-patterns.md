# State Validation and Repair Patterns Research

> **Research Date**: 2026-01-24
> **Purpose**: Comprehensive research on state validation patterns, Zod validation, and backup/repair strategies for task management systems

---

## Table of Contents

1. [State Validation Patterns](#1-state-validation-patterns)
2. [Zod Validation](#2-zod-validation)
3. [Backup/Repair Patterns](#3-backuprepair-patterns)
4. [Implementation Recommendations](#4-implementation-recommendations)
5. [Reference URLs](#5-reference-urls)

---

## 1. State Validation Patterns

### 1.1 JSON Schema Validation Best Practices

#### Core Principles

**1. Schema Design for Task State Management**

- Define strict, typed schemas for all state transitions
- Use enum constraints for finite state values (e.g., "pending", "running", "completed", "failed")
- Implement required fields for essential task metadata
- Include timestamp fields for audit trails
- Use UUID or similar for unique identifiers

**2. Validation Layers**

```text
Input Validation → State Transition Validation → Storage Validation → Output Validation
```

**3. Common Schema Patterns**

Task State Schema:

```json
{
  "type": "object",
  "required": ["id", "state", "createdAt", "updatedAt"],
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "description": "Unique task identifier"
    },
    "state": {
      "type": "string",
      "enum": [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "retrying"
      ],
      "description": "Current task state"
    },
    "previousState": {
      "type": "string",
      "enum": [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "retrying"
      ],
      "description": "Previous state for transition tracking"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "Task creation timestamp"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Last update timestamp"
    },
    "dependencies": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of task IDs this task depends on"
    },
    "retryCount": {
      "type": "integer",
      "minimum": 0,
      "description": "Number of retry attempts"
    }
  }
}
```

**4. State Machine Validation**

- Define valid state transitions as a matrix
- Implement guards to prevent invalid transitions
- Track state transition history for debugging

Valid Transition Matrix:

```text
pending → running
running → completed | failed | retrying
retrying → running | failed
failed → retrying
completed → (terminal state)
cancelled → (terminal state)
```

### 1.2 Task Dependency Graph Validation

#### Common Validation Checks

**1. Dependency Existence Check**

- All dependency IDs must reference existing tasks
- Detect dangling references (dependencies pointing to non-existent tasks)
- Validate against current task store

**2. Orphaned Dependency Detection**

What are orphaned dependencies?

- Tasks that depend on non-existent tasks
- Tasks referenced as dependencies but don't exist
- Broken references in the dependency chain

Detection Algorithm:

```typescript
function detectOrphanedDependencies(tasks: Task[]): OrphanReport {
  const taskIds = new Set(tasks.map(t => t.id));
  const orphans: Map<string, string[]> = new Map();

  for (const task of tasks) {
    const missingDeps = task.dependencies.filter(depId => !taskIds.has(depId));

    if (missingDeps.length > 0) {
      orphans.set(task.id, missingDeps);
    }
  }

  return { orphans, count: orphans.size };
}
```

**3. Circular Dependency Detection**

Circular dependencies occur when:

- Task A depends on Task B
- Task B depends on Task C
- Task C depends on Task A (creates a cycle)

Why detect them?

- Create deadlocks in task execution
- Make it impossible to determine execution order
- Can cause infinite loops in dependency resolution

#### Circular Dependency Detection Algorithms

**Algorithm 1: Three-Color DFS (Depth-First Search)**

The most common and efficient approach using three-color marking:

```typescript
enum NodeColor {
  WHITE = 'white', // Unvisited
  GRAY = 'gray', // Currently visiting (in recursion stack)
  BLACK = 'black', // Fully visited
}

function detectCyclicDependencies(tasks: Task[]): string[] | null {
  const colors = new Map<string, NodeColor>();
  const adjacencyList = buildAdjacencyList(tasks);

  // Initialize all nodes as WHITE
  for (const task of tasks) {
    colors.set(task.id, NodeColor.WHITE);
  }

  // Run DFS on each unvisited node
  for (const task of tasks) {
    if (colors.get(task.id) === NodeColor.WHITE) {
      const cycle = dfsVisit(task.id, colors, adjacencyList);
      if (cycle) return cycle;
    }
  }

  return null; // No cycle found
}

function dfsVisit(
  nodeId: string,
  colors: Map<string, NodeColor>,
  adjacencyList: Map<string, string[]>,
  path: string[] = []
): string[] | null {
  colors.set(nodeId, NodeColor.GRAY);
  path.push(nodeId);

  const neighbors = adjacencyList.get(nodeId) || [];
  for (const neighbor of neighbors) {
    const neighborColor = colors.get(neighbor);

    if (neighborColor === NodeColor.GRAY) {
      // Found a back edge - cycle detected!
      const cycleStart = path.indexOf(neighbor);
      return [...path.slice(cycleStart), neighbor];
    }

    if (neighborColor === NodeColor.WHITE) {
      const cycle = dfsVisit(neighbor, colors, adjacencyList, path);
      if (cycle) return cycle;
    }
  }

  colors.set(nodeId, NodeColor.BLACK);
  path.pop();
  return null;
}

function buildAdjacencyList(tasks: Task[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const task of tasks) {
    graph.set(task.id, task.dependencies);
  }

  return graph;
}
```

**Algorithm 2: Topological Sort (Kahn's Algorithm)**

If topological sort produces fewer than V vertices, a cycle exists:

```typescript
function detectCycleWithTopologicalSort(tasks: Task[]): boolean {
  const adjacencyList = buildAdjacencyList(tasks);
  const inDegree = calculateInDegrees(tasks, adjacencyList);
  const queue: string[] = [];

  // Find all nodes with zero in-degree
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(nodeId);
  }

  let visitedCount = 0;

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    visitedCount++;

    // Reduce in-degree for all neighbors
    const neighbors = adjacencyList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If not all nodes visited, cycle exists
  return visitedCount !== tasks.length;
}

function calculateInDegrees(
  tasks: Task[],
  adjacencyList: Map<string, string[]>
): Map<string, number> {
  const inDegree = new Map<string, number>();

  // Initialize all degrees to 0
  for (const task of tasks) {
    inDegree.set(task.id, 0);
  }

  // Count incoming edges
  for (const [nodeId, neighbors] of adjacencyList) {
    for (const neighbor of neighbors) {
      inDegree.set(neighbor, (inDegree.get(neighbor) || 0) + 1);
    }
  }

  return inDegree;
}
```

**Time Complexity**: O(V + E) where V = vertices (tasks), E = edges (dependencies)
**Space Complexity**: O(V + E)

**4. Transitive Dependency Validation**

Validate that all transitive dependencies are valid:

```typescript
function validateTransitiveDependencies(
  taskId: string,
  tasks: Map<string, Task>,
  visited: Set<string> = new Set()
): ValidationResult {
  if (visited.has(taskId)) {
    return { valid: true }; // Already validated
  }

  const task = tasks.get(taskId);
  if (!task) {
    return { valid: false, error: `Task ${taskId} not found` };
  }

  visited.add(taskId);

  for (const depId of task.dependencies) {
    if (!tasks.has(depId)) {
      return {
        valid: false,
        error: `Task ${taskId} depends on non-existent task ${depId}`,
      };
    }

    const result = validateTransitiveDependencies(depId, tasks, visited);
    if (!result.valid) return result;
  }

  return { valid: true };
}
```

### 1.3 Validation Patterns Summary

| Validation Type       | Purpose                     | Algorithm              | Complexity                   |
| --------------------- | --------------------------- | ---------------------- | ---------------------------- |
| Schema Validation     | Type and structure checking | JSON Schema validators | O(n) where n = doc size      |
| Dependency Existence  | Find dangling references    | Set lookup             | O(n \* d) where d = avg deps |
| Orphan Detection      | Find tasks with broken deps | Set difference         | O(n \* d)                    |
| Circular Dependency   | Detect cycles in dep graph  | DFS 3-color marking    | O(V + E)                     |
| Topological Sort      | Validate DAG structure      | Kahn's algorithm       | O(V + E)                     |
| Transitive Validation | Validate entire dep tree    | Recursive DFS          | O(V + E)                     |

---

## 2. Zod Validation

### 2.1 Zod for Complex Nested Structures

Zod is a TypeScript-first schema validation library with excellent type inference.

#### Basic Schema Definition

```typescript
import { z } from 'zod';

// Task state enum
const TaskStateSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'retrying',
]);

// Base task schema
const TaskSchema = z.object({
  id: z.string().uuid(),
  state: TaskStateSchema,
  previousState: TaskStateSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dependencies: z.array(z.string().uuid()),
  retryCount: z.number().int().min(0).default(0),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Type inference
type Task = z.infer<typeof TaskSchema>;
```

#### Complex Nested Structures

**1. Deeply Nested Objects**

```typescript
const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
});

const ExecutionContextSchema = z.object({
  environment: z.enum(['development', 'staging', 'production']),
  location: LocationSchema,
  config: z.object({
    timeout: z.number().positive(),
    retries: z.number().int().min(0),
    priority: z.number().min(1).max(10),
  }),
});

const TaskWithExecutionSchema = TaskSchema.extend({
  executionContext: ExecutionContextSchema,
});
```

**2. Arrays of Nested Objects**

```typescript
const DependencySchema = z.object({
  taskId: z.string().uuid(),
  type: z.enum(['hard', 'soft']),
  condition: z.string().optional(),
});

const TaskWithTypedDepsSchema = TaskSchema.extend({
  dependencies: z.array(DependencySchema),
});
```

**3. Recursive Structures**

```typescript
// Define a schema for task trees (tasks can have subtasks)
const TaskTreeSchema: z.ZodType<TaskTree> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    subtasks: z.array(TaskTreeSchema).optional(),
  })
);

type TaskTree = z.infer<typeof TaskTreeSchema>;
```

**4. Polymorphic/Union Types**

```typescript
const BaseTaskSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  createdAt: z.string().datetime(),
});

const HttpTaskSchema = BaseTaskSchema.extend({
  type: z.literal('http'),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
});

const DatabaseTaskSchema = BaseTaskSchema.extend({
  type: z.literal('database'),
  query: z.string(),
  connection: z.string(),
});

const TaskSchema = z.discriminatedUnion('type', [
  HttpTaskSchema,
  DatabaseTaskSchema,
]);

type Task = z.infer<typeof TaskSchema>;
```

### 2.2 Custom Validators in Zod

#### Using `.refine()` for Custom Validation

```typescript
const TaskSchema = z
  .object({
    id: z.string().uuid(),
    state: TaskStateSchema,
    previousState: TaskStateSchema.optional(),
    dependencies: z.array(z.string().uuid()),
    retryCount: z.number().int().min(0),
  })
  .refine(
    data => {
      // Validate state transitions
      if (!data.previousState) return true;
      return isValidTransition(data.previousState, data.state);
    },
    {
      message: 'Invalid state transition',
      path: ['state'],
    }
  )
  .refine(
    data => {
      // Prevent self-dependencies
      return !data.dependencies.includes(data.id);
    },
    {
      message: 'Task cannot depend on itself',
      path: ['dependencies'],
    }
  );

function isValidTransition(from: string, to: string): boolean {
  const validTransitions: Record<string, string[]> = {
    pending: ['running', 'cancelled'],
    running: ['completed', 'failed', 'retrying'],
    retrying: ['running', 'failed'],
    failed: ['retrying'],
    completed: [],
    cancelled: [],
  };

  return validTransitions[from]?.includes(to) ?? false;
}
```

#### Custom Validators with `.transform()`

```typescript
const TaskWithComputedFieldsSchema = TaskSchema.transform(data => ({
  ...data,
  canRetry: data.state === 'failed' && data.retryCount < 3,
  isTerminal: ['completed', 'cancelled'].includes(data.state),
}));

type TaskWithComputedFields = z.infer<typeof TaskWithComputedFieldsSchema>;
```

#### Async Custom Validators

```typescript
const TaskSchema = z
  .object({
    id: z.string().uuid(),
    dependencies: z.array(z.string().uuid()),
  })
  .refine(
    async data => {
      // Async validation - check if dependencies exist in database
      const tasks = await getTasksByIds(data.dependencies);
      return tasks.length === data.dependencies.length;
    },
    {
      message: 'Some dependencies do not exist',
    }
  );

async function validateTask(task: unknown) {
  const result = await TaskSchema.safeParseAsync(task);
  if (!result.success) {
    console.error(result.error.errors);
    return null;
  }
  return result.data;
}
```

#### Custom Error Messages

```typescript
const EnhancedTaskSchema = z.object({
  id: z.string().uuid({
    errorMap: () => ({ message: 'Task ID must be a valid UUID' }),
  }),
  state: TaskStateSchema,
  dependencies: z
    .array(z.string().uuid())
    .min(0)
    .max(100, {
      errorMap: () => ({
        message: 'A task cannot have more than 100 dependencies',
      }),
    }),
  retryCount: z
    .number()
    .int()
    .min(0)
    .max(10, {
      errorMap: () => ({ message: 'Retry count cannot exceed 10' }),
    }),
});
```

### 2.3 Zod Error Handling and Reporting

#### Basic Error Handling

```typescript
function validateTask(data: unknown): Task | null {
  const result = TaskSchema.safeParse(data);

  if (!result.success) {
    console.error('Validation errors:');
    for (const error of result.error.errors) {
      console.error(`  - ${error.path.join('.')}: ${error.message}`);
    }
    return null;
  }

  return result.data;
}
```

#### Detailed Error Reporting

```typescript
function formatZodErrors(error: z.ZodError): FormattedError[] {
  return error.errors.map(err => ({
    path: err.path.join('.') || 'root',
    message: err.message,
    code: err.code,
    expected: err.expected,
    received: err.received,
  }));
}

interface FormattedError {
  path: string;
  message: string;
  code: string;
  expected?: any;
  received?: any;
}

function validateWithDetailedReporting(data: unknown): ValidationResult {
  const result = TaskSchema.safeParse(data);

  if (!result.success) {
    return {
      valid: false,
      errors: formatZodErrors(result.error),
      summary: generateErrorSummary(result.error),
    };
  }

  return {
    valid: true,
    data: result.data,
  };
}

function generateErrorSummary(error: z.ZodError): string {
  const errorCount = error.errors.length;
  const paths = [...new Set(error.errors.map(e => e.path.join('.')))];

  return `Validation failed with ${errorCount} error(s) in ${paths.length} field(s): ${paths.join(', ')}`;
}
```

#### Error Aggregation for Multiple Tasks

```typescript
function validateTaskBatch(tasks: unknown[]): BatchValidationResult {
  const errors: Map<number, z.ZodError> = new Map();
  const validTasks: Task[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const result = TaskSchema.safeParse(tasks[i]);

    if (!result.success) {
      errors.set(i, result.error);
    } else {
      validTasks.push(result.data);
    }
  }

  return {
    valid: errors.size === 0,
    validTasks,
    invalidIndices: Array.from(errors.keys()),
    errors: Object.fromEntries(errors),
  };
}
```

### 2.4 Zod Best Practices

1. **Use `.passthrough()` for flexibility**

   ```typescript
   const FlexibleTaskSchema = TaskSchema.passthrough();
   // Allows additional properties without error
   ```

2. **Use `.strict()` for validation**

   ```typescript
   const StrictTaskSchema = TaskSchema.strict();
   // Rejects additional properties
   ```

3. **Reuse schemas with composition**

   ```typescript
   const BaseSchema = z.object({
     id: z.string().uuid(),
     createdAt: z.string().datetime(),
   });

   const TaskSchema = BaseSchema.extend({
     state: TaskStateSchema,
   });
   ```

4. **Extract types for TypeScript**

   ```typescript
   type TaskInput = z.input<typeof TaskSchema>;
   type TaskOutput = z.output<typeof TaskSchema>;
   ```

---

## 3. Backup/Repair Patterns

### 3.1 JSON File Backup Strategies

#### Strategy 1: Atomic Write with Temporary File

**The safest approach for writing JSON files:**

```typescript
import { promises as fs } from 'fs';
import { join } from 'path';

async function writeJsonAtomically<T>(
  filePath: string,
  data: T,
  options?: { backup?: boolean }
): Promise<void> {
  const dir = dirname(filePath);
  const basename = basename(filePath, '.json');
  const tmpPath = join(dir, `.${basename}.tmp.${Date.now()}.json`);

  try {
    // Write to temporary file
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');

    // Sync to disk
    await fs.sync(tmpPath);

    // Create backup if requested
    if (options?.backup) {
      await createBackup(filePath);
    }

    // Atomic rename (overwrites target)
    await fs.rename(tmpPath, filePath);

    // Ensure directory entry is flushed
    await fs.sync(dir);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tmpPath);
    } catch {}
    throw error;
  }
}

async function createBackup(filePath: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.backup.${timestamp}`;
    await fs.copyFile(filePath, backupPath);

    // Clean up old backups (keep last 5)
    await cleanupOldBackups(filePath, 5);
  } catch {
    // File doesn't exist yet, no backup needed
  }
}

async function cleanupOldBackups(
  filePath: string,
  keep: number
): Promise<void> {
  const dir = dirname(filePath);
  const basename = basename(filePath);
  const files = await fs.readdir(dir);

  const backups = files
    .filter(f => f.startsWith(`${basename}.backup.`))
    .sort()
    .reverse();

  const toDelete = backups.slice(keep);

  await Promise.all(toDelete.map(f => fs.unlink(join(dir, f))));
}
```

#### Strategy 2: Versioned Backups with Rotation

```typescript
interface BackupConfig {
  maxBackups: number;
  maxAge: number; // milliseconds
  backupDir: string;
}

class BackupManager {
  constructor(private config: BackupConfig) {}

  async createBackup(filePath: string): Promise<string> {
    await this.ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${basename(filePath)}.${timestamp}.json`;
    const backupPath = join(this.config.backupDir, backupName);

    await fs.copyFile(filePath, backupPath);

    await this.rotateBackups(filePath);

    return backupPath;
  }

  async rotateBackups(filePath: string): Promise<void> {
    const backups = await this.getBackupsForFile(filePath);

    // Sort by creation time (newest first)
    backups.sort((a, b) => b.stats.birthtimeMs - a.stats.birthtimeMs);

    // Remove excess backups
    const toDelete = backups.slice(this.config.maxBackups);

    // Remove old backups
    const now = Date.now();
    const tooOld = backups.filter(
      b => now - b.stats.birthtimeMs > this.config.maxAge
    );

    const filesToDelete = new Set([...toDelete, ...tooOld]);

    await Promise.all(Array.from(filesToDelete).map(b => fs.unlink(b.path)));
  }

  async restoreLatest(filePath: string): Promise<boolean> {
    const backups = await this.getBackupsForFile(filePath);

    if (backups.length === 0) return false;

    // Get most recent backup
    const latest = backups.sort(
      (a, b) => b.stats.birthtimeMs - a.stats.birthtimeMs
    )[0];

    await fs.copyFile(latest.path, filePath);
    return true;
  }

  private async getBackupsForFile(
    filePath: string
  ): Promise<Array<{ path: string; stats: import('fs').Stats }>> {
    const files = await fs.readdir(this.config.backupDir);
    const prefix = basename(filePath);

    const backups: Array<{ path: string; stats: import('fs').Stats }> = [];

    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.json')) {
        const fullPath = join(this.config.backupDir, file);
        const stats = await fs.stat(fullPath);
        backups.push({ path: fullPath, stats });
      }
    }

    return backups;
  }

  private async ensureBackupDir(): Promise<void> {
    try {
      await fs.mkdir(this.config.backupDir, { recursive: true });
    } catch {}
  }
}
```

#### Strategy 3: Write-Ahead Logging (WAL)

For critical systems, use write-ahead logging:

```typescript
interface WALOperation {
  timestamp: number;
  operation: 'write' | 'delete';
  path: string;
  data?: any;
  checksum: string;
}

class WriteAheadLog {
  private logPath: string;
  private operations: WALOperation[] = [];

  constructor(dataDir: string) {
    this.logPath = join(dataDir, 'wal.json');
  }

  async append(
    operation: Omit<WALOperation, 'timestamp' | 'checksum'>
  ): Promise<void> {
    const op: WALOperation = {
      ...operation,
      timestamp: Date.now(),
      checksum: this.calculateChecksum(operation.data),
    };

    this.operations.push(op);
    await this.persistLog();
  }

  async commit(): Promise<void> {
    // Execute all operations
    for (const op of this.operations) {
      await this.executeOperation(op);
    }

    // Clear log on success
    this.operations = [];
    await this.persistLog();
  }

  async rollback(): Promise<void> {
    // Reverse operations
    for (let i = this.operations.length - 1; i >= 0; i--) {
      await this.reverseOperation(this.operations[i]);
    }

    this.operations = [];
    await this.persistLog();
  }

  async recover(): Promise<void> {
    try {
      const logContent = await fs.readFile(this.logPath, 'utf8');
      const loggedOps = JSON.parse(logContent) as WALOperation[];

      // Verify checksums and replay incomplete operations
      for (const op of loggedOps) {
        if (this.verifyChecksum(op)) {
          await this.executeOperation(op);
        }
      }

      await this.clearLog();
    } catch {
      // No log to recover from
    }
  }

  private calculateChecksum(data: any): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  private verifyChecksum(op: WALOperation): boolean {
    const calculated = this.calculateChecksum(op.data);
    return calculated === op.checksum;
  }

  private async executeOperation(op: WALOperation): Promise<void> {
    if (op.operation === 'write') {
      await fs.writeFile(op.path, JSON.stringify(op.data, null, 2));
    } else if (op.operation === 'delete') {
      await fs.unlink(op.path);
    }
  }

  private async reverseOperation(op: WALOperation): Promise<void> {
    // Implementation depends on your needs
  }

  private async persistLog(): Promise<void> {
    await fs.writeFile(this.logPath, JSON.stringify(this.operations, null, 2));
  }

  private async clearLog(): Promise<void> {
    await fs.unlink(this.logPath);
  }
}
```

### 3.2 Auto-Repair Patterns for Corrupted JSON

#### Pattern 1: Graceful Degradation

```typescript
interface RepairResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
  repairs: string[];
}

function repairJson<T>(
  content: string,
  schema: z.ZodSchema<T>
): RepairResult<T> {
  const repairs: string[] = [];
  const errors: string[] = [];

  try {
    // Try parsing as-is
    const data = JSON.parse(content);
    const result = schema.safeParse(data);

    if (result.success) {
      return {
        success: true,
        data: result.data,
        errors: [],
        repairs: [],
      };
    }

    // Attempt repairs
    let repairedData = data;

    for (const issue of result.error.issues) {
      const repair = attemptRepair(repairedData, issue);
      if (repair.repaired) {
        repairedData = repair.data;
        repairs.push(`Repaired ${issue.path.join('.')}: ${repair.message}`);
      } else {
        errors.push(`Cannot repair ${issue.path.join('.')}: ${issue.message}`);
      }
    }

    // Validate repaired data
    const finalResult = schema.safeParse(repairedData);
    if (finalResult.success) {
      return {
        success: true,
        data: finalResult.data,
        errors,
        repairs,
      };
    }

    return {
      success: false,
      errors: [...errors, 'Repaired data still invalid'],
      repairs,
    };
  } catch (parseError) {
    // JSON syntax error - attempt fixing
    return attemptJsonSyntaxRepair(content, schema);
  }
}

function attemptRepair(
  data: any,
  issue: z.ZodIssue
): { repaired: boolean; data: any; message: string } {
  const path = issue.path.join('.');

  // Repair missing required fields
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    if (path.includes('createdAt') || path.includes('updatedAt')) {
      return {
        repaired: true,
        data: setNestedValue(data, issue.path, new Date().toISOString()),
        message: 'Added missing timestamp',
      };
    }

    if (path.includes('state')) {
      return {
        repaired: true,
        data: setNestedValue(data, issue.path, 'pending'),
        message: 'Added missing state (default: pending)',
      };
    }

    if (path.includes('dependencies')) {
      return {
        repaired: true,
        data: setNestedValue(data, issue.path, []),
        message: 'Added missing dependencies array',
      };
    }

    if (path.includes('retryCount')) {
      return {
        repaired: true,
        data: setNestedValue(data, issue.path, 0),
        message: 'Added missing retryCount (default: 0)',
      };
    }
  }

  // Repair invalid enum values
  if (issue.code === 'invalid_enum_value') {
    // Try to find close match or default
    const validValues = (issue as any).options;
    return {
      repaired: true,
      data: setNestedValue(data, issue.path, validValues[0]),
      message: `Replaced invalid enum with '${validValues[0]}'`,
    };
  }

  // Repair type mismatches
  if (issue.code === 'invalid_type') {
    if (issue.expected === 'string' && typeof issue.received === 'number') {
      return {
        repaired: true,
        data: setNestedValue(
          data,
          issue.path,
          String(getNestedValue(data, issue.path))
        ),
        message: 'Converted number to string',
      };
    }

    if (issue.expected === 'number' && typeof issue.received === 'string') {
      const num = Number(getNestedValue(data, issue.path));
      if (!isNaN(num)) {
        return {
          repaired: true,
          data: setNestedValue(data, issue.path, num),
          message: 'Converted string to number',
        };
      }
    }
  }

  return {
    repaired: false,
    data,
    message: 'No repair available',
  };
}

function setNestedValue(obj: any, path: (string | number)[], value: any): any {
  if (path.length === 0) return value;

  const [key, ...rest] = path;
  if (typeof key === 'number') {
    if (!Array.isArray(obj)) obj = [];
    obj[key] = setNestedValue(obj[key], rest, value);
  } else {
    if (typeof obj !== 'object' || obj === null) obj = {};
    obj[key] = setNestedValue(obj[key], rest, value);
  }

  return obj;
}

function getNestedValue(obj: any, path: (string | number)[]): any {
  return path.reduce((current, key) => current?.[key], obj);
}
```

#### Pattern 2: JSON Syntax Repair

```typescript
function attemptJsonSyntaxRepair<T>(
  content: string,
  schema: z.ZodSchema<T>
): RepairResult<T> {
  const repairs: string[] = [];
  const errors: string[] = [];

  // Common JSON syntax fixes
  let fixed = content;

  // Fix trailing commas
  if (/,[\s]*[\]}]/.test(fixed)) {
    fixed = fixed.replace(/,([\s]*[\]}])/g, '$1');
    repairs.push('Removed trailing commas');
  }

  // Fix single quotes
  if (/'[^']*'/.test(fixed)) {
    fixed = fixed.replace(/'/g, '"');
    repairs.push('Converted single quotes to double quotes');
  }

  // Fix unquoted keys
  fixed = fixed.replace(
    /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g,
    '$1"$2"$3'
  );
  if (fixed !== content) {
    repairs.push('Added quotes to unquoted keys');
  }

  // Fix comments
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

  // Try parsing again
  try {
    const data = JSON.parse(fixed);
    const result = schema.safeParse(data);

    if (result.success) {
      return {
        success: true,
        data: result.data,
        errors: [],
        repairs,
      };
    }

    return {
      success: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      repairs,
    };
  } catch {
    errors.push('Cannot repair JSON syntax errors');
    return {
      success: false,
      errors,
      repairs,
    };
  }
}
```

#### Pattern 3: Schema Migration

```typescript
interface Migration<T, U> {
  version: number;
  description: string;
  migrate: (data: T) => U;
}

class SchemaMigrator {
  private migrations: Map<number, Migration<any, any>> = new Map();

  registerMigration<T, U>(migration: Migration<T, U>): void {
    this.migrations.set(migration.version, migration);
  }

  migrate<T>(data: any, currentVersion: number, targetVersion: number): T {
    let result = data;

    for (let v = currentVersion; v < targetVersion; v++) {
      const migration = this.migrations.get(v + 1);
      if (!migration) {
        throw new Error(`No migration found for version ${v + 1}`);
      }

      result = migration.migrate(result);
    }

    return result as T;
  }
}

// Example usage for task system
const taskMigrator = new SchemaMigrator();

taskMigrator.registerMigration({
  version: 1,
  description: 'Initial version',
  migrate: data => data,
});

taskMigrator.registerMigration({
  version: 2,
  description: 'Add retryCount field',
  migrate: data => ({
    ...data,
    retryCount: data.retryCount ?? 0,
  }),
});

taskMigrator.registerMigration({
  version: 3,
  description: 'Convert state to enum',
  migrate: data => ({
    ...data,
    state: normalizeState(data.state),
  }),
});
```

### 3.3 Common Issues in Task State Management

#### Issue 1: Race Conditions

**Problem**: Concurrent writes to state files can cause data loss.

**Solution**: File locking and atomic writes:

```typescript
import lockfile from 'proper-lockfile';

async function writeWithLock<T>(filePath: string, data: T): Promise<void> {
  const release = await lockfile.lock(filePath);

  try {
    await writeJsonAtomically(filePath, data, { backup: true });
  } finally {
    await release();
  }
}
```

#### Issue 2: State Inconsistency

**Problem**: State files become inconsistent after crashes or partial writes.

**Solution**: Use checksums and validation:

```typescript
interface ChecksummedData<T> {
  data: T;
  checksum: string;
  version: number;
}

async function writeWithChecksum<T>(filePath: string, data: T): Promise<void> {
  const checksum = calculateChecksum(data);
  const wrapper: ChecksummedData<T> = {
    data,
    checksum,
    version: 1,
  };

  await writeJsonAtomically(filePath, wrapper);
}

async function readWithChecksum<T>(
  filePath: string,
  schema: z.ZodSchema<T>
): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const wrapper = JSON.parse(content) as ChecksummedData<T>;

    // Verify checksum
    const calculatedChecksum = calculateChecksum(wrapper.data);
    if (calculatedChecksum !== wrapper.checksum) {
      throw new Error('Checksum mismatch - data corrupted');
    }

    // Validate schema
    const result = schema.safeParse(wrapper.data);
    if (!result.success) {
      throw new Error('Schema validation failed');
    }

    return result.data;
  } catch {
    return null;
  }
}
```

#### Issue 3: Orphaned Tasks

**Problem**: Tasks reference non-existent dependencies.

**Solution**: Periodic cleanup and validation:

```typescript
async function cleanupOrphanedTasks(
  taskStore: TaskStore
): Promise<CleanupReport> {
  const tasks = await taskStore.getAll();
  const validIds = new Set(tasks.map(t => t.id));

  const orphans: Task[] = [];
  const repaired: Task[] = [];

  for (const task of tasks) {
    const validDeps = task.dependencies.filter(d => validIds.has(d));

    if (validDeps.length !== task.dependencies.length) {
      if (validDeps.length === 0) {
        orphans.push(task);
      } else {
        // Repair by removing invalid dependencies
        const repairedTask = { ...task, dependencies: validDeps };
        await taskStore.update(repairedTask);
        repaired.push(repairedTask);
      }
    }
  }

  // Optionally delete orphans or mark them as failed
  for (const orphan of orphans) {
    await taskStore.update({
      ...orphan,
      state: 'failed',
      metadata: {
        ...orphan.metadata,
        failureReason: 'Orphaned task - all dependencies invalid',
      },
    });
  }

  return {
    orphansRemoved: orphans.length,
    tasksRepaired: repaired.length,
  };
}
```

---

## 4. Implementation Recommendations

### 4.1 Validation Layer Architecture

```text
┌─────────────────────────────────────────┐
│         Application Layer               │
├─────────────────────────────────────────┤
│         Validation Layer                │
│  ┌───────────┐  ┌─────────────────┐   │
│  │ Schema    │  │ Dependency      │   │
│  │ Validator │  │ Graph Validator │   │
│  └───────────┘  └─────────────────┘   │
├─────────────────────────────────────────┤
│         Persistence Layer               │
│  ┌───────────┐  ┌─────────────────┐   │
│  │ Atomic    │  │ Backup Manager  │   │
│  │ Writer    │  │                 │   │
│  └───────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
```

### 4.2 Recommended Workflow

1. **On Task Creation**:
   - Validate schema with Zod
   - Check for circular dependencies
   - Validate all dependencies exist
   - Write atomically with backup

2. **On State Update**:
   - Validate state transition
   - Update timestamp
   - Write atomically with backup
   - Remove old backups

3. **On Startup/Recovery**:
   - Validate all tasks against schema
   - Detect and repair orphaned dependencies
   - Detect circular dependencies
   - Attempt recovery from backups if corrupted

4. **Periodic Maintenance**:
   - Run cleanup for orphaned tasks
   - Remove old backups
   - Validate data integrity

### 4.3 Monitoring and Alerting

```typescript
interface ValidationMetrics {
  totalTasks: number;
  validTasks: number;
  invalidTasks: number;
  orphanedTasks: number;
  circularDependencies: number;
  lastValidationTime: Date;
}

async function runHealthCheck(
  taskStore: TaskStore
): Promise<ValidationMetrics> {
  const tasks = await taskStore.getAll();

  // Schema validation
  const schemaResults = await Promise.all(
    tasks.map(t => TaskSchema.safeParseAsync(t))
  );
  const validTasks = schemaResults.filter(r => r.success).length;

  // Dependency validation
  const orphaned = detectOrphanedDependencies(tasks);
  const circular = detectCyclicDependencies(tasks);

  const metrics: ValidationMetrics = {
    totalTasks: tasks.length,
    validTasks,
    invalidTasks: tasks.length - validTasks,
    orphanedTasks: orphaned.count,
    circularDependencies: circular ? 1 : 0,
    lastValidationTime: new Date(),
  };

  // Alert if issues detected
  if (
    metrics.invalidTasks > 0 ||
    metrics.orphanedTasks > 0 ||
    metrics.circularDependencies > 0
  ) {
    await sendAlert({
      level: 'warning',
      message: 'Task store validation issues detected',
      metrics,
    });
  }

  return metrics;
}
```

---

## 5. Reference URLs

### Official Documentation

**Zod Validation**

- Official Docs: <https://zod.dev/>
- GitHub Repository: <https://github.com/colinhacks/zod>
- Error Handling: <https://zod.dev/?id=error-handling>
- Custom Validators: <https://zod.dev/?id=refine>
- Advanced Patterns: <https://zod.dev/?id=advanced>

**JSON Schema**

- Official Specification: <https://json-schema.org/>
- Understanding JSON Schema: <https://json-schema.org/understanding-json-schema/>
- Validation Best Practices: <https://json-schema.org/learn/>

**Node.js File System**

- fs.promises API: <https://nodejs.org/api/fs.html#fspromises-api>
- Atomic Writes: <https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback>

### Algorithms and Data Structures

**Graph Algorithms**

- Topological Sorting (Kahn's Algorithm): <https://en.wikipedia.org/wiki/Topological_sorting>
- DFS-based Cycle Detection: <https://en.wikipedia.org/wiki/Cycle_(graph_theory)#Cycle_detection>
- Directed Acyclic Graphs: <https://en.wikipedia.org/wiki/Directed_acyclic_graph>

**Dependency Management**

- Dependency Resolution Algorithms: <https://en.wikipedia.org/wiki/Dependency_resolution>
- Package Manager Algorithms: <https://github.com/npm/npm/blob/latest/lib/install/deps.js>

### Community Resources

**StackOverflow - Circular Dependency Detection**

- DFS Cycle Detection in JavaScript: <https://stackoverflow.com/questions/14982352/>
- Detecting Cycles in Directed Graph: <https://stackoverflow.com/questions/10825449/>
- Topological Sort Implementation: <https://stackoverflow.com/questions/11192816/>

**GitHub Repositories - Validation Patterns**

**TypeScript/Node.js**

- <https://github.com/colinhacks/zod> (Zod validation library)
- <https://github.com/ajv-validator/ajv> (JSON Schema validator)
- <https://github.com/sindresorhus/ow> (Argument validation)
- <https://github.com/jquense/yup> (Schema validation)

**Task/State Management**

- <https://github.com/facebook/draft-js> (Rich text editor with state management)
- <https://github.com/reduxjs/redux> (Predictable state container)
- <https://github.com/ag-grid/ag-grid> (Data grid with complex state)

**Best Practice Articles**

**General Validation**

- <https://kentcdodds.com/blog/how-to-write-validations-in-your-code>
- <https://www.builder.io/blog/zod-safe-type-validation-in-typescript>
- <https://blog.logrocket.com/zod-typescript-schema-validation/>

**File System Operations**

- <https://nodejs.org/en/knowledge/file-system/security/>
- <https://blog.heroku.com/better-file-writes-with-node>
- <https://www.kernel.org/doc/html/latest/filesystems/>

**Error Handling**

- <https://www.joyent.com/node-js/production/design/errors>
- <https://martinfowler.com/articles/replaceThrowWithNotification.html>
- <https://medium.com/@benastontweet/typescript-error-handling-4841b37f7526>

### Testing Resources

**Validation Testing**

- <https://vitest.dev/guide/assertion.html> (Vitest assertions)
- <https://jestjs.io/docs/expect> (Jest matchers)
- <https://testing-library.com/docs/> (Testing library principles)

**Property-Based Testing**

- <https://github.com/dubzzz/fast-check> (Property-based testing for JS/TS)
- <https://prop-testing.com/> (Property-based testing guide)

### Additional Reading

**State Machine Design**

- <https://statecharts.dev/> (Statecharts and state machines)
- <https://github.com/statelyai/xstate> (State machine library)
- <https://www.patternsforcloud.org/state-management> (Cloud patterns)

**Data Integrity**

- <https://www.postgresql.org/docs/current/ddl-constraints.html> (Database constraints)
- <https://www.sqlite.org/lockingv3.html> (File locking in SQLite)
- <https://en.wikipedia.org/wiki/ACID> (Database transactions)

---

## Summary

This research document provides comprehensive coverage of:

1. **State Validation Patterns**: JSON schema design, dependency graph validation, circular dependency detection algorithms (DFS and topological sort), and orphaned dependency detection.

2. **Zod Validation**: Complex nested structure validation, custom validators using `.refine()`, error handling patterns, and best practices for TypeScript-first validation.

3. **Backup/Repair Patterns**: Atomic write strategies, versioned backups, write-ahead logging, JSON syntax repair, schema migration, and solutions for common state management issues.

All algorithms include TypeScript implementations ready for adaptation to your task management system. The reference URLs provide official documentation, community resources, and best practices for further reading.

**Key Takeaways**:

- Use Zod for runtime type validation with excellent TypeScript integration
- Implement DFS-based cycle detection for O(V + E) performance
- Always use atomic writes with temporary files for state persistence
- Maintain versioned backups with automatic rotation
- Implement periodic health checks and validation
- Use file locking for concurrent write scenarios
