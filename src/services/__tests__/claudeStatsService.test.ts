/**
 * Claude Stats Service Tests
 *
 * Tests for claudeStatsService.ts - validates reading and parsing Claude CLI usage statistics.
 * Covers file reading, JSON parsing, data extraction, sorting, and error handling.
 *
 * Test coverage:
 * - File existence checking and missing file handling
 * - JSON parsing and error recovery
 * - Skill and tool data extraction and sorting
 * - Edge cases (empty data, missing properties, invalid formats)
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

jest.mock('node:fs');
jest.mock('node:path');
jest.mock('node:os');

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ClaudeStatsService, UsageItem, ClaudeStats } from '../claudeStatsService';

describe('ClaudeStatsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mocks
    (os.homedir as jest.Mock).mockReturnValue('/home/user');
    (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockClaudeJson = {
    skillUsage: {
      'skill-1': { usageCount: 10, lastUsedAt: 1704067200000 },
      'skill-2': { usageCount: 5, lastUsedAt: 1704153600000 },
      'skill-3': { usageCount: 20, lastUsedAt: 1704240000000 },
    },
    toolUsage: {
      'read': { usageCount: 50, lastUsedAt: 1704067200000 },
      'write': { usageCount: 30, lastUsedAt: 1704153600000 },
      'bash': { usageCount: 25, lastUsedAt: 1704240000000 },
    },
  };

  describe('getClaudeStats', () => {
    it('should return stats with empty arrays when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats).toEqual({
        skills: [],
        tools: [],
      });
    });

    it('should read and parse Claude stats from valid file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills).toHaveLength(3);
      expect(stats.tools).toHaveLength(3);
    });

    it('should correctly extract skill data', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills).toContainEqual({
        name: 'skill-1',
        usageCount: 10,
        lastUsedAt: 1704067200000,
      });
      expect(stats.skills).toContainEqual({
        name: 'skill-2',
        usageCount: 5,
        lastUsedAt: 1704153600000,
      });
    });

    it('should correctly extract tool data', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.tools).toContainEqual({
        name: 'read',
        usageCount: 50,
        lastUsedAt: 1704067200000,
      });
      expect(stats.tools).toContainEqual({
        name: 'bash',
        usageCount: 25,
        lastUsedAt: 1704240000000,
      });
    });

    it('should sort skills by usage count in descending order', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills[0].usageCount).toBe(20);
      expect(stats.skills[1].usageCount).toBe(10);
      expect(stats.skills[2].usageCount).toBe(5);
    });

    it('should sort tools by usage count in descending order', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.tools[0].usageCount).toBe(50);
      expect(stats.tools[1].usageCount).toBe(30);
      expect(stats.tools[2].usageCount).toBe(25);
    });

    it('should handle invalid JSON gracefully and return empty stats', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json {]');

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats).toEqual({
        skills: [],
        tools: [],
      });
    });

    it('should handle file read errors gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File read error');
      });

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats).toEqual({
        skills: [],
        tools: [],
      });
    });

    it('should handle missing skillUsage property', () => {
      const dataWithoutSkills = {
        toolUsage: mockClaudeJson.toolUsage,
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(dataWithoutSkills));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills).toEqual([]);
      expect(stats.tools).toHaveLength(3);
    });

    it('should handle missing toolUsage property', () => {
      const dataWithoutTools = {
        skillUsage: mockClaudeJson.skillUsage,
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(dataWithoutTools));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills).toHaveLength(3);
      expect(stats.tools).toEqual([]);
    });

    it('should handle skillUsage and toolUsage being non-objects', () => {
      const dataWithInvalidTypes = {
        skillUsage: 'not an object',
        toolUsage: 'also not an object',
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(dataWithInvalidTypes));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills).toEqual([]);
      expect(stats.tools).toEqual([]);
    });

    it('should handle missing usageCount property in items', () => {
      const dataWithMissingCount = {
        skillUsage: {
          'skill-1': { lastUsedAt: 1704067200000 },
        },
        toolUsage: {},
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(dataWithMissingCount));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills).toEqual([
        {
          name: 'skill-1',
          usageCount: 0,
          lastUsedAt: 1704067200000,
        },
      ]);
    });

    it('should handle missing lastUsedAt property in items', () => {
      const dataWithMissingTimestamp = {
        skillUsage: {
          'skill-1': { usageCount: 10 },
        },
        toolUsage: {},
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(dataWithMissingTimestamp));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats.skills).toEqual([
        {
          name: 'skill-1',
          usageCount: 10,
          lastUsedAt: 0,
        },
      ]);
    });

    it('should handle empty skillUsage and toolUsage objects', () => {
      const emptyData = {
        skillUsage: {},
        toolUsage: {},
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(emptyData));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats).toEqual({
        skills: [],
        tools: [],
      });
    });

    it('should maintain sort order with tied usage counts', () => {
      const dataWithTies = {
        skillUsage: {
          'skill-a': { usageCount: 10, lastUsedAt: 1704067200000 },
          'skill-b': { usageCount: 10, lastUsedAt: 1704153600000 },
          'skill-c': { usageCount: 5, lastUsedAt: 1704240000000 },
        },
        toolUsage: {},
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(dataWithTies));

      const stats = ClaudeStatsService.getClaudeStats();

      // Both skill-a and skill-b should have 10 usage count, followed by skill-c with 5
      expect(stats.skills[0].usageCount).toBe(10);
      expect(stats.skills[1].usageCount).toBe(10);
      expect(stats.skills[2].usageCount).toBe(5);
    });

    it('should return data in correct shape', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats).toHaveProperty('skills');
      expect(stats).toHaveProperty('tools');
      expect(Array.isArray(stats.skills)).toBe(true);
      expect(Array.isArray(stats.tools)).toBe(true);

      if (stats.skills.length > 0) {
        expect(stats.skills[0]).toHaveProperty('name');
        expect(stats.skills[0]).toHaveProperty('usageCount');
        expect(stats.skills[0]).toHaveProperty('lastUsedAt');
      }
    });
  });

  describe('Interface structures', () => {
    it('should have correct UsageItem structure', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();
      const skill = stats.skills[0];

      if (skill) {
        expect(typeof skill.name).toBe('string');
        expect(typeof skill.usageCount).toBe('number');
        expect(typeof skill.lastUsedAt).toBe('number');
      }
    });

    it('should have correct ClaudeStats structure', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockClaudeJson));

      const stats = ClaudeStatsService.getClaudeStats();

      expect(stats).toHaveProperty('skills');
      expect(stats).toHaveProperty('tools');
      expect(Array.isArray(stats.skills)).toBe(true);
      expect(Array.isArray(stats.tools)).toBe(true);
    });
  });
});
