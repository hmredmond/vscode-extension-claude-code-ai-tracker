/**
 * AI Stats Data Service
 *
 * Generates and manages AI usage statistics by running a generate-data.js script.
 * Reads aggregated usage data from ai-stats-data.json file in the extension directory.
 *
 * Key functions:
 * - setExtensionPath(uri): Sets the extension installation path
 * - getDataPath(): Returns path to ai-stats-data.json
 * - getData(): Reads and returns current AI stats data
 * - run(outputChannel): Executes data generation script with output streaming
 * - runAndGet(outputChannel): Generates new data and returns results
 *
 * Usage: Generate and retrieve comprehensive AI API usage and cost statistics
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as vscode from "vscode";

export interface AiStatsData {
  generated_at: string;
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    count: number;
  };
  hourly: Record<string, any>;
  daily: Record<string, any>;
  weekly: Record<string, any>;
  monthly: Record<string, any>;
  projects: Record<string, any>;
  skills: any[];
  tools: any[];
  dashboard?: any; // Dashboard-compatible format
}

export class AiStatsDataService {
  private static readonly dataFileName = "ai-stats-data.json";
  private static extensionPath: string = "";

  /**
   * Initialize with the extension path
   */
  static setExtensionPath(extensionUri: vscode.Uri): void {
    this.extensionPath = extensionUri.fsPath;
  }

  /**
   * Get the path to ai-stats-data.json
   */
  static getDataPath(): string {
    if (!this.extensionPath) {
      throw new Error(
        "AiStatsDataService not initialized. Call setExtensionPath first."
      );
    }
    return path.join(this.extensionPath, this.dataFileName);
  }

  /**
   * Get the path to generate-data.js
   */
  private static getScriptPath(): string {
    if (!this.extensionPath) {
      throw new Error(
        "AiStatsDataService not initialized. Call setExtensionPath first."
      );
    }
    return path.join(this.extensionPath, "generate-data.js");
  }

  /**
   * Run generate-data.js and stream output to the output channel
   */
  static async run(outputChannel: vscode.OutputChannel): Promise<void> {
    return new Promise((resolve, reject) => {
      const scriptPath = this.getScriptPath();

      if (!fs.existsSync(scriptPath)) {
        const err = `generate-data.js not found at ${scriptPath}`;
        outputChannel.appendLine(`❌ Error: ${err}`);
        reject(new Error(err));
        return;
      }

      outputChannel.appendLine("\n--- Running generate-data.js ---");
      outputChannel.appendLine(`Working directory: ${this.extensionPath}`);

      const customPricing = vscode.workspace
        .getConfiguration("aiUsageCost")
        .get<Record<string, unknown>>("customModelPricing", {});

      const node = spawn("node", [scriptPath], {
        cwd: this.extensionPath,
        env: {
          ...process.env,
          AIUSAGECOST_PRICING_JSON: JSON.stringify(customPricing),
        },
      });

      let stderrData = "";

      node.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        outputChannel.append(text);
      });

      node.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        stderrData += text;
        outputChannel.append(text);
      });

      node.on("close", (code: number) => {
        if (code === 0) {
          outputChannel.appendLine(
            `✅ generate-data.js completed successfully`
          );
          resolve();
        } else {
          const errMsg = `generate-data.js exited with code ${code}`;
          outputChannel.appendLine(`❌ ${errMsg}`);
          outputChannel.appendLine(`stderr: ${stderrData}`);
          reject(new Error(errMsg));
        }
      });

      node.on("error", (err: Error) => {
        const errMsg = `Failed to spawn node: ${err.message}`;
        outputChannel.appendLine(`❌ ${errMsg}`);
        reject(new Error(errMsg));
      });
    });
  }

  /**
   * Read and parse ai-stats-data.json
   */
  static async getData(): Promise<AiStatsData | null> {
    const dataPath = this.getDataPath();

    if (!fs.existsSync(dataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(dataPath, "utf-8");
      return JSON.parse(content) as AiStatsData;
    } catch (error) {
      return null;
    }
  }

  /**
   * Run the script and return the data in one call
   */
  static async runAndGet(
    outputChannel: vscode.OutputChannel
  ): Promise<AiStatsData | null> {
    try {
      await this.run(outputChannel);
      return await this.getData();
    } catch (error) {
      outputChannel.appendLine(
        `⚠️  Warning: Could not run generate-data.js: ${error instanceof Error ? error.message : String(error)}`
      );
      // Try to return cached data even if run failed
      return await this.getData();
    }
  }
}
