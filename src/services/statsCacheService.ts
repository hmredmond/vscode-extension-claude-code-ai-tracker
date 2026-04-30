/**
 * Stats Cache Service
 *
 * Manages caching of AI statistics data using VS Code's global storage mechanism.
 * Provides centralized cache management for frequently accessed stats to improve performance.
 *
 * Key functions:
 * - Caches and retrieves AI usage statistics
 * - Manages cache expiration and invalidation
 * - Integrates with VS Code extension storage API
 *
 * Usage: Optimize stats retrieval performance by caching data locally
 */

import * as fs from 'fs';
import * as path from 'path';
import { calculateCost } from '../utils/pricing';
import { CostRecord } from '../types';

export interface StatsCacheData {
  version: number;
  lastComputedDate: string;
  dailyActivity: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  dailyModelTokens: Array<{
    date: string;
    tokensByModel: Record<string, number>;
  }>;
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
      webSearchRequests: number;
      contextWindow: number;
      maxOutputTokens: number;
    }
  >;
}

export class StatsCacheService {
  static expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(homeDir, filePath.slice(1));
    }
    return filePath;
  }

  static readCacheFile(cachePath: string): StatsCacheData {
    const expandedPath = this.expandPath(cachePath);

    if (!fs.existsSync(expandedPath)) {
      throw new Error(`Stats cache file not found at: ${expandedPath}`);
    }

    const fileContent = fs.readFileSync(expandedPath, 'utf-8');
    const data = JSON.parse(fileContent) as StatsCacheData;

    if (!data.modelUsage) {
      throw new Error('Invalid stats cache format: missing modelUsage');
    }

    return data;
  }

  static convertToProjectBranchRecords(
    cacheData: StatsCacheData,
    project: string,
    branch: string
  ): CostRecord[] {
    const records: CostRecord[] = [];

    // Calculate total tokens and costs per model across all days
    const modelTotals: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        cost: number;
      }
    > = {};

    for (const [modelName, modelData] of Object.entries(
      cacheData.modelUsage || {}
    )) {
      const cost = calculateCost(
        modelName,
        modelData.inputTokens,
        modelData.outputTokens,
        modelData.cacheReadInputTokens,
        modelData.cacheCreationInputTokens
      );

      modelTotals[modelName] = {
        inputTokens: modelData.inputTokens,
        outputTokens: modelData.outputTokens,
        cacheReadInputTokens: modelData.cacheReadInputTokens,
        cacheCreationInputTokens: modelData.cacheCreationInputTokens,
        cost,
      };
    }

    // Create daily records with proportional costs
    for (const dailyData of cacheData.dailyModelTokens || []) {
      const date = new Date(dailyData.date);
      const timestamp = date.getTime();

      for (const [modelName, dailyTokens] of Object.entries(
        dailyData.tokensByModel || {}
      )) {
        const modelTotal = modelTotals[modelName];
        if (!modelTotal) {
          continue;
        }

        // Calculate proportional cost based on daily tokens vs total tokens
        const totalTokens = modelTotal.inputTokens + modelTotal.outputTokens;
        const proportionalCost =
          totalTokens > 0 ? (dailyTokens / totalTokens) * modelTotal.cost : 0;

        // Proportionally distribute input/output tokens
        const totalModelInputTokens = modelTotal.inputTokens;
        const proportionalInputTokens =
          totalModelInputTokens > 0
            ? (dailyTokens / totalTokens) * totalModelInputTokens
            : 0;
        const proportionalOutputTokens = dailyTokens - proportionalInputTokens;

        const record: CostRecord = {
          timestamp,
          project,
          branch,
          aiTool: modelName.replace('claude-', ''),
          totalCost: proportionalCost,
          inputTokens: Math.round(proportionalInputTokens),
          outputTokens: Math.round(proportionalOutputTokens),
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        };

        records.push(record);
      }
    }

    return records;
  }

  static summarizeModelUsage(
    cacheData: StatsCacheData
  ): Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalCost: number;
  }> {
    const summary = [];

    for (const [modelName, data] of Object.entries(cacheData.modelUsage || {})) {
      const cost = calculateCost(
        modelName,
        data.inputTokens,
        data.outputTokens,
        data.cacheReadInputTokens,
        data.cacheCreationInputTokens
      );

      summary.push({
        model: modelName,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cacheReadTokens: data.cacheReadInputTokens,
        cacheWriteTokens: data.cacheCreationInputTokens,
        totalCost: cost,
      });
    }

    return summary.sort((a, b) => b.totalCost - a.totalCost);
  }

  static getCacheFileModificationTime(cachePath: string): number | null {
    try {
      const expandedPath = this.expandPath(cachePath);
      if (!fs.existsSync(expandedPath)) {
        return null;
      }
      const stats = fs.statSync(expandedPath);
      return stats.mtimeMs;
    } catch {
      return null;
    }
  }
}
