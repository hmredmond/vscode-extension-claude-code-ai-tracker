/**
 * Claude Stats Service
 *
 * Reads and parses Claude CLI usage statistics from the ~/.claude.json file.
 * Extracts skill and tool usage data with usage counts and timestamps.
 *
 * Key functions:
 * - getClaudeStats(): Reads ~/.claude.json and returns aggregated skill/tool usage
 *
 * Usage: Get insights into which Claude skills and tools are most frequently used
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface UsageItem {
  name: string;
  usageCount: number;
  lastUsedAt: number;
}

export interface ClaudeStats {
  skills: UsageItem[];
  tools: UsageItem[];
}

export class ClaudeStatsService {
  private static getClaudeJsonPath(): string {
    return path.join(os.homedir(), ".claude.json");
  }

  static getClaudeStats(): ClaudeStats {
    const stats: ClaudeStats = {
      skills: [],
      tools: [],
    };

    try {
      const claudeJsonPath = ClaudeStatsService.getClaudeJsonPath();
      if (!fs.existsSync(claudeJsonPath)) {
        return stats;
      }

      const fileContent = fs.readFileSync(claudeJsonPath, "utf-8");
      const claudeData = JSON.parse(fileContent);

      // Parse skills
      if (claudeData.skillUsage && typeof claudeData.skillUsage === "object") {
        for (const [name, data] of Object.entries(claudeData.skillUsage)) {
          const skillData = data as { usageCount: number; lastUsedAt: number };
          stats.skills.push({
            name,
            usageCount: skillData.usageCount || 0,
            lastUsedAt: skillData.lastUsedAt || 0,
          });
        }
      }

      // Parse tools
      if (claudeData.toolUsage && typeof claudeData.toolUsage === "object") {
        for (const [name, data] of Object.entries(claudeData.toolUsage)) {
          const toolData = data as { usageCount: number; lastUsedAt: number };
          stats.tools.push({
            name,
            usageCount: toolData.usageCount || 0,
            lastUsedAt: toolData.lastUsedAt || 0,
          });
        }
      }

      // Sort both by usage count descending
      stats.skills.sort((a, b) => b.usageCount - a.usageCount);
      stats.tools.sort((a, b) => b.usageCount - a.usageCount);

      return stats;
    } catch (error) {
      return stats;
    }
  }

}
