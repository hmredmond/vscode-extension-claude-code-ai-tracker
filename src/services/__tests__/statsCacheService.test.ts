import * as fs from 'fs';
import * as os from 'os';
import { StatsCacheService, StatsCacheData } from '../statsCacheService';

jest.mock('fs');

describe('StatsCacheService', () => {
  const mockFs = jest.mocked(fs);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('expandPath', () => {
    it('should expand tilde to home directory', () => {
      process.env.HOME = '/home/user';
      const expanded = StatsCacheService.expandPath('~/.claude/cache.json');
      expect(expanded).toBe('/home/user/.claude/cache.json');
    });

    it('should use USERPROFILE on Windows', () => {
      delete process.env.HOME;
      process.env.USERPROFILE = 'C:\\Users\\user';
      const expanded = StatsCacheService.expandPath('~/.claude/cache.json');
      expect(expanded).toContain('.claude/cache.json');
    });

    it('should return path unchanged if no tilde', () => {
      const path = '/absolute/path/to/file.json';
      const expanded = StatsCacheService.expandPath(path);
      expect(expanded).toBe(path);
    });

    it('should handle relative paths', () => {
      const path = 'relative/path/file.json';
      const expanded = StatsCacheService.expandPath(path);
      expect(expanded).toBe(path);
    });
  });

  describe('readCacheFile', () => {
    it('should read and parse valid cache file', () => {
      const mockData: StatsCacheData = {
        version: 1,
        lastComputedDate: '2026-03-05',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {
          'claude-haiku': {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.015,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockData));

      const result = StatsCacheService.readCacheFile('~/.claude/stats-cache.json');
      expect(result).toEqual(mockData);
    });

    it('should throw error if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => {
        StatsCacheService.readCacheFile('/nonexistent/file.json');
      }).toThrow('Stats cache file not found');
    });

    it('should throw error if modelUsage is missing', () => {
      const invalidData = {
        version: 1,
        lastComputedDate: '2026-03-05',
        dailyActivity: [],
        dailyModelTokens: [],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidData));

      expect(() => {
        StatsCacheService.readCacheFile('/path/to/file.json');
      }).toThrow('Invalid stats cache format');
    });
  });

  describe('summarizeModelUsage', () => {
    it('should summarize model usage data', () => {
      const mockData: StatsCacheData = {
        version: 1,
        lastComputedDate: '2026-03-05',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {
          'claude-haiku': {
            inputTokens: 1_000_000,
            outputTokens: 500_000,
            cacheReadInputTokens: 100_000,
            cacheCreationInputTokens: 50_000,
            costUSD: 10,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
          'claude-sonnet': {
            inputTokens: 2_000_000,
            outputTokens: 1_000_000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 75,
            webSearchRequests: 5,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
        },
      };

      const summary = StatsCacheService.summarizeModelUsage(mockData);

      expect(summary).toHaveLength(2);
      expect(summary[0].model).toBe('claude-sonnet');
      expect(summary[1].model).toBe('claude-haiku');
    });

    it('should sort by cost descending', () => {
      const mockData: StatsCacheData = {
        version: 1,
        lastComputedDate: '2026-03-05',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {
          'claude-opus': {
            inputTokens: 100_000,
            outputTokens: 100_000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 1,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
          'claude-haiku': {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 6,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
        },
      };

      const summary = StatsCacheService.summarizeModelUsage(mockData);
      expect(summary[0].totalCost).toBeGreaterThan(summary[1].totalCost);
    });

    it('should include cache token counts', () => {
      const mockData: StatsCacheData = {
        version: 1,
        lastComputedDate: '2026-03-05',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {
          'claude-haiku': {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 200,
            cacheCreationInputTokens: 100,
            costUSD: 0.015,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
        },
      };

      const summary = StatsCacheService.summarizeModelUsage(mockData);

      expect(summary[0].cacheReadTokens).toBe(200);
      expect(summary[0].cacheWriteTokens).toBe(100);
    });
  });

  describe('convertToProjectBranchRecords', () => {
    it('should convert cache data to cost records', () => {
      const mockData: StatsCacheData = {
        version: 1,
        lastComputedDate: '2026-03-05',
        dailyActivity: [],
        dailyModelTokens: [
          {
            date: '2026-03-05',
            tokensByModel: {
              'claude-haiku': 1000,
            },
          },
        ],
        modelUsage: {
          'claude-haiku': {
            inputTokens: 2000,
            outputTokens: 2000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.06,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
        },
      };

      const records = StatsCacheService.convertToProjectBranchRecords(
        mockData,
        'test-project',
        'main'
      );

      expect(records).toHaveLength(1);
      expect(records[0].project).toBe('test-project');
      expect(records[0].branch).toBe('main');
      expect(records[0].aiTool).toBe('haiku');
      expect(records[0].totalCost).toBeGreaterThan(0);
    });

    it('should handle multiple days and models', () => {
      const mockData: StatsCacheData = {
        version: 1,
        lastComputedDate: '2026-03-05',
        dailyActivity: [],
        dailyModelTokens: [
          {
            date: '2026-03-04',
            tokensByModel: {
              'claude-haiku': 500,
              'claude-sonnet': 1000,
            },
          },
          {
            date: '2026-03-05',
            tokensByModel: {
              'claude-haiku': 500,
            },
          },
        ],
        modelUsage: {
          'claude-haiku': {
            inputTokens: 2000,
            outputTokens: 2000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.06,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
          'claude-sonnet': {
            inputTokens: 5000,
            outputTokens: 5000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.3,
            webSearchRequests: 0,
            contextWindow: 200000,
            maxOutputTokens: 4096,
          },
        },
      };

      const records = StatsCacheService.convertToProjectBranchRecords(
        mockData,
        'my-app',
        'develop'
      );

      expect(records.length).toBeGreaterThan(0);
      expect(records.every(r => r.project === 'my-app')).toBe(true);
    });
  });

  describe('getCacheFileModificationTime', () => {
    it('should return modification time if file exists', () => {
      const mockMtime = 1709596800000;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({
        mtimeMs: mockMtime,
      } as any);

      const mtime = StatsCacheService.getCacheFileModificationTime('~/.claude/stats-cache.json');
      expect(mtime).toBe(mockMtime);
    });

    it('should return null if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const mtime = StatsCacheService.getCacheFileModificationTime('/nonexistent/file.json');
      expect(mtime).toBeNull();
    });

    it('should return null on error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      const mtime = StatsCacheService.getCacheFileModificationTime('/path/file.json');
      expect(mtime).toBeNull();
    });
  });
});
