/**
 * Unit tests for table-formatter terminal-width responsiveness (PRD §5.4).
 *
 * @remarks
 * Verifies that `hack inspect` tables size their columns to the actual terminal
 * width and wrap long cell data, staying readable down to 30 columns. Covers
 * the {@link getTerminalWidth} / {@link fitColumnWidths} helpers and the
 * rendering of every table inspect emits.
 *
 * @see {@link ../../../../src/utils/display/table-formatter.ts | table-formatter}
 */

import { describe, expect, it, afterEach } from 'vitest';
import {
  getTerminalWidth,
  formatSessionTable,
  formatTaskHierarchyTable,
  formatArtifactTable,
  formatErrorTable,
  formatStatusCounts,
  formatCurrentTask,
} from '../../../../src/utils/display/table-formatter.js';
import type { SessionMetadata, Phase } from '../../../../src/core/models.js';

/** ANSI escape (ESC) used to build the strip regex without a regex literal. */
const ESC = '\x1b';
/** Strip ANSI escape sequences so line-length assertions measure visible width. */
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g');
const strip = (s: string): string => s.replace(ANSI_RE, '');

/** Longest visible line length in a rendered table string. */
const maxVisibleLine = (out: string): number =>
  Math.max(...out.split('\n').map(l => strip(l).length));

describe('table-formatter terminal-width responsiveness (PRD §5.4)', () => {
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      configurable: true,
      writable: true,
    });
  });

  const setColumns = (n: number | undefined): void => {
    Object.defineProperty(process.stdout, 'columns', {
      value: n,
      configurable: true,
      writable: true,
    });
  };

  describe('getTerminalWidth', () => {
    it('returns the detected TTY width', () => {
      setColumns(120);
      expect(getTerminalWidth()).toBe(120);
    });

    it('clamps to the 30-column minimum', () => {
      setColumns(12);
      expect(getTerminalWidth()).toBe(30);
    });

    it('falls back to 80 when width is not detectable (non-TTY)', () => {
      setColumns(undefined);
      expect(getTerminalWidth()).toBe(80);
    });

    it('falls back to 80 for a non-positive width, then clamps to 30', () => {
      setColumns(0);
      expect(getTerminalWidth()).toBe(80);
    });
  });

  describe('column fitting + wrapping at narrow widths', () => {
    const meta = (
      overrides: Partial<SessionMetadata> = {}
    ): SessionMetadata => ({
      id: '001_14b9dc2a33c7',
      hash: '14b9dc2a33c7',
      path: '/a/plan/001_14b9dc2a33c7',
      createdAt: new Date('2024-01-15T10:00:00Z'),
      parentSession: null,
      ...overrides,
    });

    const phases: Phase[] = [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Foundation and scaffolding work for the whole project',
        status: 'Complete',
        description: '',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Milestone with a long title that should wrap nicely',
            status: 'Implementing',
            description: '',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Task one title here',
                status: 'Planned',
                description: '',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'Subtask one',
                    status: 'Ready',
                    story_points: 3,
                    dependencies: [],
                    context_scope: '',
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    it.each([30, 40, 80] as const)(
      'keeps the session table within %i columns',
      width => {
        setColumns(width);
        const out = formatSessionTable(meta());
        expect(maxVisibleLine(out)).toBeLessThanOrEqual(width);
      }
    );

    it.each([30, 40, 80] as const)(
      'keeps the task hierarchy table within %i columns',
      width => {
        setColumns(width);
        const out = formatTaskHierarchyTable(phases);
        expect(maxVisibleLine(out)).toBeLessThanOrEqual(width);
      }
    );

    it.each([30, 40, 80] as const)(
      'keeps the artifact table within %i columns',
      width => {
        setColumns(width);
        const out = formatArtifactTable([
          {
            taskId: 'P1.M1.T1.S1',
            type: 'prp',
            path: '/a/really/long/artifact/path/to/some/generated/file.md',
            exists: true,
          },
        ]);
        expect(maxVisibleLine(out)).toBeLessThanOrEqual(width);
      }
    );

    it.each([30, 40, 80] as const)(
      'keeps the error table within %i columns',
      width => {
        setColumns(width);
        const out = formatErrorTable([
          {
            taskId: 'P1.M1.T1.S1',
            taskTitle: 'A task with a reasonably long descriptive title',
            errorMessage: 'something went wrong during the validation step',
            timestamp: '2024-01-15T10:00:00Z',
          },
        ]);
        expect(maxVisibleLine(out)).toBeLessThanOrEqual(width);
      }
    );

    it.each([30, 40, 80] as const)(
      'keeps the status-counts table within %i columns',
      width => {
        setColumns(width);
        const out = formatStatusCounts({
          Complete: 5,
          Planned: 3,
          Implementing: 1,
          Failed: 0,
        });
        expect(maxVisibleLine(out)).toBeLessThanOrEqual(width);
      }
    );

    it.each([30, 40, 80] as const)(
      'keeps the current-task table within %i columns',
      width => {
        setColumns(width);
        const out = formatCurrentTask(
          'P1.M1.T1.S1',
          'Implementing the long named subtask with extra description',
          'Implementing',
          new Date()
        );
        expect(maxVisibleLine(out)).toBeLessThanOrEqual(width);
      }
    );

    it('wraps long space-separated cell data onto multiple lines at 30 columns', () => {
      setColumns(30);
      const out = formatSessionTable(
        meta({
          path: 'this is a long descriptive value that should wrap across lines',
        })
      );
      // The wrapped content survives across multiple physical lines instead of
      // pushing the table past 30 columns.
      const lines = strip(out).split('\n');
      expect(maxVisibleLine(out)).toBeLessThanOrEqual(30);
      expect(lines.length).toBeGreaterThan(5);
      expect(out).toContain('descriptive');
    });
  });
});
