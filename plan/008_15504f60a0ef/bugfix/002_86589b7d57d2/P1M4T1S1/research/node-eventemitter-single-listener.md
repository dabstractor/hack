# Research — Node EventEmitter single-listener optimization (BUG-004 Category c)

Source of the `process._events.SIGINT is not iterable` failure in
`tests/integration/prp-pipeline-shutdown.test.ts`. This is the ONLY defect this
item fixes; production code is in-spec and untouched.

## 1. Root cause: the "f" optimization

Node's `EventEmitter` stores listeners in an internal `this._events[event]` map,
**not** always as an array. It uses a storage-shape optimization:

| # listeners for event | Shape of `_events[event]`      | Truthy? |
|----------------------|---------------------------------|---------|
| 0                    | `undefined`                     | no      |
| 1                    | the listener **function itself** | **yes** |
| 2+                   | `Array<Function>`               | yes     |

> "if there is only one listener for an event then it is set as a function value
> in the `_events` object rather than an array"
> — https://dev.to/captainsafia/node-module-deep-dive-eventemitter-3oeg
> Authoritative API ref: https://nodejs.org/api/events.html

This is why the test's truthiness guard is INSUFFICIENT:

```ts
// tests/integration/prp-pipeline-shutdown.test.ts:116-121 (CURRENT — BUGGY)
SIGINT: (process as any)._events?.SIGINT          // 1 listener => bare function (TRUTHY)
  ? [...(process as any)._events.SIGINT]          // => [...fn] => THROWS "not iterable"
  : [],
```

A bare function is truthy, so the ternary always picks the spread branch, and
spreading a non-iterable function throws `TypeError: process._events.SIGINT is
not iterable`. Because this is in `beforeEach`, **every one of the 20 tests fails
in setup before its body runs** — hence "20/20 fail" and graceful-shutdown
(PRD §5.1) is never actually exercised.

## 2. The idiomatic, shape-independent APIs (USE THESE)

`EventEmitter` exposes official accessors that are shape-independent and ALWAYS
return the correct type — these eliminate the `_events` internals entirely:

| API                                   | Returns        | Notes |
|---------------------------------------|----------------|-------|
| `process.listeners(eventName)`        | `Function[]`   | ALWAYS an array, even with 0 or 1 listener. Returns a **copy**. |
| `process.listenerCount(eventName)`    | `number`       | Correct count regardless of shape. |
| `process.off(name, fn)` / `removeListener(name, fn)` | void | Removes ONE specific listener (by reference). |
| `process.removeAllListeners(name)`    | void           | Removes ALL listeners for `name` — **DESTRUCTIVE** to vitest's own handlers. |

Refs:
- https://nodejs.org/api/events.html#emitterlistenerseventname  (always-array copy)
- https://nodejs.org/api/events.html#emitterlistenercounteventname
- https://nodejs.org/api/events.html#emitteroffeventname-listener

## 3. Why `removeAllListeners` is a secondary defect (afterEach)

`afterEach` (current lines 141-148) does:

```ts
process.removeAllListeners('SIGINT');
process.removeAllListeners('SIGTERM');
originalProcessListeners.SIGINT.forEach(l => process.on('SIGINT', l));
originalProcessListeners.SIGTERM.forEach(l => process.on('SIGTERM', l));
```

`removeAllListeners('SIGINT')` wipes **every** SIGINT listener, including any
that vitest's worker registered (Ctrl-C/abort → graceful test interruption).
The re-add only restores what `beforeEach` captured, so listeners vitest adds
*later* (or re-registers between suites) are silently lost, destabilizing the
forks-pool worker across the file/ suite.

### Safer restore = diff-based removal (preserve everything else)

Instead of nuking all listeners, remove ONLY the ones added *during* the test
(i.e. present now but NOT in the captured-before set), using `process.off`. This
removes the pipeline's `setupSignalHandlers` listeners while leaving vitest's
handlers (and anything else pre-existing) intact.

```ts
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  const before = new Set<Function>(originalProcessListeners[signal]);
  for (const listener of process.listeners(signal)) {
    if (!before.has(listener)) process.off(signal, listener as (...a: unknown[]) => void);
  }
}
```

This satisfies the contract "restore only the captured listeners by name ...
not removeAllListeners": the captured set is the baseline, and only test-added
listeners are torn down.

## 4. File evidence (verified line numbers)

`tests/integration/prp-pipeline-shutdown.test.ts` (2036 lines, single top-level
`describe`, 20 `it` tests across sub-describes):

- **beforeEach** lines 99-127 → capture at **115-122**; the throwing spread is
  on lines **117** (SIGINT) and **120** (SIGTERM).
- **afterEach** lines 130-149 → `removeAllListeners` at **141-142**, re-add at
  **143-148**.
- Latent sibling inaccuracy: lines **607** and **639** read
  `(process as any)._events?.SIGINT?.length ?? 0`. With 1 listener this is the
  **function's arity** (its declared parameter count), NOT the listener count —
  silently wrong. Replace with `process.listenerCount('SIGINT')` for correctness.
  (Asserted via `toBeLessThanOrEqual`, so it does not currently throw, but it is
  semantically broken — fix it while the file is open; same intent.)

## 5. Scope boundary (what NOT to touch)

- **No production code.** Architecture doc `bug-004-test-suite.md` §"NOTE": the
  pipeline code is in-spec; the bug is test-only.
- Only `tests/integration/prp-pipeline-shutdown.test.ts` is edited.
- Other BUG-004 categories (a/b — harness-init, coder-agent rot, etc.) are out
  of scope (P1.M4.T2/T3). This item only flips THIS file from 20/20 red to 20/20
  green; the overall suite stays red on other files until those land.
- **No overlap with P1.M3.T2.S1** (parallel): that item edits commit-format
  code (`git-commit.ts`, `task-orchestrator.ts`, `git-commit.test.ts`,
  `smart-commit.test.ts`); this item edits a disjoint test file. Safe to land in
  either order.