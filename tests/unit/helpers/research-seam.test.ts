import { describe, expect, it } from 'vitest';

import { PRPDocumentSchema } from '../../../src/core/models.js';
import {
  createMockPRPDocument,
  createSuccessAgentResponse,
  MINIMAL_PRP_JSON_STRING,
  MOCK_PRP_DOCUMENT,
  prpJsonPath,
} from '../../helpers/research-seam';

/**
 * Self-test for the shared research-seam helper (S1's own validation gate).
 *
 * @remarks
 * Proves the PURE FIXTURES + path util are schema-correct so that P1.M4.T2.S2 can
 * trust them when applying the helper to the ~9 category-(a) suites. Does NOT test
 * the `vi` wiring helpers here — those need a real `vi.mock` context and are
 * exercised by S2 applying them to the real integration suites.
 */
describe('tests/helpers/research-seam', () => {
  it('createMockPRPDocument satisfies PRPDocumentSchema', () => {
    const result = PRPDocumentSchema.safeParse(
      createMockPRPDocument('P3.M3.T1.S1')
    );
    expect(result.success).toBe(true);
  });

  it('MOCK_PRP_DOCUMENT (default constant) satisfies PRPDocumentSchema', () => {
    const result = PRPDocumentSchema.safeParse(MOCK_PRP_DOCUMENT);
    expect(result.success).toBe(true);
  });

  it('createSuccessAgentResponse yields a valid success-shaped AgentResponse', () => {
    const r = createSuccessAgentResponse();
    expect(r.status).toBe('success');
    expect(r.error).toBeNull();
    expect(r.metadata).toMatchObject({
      agentId: expect.any(String),
      timestamp: expect.any(Number),
    });
  });

  it('prpJsonPath mirrors PRPGenerator.compute (<sessionPath>/prps/<sanitizedId>.json)', () => {
    expect(prpJsonPath('/tmp/s', 'P3.M3.T1.S1')).toBe(
      '/tmp/s/prps/P3_M3_T1_S1.json'
    );
  });

  it('MINIMAL_PRP_JSON_STRING round-trips through JSON.parse to the default taskId', () => {
    expect(JSON.parse(MINIMAL_PRP_JSON_STRING).taskId).toBe(
      MOCK_PRP_DOCUMENT.taskId
    );
  });
});
