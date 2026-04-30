/**
 * JSONL Cost Service Tests
 *
 * Tests for jsonlCostService.ts - validates JSONL file discovery, parsing, and cost aggregation.
 * Covers file system operations, JSONL parsing, cost calculation, and deduplication logic.
 *
 * Test coverage:
 * - Path expansion and environment variable handling
 * - Project name extraction from file paths
 * - JSONL file discovery in nested directories
 * - File filtering and content parsing
 * - Cost record extraction and aggregation
 * - Deduplication of records
 * - Error handling for file I/O failures
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import * as path from 'node:path';

jest.mock('node:fs');
jest.mock('node:path');
jest.mock('node:readline');

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { JsonlCostService } from '../jsonlCostService';

describe('JsonlCostService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default path.join mock to work like the real function
    (path.join as jest.Mock).mockImplementation((...args) => {
      return args.join('/');
    });
    process.env.HOME = '/Users/testuser';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('expandPath', () => {
    it('should expand tilde to home directory', () => {
      process.env.HOME = '/home/user';
      const result = JsonlCostService.expandPath('~/.claude/projects');
      expect(result).toContain('/home/user');
      expect(result).toContain('.claude/projects');
    });

    it('should return path as-is if not starting with tilde', () => {
      const result = JsonlCostService.expandPath('/absolute/path');
      expect(result).toBe('/absolute/path');
    });

    it('should use USERPROFILE on Windows if HOME is not set', () => {
      const originalHome = process.env.HOME;
      delete process.env.HOME;
      process.env.USERPROFILE = 'C:\\Users\\testuser';

      const result = JsonlCostService.expandPath('~/.config');
      expect(result).toContain('C:\\Users\\testuser');

      if (originalHome) {
        process.env.HOME = originalHome;
      }
    });

    it('should handle relative paths without tilde', () => {
      const result = JsonlCostService.expandPath('./local/path');
      expect(result).toBe('./local/path');
    });
  });

  describe('extractProjectName', () => {
    it('should extract project name from full path', () => {
      const cwd = '/Users/Hannah.Redmond/Documents/Code/Projects/personal/my-project';
      const result = JsonlCostService.extractProjectName(cwd);
      expect(result).toBe('my-project');
    });

    it('should handle paths with trailing slashes', () => {
      const cwd = '/Users/Hannah.Redmond/projects/my-app/';
      const result = JsonlCostService.extractProjectName(cwd);
      // When split by /, last element would be empty string, which is falsy, so returns 'unknown'
      expect(result).toBe('unknown');
    });

    it('should return "unknown" for empty path', () => {
      const cwd = '';
      const result = JsonlCostService.extractProjectName(cwd);
      expect(result).toBe('unknown');
    });

    it('should handle single-level path', () => {
      const cwd = 'project-name';
      const result = JsonlCostService.extractProjectName(cwd);
      expect(result).toBe('project-name');
    });

    it('should handle path with many segments', () => {
      const cwd = '/very/deep/nested/project/structure/final-project';
      const result = JsonlCostService.extractProjectName(cwd);
      expect(result).toBe('final-project');
    });
  });

  describe('findAllJsonlFiles', () => {
    it('should return empty array when projects directory does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await JsonlCostService.findAllJsonlFiles();

      expect(result).toEqual([]);
    });

    it('should find JSONL files in nested directories', async () => {
      const projectsDir = '/home/user/.claude/projects';
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      (fs.readdirSync as jest.Mock).mockImplementation((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr === projectsDir) {
          return ['project1', 'project2'];
        }
        if (dirStr.includes('project1')) {
          return ['data.jsonl'];
        }
        if (dirStr.includes('project2')) {
          return ['logs.jsonl', 'other.txt'];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockImplementation((fullPath: unknown) => {
        const pathStr = String(fullPath);
        const isDir = !pathStr.endsWith('.jsonl') && !pathStr.endsWith('.txt');
        return { isDirectory: () => isDir };
      });

      // Spy on expandPath and return a known value
      jest.spyOn(JsonlCostService, 'expandPath').mockReturnValue(projectsDir);

      const result = await JsonlCostService.findAllJsonlFiles();

      expect(result.length).toBe(2);
      expect(result.some((f) => f.includes('data.jsonl'))).toBe(true);
      expect(result.some((f) => f.includes('logs.jsonl'))).toBe(true);
    });

    it('should skip non-JSONL files', async () => {
      const projectsDir = '/home/user/.claude/projects';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['file.txt', 'data.jsonl', 'script.js']);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

      jest.spyOn(JsonlCostService, 'expandPath').mockReturnValue(projectsDir);

      const result = await JsonlCostService.findAllJsonlFiles();

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('data.jsonl'))).toBe(true);
    });

    it('should handle read errors gracefully', async () => {
      const projectsDir = '/home/user/.claude/projects';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      jest.spyOn(JsonlCostService, 'expandPath').mockReturnValue(projectsDir);

      const result = await JsonlCostService.findAllJsonlFiles();

      expect(result).toEqual([]);
    });
  });

  describe('parseJsonlFile', () => {
    const createMockRl = (entries: string[]) => ({
      [Symbol.asyncIterator]: jest.fn(async function* () {
        for (const entry of entries) {
          yield entry;
        }
      }),
    });

    it('should parse valid JSONL entries and extract cost records', async () => {
      const mockEntries = [
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-3-sonnet-20240229',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 10,
              cache_creation_input_tokens: 5,
            },
          },
          cwd: '/Users/Hannah.Redmond/Documents/Code/Projects/my-project',
          gitBranch: 'main',
          timestamp: '2026-03-05T10:00:00Z',
        }),
      ];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('timestamp');
      expect(result[0]).toHaveProperty('project', 'my-project');
      expect(result[0]).toHaveProperty('branch', 'main');
      expect(result[0]).toHaveProperty('inputTokens', 100);
      expect(result[0]).toHaveProperty('outputTokens', 50);
      expect(result[0]).toHaveProperty('cacheReadTokens', 10);
      expect(result[0]).toHaveProperty('cacheCreationTokens', 5);
    });

    it('should skip non-assistant messages', async () => {
      const mockEntries = [
        JSON.stringify({
          type: 'user',
          message: {
            model: 'claude-3-sonnet-20240229',
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          cwd: '/project',
          timestamp: '2026-03-05T10:00:00Z',
        }),
      ];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(0);
    });

    it('should skip entries without usage data', async () => {
      const mockEntries = [
        JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-3-sonnet-20240229' },
          cwd: '/project',
          timestamp: '2026-03-05T10:00:00Z',
        }),
      ];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(0);
    });

    it('should skip entries missing required fields (model, cwd, timestamp)', async () => {
      const mockEntries = [
        JSON.stringify({
          type: 'assistant',
          message: {
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          // Missing cwd and timestamp
        }),
      ];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(0);
    });

    it('should skip entries with zero tokens', async () => {
      const mockEntries = [
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-3-sonnet-20240229',
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          cwd: '/project',
          timestamp: '2026-03-05T10:00:00Z',
        }),
      ];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(0);
    });

    it('should skip empty lines', async () => {
      const mockEntries = ['', '  ', '\n'];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(0);
    });

    it('should skip malformed JSON lines', async () => {
      const mockEntries = ['invalid json {]'];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(0);
    });

    it('should use default branch "main" if gitBranch is not provided', async () => {
      const mockEntries = [
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-3-sonnet-20240229',
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          cwd: '/project',
          timestamp: '2026-03-05T10:00:00Z',
          // gitBranch is omitted
        }),
      ];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result).toHaveLength(1);
      expect(result[0].branch).toBe('main');
    });

    it('should extract aiTool name from model', async () => {
      const mockEntries = [
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-3-opus-20240229',
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          cwd: '/project',
          timestamp: '2026-03-05T10:00:00Z',
        }),
      ];

      const mockRl = createMockRl(mockEntries);

      (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
      (fs.createReadStream as jest.Mock).mockReturnValue({});

      const result = await JsonlCostService.parseJsonlFile('/path/to/file.jsonl');

      expect(result[0].aiTool).toBe('3-opus-20240229');
    });
  });

  describe('importAllJsonlCosts', () => {
    it('should orchestrate finding and parsing all JSONL files', async () => {
      const record1 = {
        timestamp: 1704067200000,
        project: 'project1',
        branch: 'main',
        aiTool: '3-sonnet-20240229',
        totalCost: 0.01,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      const record2 = {
        timestamp: 1704153600000,
        project: 'project2',
        branch: 'develop',
        aiTool: '3-opus-20240229',
        totalCost: 0.02,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      jest.spyOn(JsonlCostService, 'findAllJsonlFiles').mockResolvedValue([
        '/path/to/file1.jsonl',
        '/path/to/file2.jsonl',
      ]);

      jest
        .spyOn(JsonlCostService, 'parseJsonlFile')
        .mockResolvedValueOnce([record1])
        .mockResolvedValueOnce([record2]);

      const result = await JsonlCostService.importAllJsonlCosts();

      expect(result.records).toHaveLength(2);
      expect(result.fileCount).toBe(2);
      expect(result.totalCost).toBeCloseTo(0.03, 5);
    });

    it('should deduplicate records by timestamp + project + branch + model', async () => {
      const duplicateRecord = {
        timestamp: 1704067200000,
        project: 'project1',
        branch: 'main',
        aiTool: '3-sonnet-20240229',
        totalCost: 0.01,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      jest.spyOn(JsonlCostService, 'findAllJsonlFiles').mockResolvedValue([
        '/path/to/file1.jsonl',
        '/path/to/file2.jsonl',
      ]);

      jest
        .spyOn(JsonlCostService, 'parseJsonlFile')
        .mockResolvedValueOnce([duplicateRecord])
        .mockResolvedValueOnce([duplicateRecord, { ...duplicateRecord, timestamp: 1704153600000 }]);

      const result = await JsonlCostService.importAllJsonlCosts();

      expect(result.records).toHaveLength(2);
    });

    it('should calculate correct total cost', async () => {
      jest.spyOn(JsonlCostService, 'findAllJsonlFiles').mockResolvedValue([
        '/path/to/file.jsonl',
      ]);

      jest.spyOn(JsonlCostService, 'parseJsonlFile').mockResolvedValue([
        {
          timestamp: 1704067200000,
          project: 'project1',
          branch: 'main',
          aiTool: '3-sonnet-20240229',
          totalCost: 0.01,
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        {
          timestamp: 1704153600000,
          project: 'project2',
          branch: 'main',
          aiTool: '3-opus-20240229',
          totalCost: 0.05,
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      ]);

      const result = await JsonlCostService.importAllJsonlCosts();

      expect(result.totalCost).toBeCloseTo(0.06, 5);
    });

    it('should return empty records when no files found', async () => {
      jest.spyOn(JsonlCostService, 'findAllJsonlFiles').mockResolvedValue([]);

      const result = await JsonlCostService.importAllJsonlCosts();

      expect(result.records).toHaveLength(0);
      expect(result.fileCount).toBe(0);
      expect(result.totalCost).toBe(0);
    });
  });
});
