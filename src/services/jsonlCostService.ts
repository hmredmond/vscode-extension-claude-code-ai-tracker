/**
 * JSONL Cost Service
 *
 * Processes JSONL (JSON Lines) log files from ~/.claude/projects to extract and aggregate
 * cost data. Handles file discovery, JSONL parsing, and cost calculation with deduplication.
 *
 * Key functions:
 * - findAllJsonlFiles(): Recursively finds all .jsonl files in ~/.claude/projects
 * - parseJsonlFile(): Parses a single JSONL file and extracts cost records
 * - importAllJsonlCosts(): Orchestrates finding and parsing all JSONL files with deduplication
 *
 * Usage: Import historical Claude API usage costs from project log files
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { calculateCost } from '../utils/pricing';
import { CostRecord } from '../types';

interface JsonlMessage {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface JsonlEntry {
  message?: JsonlMessage;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  type?: string;
  sessionId?: string;
  requestId?: string;
}

export class JsonlCostService {
  private static _sessionCostIndex: Map<string, number> = new Map();
  private static _indexBuilt = false;

  /** Build a session ID → total cost map from all JSONL files, deduplicating by message ID. */
  static async buildSessionCostIndex(): Promise<void> {
    const files = await this.findAllJsonlFiles();
    const index = new Map<string, number>();
    // Deduplicate the same way generate-data.js does: by messageId + requestId
    const seen = new Set<string>();

    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as JsonlEntry;
            if (entry.type !== 'assistant' || !entry.message?.usage || !entry.sessionId) continue;
            const msgId = entry.message.id || '';
            const reqId = entry.requestId || '';
            const dedupeKey = `${msgId}-${reqId}`;
            if (dedupeKey !== '-' && seen.has(dedupeKey)) continue;
            if (dedupeKey !== '-') seen.add(dedupeKey);
            const usage = entry.message.usage;
            const model = entry.message.model;
            if (!model) continue;
            const cost = calculateCost(
              model,
              usage.input_tokens ?? 0,
              usage.output_tokens ?? 0,
              usage.cache_read_input_tokens ?? 0,
              usage.cache_creation_input_tokens ?? 0,
            );
            index.set(entry.sessionId, (index.get(entry.sessionId) ?? 0) + cost);
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    this._sessionCostIndex = index;
    this._indexBuilt = true;
  }

  /** Returns the cached session cost index (empty if not yet built). */
  static getSessionCostIndex(): Map<string, number> {
    return this._sessionCostIndex;
  }

  static expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(homeDir, filePath.slice(1));
    }
    return filePath;
  }

  static extractProjectName(cwd: string): string {
    // Extract project name from path like:
    // /Users/Hannah.Redmond/Documents/Code/Projects/personal/vscode-extensions/ai-usage-cost-vscode-extension
    // Returns: ai-usage-cost-vscode-extension
    const parts = cwd.split(path.sep);
    return parts[parts.length - 1] || 'unknown';
  }

  static async findAllJsonlFiles(): Promise<string[]> {
    const projectsDir = this.expandPath('~/.claude/projects');
    const files: string[] = [];

    if (!fs.existsSync(projectsDir)) {
      return files;
    }

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (entry.endsWith('.jsonl')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Silently skip directories we can't read
      }
    };

    walk(projectsDir);
    return files;
  }

  static async parseJsonlFile(filePath: string): Promise<CostRecord[]> {
    const records: CostRecord[] = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as JsonlEntry;

        // Only process assistant messages with usage data
        if (entry.type !== 'assistant' || !entry.message?.usage) {
          continue;
        }

        const usage = entry.message.usage;
        const model = entry.message.model;

        // Skip if missing required data
        if (!model || !entry.cwd || !entry.timestamp) {
          continue;
        }

        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0;

        // Skip if no tokens
        if (
          inputTokens === 0 &&
          outputTokens === 0 &&
          cacheReadTokens === 0 &&
          cacheCreationTokens === 0
        ) {
          continue;
        }

        const project = this.extractProjectName(entry.cwd);
        const branch = entry.gitBranch || 'main';
        const totalCost = calculateCost(
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens
        );

        const record: CostRecord = {
          timestamp: new Date(entry.timestamp).getTime(),
          project,
          branch,
          aiTool: model.replace('claude-', ''),
          totalCost,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        };

        records.push(record);
      } catch (error) {
        // Silently skip malformed lines
      }
    }

    return records;
  }

  static async importAllJsonlCosts(): Promise<{
    records: CostRecord[];
    fileCount: number;
    totalCost: number;
  }> {
    const allRecords: CostRecord[] = [];
    const files = await this.findAllJsonlFiles();

    for (const file of files) {
      const records = await this.parseJsonlFile(file);
      allRecords.push(...records);
    }

    // Deduplicate by timestamp + project + branch + model
    const seen = new Set<string>();
    const deduplicated: CostRecord[] = [];

    for (const record of allRecords) {
      const key = `${record.timestamp}|${record.project}|${record.branch}|${record.aiTool}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(record);
      }
    }

    const totalCost = deduplicated.reduce((sum, r) => sum + r.totalCost, 0);

    return {
      records: deduplicated,
      fileCount: files.length,
      totalCost,
    };
  }
}
