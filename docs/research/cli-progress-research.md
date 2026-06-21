# cli-progress Library Research Report

## 1. Official Documentation

**NPM Package**: <https://www.npmjs.com/package/cli-progress>
**GitHub Repository**: <https://github.com/npkgz/cli-progress>
**TypeScript Definitions**: <https://www.npmjs.com/package/@types/cli-progress>
**Latest Version**: 3.12.0 (Released: February 19, 2023)
**License**: MIT

### Documentation Sections

- Single Bar Mode: <https://github.com/npkgz/cli-progress#single-bar-mode>
- Multi Bar Mode: <https://github.com/npkgz/cli-progress#multi-bar-mode>
- Options: <https://github.com/npkgz/cli-progress#options-1>
- Examples: <https://github.com/npkgz/cli-progress/tree/master/examples>
- Events: <https://github.com/npkgz/cli-progress/blob/master/docs/events.md>
- Presets: <https://github.com/npkgz/cli-progress/tree/master/presets>

---

## 2. Installation

### NPM

```bash
npm install cli-progress --save
```

### Yarn

```bash
yarn add cli-progress
```

### TypeScript Definitions

```bash
# Install the library
npm install cli-progress

# Install TypeScript definitions (separate package)
npm install @types/cli-progress --save-dev
```

---

## 3. TypeScript Types

### Main Classes and Interfaces

#### `SingleBar`

```typescript
class SingleBar extends GenericBar {
  constructor(opt: Options, preset?: Preset);
  render(): void;
  update(current: number, payload?: object): void;
  update(payload: object): void;
  start(total: number, startValue: number, payload?: object): void;
  stop(): void;
}
```

#### `MultiBar`

```typescript
class MultiBar extends EventEmitter {
  constructor(opt: Options, preset?: Preset);
  isActive: boolean;
  create(
    total: number,
    startValue: number,
    payload?: any,
    barOptions?: Options
  ): SingleBar;
  remove(bar: SingleBar): boolean;
  update(): void;
  stop(): void;
  log(data: string): void;
}
```

#### `GenericBar` (Base Class)

```typescript
class GenericBar extends EventEmitter {
  isActive: boolean;
  render(forceRendering?: boolean): void;
  start(total: number, startValue: number, payload?: object): void;
  stop(): void;
  update(current: number, payload?: object): void;
  update(payload: object): void;
  getProgress(): number;
  increment(step?: number, payload?: object): void;
  increment(payload: object): void;
  getTotal(): number;
  setTotal(total: number): void;
  updateETA(): void;
}
```

#### `Options` Interface

```typescript
interface Options {
  format?: string | GenericFormatter;
  formatBar?: BarFormatter;
  formatTime?: TimeFormatter;
  formatValue?: ValueFormatter;
  fps?: number;
  stream?: NodeJS.WritableStream;
  stopOnComplete?: boolean;
  clearOnComplete?: boolean;
  barsize?: number;
  align?: 'left' | 'right' | 'center';
  barCompleteChar?: string;
  barIncompleteChar?: string;
  hideCursor?: boolean | null;
  barGlue?: string;
  etaBuffer?: number;
  etaAsynchronousUpdate?: boolean;
  progressCalculationRelative?: boolean;
  linewrap?: boolean | null;
  synchronousUpdate?: boolean;
  noTTYOutput?: boolean;
  notTTYSchedule?: number;
  emptyOnZero?: boolean;
  forceRedraw?: boolean;
  autopadding?: boolean;
  autopaddingChar?: string;
  gracefulExit?: boolean;
}
```

#### `Params` Interface (for formatters)

```typescript
interface Params {
  progress: number;
  eta: number;
  startTime: number;
  stopTime: number | null;
  total: number;
  value: number;
  maxWidth: number;
}
```

#### `Preset` Interface

```typescript
interface Preset {
  barCompleteChar: string;
  barIncompleteChar: string;
  format: string;
}
```

#### Custom Formatters

```typescript
type GenericFormatter = (
  options: Options,
  params: Params,
  payload: any
) => string;
type BarFormatter = (progress: number, options: Options) => string;
type TimeFormatter = (
  t: number,
  options: Options,
  roundToMultipleOf: number
) => string;
type ValueFormatter = (v: number, options: Options, type: ValueType) => string;
type ValueType = 'percentage' | 'total' | 'value' | 'eta' | 'duration';
```

---

## 4. Key APIs

### Single Bar Progress

#### Basic Usage

```typescript
import cliProgress from 'cli-progress';

// Create instance
const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

// Start: total value, start value, optional payload
bar.start(200, 0);

// Update to specific value
bar.update(100);

// Increment by 1 (or custom amount)
bar.increment();
bar.increment(5);

// Update with custom payload
bar.update(50, { speed: '125 kbit' });

// Stop the bar
bar.stop();
```

#### Options Reference

```typescript
const options = {
  // Format string with placeholders
  format: 'progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}',

  // Bar appearance
  barsize: 40,
  barCompleteChar: '=',
  barIncompleteChar: '-',
  barGlue: '',

  // Update rate
  fps: 10, // Maximum updates per second
  synchronousUpdate: true, // Trigger redraw on update if threshold exceeded

  // Completion behavior
  stopOnComplete: false, // Auto-stop when value reaches total
  clearOnComplete: false, // Clear bar on complete

  // Output
  stream: process.stderr, // Output stream
  hideCursor: false, // Hide cursor during progress
  linewrap: false, // Disable line wrapping
  align: 'left', // 'left' | 'right' | 'center'

  // ETA calculation
  etaBuffer: 10, // Number of updates for ETA calculation
  etaAsynchronousUpdate: false, // Async ETA for long-running processes

  // Progress calculation
  progressCalculationRelative: false, // Use startValue as offset
  emptyOnZero: false, // Display total:0 as empty, not full

  // Non-TTY mode
  noTTYOutput: false, // Enable output to non-TTY streams (files)
  notTTYSchedule: 2000, // Non-TTY output interval in ms

  // Other
  forceRedraw: false, // Redraw every frame even if progress unchanged
  autopadding: false, // Add padding to enforce fixed width
  gracefulExit: true, // Restore cursor on SIGINT/SIGTERM
};
```

### Multi Bar Progress

#### Basic Usage

```typescript
import cliProgress from 'cli-progress';

// Create multi-bar container
const multiBar = new cliProgress.MultiBar(
  {
    clearOnComplete: false,
    hideCursor: true,
    format: ' {bar} | {filename} | {value}/{total}',
  },
  cliProgress.Presets.shades_grey
);

// Add bars - returns SingleBar instances
const bar1 = multiBar.create(200, 0);
const bar2 = multiBar.create(1000, 0, { filename: 'test1.txt' });
const bar3 = multiBar.create(500, 0, { filename: 'test2.txt' });

// Update individual bars
bar1.increment();
bar2.update(20, { filename: 'updated.txt' });

// Remove a specific bar
multiBar.remove(bar3);

// Log output during multi-bar operation (newline required!)
multiBar.log('Processing file...\n');

// Stop all bars
multiBar.stop();
```

#### Multi-Bar with Custom Options per Bar

```typescript
const multiBar = new cliProgress.MultiBar({
  format: ' {bar} | {name} | {value}/{total}',
  hideCursor: true,
});

// Create bar with custom options override
const bar1 = multiBar.create(
  100,
  0,
  { name: 'Task 1' },
  {
    format: ' {bar} | {name} | {value}/{total} | Custom',
    barCompleteChar: '#',
  }
);
```

### Custom Formatting

#### Built-in Format Placeholders

```typescript
// Available placeholders:
// {bar}           - Progress bar itself
// {percentage}    - Current progress percentage (0-100)
// {total}         - End value
// {value}         - Current value
// {eta}           - ETA in seconds (limited to 115 days, otherwise INF)
// {duration}      - Elapsed time in seconds
// {eta_formatted} - ETA formatted (e.g., "2h 30m")
// {duration_formatted} - Duration formatted
// {customKey}     - Custom payload values
```

#### Custom Format String

```typescript
const bar = new cliProgress.SingleBar({
  format:
    'CLI Progress |{bar}| {percentage}% || {value}/{total} Chunks || Speed: {speed}',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  hideCursor: true,
});

bar.start(200, 0, { speed: 'N/A' });
bar.update(50, { speed: '125' });
```

#### Custom Formatter Function

```typescript
import colors from 'ansi-colors';

function customFormatter(
  options: cliProgress.Options,
  params: cliProgress.Params,
  payload: any
) {
  const bar = options.barCompleteChar!.repeat(
    Math.round(params.progress * options.barsize!)
  );

  if (params.value >= params.total) {
    return colors.green(
      `# ${payload.task} ${params.value}/${params.total} [${bar}]`
    );
  } else {
    return colors.yellow(
      `# ${payload.task} ${params.value}/${params.total} [${bar}]`
    );
  }
}

const bar = new cliProgress.SingleBar({
  format: customFormatter,
});

bar.start(200, 0, { task: 'Processing' });
```

### Time Remaining Estimation

#### ETA Display

```typescript
const bar = new cliProgress.SingleBar({
  format: ' [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}',
  etaBuffer: 10, // Higher = more stable ETA
});

bar.start(1000, 0);

// Force ETA update for long-running processes
bar.updateETA();
```

#### ETA Options

```typescript
const options = {
  // Number of updates to average for ETA calculation
  etaBuffer: 10,

  // Trigger ETA calculation during async rendering
  // Use for long-running processes with low fps + large etaBuffer
  etaAsynchronousUpdate: true,
};
```

---

## 5. Code Examples

### Example 1: TypeScript Single Bar with async/await

```typescript
import cliProgress from 'cli-progress';

async function processItems(items: any[]) {
  const bar = new cliProgress.SingleBar({
    format: 'Processing |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  bar.start(items.length, 0);

  for (let i = 0; i < items.length; i++) {
    await processItem(items[i]);
    bar.increment();
  }

  bar.stop();
}
```

### Example 2: Multi-Level Progress (Phase/Milestone/Task/Subtask)

```typescript
import cliProgress from 'cli-progress';

interface ProgressHierarchy {
  phases: string[];
  milestones: Map<string, string[]>;
  tasks: Map<string, string[]>;
  subtasks: Map<string, string[]>;
}

async function executeWithProgress(data: ProgressHierarchy) {
  const multiBar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: ' {bar} | {name} | {value}/{total} | {eta_formatted}',
  });

  const phaseBars = new Map<string, cliProgress.SingleBar>();
  const milestoneBars = new Map<string, cliProgress.SingleBar>();

  // Create phase bars
  for (const phase of data.phases) {
    const milestones = data.milestones.get(phase) || [];
    const phaseBar = multiBar.create(milestones.length, 0, {
      name: `Phase: ${phase}`,
      level: 'phase',
    });
    phaseBars.set(phase, phaseBar);

    // Create milestone bars
    for (const milestone of milestones) {
      const tasks = data.tasks.get(milestone) || [];
      const milestoneBar = multiBar.create(
        tasks.length,
        0,
        {
          name: `  Milestone: ${milestone}`,
          level: 'milestone',
        },
        {
          format: ' {bar} | {name} | {value}/{total}',
        }
      );
      milestoneBars.set(milestone, milestoneBar);
    }
  }

  // Execute and update
  for (const phase of data.phases) {
    const milestones = data.milestones.get(phase) || [];
    const phaseBar = phaseBars.get(phase)!;

    for (const milestone of milestones) {
      const tasks = data.tasks.get(milestone) || [];
      const milestoneBar = milestoneBars.get(milestone)!;

      for (const task of tasks) {
        await executeTask(task);
        milestoneBar.increment();
      }

      phaseBar.increment();
    }
  }

  multiBar.stop();
}
```

### Example 3: Multi-Bar with Real-World File Processing

```typescript
import cliProgress from 'cli-progress';
import * as fs from 'fs';

interface DownloadTask {
  filename: string;
  totalBytes: number;
}

async function downloadFiles(files: DownloadTask[]) {
  const multiBar = new cliProgress.MultiBar({
    format: ' {bar} | "{file}" | {value}/{total} | Speed: {speed}',
    hideCursor: true,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    clearOnComplete: false,
    stopOnComplete: false,
  });

  const bars = new Map<string, cliProgress.SingleBar>();

  // Start all downloads
  const downloads = files.map(async file => {
    const bar = multiBar.create(file.totalBytes, 0, {
      file: file.filename,
      speed: '0 KB/s',
    });
    bars.set(file.filename, bar);

    const startTime = Date.now();
    let lastUpdate = startTime;

    // Simulate download with progress
    for (
      let downloaded = 0;
      downloaded <= file.totalBytes;
      downloaded += 1024
    ) {
      await new Promise(resolve => setTimeout(resolve, 10));

      // Calculate speed
      const now = Date.now();
      if (now - lastUpdate > 500) {
        const elapsed = (now - startTime) / 1000;
        const speed = Math.round(downloaded / elapsed / 1024);
        bar.update(downloaded, { speed: `${speed} KB/s` });
        lastUpdate = now;
      } else {
        bar.update(downloaded);
      }
    }

    return file.filename;
  });

  await Promise.all(downloads);

  // Check if all complete
  if (!multiBar.isActive) {
    console.log('\nAll downloads complete!');
  }

  multiBar.stop();
}
```

### Example 4: Progress with Payload Updates

```typescript
import cliProgress from 'cliProgress';

interface BuildProgress {
  files: number;
  errors: number;
  warnings: number;
}

async function buildProject() {
  const bar = new cliProgress.SingleBar({
    format:
      'Building |{bar}| {percentage}% | Files: {files} | Errors: {errors} | Warnings: {warnings}',
    hideCursor: true,
  });

  const totalFiles = 150;
  bar.start(totalFiles, 0, {
    files: 0,
    errors: 0,
    warnings: 0,
  });

  const progress: BuildProgress = {
    files: 0,
    errors: 0,
    warnings: 0,
  };

  for (let i = 0; i < totalFiles; i++) {
    const result = await compileFile(i);
    progress.files++;

    if (result.hasErrors) progress.errors++;
    if (result.hasWarnings) progress.warnings++;

    bar.update(i + 1, progress);
  }

  bar.stop();
}
```

### Example 5: Using Events

```typescript
import cliProgress from 'cli-progress';

const bar = new cliProgress.SingleBar();

// Listen to events
bar.on('start', () => {
  console.log('Progress bar started');
});

bar.on('stop', () => {
  console.log('Progress bar stopped');
});

bar.on('redraw-pre', () => {
  // Before redraw
});

bar.on('redraw-post', () => {
  // After redraw
});

bar.start(100, 0);
// ... updates ...
bar.stop();
```

### Example 6: Custom Presets

```typescript
import cliProgress from 'cli-progress';

// Create custom preset
const customPreset: cliProgress.Preset = {
  format: 'Progress |{bar}| {percentage}%',
  barCompleteChar: '\u25A0',
  barIncompleteChar: '\u25A1',
};

// Use custom preset
const bar = new cliProgress.SingleBar({}, customPreset);
```

---

## 6. Alternatives

### Popular TypeScript Progress Bar Libraries

1. **cli-progress** (this library)
   - 3.12.0 | MIT | Last updated: Feb 2023
   - Pros: Full-featured, multi-bar support, customizable, stable
   - Cons: Not recently updated (but mature and stable)

2. **progress**
   - <https://www.npmjs.com/package/progress>
   - Simple, lightweight alternative
   - Less feature-rich than cli-progress
   - No built-in multi-bar support

3. **cli-progress-footer**
   - Alternative approach with footer-based progress
   - Better for logging during progress

4. **@sounisi5050/cli-progress**
   - Fork with additional features
   - Check for latest updates

5. **ora** (spinners, not progress bars)
   - <https://www.npmjs.com/package/ora>
   - Great for loading spinners
   - No progress bar functionality

6. **listr** (task lists with progress)
   - <https://www.npmjs.com/package/listr>
   - Task list execution with progress indicators
   - Different paradigm but useful for similar use cases

7. **ink-progress** (React-based CLI)
   - For projects using Ink for CLI UIs
   - React component-based

### Recommendation

**Stick with cli-progress** for your use case because:

- Full TypeScript support via @types/cli-progress
- Excellent multi-bar support for hierarchical progress
- Highly customizable formatting
- Mature and stable (maintained since 2015)
- No active development needed for stable feature set
- Good async/await patterns

---

## 7. Best Practices

### 1. Always Stop Bars

```typescript
try {
  bar.start(100, 0);
  // ... work ...
} finally {
  bar.stop();
}
```

### 2. Use gracefulExit in Production

```typescript
const bar = new cliProgress.SingleBar({
  gracefulExit: true, // Restore cursor on SIGINT/SIGTERM
});
```

### 3. Handle Non-TTY Environments

```typescript
const bar = new cliProgress.SingleBar({
  noTTYOutput: true, // Enable for CI/CD
  notTTYSchedule: 2000, // Update interval for files
});
```

### 4. Use Appropriate ETA Buffer

```typescript
// For fast operations (seconds)
const fastBar = new cliProgress.SingleBar({ etaBuffer: 5 });

// For long operations (minutes/hours)
const longBar = new cliProgress.SingleBar({ etaBuffer: 50 });
```

### 5. Multi-Bar Logging

```typescript
// Always include newline in log() calls!
multiBar.log('Processing file...\n');
```

### 6. Dynamic Total Adjustment

```typescript
bar.start(100, 0);
// ... discover more work needed ...
bar.setTotal(150); // Adjust total dynamically
```

### 7. Custom Formatters for Complex UIs

```typescript
// Use custom formatters for conditional formatting
function formatProgress(options, params, payload) {
  if (params.value >= params.total) {
    return colors.green(`Complete: ${payload.name}`);
  }
  return `Working: ${payload.name} ${params.value}/${params.total}`;
}
```

---

## 8. Common Patterns

### Pattern 1: Parallel Processing with Multi-Bar

```typescript
async function parallelProcessing(items: any[]) {
  const multiBar = new cliProgress.MultiBar({ hideCursor: true });
  const bars = items.map(item => multiBar.create(100, 0, { name: item.name }));

  await Promise.all(
    items.map(async (item, index) => {
      const bar = bars[index];
      for (let i = 0; i < 100; i++) {
        await processStep(item);
        bar.increment();
      }
    })
  );

  multiBar.stop();
}
```

### Pattern 2: Nested Progress

```typescript
// Outer bar for overall progress
const outerBar = new cliProgress.SingleBar({ format: 'Overall: {bar}' });

// Inner bars for subtasks
const innerBar = new cliProgress.SingleBar({ format: 'Task: {bar}' });

outerBar.start(totalTasks, 0);
for (const task of tasks) {
  innerBar.start(task.steps, 0);
  // ... process task steps ...
  innerBar.stop();
  outerBar.increment();
}
outerBar.stop();
```

### Pattern 3: Progress with Cancellation

```typescript
let cancelled = false;
process.on('SIGINT', () => {
  cancelled = true;
});

const bar = new cliProgress.SingleBar({ stopOnComplete: true });
bar.start(1000, 0);

for (let i = 0; i < 1000 && !cancelled; i++) {
  await work();
  bar.update(i + 1);
}

if (cancelled) {
  bar.stop();
  console.log('\nCancelled!');
}
```

---

## Summary

**cli-progress** is an excellent choice for TypeScript/Node.js progress bars with:

- Complete TypeScript support via @types/cli-progress
- Rich feature set (single/multi-bar, custom formatting, ETA)
- Mature and stable (8+ years of development)
- Flexible for complex hierarchical progress displays
- Good async/await support
- Active community (DescribedType definitions maintained)

**Installation**:

```bash
npm install cli-progress
npm install @types/cli-progress --save-dev
```

**Key URLs**:

- NPM: <https://www.npmjs.com/package/cli-progress>
- GitHub: <https://github.com/npkgz/cli-progress>
- Type Definitions: <https://www.npmjs.com/package/@types/cli-progress>
- Examples: <https://github.com/npkgz/cli-progress/tree/master/examples>
