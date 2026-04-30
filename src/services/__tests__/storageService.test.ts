import { StorageService } from '../storageService';
import { CostRecord } from '../../types';

describe('StorageService', () => {
  let mockMemento: any;
  let storageService: StorageService;
  let storage: Map<string, any>;

  beforeEach(() => {
    storage = new Map();

    mockMemento = {
      get: jest.fn((key: string, defaultValue?: any) => {
        return storage.has(key) ? storage.get(key) : defaultValue;
      }),
      update: jest.fn((key: string, value: any) => {
        if (value === undefined) {
          storage.delete(key);
        } else {
          storage.set(key, value);
        }
      }),
    };

    storageService = new StorageService(mockMemento);
  });

  describe('append', () => {
    it('should append a cost record', () => {
      const record: CostRecord = {
        timestamp: Date.now(),
        project: 'test-project',
        branch: 'main',
        aiTool: 'claude',
        totalCost: 10.5,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(record);

      const key = 'aiUsageCost::test-project::main';
      const stored = storage.get(key);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(record);
    });

    it('should append multiple records to same project/branch', () => {
      const record1: CostRecord = {
        timestamp: 1000,
        project: 'project-a',
        branch: 'main',
        aiTool: 'claude',
        totalCost: 5,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      const record2: CostRecord = {
        timestamp: 2000,
        project: 'project-a',
        branch: 'main',
        aiTool: 'claude',
        totalCost: 7,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(record1);
      storageService.append(record2);

      const key = 'aiUsageCost::project-a::main';
      const stored = storage.get(key);
      expect(stored).toHaveLength(2);
      expect(stored[1]).toEqual(record2);
    });

    it('should register key in registry', () => {
      const record: CostRecord = {
        timestamp: Date.now(),
        project: 'test',
        branch: 'dev',
        aiTool: 'claude',
        totalCost: 1,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(record);

      const registry = storage.get('aiUsageCost::__keys__');
      expect(registry).toContain('aiUsageCost::test::dev');
    });

    it('should not duplicate keys in registry', () => {
      const record1: CostRecord = {
        timestamp: 1000,
        project: 'p',
        branch: 'b',
        aiTool: 'claude',
        totalCost: 1,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      const record2: CostRecord = {
        timestamp: 2000,
        project: 'p',
        branch: 'b',
        aiTool: 'claude',
        totalCost: 2,
        inputTokens: 20,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(record1);
      storageService.append(record2);

      const registry = storage.get('aiUsageCost::__keys__');
      const keyCount = registry.filter((k: string) => k === 'aiUsageCost::p::b').length;
      expect(keyCount).toBe(1);
    });
  });

  describe('getHistory', () => {
    it('should return empty array for non-existent project/branch', () => {
      const history = storageService.getHistory('unknown', 'unknown');
      expect(history).toEqual([]);
    });

    it('should return history for project/branch', () => {
      const record: CostRecord = {
        timestamp: Date.now(),
        project: 'myproject',
        branch: 'feature',
        aiTool: 'claude',
        totalCost: 3.5,
        inputTokens: 500,
        outputTokens: 250,
        cacheReadTokens: 100,
        cacheCreationTokens: 0,
      };

      storageService.append(record);
      const history = storageService.getHistory('myproject', 'feature');

      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(record);
    });
  });

  describe('getLatestForProject', () => {
    it('should return undefined when no records exist', () => {
      const latest = storageService.getLatestForProject('nonexistent');
      expect(latest).toBeUndefined();
    });

    it('should return latest record by timestamp across all branches', () => {
      const oldRecord: CostRecord = {
        timestamp: 1000,
        project: 'myapp',
        branch: 'main',
        aiTool: 'claude',
        totalCost: 1,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      const newRecord: CostRecord = {
        timestamp: 5000,
        project: 'myapp',
        branch: 'develop',
        aiTool: 'claude',
        totalCost: 2,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(oldRecord);
      storageService.append(newRecord);

      const latest = storageService.getLatestForProject('myapp');
      expect(latest?.timestamp).toBe(5000);
      expect(latest?.branch).toBe('develop');
    });

    it('should find latest across multiple branches', () => {
      const records: CostRecord[] = [
        { timestamp: 1000, project: 'app', branch: 'main', aiTool: 'claude', totalCost: 1, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 },
        { timestamp: 3000, project: 'app', branch: 'develop', aiTool: 'claude', totalCost: 2, inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
        { timestamp: 2000, project: 'app', branch: 'feature', aiTool: 'claude', totalCost: 1.5, inputTokens: 150, outputTokens: 75, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ];

      records.forEach(r => storageService.append(r));
      const latest = storageService.getLatestForProject('app');

      expect(latest?.timestamp).toBe(3000);
      expect(latest?.branch).toBe('develop');
    });
  });

  describe('clearForProjectBranch', () => {
    it('should clear records for specific project/branch', () => {
      const record: CostRecord = {
        timestamp: Date.now(),
        project: 'proj',
        branch: 'br',
        aiTool: 'claude',
        totalCost: 1,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(record);
      storageService.clearForProjectBranch('proj', 'br');

      const history = storageService.getHistory('proj', 'br');
      expect(history).toEqual([]);
    });

    it('should remove key from registry', () => {
      const record: CostRecord = {
        timestamp: Date.now(),
        project: 'x',
        branch: 'y',
        aiTool: 'claude',
        totalCost: 1,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(record);
      storageService.clearForProjectBranch('x', 'y');

      const keys = storageService.getAllKeys();
      expect(keys).not.toContain('aiUsageCost::x::y');
    });

    it('should preserve other project/branch records', () => {
      const record1: CostRecord = {
        timestamp: Date.now(),
        project: 'proj1',
        branch: 'main',
        aiTool: 'claude',
        totalCost: 1,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      const record2: CostRecord = {
        timestamp: Date.now(),
        project: 'proj2',
        branch: 'main',
        aiTool: 'claude',
        totalCost: 2,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      storageService.append(record1);
      storageService.append(record2);
      storageService.clearForProjectBranch('proj1', 'main');

      expect(storageService.getHistory('proj1', 'main')).toEqual([]);
      expect(storageService.getHistory('proj2', 'main')).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should clear all data', () => {
      const records: CostRecord[] = [
        { timestamp: 1000, project: 'p1', branch: 'b1', aiTool: 'claude', totalCost: 1, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 },
        { timestamp: 2000, project: 'p2', branch: 'b2', aiTool: 'claude', totalCost: 2, inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ];

      records.forEach(r => storageService.append(r));
      storageService.clear();

      expect(storageService.getAllKeys()).toEqual([]);
      expect(storageService.getHistory('p1', 'b1')).toEqual([]);
      expect(storageService.getHistory('p2', 'b2')).toEqual([]);
    });
  });
});
