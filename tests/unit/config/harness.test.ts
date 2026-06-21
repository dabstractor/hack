/**
 * Unit tests for harness/provider constants, types, and error class
 *
 * @remarks
 * Tests validate the new harness configuration symbols added for the
 * Pluggable Agent Harness System (PRD §9.4). Covers all 7 new exports:
 * - Constants: PRP_AGENT_HARNESS, DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER, SUPPORTED_HARNESSES
 * - Types: AgentHarness, ModelProvider (type-level / compile-time)
 * - Error class: HarnessProviderMismatchError
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  ModelProvider,
  HarnessProviderMismatchError,
} from '../../../src/config/types.js';
import { HarnessProviderMismatchError as HarnessProviderMismatchErrorClass } from '../../../src/config/types.js';
import {
  PRP_AGENT_HARNESS,
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  SUPPORTED_HARNESSES,
} from '../../../src/config/constants.js';

describe('config/harness', () => {
  describe('constants', () => {
    it('should export PRP_AGENT_HARNESS as the env-var name string', () => {
      // EXECUTE & VERIFY
      expect(PRP_AGENT_HARNESS).toBe('PRP_AGENT_HARNESS');
    });

    it('should export DEFAULT_HARNESS as "pi"', () => {
      // EXECUTE & VERIFY
      expect(DEFAULT_HARNESS).toBe('pi');
    });

    it('should export DEFAULT_MODEL_PROVIDER as "zai"', () => {
      // EXECUTE & VERIFY
      expect(DEFAULT_MODEL_PROVIDER).toBe('zai');
    });

    it('should export SUPPORTED_HARNESSES as a readonly tuple of ["pi","claude-code"]', () => {
      // EXECUTE & VERIFY: value equality
      expect(SUPPORTED_HARNESSES).toEqual(['pi', 'claude-code']);

      // VERIFY: readonly literal tuple (compile-time check)
      const _check: readonly ['pi', 'claude-code'] = SUPPORTED_HARNESSES;
      expect(_check).toBeDefined(); // consumed by tsc
    });
  });

  describe('types', () => {
    it('should accept valid AgentHarness values at compile time', () => {
      // SETUP: compile-time type checks — if these fail, tsc errors
      const pi: AgentHarness = 'pi';
      const claudeCode: AgentHarness = 'claude-code';

      // EXECUTE & VERIFY
      expect(pi).toBe('pi');
      expect(claudeCode).toBe('claude-code');
    });

    it('should accept known ModelProvider values at compile time', () => {
      // SETUP: compile-time type checks
      const zai: ModelProvider = 'zai';
      const anthropic: ModelProvider = 'anthropic';

      // EXECUTE & VERIFY
      expect(zai).toBe('zai');
      expect(anthropic).toBe('anthropic');
    });

    it('should accept arbitrary strings for ModelProvider (open set)', () => {
      // SETUP: any string must be valid due to `(string & {})` idiom
      const custom: ModelProvider = 'custom-xyz-llm';

      // EXECUTE & VERIFY
      expect(custom).toBe('custom-xyz-llm');
    });
  });

  describe('HarnessProviderMismatchError', () => {
    it('should be an instance of Error', () => {
      // SETUP
      const error = new HarnessProviderMismatchErrorClass('claude-code', 'zai');

      // EXECUTE & VERIFY
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(HarnessProviderMismatchErrorClass);
    });

    it('should have the correct error name', () => {
      // SETUP
      const error = new HarnessProviderMismatchErrorClass('claude-code', 'zai');

      // EXECUTE & VERIFY
      expect(error.name).toBe('HarnessProviderMismatchError');
    });

    it('should carry the harness value as a readonly field', () => {
      // SETUP
      const error = new HarnessProviderMismatchErrorClass('claude-code', 'zai');

      // EXECUTE & VERIFY
      expect(error.harness).toBe('claude-code');
    });

    it('should carry the provider value as a readonly field', () => {
      // SETUP
      const error = new HarnessProviderMismatchErrorClass('claude-code', 'zai');

      // EXECUTE & VERIFY
      expect(error.provider).toBe('zai');
    });

    it('should include both harness and provider in the message', () => {
      // SETUP
      const error = new HarnessProviderMismatchErrorClass('claude-code', 'zai');

      // EXECUTE & VERIFY
      expect(error.message).toContain('claude-code');
      expect(error.message).toContain('zai');
    });
  });
});
