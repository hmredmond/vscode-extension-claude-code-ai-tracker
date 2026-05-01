import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AiStatsDataService } from "../services/aiStatsDataService";
import { getGitUsername } from "../services/gitService";
import { getNonce, getUri } from "../utils/webviewHelpers";

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

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

interface StatsCacheData {
  modelUsage: { [model: string]: ModelUsage };
  firstSessionDate?: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "aiUsageCost.sidebar";
  private currentWebview: vscode.Webview | undefined;
  private currentWebviewView: vscode.WebviewView | undefined;
  private pollInterval: NodeJS.Timeout | undefined;
  private lastUpdateTime: Date | undefined;
  private readonly outputChannel: vscode.OutputChannel;
  private configChangeListener: vscode.Disposable | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.outputChannel = vscode.window.createOutputChannel(
      "AI Usage Cost - Dashboard",
    );
  }

  private getStatsCacheData(): {
    totalCost: number;
    firstSessionDate: string | null;
  } {
    const statsCachePath = path.join(
      os.homedir(),
      ".claude",
      "stats-cache.json",
    );

    if (!fs.existsSync(statsCachePath)) {
      return { totalCost: 0, firstSessionDate: null };
    }

    try {
      const content = fs.readFileSync(statsCachePath, "utf-8");
      const data = JSON.parse(content);

      let totalCost = 0;
      if (data.modelUsage) {
        for (const [modelName, modelInfoRaw] of Object.entries(
          data.modelUsage,
        )) {
          const modelInfo = modelInfoRaw as ModelUsage;
          const pricing = (PRICING as any)[modelName] || {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          };

          const inputCost = (modelInfo.inputTokens / 1_000_000) * pricing.input;
          const outputCost =
            (modelInfo.outputTokens / 1_000_000) * pricing.output;
          const cacheReadCost =
            (modelInfo.cacheReadInputTokens / 1_000_000) * pricing.cacheRead;
          const cacheWriteCost =
            (modelInfo.cacheCreationInputTokens / 1_000_000) *
            pricing.cacheWrite;

          totalCost += inputCost + outputCost + cacheReadCost + cacheWriteCost;
        }
      }

      return {
        totalCost,
        firstSessionDate: data.firstSessionDate || null,
      };
    } catch (error) {
      return { totalCost: 0, firstSessionDate: null };
    }
  }

  private getWeekNumber(date: Date): string {
    const d = new Date(date);
    const year = d.getFullYear();
    // Match the calculation in generate-data.js
    const weekNumber = Math.ceil((d.getDate() + 6 - d.getDay()) / 7);
    return `${year}-W${String(weekNumber).padStart(2, "0")}`;
  }

  private getDailyDataFromAiStats(days: number = 7): Array<{
    date: string;
    cost: number;
    billedTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    count: number;
  }> {
    const aiStatsPath = path.join(
      this.extensionUri.fsPath,
      "ai-stats-data.json",
    );

    if (!fs.existsSync(aiStatsPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(aiStatsPath, "utf-8");
      const data = JSON.parse(content);

      if (!data.daily) {
        return [];
      }

      // Get last N days
      const dailyDates = Object.keys(data.daily).sort((a, b) =>
        b.localeCompare(a),
      );
      const result = [];

      for (let i = 0; i < days && i < dailyDates.length; i++) {
        const date = dailyDates[i];
        const dayData = data.daily[date];
        result.push({
          date,
          cost: dayData.cost || 0,
          billedTokens: (dayData.input || 0) + (dayData.output || 0),
          cacheReadTokens: dayData.cacheRead || 0,
          cacheWriteTokens: dayData.cacheWrite || 0,
          count: dayData.count || 0,
        });
      }

      return result.reverse(); // Return in chronological order
    } catch (error) {
      return [];
    }
  }

  private getAiStatsData(): {
    todayData?: {
      cost: number;
      billedTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      count: number;
    };
    thisWeekData?: {
      cost: number;
      billedTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      count: number;
    };
    allTimeData: {
      cost: number;
      billedTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      count: number;
    };
    last7DaysCost: number;
    allTimeCost: number;
    projectsSummary: { [key: string]: { cost: number; recordCount: number } };
    oldestDate: string | null;
  } {
    const aiStatsPath = path.join(
      this.extensionUri.fsPath,
      "ai-stats-data.json",
    );

    const defaultReturn = {
      allTimeData: {
        cost: 0,
        billedTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        count: 0,
      },
      last7DaysCost: 0,
      allTimeCost: 0,
      projectsSummary: {},
      oldestDate: null,
    };

    if (!fs.existsSync(aiStatsPath)) {
      return defaultReturn;
    }

    try {
      const content = fs.readFileSync(aiStatsPath, "utf-8");
      const data = JSON.parse(content);

      if (!data.daily || !data.weekly || !data.totals || !data.projects) {
        return defaultReturn;
      }

      // Get today's date in YYYY-MM-DD format (local time, not UTC)
      const date = new Date();
      const today =
        date.getFullYear() +
        "-" +
        String(date.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(date.getDate()).padStart(2, "0");
      const todayData = data.daily[today];

      // Get this week's data
      const thisWeek = this.getWeekNumber(new Date());
      const thisWeekData = data.weekly[thisWeek];

      // Calculate last 7 days total
      const dailyDates = Object.keys(data.daily).sort((a, b) =>
        b.localeCompare(a),
      );
      let last7DaysCost = 0;

      for (let i = 0; i < 7 && i < dailyDates.length; i++) {
        const dayData = data.daily[dailyDates[i]];
        last7DaysCost += dayData.cost || 0;
      }

      // Get all-time cost from totals
      const allTimeCost = data.totals.cost || 0;

      // Get oldest date
      const allDates = Object.keys(data.daily).sort((a, b) =>
        a.localeCompare(b),
      );
      const oldestDate = allDates.length > 0 ? allDates[0] : null;

      // Get projects summary
      const projectsSummary: {
        [key: string]: { cost: number; recordCount: number };
      } = {};
      for (const [projectName, projectData] of Object.entries(data.projects)) {
        if (projectData && typeof projectData === "object") {
          const pData = projectData as any;
          projectsSummary[projectName] = {
            cost: pData.total?.cost || 0,
            recordCount: pData.total?.count || 0,
          };
        }
      }

      // Get all-time tokens data
      const allTimeData = data.totals
        ? {
            cost: data.totals.cost || 0,
            billedTokens: (data.totals.input || 0) + (data.totals.output || 0),
            cacheReadTokens: data.totals.cacheRead || 0,
            cacheWriteTokens: data.totals.cacheWrite || 0,
            count: data.totals.count || 0,
          }
        : {
            cost: 0,
            billedTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            count: 0,
          };

      return {
        todayData: todayData
          ? {
              cost: todayData.cost || 0,
              billedTokens: (todayData.input || 0) + (todayData.output || 0),
              cacheReadTokens: todayData.cacheRead || 0,
              cacheWriteTokens: todayData.cacheWrite || 0,
              count: todayData.count || 0,
            }
          : undefined,
        thisWeekData: thisWeekData
          ? {
              cost: thisWeekData.cost || 0,
              billedTokens:
                (thisWeekData.input || 0) + (thisWeekData.output || 0),
              cacheReadTokens: thisWeekData.cacheRead || 0,
              cacheWriteTokens: thisWeekData.cacheWrite || 0,
              count: thisWeekData.count || 0,
            }
          : undefined,
        last7DaysCost,
        allTimeCost,
        allTimeData,
        projectsSummary,
        oldestDate,
      };
    } catch (error) {
      return defaultReturn;
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    // Store reference to webview for later updates
    this.currentWebview = webviewView.webview;
    this.currentWebviewView = webviewView;

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "openDashboard":
          vscode.commands.executeCommand(
            "aiUsageCost.openDashboard",
            message.tab,
          );
          break;
        case "openReportDashboard":
          vscode.commands.executeCommand("aiUsageCost.openReportDashboard");
          break;
        case "openCharts":
          vscode.commands.executeCommand("aiUsageCost.openCharts");
          break;
        case "refresh":
          await this.refresh(
            webviewView.webview,
            message.project,
            message.branch,
          );
          break;
        case "updateSetting":
          await vscode.workspace
            .getConfiguration("aiUsageCost")
            .update(
              message.key,
              message.value,
              vscode.ConfigurationTarget.Global,
            );
          await this.refresh(
            webviewView.webview,
            message.project,
            message.branch,
          );
          break;
        case "printReportToConsole":
          await this.printReportToConsole();
          break;
        case "configureClaudeJson":
          await this.configureClaudeJsonPath();
          break;
      }
    });

    // Initial load
    this.updateSidebarData(webviewView.webview);

    // Start polling
    this.startPolling();

    // Dispose previous listener if re-resolving webview
    this.configChangeListener?.dispose();
    this.configChangeListener = vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("aiUsageCost.pollIntervalMinutes")) {
          this.startPolling();
        }
      },
    );

    // Clean up on dispose
    webviewView.onDidDispose(() => {
      this.stopPolling();
      this.configChangeListener?.dispose();
      this.configChangeListener = undefined;
    });
  }

  private async configureClaudeJsonPath(): Promise<void> {
    const config = vscode.workspace.getConfiguration("aiUsageCost");
    const current = config.get<string>("claudeJsonPath", "");

    // Show file picker
    const uris = await vscode.window.showOpenDialog({
      title: "Select claude.json configuration file",
      defaultUri: vscode.Uri.file(
        current || require("node:os").homedir() + "/.claude/claude.json",
      ),
      filters: {
        "JSON Files": ["json"],
      },
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
    });

    if (uris && uris.length > 0) {
      const selectedPath = uris[0].fsPath;
      await config.update(
        "claudeJsonPath",
        selectedPath,
        vscode.ConfigurationTarget.Global,
      );
      vscode.window.showInformationMessage(
        `Claude JSON path set to: ${selectedPath}`,
      );
      // Refresh the sidebar
      await this.refresh();
    }
  }

  private isClaudeJsonConfigured(): boolean {
    const config = vscode.workspace.getConfiguration("aiUsageCost");
    const path = config.get<string>("claudeJsonPath", "");
    return path !== "";
  }

  async refresh(
    webview?: vscode.Webview,
    project?: string,
    branch?: string,
  ): Promise<void> {
    const targetWebview = webview || this.currentWebview;
    if (targetWebview) {
      // Regenerate data from Claude project files before updating sidebar
      await AiStatsDataService.run(this.outputChannel);
      // Then update the sidebar with fresh data
      await this.updateSidebarData(targetWebview, project, branch);
    }
  }

  async printReportToConsole(): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel(
      "AI Usage Cost Report",
    );
    outputChannel.show();

    // Get GitHub username
    const gitUsername = await getGitUsername();

    outputChannel.appendLine("=== AI USAGE COST REPORT (LIVE) ===");
    outputChannel.appendLine(`Generated: ${new Date().toLocaleString()}`);
    outputChannel.appendLine(`User: ${gitUsername}`);
    outputChannel.appendLine("Data Source: Claude Project Files");
    outputChannel.appendLine("");

    try {
      // Get live data for last 7 days from ai-stats-data.json
      const dailyData = this.getDailyDataFromAiStats(7);

      // Calculate total cost (will be 0 if no data)
      const totalCost = dailyData.reduce((sum: number, d) => sum + d.cost, 0);
      const totalRecords = dailyData.reduce(
        (sum: number, d) => sum + d.count,
        0,
      );
      const totalBilledTokens = dailyData.reduce(
        (sum: number, d) => sum + d.billedTokens,
        0,
      );
      const totalCacheReadTokens = dailyData.reduce(
        (sum: number, d) => sum + d.cacheReadTokens,
        0,
      );
      const totalCacheWriteTokens = dailyData.reduce(
        (sum: number, d) => sum + d.cacheWriteTokens,
        0,
      );

      outputChannel.appendLine("Last 7 Days Summary:");
      outputChannel.appendLine(`  Total Cost: $${totalCost.toFixed(2)}`);
      outputChannel.appendLine(`  Total Requests: ${totalRecords}`);
      outputChannel.appendLine(
        `  Billed Tokens: ${totalBilledTokens.toLocaleString()}`,
      );
      outputChannel.appendLine(
        `  Cache Read Tokens: ${totalCacheReadTokens.toLocaleString()}`,
      );
      outputChannel.appendLine(
        `  Cache Write Tokens: ${totalCacheWriteTokens.toLocaleString()}`,
      );

      // Print daily bar chart
      outputChannel.appendLine("");
      outputChannel.appendLine("Daily Costs:");

      // Find max cost for bar chart scaling
      const costs = dailyData.map((d) => d.cost);
      const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
      const barWidth = 40;

      // Display all days
      dailyData.forEach((day: any) => {
        const barLength =
          maxCost > 0 ? Math.round((day.cost / maxCost) * barWidth) : 0;
        const bar = barLength > 0 ? "█".repeat(barLength) : "·";
        const dateObj = new Date(day.date);
        const formattedDate = dateObj.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const costDisplay = day.cost > 0 ? `$${day.cost.toFixed(2)}` : "$0.00";
        const reqDisplay = day.count > 0 ? ` (${day.count} req)` : " (0 req)";
        outputChannel.appendLine(
          `  ${formattedDate}: ${bar} ${costDisplay}${reqDisplay}`,
        );
      });

      // Project breakdown summary
      outputChannel.appendLine("");
      outputChannel.appendLine("Breakdown by Project (last 7 days):");
      outputChannel.appendLine(
        `  All Projects Combined: $${totalCost.toFixed(2)}`,
      );
      outputChannel.appendLine(
        "  (Note: Project-level breakdown requires additional tracking)",
      );

      // (Removed: Skills & Tools Usage from .claude.json)

      outputChannel.appendLine("");
      outputChannel.appendLine("=== END REPORT ===");
    } catch (error) {
      outputChannel.appendLine("Error generating report:");
      outputChannel.appendLine(`  ${error}`);
      outputChannel.appendLine("");
      outputChannel.appendLine(
        "Please ensure Claude project files are accessible at ~/.claude/projects/",
      );
    }
  }

  private startPolling(): void {
    // Clear any existing interval
    this.stopPolling();

    const pollIntervalMinutes = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<number>("pollIntervalMinutes", 5);

    // Don't start polling if interval is 0
    if (pollIntervalMinutes === 0) {
      return;
    }

    // Set up polling interval (convert minutes to milliseconds)
    const pollIntervalMs = pollIntervalMinutes * 60 * 1000;
    this.pollInterval = setInterval(() => {
      this.updateSidebarData();
      // Also regenerate dashboard in background
      this.regenerateDashboardInBackground();
    }, pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  private regenerateDashboardInBackground(): void {
    // Run generate-data.js in the background without blocking
    // (includes both ai-stats-data and dashboard-compatible format)
    this.generateAiStatsData().catch((error) => {
      this.outputChannel.appendLine(
        `⚠️ Warning: Failed to generate ai-stats-data.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async generateAiStatsData(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require("node:child_process");
      const scriptPath = path.join(
        this.extensionUri.fsPath,
        "generate-data.js",
      );

      if (!fs.existsSync(scriptPath)) {
        reject(new Error(`generate-data.js not found at ${scriptPath}`));
        return;
      }

      const node = spawn("node", [scriptPath], {
        cwd: this.extensionUri.fsPath,
      });

      node.stdout?.on("data", (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      node.stderr?.on("data", (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      node.on("close", (code: number) => {
        if (code === 0) {
          this.outputChannel.appendLine(
            "✅ ai-stats-data.json generated successfully",
          );
          resolve();
        } else {
          reject(new Error(`generate-data.js exited with code ${code}`));
        }
      });

      node.on("error", (err: Error) => {
        reject(new Error(`Failed to spawn node: ${err.message}`));
      });
    });
  }

  private async updateSidebarData(
    webview?: vscode.Webview,
    project?: string,
    branch?: string,
  ): Promise<void> {
    // Check if claude.json is configured
    if (!this.isClaudeJsonConfigured()) {
      const targetWebview = webview || this.currentWebview;
      if (targetWebview) {
        targetWebview.postMessage({
          command: "showConfigurationNeeded",
        });
      }
      return;
    }

    // Get current workspace folder if not provided
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    // If not provided, try to get current project and branch from git (optional)
    if ((!project || !branch) && workspaceFolder) {
      try {
        const { getProjectName } = await import("../services/gitService");
        const { getCurrentBranch } = await import("../services/gitService");
        const cwd = workspaceFolder.uri.fsPath;
        project = await getProjectName(cwd);
        branch = await getCurrentBranch(cwd);
      } catch {
        // No git info available — continue without it
      }
    }

    // --- NEW LOGIC: Use only project folders for live data ---
    // Show loading splash
    const loadingWebview = webview || this.currentWebview;
    if (loadingWebview) {
      loadingWebview.postMessage({
        command: "updateData",
        loading: true,
      });
    }

    // Always define these so they're available after try/catch
    let liveAllTimeCost = 0;
    let liveAllTimeUsage = {
      cost: 0,
      billedTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      count: 0,
    };
    let liveWeekCost = 0;
    let liveProjectsSummary = {};
    let liveTodaysSummary = null;
    let thisWeekSummary: any = null;
    let statsCacheTotalCost = 0;
    let statsCacheFirstSessionDate: string | null = null;
    let liveOldestDate: string | null = null;
    try {
      // Get stats-cache.json total cost and first session date
      const statsCacheData = this.getStatsCacheData();
      statsCacheTotalCost = statsCacheData.totalCost;
      statsCacheFirstSessionDate = statsCacheData.firstSessionDate;

      // Get ALL data from ai-stats-data.json (single source of truth)
      const aiStatsData = this.getAiStatsData();
      liveAllTimeCost = aiStatsData.allTimeCost;
      liveAllTimeUsage = aiStatsData.allTimeData;
      liveWeekCost = aiStatsData.last7DaysCost;
      liveProjectsSummary = aiStatsData.projectsSummary;
      if (aiStatsData.oldestDate) {
        liveOldestDate = new Date(aiStatsData.oldestDate).toISOString();
      }

      // Use today's data from ai-stats-data.json if available
      if (aiStatsData.todayData) {
        liveTodaysSummary = {
          cost: aiStatsData.todayData.cost,
          billedTokens: aiStatsData.todayData.billedTokens,
          cacheReadTokens: aiStatsData.todayData.cacheReadTokens,
          cacheWriteTokens: aiStatsData.todayData.cacheWriteTokens,
          count: aiStatsData.todayData.count,
        };
      }

      // Use this week's data from ai-stats-data.json if available
      if (aiStatsData.thisWeekData) {
        thisWeekSummary = {
          cost: aiStatsData.thisWeekData.cost,
          billedTokens: aiStatsData.thisWeekData.billedTokens,
          cacheReadTokens: aiStatsData.thisWeekData.cacheReadTokens,
          cacheWriteTokens: aiStatsData.thisWeekData.cacheWriteTokens,
          count: aiStatsData.thisWeekData.count,
        };
      }
    } catch (error) {
      // Show error in webview
      const targetWebview = webview || this.currentWebview;
      if (targetWebview) {
        targetWebview.postMessage({
          command: "showError",
          error:
            (error && (error as any).message) || "Failed to load usage data.",
        });
      }
    }

    // No more captured data - everything is read directly from project folders

    // Get alert thresholds from settings
    const dailyAlertThreshold = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<number>("dailyAlertThreshold", 10);
    const weeklyAlertThreshold = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<number>("weeklyAlertThreshold", 50);

    // Track update time and calculate next update
    this.lastUpdateTime = new Date();
    const pollIntervalMinutes = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<number>("pollIntervalMinutes", 5);
    const nextUpdateTime = new Date(
      this.lastUpdateTime.getTime() + pollIntervalMinutes * 60 * 1000,
    );

    // Update section header description with last updated time
    if (this.currentWebviewView) {
      this.currentWebviewView.description = `last updated ${this.lastUpdateTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

    // Send data to webview (use current webview as fallback for polling)
    const targetWebview = webview || this.currentWebview;
    if (targetWebview) {
      targetWebview.postMessage({
        command: "updateData",
        project,
        branch,
        // All data from project folders
        allTimeCost: liveAllTimeCost,
        allTimeUsage: liveAllTimeUsage,
        statsCacheTotalCost,
        statsCacheFirstSessionDate,
        weekCost: liveWeekCost,
        liveUsage: liveTodaysSummary,
        thisWeekUsage: thisWeekSummary,
        liveProjectsSummary,
        dailyAlertThreshold,
        weeklyAlertThreshold,
        lastUpdateTime: this.lastUpdateTime.toISOString(),
        nextUpdateTime: nextUpdateTime.toISOString(),
        pollInterval: pollIntervalMinutes,
        liveOldestDate,
      });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cssUri = getUri(webview, this.extensionUri, ["media", "webview.css"]);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <link rel="stylesheet" href="${cssUri}">
  <title>Claude AI usage costs</title>
  <style>
    /* ===== Base Styles ===== */
    body { padding: 12px; min-height: 350px; }

    /* Action Buttons */
    .action-buttons { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; }
    .action-buttons button { flex: 1; min-width: 100px; }

    /* ===== Alert Boxes ===== */
    /* Daily Alert */
    #costAlert {
      border: 2px solid #d9534f;
      background: rgba(217, 83, 79, 0.1);
      padding: 12px;
      border-radius: 4px;
      margin-top: 8px;
      display: none;
    }
    #costAlert.active { display: block; }
    #costAlert .alert-icon { font-size: 24px; margin-bottom: 8px; }
    #costAlert .alert-text {
      font-weight: 600;
      color: #d9534f;
      font-size: 13px;
    }

    /* Weekly Alert */
    #weeklyAlertBox {
      border: 2px solid #f0ad4e;
      background: rgba(240, 173, 78, 0.1);
      padding: 12px;
      border-radius: 4px;
      margin-top: 8px;
      display: none;
    }
    #weeklyAlertBox.active { display: block; }
    #weeklyAlertBox .alert-icon { font-size: 24px; margin-bottom: 8px; }
    #weeklyAlertBox .alert-text {
      font-weight: 600;
      color: #f0ad4e;
      font-size: 13px;
    }

    /* ===== Settings Section ===== */
    .settings-section {
      border: 1px solid var(--vscode-editorGroup-border, #cccccc);
      border-radius: 4px;
      padding: 12px;
      margin-top: 16px;
      margin-bottom: 16px;
    }
    .settings-section h3 {
      margin-top: 0;
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      opacity: 0.8;
    }

    /* ===== Form Inputs ===== */
    .setting-item { margin-bottom: 10px; }
    .setting-item label {
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
      font-weight: 500;
    }
    .setting-item input {
      width: 100%;
      box-sizing: border-box;
      padding: 6px;
      border-radius: 3px;
      border: 1px solid var(--vscode-editorWidget-border, #ccc);
      background-color: var(--vscode-input-background, #fff);
      color: var(--vscode-input-foreground, #000);
      font-size: 12px;
    }
    .setting-item input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, #007acc);
    }

    /* ===== Accordion Styles ===== */
    .accordion-container {
      border: 1px solid var(--vscode-editorGroup-border, #cccccc);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }
    .accordion-item { border-bottom: 1px solid var(--vscode-editorGroup-border, #cccccc); }
    .accordion-item:last-child { border-bottom: none; }

    .accordion-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--vscode-editor-background);
      cursor: pointer;
      user-select: none;
      transition: background 0.2s ease;
    }
    .accordion-header:hover { background: rgba(255, 255, 255, 0.05); }
    .accordion-header.active { background: rgba(0, 122, 204, 0.1); }

    .accordion-toggle {
      font-size: 12px;
      margin-right: 8px;
      transition: transform 0.2s ease;
      display: inline-block;
    }
    .accordion-toggle.open { transform: rotate(90deg); }

    .accordion-title {
      flex: 1;
      font-weight: 600;
      font-size: 13px;
    }
    .accordion-cost {
      font-weight: 700;
      color: var(--vscode-charts-green);
      min-width: 60px;
      text-align: right;
    }

    .accordion-content {
      display: none;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.2);
      font-size: 11px;
    }
    .accordion-content.open { display: block; }

    .accordion-detail {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      opacity: 0.8;
    }
    .accordion-detail-label { opacity: 0.7; }
    .accordion-detail-value { font-weight: 600; }

    /* ===== Data Display ===== */
    #totals {
      border-left: 4px solid var(--vscode-editorLineNumber-foreground, #6a9955);
      padding-left: 12px;
      transition: border-color 0.3s ease, color 0.3s ease;
    }

    /* ===== Loading State ===== */
    #loadingIndicator {
      display: none;
      padding: 24px 12px;
      text-align: center;
      min-height: 200px;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    #loadingIndicator.active {
      display: flex;
    }
    
    #sidebar-content {
      display: block;
    }
    #sidebar-content.hidden {
      display: none;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--vscode-editorLineNumber-foreground, #6a9955);
      border-top-color: var(--vscode-charts-green, #4ec9b0);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      font-size: 13px;
      opacity: 0.7;
    }

    /* ===== Configuration Needed State ===== */
    #configNeeded {
      display: none;
      padding: 24px 16px;
      text-align: center;
      min-height: 300px;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    #configNeeded.active {
      display: flex;
    }

    .config-icon {
      font-size: 56px;
      opacity: 0.7;
      margin-bottom: 8px;
    }

    .config-title {
      font-size: 15px;
      font-weight: 600;
      opacity: 0.9;
    }

    .config-message {
      font-size: 12px;
      opacity: 0.7;
      line-height: 1.6;
      max-width: 260px;
    }

    .config-warning {
      background: rgba(255, 191, 0, 0.1);
      border: 1px solid rgba(255, 191, 0, 0.3);
      border-radius: 4px;
      padding: 10px 12px;
      font-size: 11px;
      line-height: 1.5;
      max-width: 260px;
      text-align: left;
    }

    .config-button {
      padding: 8px 20px;
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s ease;
      margin-top: 4px;
    }
    .config-button:hover {
      background: var(--vscode-button-hoverBackground, #005a9e);
    }
  </style>
</head>
<body>
  <div id="configNeeded">
    <div class="config-icon">⚙️</div>
    <div class="config-title">Setup Required</div>
    <div class="config-message">
      You must set the path to your Claude configuration file before any usage data can be displayed.
    </div>
    <div class="config-warning">
      <strong>Why am I seeing this?</strong><br>
      The extension needs to know where your <code>claude.json</code> file is located to track and display AI usage costs.
    </div>
    <button class="config-button" id="configureBtn">Select claude.json File</button>
  </div>

  <div id="loadingIndicator">
    <div class="spinner"></div>
    <div class="loading-text">Loading data...</div>
  </div>
  <div id="sidebar-content">
   <div id="costAlert">
        <div class="alert-text">⚠️ Daily cost alert triggered!</div>
        <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;" id="alertMessage"></div>
      </div>
      <div id="weeklyAlertBox">
        <div class="alert-text">⚠️ Weekly cost alert triggered!</div>
        <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;" id="weeklyAlertMessage"></div>
      </div>

    <div id="liveUsageSection">


    <h2>Daily (Today)</h2>
    <div id="dailyTodaySection" class="cost-display">
      <div class="cost-value" id="dailyTodayCost">$0.00</div>
      <div class="cost-detail" id="dailyTodayBilledTokens">0 billed tokens</div>
      <div class="cost-detail" id="dailyTodayCacheReadTokens">0 cache read tokens</div>
      <div class="cost-detail" id="dailyTodayCacheWriteTokens">0 cache write tokens</div>
      <div class="cost-detail" id="dailyTodayCount" style="margin-top: 4px; opacity: 0.6; font-size: 10px;">0 requests</div>
    </div>

    <h2>Weekly (Last 7 days)</h2>
    <div id="weeklyThisWeekSection" class="cost-display">
      <div class="cost-value" id="weeklyThisWeekCost">$0.00</div>
      <div class="cost-detail" id="weeklyThisWeekBilledTokens">0 billed tokens</div>
      <div class="cost-detail" id="weeklyThisWeekCacheReadTokens">0 cache read tokens</div>
      <div class="cost-detail" id="weeklyThisWeekCacheWriteTokens">0 cache write tokens</div>
      <div class="cost-detail" id="weeklyThisWeekCount" style="margin-top: 4px; opacity: 0.6; font-size: 10px;">0 requests</div>
    </div>


    <h2>All Time Total</h2>
    <div id="allTimeSection" class="cost-display">
      <div class="cost-value" id="allTimeCost">$0.00</div>
      <div class="cost-detail" id="allTimeBilledTokens">0 billed tokens</div>
      <div class="cost-detail" id="allTimeCacheReadTokens">0 cache read tokens</div>
      <div class="cost-detail" id="allTimeCacheWriteTokens">0 cache write tokens</div>
      <div class="cost-detail" id="allTimeCount" style="margin-top: 4px; opacity: 0.6; font-size: 10px;">0 requests</div>
    </div>

    <div id="dataSinceSection" style="font-size: 11px; opacity: 0.7; padding: 8px 0;">
      <div id="dataSinceDate">—</div>
    </div>

    <div id="projectAccordion" style="display:none;"></div>
  </div>

    <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let loadingTimeout = null;
    const LOADING_DELAY = 500; // Show loading indicator if data takes longer than 500ms

    // Handle updates from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      
      const configNeeded = document.getElementById('configNeeded');
      const loadingIndicator = document.getElementById('loadingIndicator');
      const sidebarContent = document.getElementById('sidebar-content');
      
      if (message.command === 'showConfigurationNeeded') {
        // Show configuration needed UI
        if (configNeeded) configNeeded.classList.add('active');
        if (loadingIndicator) loadingIndicator.classList.remove('active');
        if (sidebarContent) sidebarContent.classList.add('hidden');
        return;
      }
      
      if (message.command === 'updateData') {
        const hasData = typeof message.allTimeCost === 'number';
        
        if (message.loading === true) {
          // Start data loading - set a timeout to show loading indicator if it's slow
          if (loadingTimeout) clearTimeout(loadingTimeout);
          loadingTimeout = setTimeout(() => {
            if (configNeeded) configNeeded.classList.remove('active');
            if (loadingIndicator) loadingIndicator.classList.add('active');
            if (sidebarContent) sidebarContent.classList.add('hidden');
          }, LOADING_DELAY);
          return; // Don't process data updates while loading
        }
        
        // Data arrived - hide loading state
        if (hasData) {
          if (loadingTimeout) clearTimeout(loadingTimeout);
          if (configNeeded) configNeeded.classList.remove('active');
          if (loadingIndicator) loadingIndicator.classList.remove('active');
          if (sidebarContent) sidebarContent.classList.remove('hidden');
        }

        // Show all time total (default to 0 if undefined/null)
        const allTimeCost = (typeof message.allTimeCost === 'number' && !isNaN(message.allTimeCost)) ? message.allTimeCost : 0;
        const allTimeCostEl = document.getElementById('allTimeCost');
        if (allTimeCostEl) allTimeCostEl.textContent = '$' + allTimeCost.toFixed(2);

        // Show stats-cache total cost
        const statsCacheCost = (typeof message.statsCacheTotalCost === 'number' && !isNaN(message.statsCacheTotalCost)) ? message.statsCacheTotalCost : 0;
        const statsCacheCostEl = document.getElementById('statsCacheCost');
        if (statsCacheCostEl) statsCacheCostEl.textContent = '$' + statsCacheCost.toFixed(2);

        // Update stats-cache label with first session date
        const statsCacheLabel = document.getElementById('statsCacheLabel');
        const oldestCacheDate = document.getElementById('oldestCacheDate');
        if (statsCacheLabel && message.statsCacheFirstSessionDate) {
          const firstDate = new Date(message.statsCacheFirstSessionDate);
          const formattedDate = firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          statsCacheLabel.textContent = 'Total (Since ' + formattedDate + ')';
          if (oldestCacheDate) oldestCacheDate.textContent = formattedDate;
        } else {
          if (statsCacheLabel) statsCacheLabel.textContent = 'Total (Cached)';
          if (oldestCacheDate) oldestCacheDate.textContent = '—';
        }

        // Update oldest live data date
        const oldestLiveDate = document.getElementById('oldestLiveDate');
        if (oldestLiveDate && message.liveOldestDate) {
          const liveDate = new Date(message.liveOldestDate);
          oldestLiveDate.textContent = liveDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else if (oldestLiveDate) {
          oldestLiveDate.textContent = '—';
        }

        // Update settings inputs with current threshold values
        const dailyAlertInput = document.getElementById('dailyAlert');
        const weeklyAlertInput = document.getElementById('weeklyAlert');
        if (dailyAlertInput) {
          dailyAlertInput.value = message.dailyAlertThreshold || 0;
        }
        if (weeklyAlertInput) {
          weeklyAlertInput.value = message.weeklyAlertThreshold || 0;
        }

        // Last 7 Days Total
        const last7DaysCost = (typeof message.weekCost === 'number' && !isNaN(message.weekCost)) ? message.weekCost : 0;
        if (last7DaysCost > 0) {
          const last7El1 = document.getElementById('last7DaysCostValue');
          const last7El2 = document.getElementById('last7DaysCostDetail');
          const last7El3 = document.getElementById('last7DaysCostDetail2');
          if (last7El1) last7El1.textContent = '$' + last7DaysCost.toFixed(2);
          if (last7El2) last7El2.textContent = 'Last 7 days (cost)';
          if (last7El3) last7El3.textContent = 'From ~/.claude/projects JSONL files';
        } else {
          const last7DaysEl = document.getElementById('last7DaysCost');
          if (last7DaysEl) last7DaysEl.innerHTML = '<div class="empty-state">No live data</div>';
        }

        // Live usage data
        if (message.liveUsage && message.liveUsage.cost !== undefined) {
          const live = message.liveUsage;
          const el1 = document.getElementById('liveUsageCost');
          const el2 = document.getElementById('liveUsageBilledTokens');
          const el3 = document.getElementById('liveUsageCacheReadTokens');
          const el4 = document.getElementById('liveUsageCacheWriteTokens');
          const el5 = document.getElementById('liveUsageCount');
          if (el1) el1.textContent = '$' + live.cost.toFixed(2);
          if (el2) el2.textContent = (live.billedTokens || 0).toLocaleString() + ' billed tokens';
          if (el3) el3.textContent = (live.cacheReadTokens || 0).toLocaleString() + ' cache read tokens';
          if (el4) el4.textContent = (live.cacheWriteTokens || 0).toLocaleString() + ' cache write tokens';
          if (el5) el5.textContent = live.count + ' requests';
        } else {
          const liveEl = document.getElementById('liveUsage');
          // if (liveEl) liveEl.innerHTML = '<div class="empty-state">No live data</div>';
        }

        // Daily (Today) data
        if (message.liveUsage && message.liveUsage.cost !== undefined) {
          const daily = message.liveUsage;
          const el1 = document.getElementById('dailyTodayCost');
          const el2 = document.getElementById('dailyTodayBilledTokens');
          const el3 = document.getElementById('dailyTodayCacheReadTokens');
          const el4 = document.getElementById('dailyTodayCacheWriteTokens');
          const el5 = document.getElementById('dailyTodayCount');

          if (el1) el1.textContent = '$' + daily.cost.toFixed(2);
          if (el2) el2.textContent = (daily.billedTokens || 0).toLocaleString() + ' billed tokens';
          if (el3) el3.textContent = (daily.cacheReadTokens || 0).toLocaleString() + ' cache read tokens';
          if (el4) el4.textContent = (daily.cacheWriteTokens || 0).toLocaleString() + ' cache write tokens';
          if (el5) el5.textContent = daily.count + ' requests';
        } else {
          const dailyEl = document.getElementById('dailyTodaySection');
          
        }

        // Weekly (This Week) data
        if (message.thisWeekUsage && message.thisWeekUsage.cost !== undefined) {
          const weekly = message.thisWeekUsage;
          const el1 = document.getElementById('weeklyThisWeekCost');
          const el2 = document.getElementById('weeklyThisWeekBilledTokens');
          const el3 = document.getElementById('weeklyThisWeekCacheReadTokens');
          const el4 = document.getElementById('weeklyThisWeekCacheWriteTokens');
          const el5 = document.getElementById('weeklyThisWeekCount');

          if (el1) el1.textContent = '$' + weekly.cost.toFixed(2);
          if (el2) el2.textContent = (weekly.billedTokens || 0).toLocaleString() + ' billed tokens';
          if (el3) el3.textContent = (weekly.cacheReadTokens || 0).toLocaleString() + ' cache read tokens';
          if (el4) el4.textContent = (weekly.cacheWriteTokens || 0).toLocaleString() + ' cache write tokens';
          if (el5) el5.textContent = weekly.count + ' requests';
        } else {
          const weeklyEl = document.getElementById('weeklyThisWeekSection');

        }

        // All Time data
        if (message.allTimeUsage && message.allTimeUsage.cost !== undefined) {
          const allTime = message.allTimeUsage;
          const el1 = document.getElementById('allTimeCost');
          const el2 = document.getElementById('allTimeBilledTokens');
          const el3 = document.getElementById('allTimeCacheReadTokens');
          const el4 = document.getElementById('allTimeCacheWriteTokens');
          const el5 = document.getElementById('allTimeCount');

          if (el1) el1.textContent = '$' + allTime.cost.toFixed(2);
          if (el2) el2.textContent = (allTime.billedTokens || 0).toLocaleString() + ' billed tokens';
          if (el3) el3.textContent = (allTime.cacheReadTokens || 0).toLocaleString() + ' cache read tokens';
          if (el4) el4.textContent = (allTime.cacheWriteTokens || 0).toLocaleString() + ' cache write tokens';
          if (el5) el5.textContent = allTime.count + ' requests';
        } else {
          const allTimeEl = document.getElementById('allTimeSection');

        }

        // Data Since (oldest date)
        if (message.liveOldestDate) {
          const oldestDate = new Date(message.liveOldestDate);
          const dateEl = document.getElementById('dataSinceDate');
          if (dateEl) {
            const formatted = oldestDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            dateEl.textContent = 'Data Collection Since: ' + formatted;
          }
        }

        // Check daily alert threshold
        const dailyAlertThreshold = message.dailyAlertThreshold || 0;
        const dailyAlertDiv = document.getElementById('costAlert');
        const liveCost = (message.liveUsage && message.liveUsage.cost) || 0;
        const dailyAlertActive = dailyAlertThreshold > 0 && liveCost >= dailyAlertThreshold;
        if (dailyAlertActive) {
          const alertMsg = document.getElementById('alertMessage');
          if (alertMsg) alertMsg.textContent = 'Exceeded threshold of $' + dailyAlertThreshold.toFixed(2) + ' - Current: $' + liveCost.toFixed(2);
          if (dailyAlertDiv) dailyAlertDiv.classList.add('active');
        } else {
          if (dailyAlertDiv) dailyAlertDiv.classList.remove('active');
        }

        // Check weekly alert threshold against captured week cost
        const weeklyAlertThreshold = message.weeklyAlertThreshold || 0;
        const weeklyAlertDiv = document.getElementById('weeklyAlertBox');
        const weeklyAlertActive = weeklyAlertThreshold > 0 && message.weekCost >= weeklyAlertThreshold;
        if (weeklyAlertActive) {
          const weeklyMsg = document.getElementById('weeklyAlertMessage');
          if (weeklyMsg) weeklyMsg.textContent = 'Exceeded threshold of $' + weeklyAlertThreshold.toFixed(2) + ' - Current: $' + message.weekCost.toFixed(2);
          if (weeklyAlertDiv) weeklyAlertDiv.classList.add('active');
        } else {
          if (weeklyAlertDiv) weeklyAlertDiv.classList.remove('active');
        }

        // Update live usage section and totals border based on alerts
        const liveUsageSection = document.getElementById('liveUsageSection');
        const totalsSection = document.getElementById('totals');
        if (dailyAlertActive || weeklyAlertActive) {
          if (liveUsageSection) liveUsageSection.classList.add('alert-active');
          if (totalsSection) totalsSection.classList.add('alert-active');
        } else {
          if (liveUsageSection) liveUsageSection.classList.remove('alert-active');
          if (totalsSection) totalsSection.classList.remove('alert-active');
        }
      }
    });

    // Configure button click handler
    const configureBtn = document.getElementById('configureBtn');
    if (configureBtn) {
      configureBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'configureClaudeJson' });
      });
    }

    // Request initial data
    vscode.postMessage({ command: 'refresh' });
  </script>
</body>
</html>`;
  }
}
