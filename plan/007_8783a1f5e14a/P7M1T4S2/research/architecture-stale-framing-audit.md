# Stale-Framing Audit — docs/ARCHITECTURE.md (P7.M1.T4.S2)

**Scope**: scan `docs/ARCHITECTURE.md` (917 lines / 27,888 B / last-updated 2026-01-23) for framing
that is inconsistent with the SHIPPED pi-native auth model (P7.M1.T2) and synchronous-destination
logging (P7.M1.T1), per the work item's three checks:

- **(a)** implies Anthropic is the primary/only provider
- **(b)** implies worker-thread transports / async / transport-based logging
- **(c)** omits the harness/provider orthogonality (pi default + zai default)

Scan command (from the work item): `rg -n -i 'anthropic|pino|transport|worker|auth|pi harness|zai'`
+ a comprehensive pass: `rg -n -i 'claude|apikey|process\.env|pino|log|transport|worker|\bpi\b|\bzai\b|harness|provider|anthropic'`.

---

## 1. PRIMARY stale location — `### Agent Creation` code block (lines 348-367)

The ONLY place in the document that hardcodes an Anthropic-primary capability example:

```typescript
// docs/ARCHITECTURE.md L348-367 (CURRENT — STALE)
import { createAgent } from 'groundswell';

const coderAgent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY!,      // ← (a) implies Anthropic-only auth
  model: 'claude-opus-4-5-20251101',            // ← (a) implies Anthropic Claude-only model (also a stale model id)
  maxTokens: 8192,
  systemPrompt: CODER_SYSTEM_PROMPT,
});
```

This block fails **all three** checks:
- **(a)** `ANTHROPIC_API_KEY` + `claude-opus-4-5-20251101` present Anthropic as the only provider/auth.
- **(c)** ZERO mention of `pi`, `zai`, harness, provider, or `configureHarnesses` — the orthogonality
  that PRD §9.4 mandates is entirely absent from the doc.

**Canonical replacement** (in-repo, markdownlint- + prettier-passing source): `docs/GROUNDSWELL_GUIDE.md`
L61-72 ("Configuration") + L116-130 ("Integration Example"):

```ts
import { configureHarnesses } from 'groundswell';

configureHarnesses({
  defaultHarness: 'pi',        // vendor-neutral default (pi.dev)
  defaultModelProvider: 'zai', // LLM host — INDEPENDENT of the harness
  harnessDefaults: {
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});
```

Shipped names (src/config/constants.ts): `DEFAULT_HARNESS='pi'`, `DEFAULT_MODEL_PROVIDER='zai'`,
`SUPPORTED_HARNESSES=['pi','claude-code']`, `MODEL_NAMES.sonnet='glm-5.2'`. The model string in the
example must be **provider-qualified** `zai/glm-5.2` (lowercase, PRD §9.2.3; never harness-qualified —
`pi/zai/glm-5.2` is INVALID). `src/config/harness.ts` exports `configureHarness()` (singular) which
WRAPS Groundswell's `configureHarnesses()` (plural); the doc code example imports `configureHarnesses`
from `'groundswell'` exactly as GROUNDSWELL_GUIDE.md does.

---

## 2. SECONDARY stale location — `### External References` (lines 906-912)

```markdown
- [Groundswell Framework](https://github.com/anthropics/groundswell) - Agentic workflow primitives
- [Anthropic Claude API](https://docs.anthropic.com/claude/reference/) - LLM API documentation
- [TypeScript Documentation](https://www.typescriptlang.org/docs/) - TypeScript language reference
- [Mermaid Diagrams](https://mermaid-js.github.io/) - Diagram syntax reference
```

The "Anthropic Claude API" line is listed as the **sole LLM API reference**, which mildly implies
Anthropic is the LLM provider (check (a), borderline). The Groundswell GitHub URL
(`github.com/anthropics/groundswell`) is unverified — Groundswell is a local lib
(`~/projects/groundswell`); its real repo URL is unknown, so it MUST NOT be "corrected" to a
fabricated URL. **Light-touch fix**: reframe the Anthropic line as the *optional* provider/harness
path and prefer in-repo canonical links; never fabricate an external z.ai URL. This is SECONDARY to
the Agent Creation block — the capability framing is cured primarily by Task 1.

---

## 3. LOGGING framing (check b) — VERIFIED NO-OP (no stale framing exists)

A comprehensive scan for `pino|transport|worker.?thread|threadstream|async.?log|log.?dest` returns
**ZERO** hits in `docs/ARCHITECTURE.md`. Every `log` substring match is a false positive or generic
prose that does NOT imply worker-thread transports:

| Line | Match | Verdict |
|------|-------|---------|
| 41, 69, 109, 121, 133, 137, 139, 213, 552, 571, 678, 852 | `backlog` / `Backlog` | false positive (`log` substring in "backlog") |
| 248 | "retry logic" | control-flow retry, not logging |
| 704 | "unauthorized" / "re-apply" | `auth` substring in "unauthorized"; not auth framing |
| 710 | "the failure is logged" | generic; does NOT imply transports/async |
| 719 | `process.cwd()` | not logging |
| 776, 858 | "Log Blocking" (Mermaid label) | diagram node label, not logging architecture |

**Conclusion (per work item OUTPUT §4):** no logging framing in `docs/ARCHITECTURE.md` implies
worker-thread transports or async/transport-based logging. This is a **verification-only no-op** —
no edit is required for check (b). This finding is recorded here and must be restated in the PRP's
Validation Loop. (REQ-L1/L2/L3 logging detail lives in PRD §9.6 + `src/utils/logger.ts`, not in this
architecture overview; do NOT add a logging-architecture section.)

---

## 4. Validation-tooling reality (CRITICAL — differs from the parallel README/T4.S1 task)

- `npm run docs:lint` runs `markdownlint "docs/**/*.md"` (package.json L57) → **ARCHITECTURE.md IS gated**.
  `.markdownlintignore` excludes only `docs/api/`. markdownlint config (`default:true`, MD013 off,
  MD024 siblings_only, MD036 off). **It PASSES today (`npx markdownlint docs/ARCHITECTURE.md` → exit 0).**
- `docs/ARCHITECTURE.md` is NOT in `.prettierignore` → prettier **IS gated**. **It PASSES today**
  (`npx prettier --check docs/ARCHITECTURE.md` → "All matched files use Prettier code style!").
- **Both gates MUST remain green after edits.** This is the key difference from T4.S1 (README),
  where markdownlint was NOT a gate (README is excluded from the `docs/**/*.md` glob).
- prettier does NOT reformat code inside markdown fenced blocks (no embedded-language plugin is
  configured in `.prettierrc`), so TS-in-fence edits are style-safe at the prettier layer.

## 5. Link-integrity reality (currently GREEN; edits must not break it)

All existing link targets resolve today: `../README.md`, `./CLI_REFERENCE.md`, `./WORKFLOWS.md`,
`./INSTALLATION.md`, `./CONFIGURATION.md`, `../PROMPTS.md`, `./api/media/architecture.md` (EXISTS),
`./api/index.html` (EXISTS). The replacement adds a link to `./GROUNDSWELL_GUIDE.md` (EXISTS) and
optionally `../PRD.md` (EXISTS). Verify all links post-edit.

## 6. Scope guardrails

- Edit ONLY `docs/ARCHITECTURE.md`. Do NOT touch `README.md` (T4.S1 owns it, parallel), other
  `docs/*.md`, `.env.example`, `PRD.md`, `PROMPTS.md`, or any `src/` file.
- Keep the doc's existing structure (ToC, headings, Mermaid diagrams, sections) — edit only stale
  statements. No new top-level sections.
- This task is INDEPENDENT of T4.S1's output (different files, no contract dependency), but must not
  conflict with it.
