# Research 02 — MAX_ARG_STRLEN / E2BIG (external, authoritative)

**Why this matters**: PRD §9.3.3 mandates prompts (>128KB possible) be
delivered as a programmatic message body, never as argv (capped by
`MAX_ARG_STRLEN`, fails `E2BIG`). This file pins the exact values + sources
so the test's threshold constant is defensible.

## Key facts (exact values)

1. **`MAX_ARG_STRLEN = 131,072 bytes (128 KiB)`** — the maximum length of a
   SINGLE argv/envp string on Linux. Defined as `PAGE_SIZE * 32` in the
   kernel (`PAGE_SIZE = 4096` on standard x86_64/arm64). Not configurable.
   - Source: Linux kernel `fs/exec.c`
     https://github.com/torvalds/linux/blob/master/fs/exec.c (search for
     `MAX_ARG_STRLEN`).

2. **Error code: `E2BIG`** — returned by `execve(2)` when the total number of
   bytes in the argv+envp arrays, OR a single argument string, exceeds the
   limit. From the user's perspective the new process never starts; the
   parent gets `E2BIG`.
   - Source: `execve(2)` man page, ERRORS section
     https://man7.org/linux/man-pages/man2/execve.2.html#ERRORS

3. **`ARG_MAX` (~2 MiB total)** — the limit on the TOTAL size of all argv +
   envp strings combined (derived from `RLIMIT_STACK / 4`). This is DISTINCT
   from `MAX_ARG_STRLEN` (per-single-string). A pipeline that fits under
   ARG_MAX overall can STILL die on a single >131072-byte argument.
   - Source: `execve(2)` man page, NOTES section
     https://man7.org/linux/man-pages/man2/execve.2.html#NOTES

4. **`MAX_ARG_STRNUM` (irrelevant here)** — max NUMBER of argument strings
   (~16,384 on 64-bit). Not the relevant limit for prompt-size concerns.

5. **Node `child_process`**: `spawn(cmd, args)` where `args` is an array —
   each array element becomes one argv string; a single element >131072
   bytes → `E2BIG`. With `shell:true`, Node passes the single `command`
   string as one argv to `/bin/sh -c` → that ONE string is subject to
   `MAX_ARG_STRLEN`. So a >128KB `command` to `spawn(cmd, {shell:true})`
   ALSO dies with `E2BIG`. (This is why the audit must also cover
   `bash-mcp.ts`, even though validation commands are short.)

## Best-practice delivery for large prompts (authoritative)

- **Anthropic Claude Agent SDK**: prompts are delivered as message-body
  content via `query({ prompt, options })` / `streamInput()` — a programmatic
  AsyncGenerator, never argv.
  https://docs.anthropic.com/en/docs/claude-code/sdk
- **Pi coding agent SDK**: `session.prompt(text)` — a method call on an
  in-process session object; the text is a normal JS string (memory), not a
  kernel argv string. (Verified in research/01 — groundswell's pi-harness.js
  L245.)
- **General rule**: large payloads (prompts, files, stdin data) go through
  `stdio: ['pipe', ...]` + `child.stdin.write(...)`, temp files, or
  in-process SDK calls — never argv. `E2BIG` is unrecoverable by any wrapper.

## Why a defensive test is warranted (the audit's rationale)

`E2BIG` is a HARD, unrecoverable failure: the new process never execve()s, so
no wrapper try/catch in the parent can recover the agent run. A future
refactor that (accidentally) routes `request.prompt` into a `spawn(argv)`
call — e.g. someone adds a `pi.dev --prompt <text>` shell-out for a new
harness, or passes a PRP body as a `gate.command` — would silently work for
small prompts in tests and then DIE in production the first time a >128KB
PRP-embedding prompt hits it. A regression test that scans for
prompt-as-argv patterns and/or asserts the agent path is programmatic makes
that failure mode impossible to reintroduce.

## Testing patterns considered

- **Pattern A (static source scan)**: a vitest test that reads
  `src/agents/*.ts` + `src/tools/bash-mcp.ts` and fails if it finds a
  `spawn(`/`exec(`/`execSync(`/`execFile(` call site whose argv contains a
  variable named/typed as a prompt (heuristic on identifiers like `prompt`,
  `injectedPrompt`, `fixPrompt`, `request.prompt`). Robust against future
  refactor; low false-positive risk because the agent runtime has NO such
  pattern today.
- **Pattern B (unit/integration)**: mock `node:child_process.spawn`, run the
  agent prompt path, assert `spawn` is NOT called with the prompt text as an
  argv element (and that `session.prompt` IS called with the prompt). Most
  direct, but couples the test to groundswell internals (which are a
  published dependency and harder to mock cleanly).
- **Pattern C (size-guard)**: a guard function that throws if any prompt
  routed toward argv exceeds a safety threshold (e.g. 100KB). Overkill here
  since no argv path exists; would be dead code.

**Chosen approach for this PRP: Pattern A (static scan) as the PRIMARY
regression test**, because (i) the audit found zero argv paths, so a static
"no prompt-as-argv pattern exists" assertion precisely captures the current
invariant; (ii) it needs no groundswell mocking; (iii) it fails LOUDLY the
moment a future commit reintroduces the pattern. The PRP also adds a small
documentation/constant pin (`MAX_ARG_STRLEN = 131072`) so the threshold is
named, not magic.