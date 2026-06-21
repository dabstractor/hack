# LLM Agent Testing Resources and URLs

**Research Document:** External Resources for Testing LLM Agents

**Date:** 2026-01-19

**Status:** Web search tools at usage limits (reset Feb 1, 2026) - This document provides the search queries and expected resources for when search becomes available.

---

## Search Queries and Expected Resources

### 1. Vitest Integration Testing Best Practices

**Search Queries:**

```text
- "Vitest integration testing best practices 2026"
- "site:vitest.dev integration testing setup configuration"
- "site:github.com Vitest integration testing examples"
```

**Expected URLs to Research:**

1. **Vitest Official Documentation**
   - URL: `https://vitest.dev/guide/`
   - Section: Integration Testing
   - Topics: Test environment setup, configuration options, coverage thresholds

2. **Vitest Configuration Reference**
   - URL: `https://vitest.dev/config/`
   - Section: Test Configuration
   - Topics: `setupFiles`, `coverage`, `globals`, `include/exclude` patterns

3. **Vitest Mocking API**
   - URL: `https://vitest.dev/guide/mocking.html`
   - Section: Mocking Functions and Modules
   - Topics: `vi.mock()`, `vi.fn()`, `vi.importActual()`, `vi.mocked()`

4. **GitHub Examples**
   - URL: `https://github.com/vitest-dev/vitest/tree/main/examples`
   - Section: Integration Test Examples
   - Topics: Real-world integration test patterns

**Relevant Sections for PRP:**

- **File Organization:** Test directory structure and naming conventions
- **Mock Setup:** Global setup files and mock cleanup patterns
- **Coverage Configuration:** Threshold settings and reporter options

---

### 2. Mocking Patterns for External API Calls

**Search Queries:**

```text
- "mocking external API calls Vitest testing patterns"
- "Vitest mock HTTP requests fetch axios"
- "MSW Mock Service Worker Vitest integration"
```

**Expected URLs to Research:**

1. **Vitest Mocking Guide**
   - URL: `https://vitest.dev/guide/mocking.html`
   - Section: Function and Module Mocking
   - Topics: `vi.fn()`, `vi.mock()`, mock implementation patterns

2. **MSW (Mock Service Worker) Documentation**
   - URL: `https://mswjs.io/`
   - Section: Integration with Vitest
   - Topics: REST API mocking, GraphQL mocking, request handlers

3. **Nock Documentation**
   - URL: `https://github.com/nock/nock`
   - Section: HTTP Mocking
   - Topics: HTTP request interception, response mocking

4. **Vitest + MSW Example**
   - URL: `https://vitest.dev/guide/mocking.html#msw`
   - Section: Mock Service Worker Integration
   - Topics: Server setup, handler configuration

**Relevant Sections for PRP:**

- **Mock Setup:** Creating mock agents and prompts for Groundswell
- **API Mocking:** Patterns for mocking LLM API calls (Claude, OpenAI)
- **Mock Verification:** Asserting mock calls and return values

---

### 3. Testing LLM Agent Integration

**Search Queries:**

```text
- "testing LLM agents external API calls Claude OpenAI"
- "LangChain testing patterns mock LLM calls"
- "LLM agent integration testing strategies"
```

**Expected URLs to Research:**

1. **LangChain Testing Guide**
   - URL: `https://python.langchain.com/docs/guides/evaluation/testing`
   - Section: Testing LLM Chains
   - Topics: Mock LLM calls, chain testing, evaluation metrics

2. **Anthropic Claude Documentation**
   - URL: `https://docs.anthropic.com/claude/reference/testing`
   - Section: Testing Claude Applications
   - Topics: Prompt testing, response validation, error handling

3. **OpenAI Testing Best Practices**
   - URL: `https://platform.openai.com/docs/guides/production-testing`
   - Section: Production Testing
   - Topics: Rate limiting, error handling, response validation

4. **LlamaIndex Testing Patterns**
   - URL: `https://docs.llamaindex.ai/en/stable/optimizing/testing`
   - Section: Testing LLM Applications
   - Topics: Unit testing, integration testing, evaluation

**Relevant Sections for PRP:**

- **Agent Config Verification:** Testing agent initialization and configuration
- **Prompt Testing:** Validating prompt structure and content
- **Response Validation:** Schema validation for LLM outputs

---

### 4. Prompt Validation Testing Strategies

**Search Queries:**

```text
- "prompt validation testing strategies LLM applications"
- "LLM prompt engineering testing framework"
- "prompt template testing validation"
```

**Expected URLs to Research:**

1. **Prompt Engineering Guide**
   - URL: `https://www.promptingguide.ai/`
   - Section: Testing and Validation
   - Topics: Prompt quality metrics, A/B testing, evaluation

2. **LangSmith Documentation**
   - URL: `https://docs.smith.langchain.com/`
   - Section: Evaluation and Testing
   - Topics: Prompt evaluation, feedback collection, metrics

3. **Promptfoo Documentation**
   - URL: `https://promptfoo.dev/`
   - Section: Prompt Testing Framework
   - Topics: Prompt comparison, assertion testing, edge cases

4. **Arize Phoenix**
   - URL: `https://docs.arize.com/phoenix/`
   - Section: LLM Evaluation
   - Topics: Prompt tracing, evaluation metrics, regression testing

**Relevant Sections for PRP:**

- **Prompt Structure Validation:** Testing prompt format and required sections
- **Template Variable Testing:** Verifying variable substitution
- **Content Validation:** Checking prompt content requirements

---

### 5. Zod Schema Validation Testing

**Search Queries:**

```text
- "Zod schema validation testing patterns TypeScript"
- "testing Zod schemas Vitest examples"
- "JSON schema validation testing LLM outputs"
```

**Expected URLs to Research:**

1. **Zod Documentation**
   - URL: `https://zod.dev/`
   - Section: Schema Testing
   - Topics: `safeParse()`, `parse()`, error handling, type inference

2. **Zod Testing Examples**
   - URL: `https://github.com/colinhacks/zod/tree/main/src/tests`
   - Section: Test Suite
   - Topics: Real-world schema testing patterns, edge cases

3. **TypeScript Schema Testing**
   - URL: `https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html`
   - Section: Type Testing
   - Topics: Type validation, schema alignment

4. **JSON Schema Validation**
   - URL: `https://json-schema.org/learn/`
   - Section: Testing and Validation
   - Topics: Schema validation tools, testing strategies

**Relevant Sections for PRP:**

- **Schema Validation Testing:** Testing Zod schemas with valid/invalid data
- **Error Message Validation:** Verifying schema error messages
- **Type Safety Testing:** Ensuring TypeScript types match schemas

---

## Current Codebase Resources

### Existing Test Files

**Unit Tests:**

- `/home/dustin/projects/hacky-hack/tests/unit/agents/agent-factory.test.ts`
  - Agent configuration testing
  - Environment variable mapping
  - MCP tool integration

- `/home/dustin/projects/hacky-hack/tests/unit/agents/prompts.test.ts`
  - Prompt export validation
  - Content validation
  - Formatting preservation

- `/home/dustin/projects/hacky-hack/tests/unit/core/models.test.ts`
  - Zod schema validation
  - Enum validation
  - Required field testing

**Integration Tests:**

- `/home/dustin/projects/hacky-hack/tests/integration/agents.test.ts`
  - Groundswell agent mocking
  - Prompt generation integration
  - Complete workflow testing

- `/home/dustin/projects/hacky-hack/tests/integration/architect-agent.test.ts`
  - Architect agent integration
  - System prompt validation
  - Response format testing

### Configuration Files

- **Vitest Config:** `/home/dustin/projects/hacky-hack/vitest.config.ts`
  - 100% coverage thresholds
  - Path aliases configuration
  - ESM module support

- **Test Setup:** `/home/dustin/projects/hacky-hack/tests/setup.ts`
  - Global mock cleanup
  - API endpoint validation
  - Promise rejection tracking

---

## Action Items for When Search Becomes Available

### Priority 1: Vitest Documentation

1. **Visit** `https://vitest.dev/guide/` and review:
   - [ ] Integration testing setup
   - [ ] Mock API documentation
   - [ ] Coverage configuration
   - [ ] Best practices section

2. **Visit** `https://vitest.dev/guide/mocking.html` and review:
   - [ ] `vi.mock()` patterns
   - [ ] `vi.fn()` usage
   - [ ] `vi.importActual()` for partial mocks
   - [ ] Mock verification patterns

### Priority 2: LLM Testing Resources

1. **Search for** "LangChain testing guide" and review:
   - [ ] Mock LLM patterns
   - [ ] Chain testing strategies
   - [ ] Evaluation metrics

2. **Search for** "Claude API testing best practices" and review:
   - [ ] Response validation
   - [ ] Error handling
   - [ ] Rate limiting strategies

### Priority 3: Schema Testing

1. **Visit** `https://zod.dev/` and review:
   - [ ] Schema testing patterns
   - [ ] Error handling
   - [ ] Type inference
   - [ ] Validation strategies

2. **Search for** "Zod schema testing examples" and review:
   - [ ] Real-world test examples
   - [ ] Edge case testing
   - [ ] Performance considerations

---

## Recommended Reading Order

### Phase 1: Foundation

1. **Vitest Configuration** - Understanding test setup
2. **Mocking Patterns** - Learning to mock external dependencies
3. **Test Organization** - Structuring test suites

### Phase 2: LLM-Specific Testing

1. **LLM Agent Testing** - Patterns for testing AI agents
2. **Prompt Validation** - Testing prompt generation
3. **Response Validation** - Schema validation for outputs

### Phase 3: Advanced Topics

1. **Integration Testing** - End-to-end workflow testing
2. **Performance Testing** - Testing agent performance
3. **Error Handling** - Testing failure scenarios

---

## Codebase Examples to Reference

### Mocking Pattern Example

**File:** `/home/dustin/projects/hacky-hack/tests/integration/agents.test.ts`

```typescript
// Mock at top level before imports
vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn(),
    createPrompt: vi.fn(),
  };
});

// Import after mocking
import { createAgent, createPrompt } from 'groundswell';

// Setup mock return values
const mockAgent = { prompt: vi.fn() };
vi.mocked(createAgent).mockReturnValue(mockAgent as never);
```

### Schema Validation Example

**File:** `/home/dustin/projects/hacky-hack/tests/unit/core/models.test.ts`

```typescript
it('should accept valid status values', () => {
  const result = StatusEnum.safeParse('Planned');
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toBe('Planned');
  }
});

it('should reject invalid status values', () => {
  const result = StatusEnum.safeParse('InvalidStatus');
  expect(result.success).toBe(false);
});
```

### Prompt Testing Example

**File:** `/home/dustin/projects/hacky-hack/tests/unit/agents/prompts.test.ts`

```typescript
it('TASK_BREAKDOWN_PROMPT should contain expected header', () => {
  expect(TASK_BREAKDOWN_PROMPT).toContain('LEAD TECHNICAL ARCHITECT');
  expect(TASK_BREAKDOWN_PROMPT).toContain('PROJECT SYNTHESIZER');
});

it('PRP_BLUEPRINT_PROMPT should contain template placeholders', () => {
  expect(PRP_BLUEPRINT_PROMPT).toContain('<item_title>');
  expect(PRP_BLUEPRINT_PROMPT).toContain('<item_description>');
});
```

---

## Additional Resources

### GitHub Repositories to Review

1. **vitest-dev/vitest**
   - URL: `https://github.com/vitest-dev/vitest`
   - Focus: Integration test examples

2. **colinhacks/zod**
   - URL: `https://github.com/colinhacks/zod`
   - Focus: Schema testing patterns

3. **langchain-ai/langchain**
   - URL: `https://github.com/langchain-ai/langchain`
   - Focus: LLM testing patterns

### Community Resources

1. **Vitest Discord**
   - Testing best practices discussions
   - Real-world implementation examples

2. **Zod Discord**
   - Schema validation discussions
   - Testing pattern sharing

3. **Stack Overflow Tags**
   - `#vitest`
   - `#zod`
   - `#llm-testing`

---

**Document Status:** Pending web search availability (reset Feb 1, 2026)

**Current Status:** Complete with codebase analysis and search query documentation

**Next Steps:**

1. When search becomes available, execute search queries
2. Update this document with actual URLs and specific sections
3. Extract relevant code examples from documentation
4. Add any new best practices discovered
