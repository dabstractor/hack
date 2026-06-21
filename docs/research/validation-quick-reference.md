# State Validation and Repair - Quick Reference Guide

> **Last Updated**: 2026-01-24
> **Related Research**: `/home/dustin/projects/hacky-hack/docs/research/state-validation-and-repair-patterns.md`

---

## Essential URLs for PRP Implementation

### Zod Validation

**Official Documentation**

- **Zod Homepage**: <https://zod.dev/>
  - Main documentation with all features and examples
- **GitHub Repository**: <https://github.com/colinhacks/zod>
  - Source code, issues, and contribution guidelines
- **Error Handling Guide**: <https://zod.dev/?id=error-handling>
  - How to handle and format validation errors
- **Custom Validators**: <https://zod.dev/?id=refine>
  - Building custom validation logic with `.refine()`
- **Advanced Patterns**: <https://zod.dev/?id=advanced>
  - Recursive types, transforms, and complex schemas

**Key Articles**

- <https://www.builder.io/blog/zod-safe-type-validation-in-typescript>
- <https://blog.logrocket.com/zod-typescript-schema-validation/>
- <https://kentcdodds.com/blog/how-to-write-validations-in-your-code>

### JSON Schema Validation

**Official Resources**

- **JSON Schema Specification**: <https://json-schema.org/>
- **Understanding JSON Schema**: <https://json-schema.org/understanding-json-schema/>
  - Learn JSON Schema from basics to advanced
- **Validation Best Practices**: <https://json-schema.org/learn/>

**Tools**

- **Ajv Validator**: <https://github.com/ajv-validator/ajv>
  - Fast JSON Schema validator for JavaScript
- **json-schema-to-ts**: <https://github.com/ThomasAribart/json-schema-to-ts>
  - Convert JSON Schema to TypeScript types

### Graph Algorithms for Dependencies

**Algorithm References**

- **Topological Sorting**: <https://en.wikipedia.org/wiki/Topological_sorting>
  - Khan's algorithm for DAG validation
- **DFS Cycle Detection**: <https://en.wikipedia.org/wiki/Cycle_(graph_theory)#Cycle_detection>
  - Three-color marking algorithm
- **Directed Acyclic Graphs**: <https://en.wikipedia.org/wiki/Directed_acyclic_graph>
  - DAG properties and algorithms

**StackOverflow Discussions**

- Detect cycles in directed graph:
  - <https://stackoverflow.com/questions/10825449/detecting-cycles-in-directed-graph>
- DFS cycle detection in JavaScript:
  - <https://stackoverflow.com/questions/14982352/>
- Topological sort implementation:
  - <https://stackoverflow.com/questions/11192816/>

### File System and Data Integrity

**Node.js Documentation**

- **fs.promises API**: <https://nodejs.org/api/fs.html#fspromises-api>
  - Async file system operations
- **Atomic Rename**: <https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback>
  - Atomic file replacement for safe writes
- **File Locking**: <https://nodejs.org/api/fs.html#class-fs> Promises
  - Managing concurrent file access

**Best Practices**

- **Atomic Writes Guide**: <https://blog.heroku.com/better-file-writes-with-node>
- **Node.js Security**: <https://nodejs.org/en/knowledge/file-system/security/>
- **File System Patterns**: <https://www.kernel.org/doc/html/latest/filesystems/>

**File Locking Libraries**

- **proper-lockfile**: <https://github.com/moxystudio/node-proper-lockfile>
  - Cross-platform file locking
- **lockfile**: <https://github.com/npm/lockfile>
  - Simple lockfile implementation

### State Management Patterns

**State Machine Design**

- **Statecharts**: <https://statecharts.dev/>
  - Hierarchical state machines
- **XState Library**: <https://github.com/statelyai/xstate>
  - State machine library with great TypeScript support
- **State Management Patterns**: <https://www.patternsforcloud.org/state-management>

**Task/Workflow Systems**

- **Redux State Management**: <https://github.com/reduxjs/redux>
  - Predictable state container patterns
- **Workflow Engines**: <https://github.com/temporalio/sdk-typescript>
  - Durable execution for workflows

---

## Implementation Checklist

### Phase 1: Schema Validation with Zod

- [ ] Define Zod schemas for all task types
- [ ] Add custom validators for state transitions
- [ ] Implement dependency validation
- [ ] Add circular dependency detection
- [ ] Create error formatting utilities

### Phase 2: Backup and Repair

- [ ] Implement atomic file writes
- [ ] Add versioned backup system
- [ ] Create JSON repair utilities
- [ ] Implement checksums for integrity
- [ ] Add recovery procedures

### Phase 3: Dependency Management

- [ ] Build adjacency list for dependencies
- [ ] Implement DFS cycle detection
- [ ] Add topological sort validation
- [ ] Create orphan detection
- [ ] Build dependency resolution

### Phase 4: Monitoring

- [ ] Add health check endpoints
- [ ] Implement metrics collection
- [ ] Create validation reports
- [ ] Set up alerting for failures
- [ ] Add audit logging

---

## Quick Code Snippets

### Zod Schema Definition

```typescript
import { z } from 'zod';

const StatusEnum = z.enum([
  'Planned',
  'Researching',
  'Implementing',
  'Retrying',
  'Complete',
  'Failed',
  'Obsolete',
]);

const SubtaskSchema = z.object({
  id: z.string().min(1),
  type: z.literal('Subtask'),
  title: z.string().min(1),
  status: StatusEnum,
  dependencies: z.array(z.string()).default([]),
  context_scope: ContextScopeSchema,
});
```

### Circular Dependency Detection

```typescript
function detectCycles(tasks: Subtask[]): boolean {
  const graph = new Map<string, string[]>();
  const colors = new Map<string, 'white' | 'gray' | 'black'>();

  // Build adjacency list
  for (const task of tasks) {
    graph.set(task.id, task.dependencies);
    colors.set(task.id, 'white');
  }

  // DFS for cycle detection
  function dfs(nodeId: string): boolean {
    colors.set(nodeId, 'gray');

    for (const neighbor of graph.get(nodeId) || []) {
      const color = colors.get(neighbor);

      if (color === 'gray') {
        return true; // Cycle found
      }

      if (color === 'white' && dfs(neighbor)) {
        return true;
      }
    }

    colors.set(nodeId, 'black');
    return false;
  }

  for (const [nodeId] of graph) {
    if (colors.get(nodeId) === 'white') {
      if (dfs(nodeId)) return true;
    }
  }

  return false;
}
```

### Atomic Write with Backup

```typescript
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';

async function writeJsonAtomically<T>(
  filePath: string,
  data: T
): Promise<void> {
  const dir = dirname(filePath);
  const name = basename(filePath, '.json');
  const tmpPath = join(dir, `.${name}.tmp.${Date.now()}.json`);

  try {
    // Write to temp file
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));

    // Sync to disk
    await fs.sync(tmpPath);

    // Create backup
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(filePath, `${filePath}.backup.${timestamp}`);
    } catch {
      // File might not exist yet
    }

    // Atomic rename
    await fs.rename(tmpPath, filePath);
    await fs.sync(dir);
  } catch (error) {
    // Cleanup temp file
    try {
      await fs.unlink(tmpPath);
    } catch {}
    throw error;
  }
}
```

---

## Current Codebase Integration

### Existing Task Types

From `/home/dustin/projects/hacky-hack/src/core/models.ts`:

```typescript
type Status =
  | 'Planned'
  | 'Researching'
  | 'Implementing'
  | 'Retrying'
  | 'Complete'
  | 'Failed'
  | 'Obsolete';

type ItemType = 'Phase' | 'Milestone' | 'Task' | 'Subtask';

interface Subtask {
  readonly id: string;
  readonly type: 'Subtask';
  readonly title: string;
  readonly status: Status;
  readonly dependencies: readonly string[];
  readonly context_scope: string;
}
```

### Existing Validation

From `/home/dustin/projects/hacky-hack/src/core/models.ts`:

```typescript
export const ContextScopeSchema: z.ZodType<string> = z
  .string()
  .min(1, 'Context scope is required')
  .superRefine((value, ctx) => {
    // Custom validation logic
  });
```

### Existing Dependency Resolution

From `/home/dustin/projects/hacky-hack/src/utils/task-utils.ts`:

```typescript
export function getDependencies(task: Subtask, backlog: Backlog): Subtask[] {
  const results: Subtask[] = [];

  for (const depId of task.dependencies) {
    const item = findItem(backlog, depId);
    if (item && isSubtask(item)) {
      results.push(item);
    }
  }

  return results;
}
```

### Existing Dependency Checking

From `/home/dustin/projects/hacky-hack/src/core/task-orchestrator.ts`:

```typescript
public canExecute(subtask: Subtask): boolean {
  const dependencies = getDependencies(subtask, this.#backlog);

  if (dependencies.length === 0) {
    return true;
  }

  const allComplete = dependencies.every(dep => dep.status === 'Complete');

  return allComplete;
}

public getBlockingDependencies(subtask: Subtask): Subtask[] {
  const dependencies = getDependencies(subtask, this.#backlog);
  const blocking = dependencies.filter(dep => dep.status !== 'Complete');
  return blocking;
}
```

---

## Recommended Next Steps

1. **Add Zod Validation Layer**
   - Create schemas for all task types
   - Add validation before state changes
   - Implement custom validators for dependencies

2. **Implement Circular Dependency Detection**
   - Add DFS-based cycle detection
   - Validate on backlog creation
   - Prevent invalid states

3. **Add Atomic Write Protection**
   - Implement temp file + rename pattern
   - Add backup rotation
   - Create recovery procedures

4. **Create Health Check System**
   - Validate all tasks on startup
   - Detect orphaned dependencies
   - Generate validation reports

---

## Testing Resources

**Property-Based Testing**

- **fast-check**: <https://github.com/dubzzz/fast-check>
  - Generate test cases automatically
- **Property Testing Guide**: <https://prop-testing.com/>

**Validation Testing**

- **Vitest Assertions**: <https://vitest.dev/guide/assertion.html>
- **Testing Library**: <https://testing-library.com/docs/>

---

## Additional Reading

**Error Handling**

- <https://martinfowler.com/articles/replaceThrowWithNotification.html>
- <https://www.joyent.com/node-js/production/design/errors>

**Data Integrity**

- <https://www.postgresql.org/docs/current/ddl-constraints.html>
- <https://en.wikipedia.org/wiki/ACID>

**Type Safety**

- <https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html>
- <https://effect.website/docs/guides/validation/>

---

## Summary

This quick reference provides essential URLs and code snippets for implementing:

1. **Zod validation** for runtime type safety
2. **Circular dependency detection** using DFS
3. **Atomic file writes** for data integrity
4. **Backup and repair** strategies for resilience

For detailed implementation guidance, see the full research document:
`/home/dustin/projects/hacky-hack/docs/research/state-validation-and-repair-patterns.md`
