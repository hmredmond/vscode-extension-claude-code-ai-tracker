/**
 * Claude Projects Service
 *
 * Analyzes Claude usage statistics from ~/.claude/projects JSONL files.
 * Aggregates usage data by project, calculates costs, and provides hourly/daily breakdowns.
 *
 * Key functions:
 * - getAllRecords(): Extracts all usage records from project files
 * - getHourlyBreakdown(date): Aggregates hourly usage stats for a given day
 * - getDailyComparison(days): Compares daily usage over N days
 * - getTodaysSummary(): Returns today's usage statistics
 * - getProjectsSummary(): Summarizes usage by project
 *
 * Usage: Generate reports and analytics on Claude API usage patterns
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as os from "os";

interface UsageRecord {
  timestamp: Date;
  cost: number;
  billedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface HourlyData {
  hour: number;
  cost: number;
  billedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokens?: number;
  count: number;
}

interface DailyData {
  date: string;
  cost: number;
  billedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokens?: number;
  count: number;
}

// Pricing per 1M tokens (official Anthropic rates Feb 2026)
const PRICING = {
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
  "claude-sonnet-4-5-20250929": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
};

export class ClaudeProjectsService {
  private static projectsDir = path.join(os.homedir(), ".claude", "projects");

  private static calculateCost(usage: any, model: string): number {
    const pricing = (PRICING as any)[model] || {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const inputCost = ((usage.input_tokens || 0) / 1_000_000) * pricing.input;
    const outputCost =
      ((usage.output_tokens || 0) / 1_000_000) * pricing.output;
    const cacheReadCost =
      ((usage.cache_read_input_tokens || 0) / 1_000_000) * pricing.cacheRead;
    const cacheWriteCost =
      ((usage.cache_creation_input_tokens || 0) / 1_000_000) *
      pricing.cacheWrite;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  private static getBilledTokens(usage: any): number {
    return (usage.input_tokens || 0) + (usage.output_tokens || 0);
  }

  private static getCacheReadTokens(usage: any): number {
    return usage.cache_read_input_tokens || 0;
  }

  private static getCacheWriteTokens(usage: any): number {
    return usage.cache_creation_input_tokens || 0;
  }

  private static async extractUsageFromFile(
    filePath: string,
  ): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];

    if (!fs.existsSync(filePath)) {
      return records;
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      try {
        const record = JSON.parse(line);
        if (
          record.message &&
          record.message.usage &&
          record.timestamp &&
          record.message.model
        ) {
          const cost = this.calculateCost(
            record.message.usage,
            record.message.model,
          );
          const billedTokens = this.getBilledTokens(record.message.usage);
          const cacheReadTokens = this.getCacheReadTokens(record.message.usage);
          const cacheWriteTokens = this.getCacheWriteTokens(
            record.message.usage,
          );
          records.push({
            timestamp: new Date(record.timestamp),
            cost,
            billedTokens,
            cacheReadTokens,
            cacheWriteTokens,
          });
        }
      } catch (e) {
        // Skip invalid JSON lines
      }
    }

    return records;
  }

  static async getAllRecords(): Promise<UsageRecord[]> {
    const allRecords: UsageRecord[] = [];

    if (!fs.existsSync(this.projectsDir)) {
      return allRecords;
    }

    const projectFolders = fs
      .readdirSync(this.projectsDir)
      .filter((f) => fs.statSync(path.join(this.projectsDir, f)).isDirectory())
      .map((f) => path.join(this.projectsDir, f));

    for (const projectPath of projectFolders) {
      try {
        const files = fs
          .readdirSync(projectPath)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => path.join(projectPath, f));

        for (const file of files) {
          const fileRecords = await this.extractUsageFromFile(file);
          allRecords.push(...fileRecords);
        }
      } catch (e) {
        // Skip folders that can't be read
      }
    }

    return allRecords;
  }

  static async getHourlyBreakdown(
    date: Date = new Date(),
  ): Promise<HourlyData[]> {
    const allRecords = await this.getAllRecords();
    const hourlyData: Map<number, HourlyData> = new Map();

    for (let hour = 0; hour < 24; hour++) {
      const hourStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hour,
        0,
        0,
      );
      const hourEnd = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hour + 1,
        0,
        0,
      );

      const hourRecords = allRecords.filter(
        (r) => r.timestamp >= hourStart && r.timestamp < hourEnd,
      );

      if (hourRecords.length > 0) {
        const cost = hourRecords.reduce((sum, r) => sum + r.cost, 0);
        const billedTokens = hourRecords.reduce(
          (sum, r) => sum + r.billedTokens,
          0,
        );
        const cacheReadTokens = hourRecords.reduce(
          (sum, r) => sum + r.cacheReadTokens,
          0,
        );
        const cacheWriteTokens = hourRecords.reduce(
          (sum, r) => sum + r.cacheWriteTokens,
          0,
        );
        const tokens = billedTokens + cacheReadTokens + cacheWriteTokens;
        hourlyData.set(hour, {
          hour,
          cost,
          billedTokens,
          cacheReadTokens,
          cacheWriteTokens,
          tokens,
          count: hourRecords.length,
        });
      }
    }

    return Array.from(hourlyData.values());
  }

  static async getDailyComparison(days: number = 7): Promise<DailyData[]> {
    const allRecords = await this.getAllRecords();
    const dailyData: Map<string, DailyData> = new Map();
    const today = new Date();

    for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString().split("T")[0];

      const dayRecords = allRecords.filter(
        (r) => r.timestamp.toISOString().split("T")[0] === dateStr,
      );

      if (dayRecords.length > 0) {
        const cost = dayRecords.reduce((sum, r) => sum + r.cost, 0);
        const billedTokens = dayRecords.reduce(
          (sum, r) => sum + r.billedTokens,
          0,
        );
        const cacheReadTokens = dayRecords.reduce(
          (sum, r) => sum + r.cacheReadTokens,
          0,
        );
        const cacheWriteTokens = dayRecords.reduce(
          (sum, r) => sum + r.cacheWriteTokens,
          0,
        );
        const tokens = billedTokens + cacheReadTokens + cacheWriteTokens;
        dailyData.set(dateStr, {
          date: dateStr,
          cost,
          billedTokens,
          cacheReadTokens,
          cacheWriteTokens,
          tokens,
          count: dayRecords.length,
        });
      }
    }

    return Array.from(dailyData.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  static async getTodaysSummary() {
    const today = new Date().toISOString().split("T")[0];
    const allRecords = await this.getAllRecords();
    const todayRecords = allRecords.filter(
      (r) => r.timestamp.toISOString().split("T")[0] === today,
    );

    const totalCost = todayRecords.reduce((sum, r) => sum + r.cost, 0);
    const totalBilledTokens = todayRecords.reduce(
      (sum, r) => sum + r.billedTokens,
      0,
    );
    const totalCacheReadTokens = todayRecords.reduce(
      (sum, r) => sum + r.cacheReadTokens,
      0,
    );
    const totalCacheWriteTokens = todayRecords.reduce(
      (sum, r) => sum + r.cacheWriteTokens,
      0,
    );
    const totalTokens =
      totalBilledTokens + totalCacheReadTokens + totalCacheWriteTokens;

    return {
      date: today,
      cost: totalCost,
      tokens: totalTokens,
      billedTokens: totalBilledTokens,
      cacheReadTokens: totalCacheReadTokens,
      cacheWriteTokens: totalCacheWriteTokens,
      count: todayRecords.length,
    };
  }

  static async getTodaysSummaryByProject() {
    const today = new Date().toISOString().split("T")[0];
    const projectSummary: any = {};

    if (!fs.existsSync(this.projectsDir)) {
      return projectSummary;
    }

    const projectFolders = fs
      .readdirSync(this.projectsDir)
      .filter((f) => fs.statSync(path.join(this.projectsDir, f)).isDirectory());

    for (const projectFolder of projectFolders) {
      const projectPath = path.join(this.projectsDir, projectFolder);
      const projectRecords: UsageRecord[] = [];

      try {
        const files = fs
          .readdirSync(projectPath)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => path.join(projectPath, f));

        for (const file of files) {
          const fileRecords = await this.extractUsageFromFile(file);
          projectRecords.push(...fileRecords);
        }
      } catch (e) {
        // Skip folders that can't be read
        continue;
      }

      const todayRecords = projectRecords.filter(
        (r) => r.timestamp.toISOString().split("T")[0] === today,
      );
      if (todayRecords.length > 0) {
        const cost = todayRecords.reduce((sum, r) => sum + r.cost, 0);
        const billedTokens = todayRecords.reduce(
          (sum, r) => sum + r.billedTokens,
          0,
        );
        const cacheReadTokens = todayRecords.reduce(
          (sum, r) => sum + r.cacheReadTokens,
          0,
        );
        const cacheWriteTokens = todayRecords.reduce(
          (sum, r) => sum + r.cacheWriteTokens,
          0,
        );

        projectSummary[projectFolder] = {
          cost,
          billedTokens,
          cacheReadTokens,
          cacheWriteTokens,
          count: todayRecords.length,
        };
      }
    }

    return projectSummary;
  }

  static async getProjectsSummary() {
    const today = new Date().toISOString().split("T")[0];
    const projectSummary: Record<
      string,
      {
        cost: number;
        billedTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        recordCount: number;
      }
    > = {};

    // Group records by project folder
    if (!fs.existsSync(this.projectsDir)) {
      return projectSummary;
    }

    const projectFolders = fs
      .readdirSync(this.projectsDir)
      .filter((f) => fs.statSync(path.join(this.projectsDir, f)).isDirectory());

    // Get all workspace folders for mapping
    // Workspace folder mapping removed (no vscode dependency)
    const workspaceFolders: string[] = [];

    for (const projectFolder of projectFolders) {
      const projectPath = path.join(this.projectsDir, projectFolder);
      const projectRecords: UsageRecord[] = [];

      try {
        const files = fs
          .readdirSync(projectPath)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => path.join(projectPath, f));

        for (const file of files) {
          const fileRecords = await this.extractUsageFromFile(file);
          projectRecords.push(...fileRecords);
        }
      } catch (e) {
        continue;
      }

      const todayRecords = projectRecords.filter(
        (r) => r.timestamp.toISOString().split("T")[0] === today,
      );
      if (todayRecords.length > 0) {
        const cost = todayRecords.reduce((sum, r) => sum + r.cost, 0);
        const billedTokens = todayRecords.reduce(
          (sum, r) => sum + r.billedTokens,
          0,
        );
        const cacheReadTokens = todayRecords.reduce(
          (sum, r) => sum + r.cacheReadTokens,
          0,
        );
        const cacheWriteTokens = todayRecords.reduce(
          (sum, r) => sum + r.cacheWriteTokens,
          0,
        );

        // Try to match the project folder to a workspace folder
        let projectName = projectFolder;
        // Remove leading dash and user path prefix if present
        projectName = projectName.replace(
          /^-Users-Hannah-Redmond-Documents-Code-Projects-/,
          "",
        );
        // Fallback: show the last segment after splitting by dash
        const parts = projectName.split("-");
        projectName = parts[parts.length - 1];

        projectSummary[projectName] = {
          cost,
          billedTokens,
          cacheReadTokens,
          cacheWriteTokens,
          recordCount: todayRecords.length,
        };
      }
    }

    // Sort by cost descending
    const sorted: Record<string, any> = {};
    Object.entries(projectSummary)
      .sort((a, b) => b[1].cost - a[1].cost)
      .forEach(([name, data]) => {
        sorted[name] = data;
      });

    return sorted;
  }
}
