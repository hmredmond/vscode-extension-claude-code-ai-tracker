import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ClaudeStatsService } from "../services/claudeStatsService";
import {
  getNonce,
  getUri,
  formatCurrency,
  formatDate,
} from "../utils/webviewHelpers";

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

interface DailyModelTokens {
  date: string;
  tokensByModel: { [model: string]: number };
}

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

interface StatsCacheData {
  version: number;
  lastComputedDate: string;
  dailyActivity: any[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: { [model: string]: ModelUsage };
  totalSessions: number;
  totalMessages: number;
  longestSession: any;
  firstSessionDate: string;
  hourCounts: { [hour: string]: number };
  totalSpeculationTimeSavedMs: number;
}

export class DashboardPanel {
  public static readonly viewType = "aiUsageCost.dashboard";
  private static currentPanel: DashboardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _fileWatcher: vscode.FileSystemWatcher | undefined;
  private _refreshTimeout: NodeJS.Timeout | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Clean up when panel is closed
    this._panel.onDidDispose(() => {
      DashboardPanel.currentPanel = undefined;
      this._fileWatcher?.dispose();
      if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
    });

    // Watch for changes to data files and refresh dashboard
    this.setupFileWatcher();

    this.update();
  }

  private readStatsCacheFile(): StatsCacheData | null {
    const statsCachePath = path.join(
      os.homedir(),
      ".claude",
      "stats-cache.json",
    );

    if (!fs.existsSync(statsCachePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(statsCachePath, "utf-8");
      return JSON.parse(content) as StatsCacheData;
    } catch (error) {
      return null;
    }
  }

  private calculateModelCost(
    modelUsage: ModelUsage,
    modelName: string,
  ): number {
    const pricing = (PRICING as any)[modelName] || {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };

    const inputCost = (modelUsage.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (modelUsage.outputTokens / 1_000_000) * pricing.output;
    const cacheReadCost =
      (modelUsage.cacheReadInputTokens / 1_000_000) * pricing.cacheRead;
    const cacheWriteCost =
      (modelUsage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWrite;

    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  static createOrShow(extensionUri: vscode.Uri): void {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.update();
      DashboardPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      "Claude AI Usage Dashboard",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
  }

  private update(): void {
    this._panel.title = "Claude AI Usage Dashboard";

    // Load data and generate HTML asynchronously
    this.updateHtmlAsync();

    // Load live usage data asynchronously
    this.loadLiveUsageData();
  }

  private setupFileWatcher(): void {
    // Watch ai-stats-data.json for changes
    const aiStatsPath = path.join(
      this._extensionUri.fsPath,
      "ai-stats-data.json",
    );

    const pattern = new vscode.RelativePattern(
      this._extensionUri.fsPath,
      "ai-stats-data.json",
    );

    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Debounce refresh to avoid too many rapid updates
    const handleChange = () => {
      if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
      this._refreshTimeout = setTimeout(() => {
        this.update();
      }, 300); // Wait 300ms after file change before refreshing
    };

    this._fileWatcher.onDidChange(handleChange);
    this._fileWatcher.onDidCreate(handleChange);
  }

  private async updateHtmlAsync(): Promise<void> {
    this._panel.webview.html = await this.getHtml();
  }

  private getAiStatsData(): any {
    const aiStatsPath = path.join(
      this._extensionUri.fsPath,
      "ai-stats-data.json",
    );

    if (!fs.existsSync(aiStatsPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(aiStatsPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  private async loadLiveUsageData(): Promise<void> {
    try {
      const aiStats = this.getAiStatsData();
      if (!aiStats) {
        return;
      }

      // Get hourly data (filtered to last 24 hours by generate-data.js)
      const hourly = Object.entries(aiStats.hourly || {}).map(
        ([hour, data]: [string, any]) => ({
          hour: parseInt(hour.split("T")[1]?.split(":")[0] || "0"),
          cost: data.cost || 0,
          billedTokens: (data.input || 0) + (data.output || 0),
          cacheReadTokens: data.cacheRead || 0,
          cacheWriteTokens: data.cacheWrite || 0,
          count: data.count || 0,
        }),
      );

      // Get daily data (last 7 days)
      const dailyDates = Object.keys(aiStats.daily || {})
        .sort()
        .reverse()
        .slice(0, 7);
      const daily = dailyDates.reverse().map((date: string) => {
        const data = aiStats.daily[date];
        return {
          date,
          cost: data.cost || 0,
          billedTokens: (data.input || 0) + (data.output || 0),
          cacheReadTokens: data.cacheRead || 0,
          cacheWriteTokens: data.cacheWrite || 0,
          count: data.count || 0,
        };
      });

      // Get today's summary
      const today = new Date().toISOString().split("T")[0];
      const todayData = aiStats.daily?.[today];
      const todaysSummary = todayData
        ? {
            cost: todayData.cost || 0,
            billedTokens: (todayData.input || 0) + (todayData.output || 0),
            cacheReadTokens: todayData.cacheRead || 0,
            cacheWriteTokens: todayData.cacheWrite || 0,
            count: todayData.count || 0,
          }
        : null;

      // Get projects summary
      const projects: any = {};
      for (const [projectName, projectData] of Object.entries(
        aiStats.projects || {},
      )) {
        const pData = projectData as any;
        projects[projectName] = {
          cost: pData.total?.cost || 0,
          recordCount: pData.total?.count || 0,
        };
      }

      const dailyAlertThreshold = vscode.workspace
        .getConfiguration("aiUsageCost")
        .get<number>("dailyAlertThreshold", 10);
      const weeklyAlertThreshold = vscode.workspace
        .getConfiguration("aiUsageCost")
        .get<number>("weeklyAlertThreshold", 50);

      this._panel.webview.postMessage({
        command: "updateLiveUsage",
        hourly,
        daily,
        todaysSummary,
        projects,
        dailyAlertThreshold,
        weeklyAlertThreshold,
      });
    } catch (error) {
      // Silently fail — live data is non-critical
    }
  }

  private async getAllDailyData(): Promise<
    Map<string, { cost: number; tokens: number }>
  > {
    const aiStats = this.getAiStatsData();
    const dailyData: Map<string, { cost: number; tokens: number }> = new Map();

    if (!aiStats || !aiStats.daily) {
      return dailyData;
    }

    for (const [date, data] of Object.entries(aiStats.daily)) {
      const dayData = data as any;
      const tokens =
        (dayData.input || 0) +
        (dayData.output || 0) +
        (dayData.cacheRead || 0) +
        (dayData.cacheWrite || 0);

      dailyData.set(date, {
        cost: dayData.cost || 0,
        tokens,
      });
    }

    return dailyData;
  }

  private async getAllModelData(): Promise<Map<string, number>> {
    const aiStats = this.getAiStatsData();
    const modelData: Map<string, number> = new Map();

    if (!aiStats || !aiStats.projects) {
      return modelData;
    }

    // Aggregate model costs from projects
    for (const projectData of Object.values(aiStats.projects)) {
      const pData = projectData as any;
      if (pData.models) {
        for (const [model, modelInfo] of Object.entries(pData.models)) {
          const mData = modelInfo as any;
          const existing = modelData.get(model) || 0;
          modelData.set(model, existing + (mData.cost || 0));
        }
      }
    }

    return modelData;
  }

  private async getAllProjectData(): Promise<
    Array<{ name: string; cost: number; tokens: number }>
  > {
    const aiStats = this.getAiStatsData();
    const projectData: Array<{ name: string; cost: number; tokens: number }> =
      [];

    if (!aiStats || !aiStats.projects) {
      return projectData;
    }

    for (const [projectName, pDataRaw] of Object.entries(aiStats.projects)) {
      const pData = pDataRaw as any;
      if (pData.total) {
        const tokens =
          (pData.total.input || 0) +
          (pData.total.output || 0) +
          (pData.total.cacheRead || 0) +
          (pData.total.cacheWrite || 0);
        projectData.push({
          name: projectName,
          cost: pData.total.cost || 0,
          tokens,
        });
      }
    }

    // Sort by cost descending
    projectData.sort((a, b) => b.cost - a.cost);
    return projectData;
  }

  private getWeekStartDate(date: Date, weekStartDay: string): Date {
    const weekStart = new Date(date);
    const dayOfWeek = date.getDay();

    if (weekStartDay === "sunday") {
      weekStart.setDate(date.getDate() - dayOfWeek);
    } else {
      // Monday (default)
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      weekStart.setDate(date.getDate() - daysSinceMonday);
    }

    return weekStart;
  }

  private async getHtml(): Promise<string> {
    const nonce = getNonce();
    const cssUri = getUri(this._panel.webview, this._extensionUri, [
      "media",
      "webview.css",
    ]);

    const weekStartDay = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<string>("weekStartDay", "monday");

    // Get alert thresholds
    const dailyAlertThreshold = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<number>("dailyAlertThreshold", 10);
    const weeklyAlertThreshold = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<number>("weeklyAlertThreshold", 50);

    // Collect all bar styles
    let barStyles = "";

    // Get daily data from .jsonl files (not stats-cache.json)
    const aggregatedDaily = await this.getAllDailyData();

    // Read stats-cache.json file for model breakdown (since .jsonl aggregation doesn't track model names)
    const statsData = this.readStatsCacheFile();

    // Generate daily table from aggregated data
    let dailyHtml = "";
    if (aggregatedDaily.size > 0) {
      const sortedDays = Array.from(aggregatedDaily.entries()).sort((a, b) =>
        b[0].localeCompare(a[0]),
      ); // Sort descending by date
      const maxCost = Math.max(
        ...Array.from(aggregatedDaily.values()).map((d) => d.cost),
      );

      dailyHtml =
        '<table class="sortable" data-default-sort="0" data-default-order="desc"><thead><tr><th class="sortable-header" data-column="0" data-type="date">Date</th><th class="sortable-header" data-column="1" data-type="number">Cost</th><th class="sortable-header" data-column="2" data-type="number">Tokens</th><th data-column="3" data-type="none"></th></tr></thead><tbody>';

      for (const [date, data] of sortedDays) {
        const width =
          maxCost > 0 ? ((data.cost / maxCost) * 100).toFixed(2) : "0";
        const barId = `bar-daily-${date.replace(/\D/g, "")}`;
        const isAlert =
          dailyAlertThreshold > 0 && data.cost >= dailyAlertThreshold;
        const rowClass = isAlert ? ' class="alert-row"' : "";
        dailyHtml += `
          <tr data-date="${date}" data-cost="${data.cost}"${rowClass}>
            <td>${date}</td>
            <td>$${data.cost.toFixed(2)}</td>
            <td>${data.tokens.toLocaleString()}</td>
            <td><div class="bar-container"><div class="bar-fill" id="${barId}"></div></div></td>
          </tr>
        `;
        barStyles += `#${barId} { width: ${width}% !important; }`;
      }
      dailyHtml += "</tbody></table>";
    } else {
      dailyHtml = '<div class="empty-state">No live data found</div>';
    }

    // Generate weekly breakdown from daily data
    const weeklyData: Map<string, { cost: number; tokens: number }> = new Map();
    for (const [dateStr, dayData] of aggregatedDaily.entries()) {
      const date = new Date(dateStr + "T00:00:00");
      const weekStart = this.getWeekStartDate(date, weekStartDay);
      const weekKey = weekStart.toISOString().split("T")[0];
      const existing = weeklyData.get(weekKey) || { cost: 0, tokens: 0 };
      weeklyData.set(weekKey, {
        cost: existing.cost + dayData.cost,
        tokens: existing.tokens + dayData.tokens,
      });
    }

    let weeklyHtml = "";
    if (weeklyData.size > 0) {
      const sortedWeeks = Array.from(weeklyData.entries()).sort((a, b) =>
        b[0].localeCompare(a[0]),
      );
      const maxCost = Math.max(
        ...Array.from(weeklyData.values()).map((d) => d.cost),
      );

      weeklyHtml =
        '<table class="sortable" data-default-sort="0" data-default-order="desc"><thead><tr><th class="sortable-header" data-column="0" data-type="date">Week Starting</th><th class="sortable-header" data-column="1" data-type="number">Cost</th><th class="sortable-header" data-column="2" data-type="number">Tokens</th><th data-column="3" data-type="none"></th></tr></thead><tbody>';

      for (const [weekStart, data] of sortedWeeks) {
        const width =
          maxCost > 0 ? ((data.cost / maxCost) * 100).toFixed(2) : "0";
        const barId = `bar-weekly-${weekStart.replace(/\D/g, "")}`;
        const isAlert =
          weeklyAlertThreshold > 0 && data.cost >= weeklyAlertThreshold;
        const rowClass = isAlert ? ' class="weekly-alert-row"' : "";
        weeklyHtml += `
          <tr data-date="${weekStart}" data-cost="${data.cost}"${rowClass}>
            <td>${weekStart}</td>
            <td>$${data.cost.toFixed(2)}</td>
            <td>${data.tokens.toLocaleString()}</td>
            <td><div class="bar-container"><div class="bar-fill" id="${barId}"></div></div></td>
          </tr>
        `;
        barStyles += `#${barId} { width: ${width}% !important; }`;
      }
      weeklyHtml += "</tbody></table>";
    } else {
      weeklyHtml = '<div class="empty-state">No live data found</div>';
    }

    // Generate model breakdown from aggregated stats
    const modelData: Map<string, number> = new Map();

    if (statsData && statsData.modelUsage) {
      for (const [modelName, modelInfo] of Object.entries(
        statsData.modelUsage,
      )) {
        const cost = this.calculateModelCost(modelInfo, modelName);
        modelData.set(modelName, cost);
      }
    }

    let modelHtml = "";
    if (modelData.size > 0) {
      const totalCost = Array.from(modelData.values()).reduce(
        (a, b) => a + b,
        0,
      );
      const sortedModels = Array.from(modelData.entries()).sort(
        (a, b) => b[1] - a[1],
      );

      modelHtml = "";
      for (const [model, cost] of sortedModels) {
        const pct = totalCost > 0 ? ((cost / totalCost) * 100).toFixed(1) : 0;
        const width =
          totalCost > 0 ? ((cost / totalCost) * 100).toFixed(2) : "0";
        const barId = `bar-model-${model.replace(/\W/g, "")}`;
        modelHtml += `
          <div class="model-bar">
            <div class="model-name">
              <span>${model}</span>
              <span class="model-percentage">${pct}%</span>
            </div>
            <div class="bar-container">
              <div class="bar-fill" id="${barId}"></div>
            </div>
            <div class="cost-detail">${formatCurrency(cost)}</div>
          </div>
        `;
        barStyles += `#${barId} { width: ${width}% !important; }`;
      }
    } else {
      modelHtml = '<div class="empty-state">No model usage data found</div>';
    }

    // Generate projects list - for stats-cache.json we don't have per-project breakdown
    // So we'll show a message that projects data comes from live usage
    let projectsHtml =
      '<div class="empty-state">Project data is only available in the Live Usage tab</div>';

    // Get Claude stats for skills and tools
    const claudeStats = ClaudeStatsService.getClaudeStats();
    let skillsHtml = "";
    let toolsHtml = "";

    if (claudeStats.skills.length > 0) {
      skillsHtml =
        '<table class="sortable" data-default-sort="1" data-default-order="desc"><thead><tr><th class="sortable-header" data-column="0" data-type="string">Skill</th><th class="sortable-header" data-column="1" data-type="number">Usage Count</th><th class="sortable-header" data-column="2" data-type="date">Last Used</th></tr></thead><tbody>';
      for (const skill of claudeStats.skills) {
        const lastUsedDate = new Date(skill.lastUsedAt).toLocaleDateString();
        skillsHtml += `<tr><td>${skill.name}</td><td>${skill.usageCount}</td><td>${lastUsedDate}</td></tr>`;
      }
      skillsHtml += "</tbody></table>";
    } else {
      skillsHtml = '<div class="empty-state">No skills data found</div>';
    }

    if (claudeStats.tools.length > 0) {
      toolsHtml =
        '<table class="sortable" data-default-sort="1" data-default-order="desc"><thead><tr><th class="sortable-header" data-column="0" data-type="string">Tool</th><th class="sortable-header" data-column="1" data-type="number">Usage Count</th><th class="sortable-header" data-column="2" data-type="date">Last Used</th></tr></thead><tbody>';
      for (const tool of claudeStats.tools) {
        const lastUsedDate = new Date(tool.lastUsedAt).toLocaleDateString();
        toolsHtml += `<tr><td>${tool.name}</td><td>${tool.usageCount}</td><td>${lastUsedDate}</td></tr>`;
      }
      toolsHtml += "</tbody></table>";
    } else {
      toolsHtml = '<div class="empty-state">No tools data found</div>';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <link rel="stylesheet" href="${cssUri}">
  <title>Claude AI usage costs Dashboard</title>
  <style>
    body { padding: 16px; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 16px; }
    .tab-button { background: none; border: none; color: var(--vscode-foreground); padding: 8px 12px; cursor: pointer; opacity: 0.6; border-bottom: 2px solid transparent; font-weight: 500; }
    .tab-button:hover { opacity: 0.8; }
    .tab-button.active { opacity: 1; color: var(--vscode-textLink-foreground); border-bottom-color: var(--vscode-textLink-foreground); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    #daily.tab-content.alert-active {
      border: 3px solid #d9534f;
      border-radius: 6px;
      padding: 12px;
      margin: 0 -16px;
      padding-left: 16px;
      padding-right: 16px;
    }
    #weekly.tab-content.alert-active {
      border: 3px solid #f0ad4e;
      border-radius: 6px;
      padding: 12px;
      margin: 0 -16px;
      padding-left: 16px;
      padding-right: 16px;
    }
    .breakdown-container {
      margin-bottom: 24px;
    }
    .breakdown-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 4px;
      background: var(--vscode-editor-background);
      margin-bottom: 8px;
      border-left: 3px solid transparent;
      transition: all 0.2s ease;
    }
    .breakdown-item.alert {
      border-left-color: #d9534f;
      background: rgba(217, 83, 79, 0.08);
    }
    
    /* Alert row styles for daily and weekly tables */
    .alert-row {
      background: rgba(217, 83, 79, 0.12) !important;
      border-left: 4px solid #d9534f !important;
      font-weight: 600;
    }
    .alert-row td {
      color: #d9534f;
      padding-left: 8px !important;
    }
    .alert-row:first-child td:first-child {
      border-left: none;
    }
    
    .weekly-alert-row {
      background: rgba(240, 173, 78, 0.12) !important;
      border-left: 4px solid #f0ad4e !important;
      font-weight: 600;
    }
    .weekly-alert-row td {
      color: #f0ad4e;
      padding-left: 8px !important;
    }
    .weekly-alert-row:first-child td:first-child {
      border-left: none;
    }
    
    table tbody tr {
      transition: all 0.2s ease;
    }
    
    .breakdown-time {
      min-width: 160px;
      font-family: monospace;
      font-weight: 400;
      color: var(--vscode-foreground);
    }
    .breakdown-bar-wrapper {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .breakdown-bar {
      height: 20px;
      border-radius: 3px;
      min-width: 0px;
      transition: all 0.2s ease;
    }
    .breakdown-bar.safe {
      background: var(--vscode-charts-green);
    }
    .breakdown-bar.alert {
      background: #d9534f;
    }
    .breakdown-stats {
      display: flex;
      gap: 16px;
      align-items: center;
      font-size: 12px;
      min-width: 200px;
      text-align: right;
    }
    .breakdown-cost {
      font-weight: 600;
      min-width: 70px;
    }
    .breakdown-tokens {
      color: var(--vscode-descriptionForeground);
      min-width: 100px;
      cursor: help;
      transition: color 0.2s ease;
      border-bottom: 1px dotted var(--vscode-descriptionForeground);
    }

    .breakdown-tokens:hover {
      color: var(--vscode-foreground);
    }

  </style>
</head>
<body>
  <div class="tabs">
    <button class="tab-button active" data-tab="live">⚡ Live Usage</button>
    <button class="tab-button" data-tab="daily">📅 Daily</button>
    <button class="tab-button" data-tab="weekly">📊 Weekly</button>
    <button class="tab-button" data-tab="models">🤖 Models</button>

    <button class="tab-button" data-tab="skills">🛠️ Skills & Tools</button>
  </div>

  <div id="live" class="tab-content active">
    <h2>Live Usage (All Projects)</h2>
    <div id="live-summary" style="margin-bottom: 20px; padding: 12px; background: var(--vscode-editor-background); border-radius: 4px; border: 1px solid var(--vscode-panel-border);">
      <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">Loading...</div>
    </div>
    <h3>Today's Projects</h3>
    <div id="projects-list" class="breakdown-container">Loading...</div>
    <h3>Hourly Breakdown</h3>
    <div id="hourly-breakdown" class="breakdown-container">Loading...</div>
    <h3>Daily Comparison (7 Days)</h3>
    <div id="daily-comparison" class="breakdown-container">Loading...</div>
  </div>

  <div id="daily" class="tab-content">
    <h2>Daily Breakdown</h2>
    ${dailyHtml}
  </div>

  <div id="weekly" class="tab-content">
    <h2>Weekly Breakdown</h2>
    ${weeklyHtml}
  </div>

  <div id="models" class="tab-content">
    <h2>Costs by Model (from stats-cache.json)</h2>
    ${modelHtml}
  </div>

  <div id="projects" class="tab-content">
    <h2>All Projects</h2>
    ${projectsHtml}
  </div>

  <div id="skills" class="tab-content">
    <h2>Skills & Tools Usage</h2>
    <div style="margin-bottom: 24px;">
      <h3>Claude Skills</h3>
      ${skillsHtml}
    </div>
    <div>
      <h3>Tools Used</h3>
      ${toolsHtml}
    </div>
  </div>

  <script nonce="${nonce}">
    // Initialize bar widths via dynamic style tag
    const styleTag = document.createElement('style');
    styleTag.textContent = \`${barStyles}\`;
    document.head.appendChild(styleTag);

    // Tab switching
    const tabs = document.querySelectorAll('.tab-button');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-button').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Global variables for alert thresholds (must be declared before functions that use them)
    let globalDailyAlertThreshold = ${dailyAlertThreshold};
    let globalWeeklyAlertThreshold = ${weeklyAlertThreshold};

    // Check and display alerts for daily/weekly costs
    async function checkAndDisplayAlerts() {
      const dailyAlertThreshold = globalDailyAlertThreshold || 0;
      const weeklyAlertThreshold = globalWeeklyAlertThreshold || 0;

      // Highlight daily rows that exceed threshold
      const dailyTable = document.querySelector('#daily table tbody');
      let dailyAlertActive = false;
      if (dailyTable) {
        dailyTable.querySelectorAll('tr').forEach(row => {
          const costText = row.children[1].textContent.replace('$', '').trim();
          const cost = parseFloat(costText);
          if (dailyAlertThreshold > 0 && cost >= dailyAlertThreshold) {
            row.classList.add('alert-row');
            dailyAlertActive = true;
          } else {
            row.classList.remove('alert-row');
          }
        });
      }

      // Highlight weekly rows that exceed threshold
      const weeklyTable = document.querySelector('#weekly table tbody');
      let weeklyAlertActive = false;
      if (weeklyTable) {
        weeklyTable.querySelectorAll('tr').forEach(row => {
          const costText = row.children[1].textContent.replace('$', '').trim();
          const cost = parseFloat(costText);
          if (weeklyAlertThreshold > 0 && cost >= weeklyAlertThreshold) {
            row.classList.add('weekly-alert-row');
            weeklyAlertActive = true;
          } else {
            row.classList.remove('weekly-alert-row');
          }
        });
      }

      // Update live tab alert status when either alert is active
      const liveTab = document.getElementById('live-summary');
      if (dailyAlertActive || weeklyAlertActive) {
        liveTab.classList.add('alert-active');
      } else {
        liveTab.classList.remove('alert-active');
      }
    }

    // Check alerts on load
    checkAndDisplayAlerts();

    // Table sorting
    const formatCurrency = (val) => '$' + parseFloat(val).toFixed(2);
    const formatDateDisplay = (timestamp) => new Date(timestamp).toLocaleDateString();

    document.querySelectorAll('table.sortable').forEach(table => {
      const defaultSortCol = parseInt(table.dataset.defaultSort);
      const defaultOrder = table.dataset.defaultOrder || 'asc';
      let currentSortCol = defaultSortCol;
      let currentOrder = defaultOrder;

      // Apply default sort
      sortTable(table, defaultSortCol, defaultOrder);

      // Add click handlers to headers
      table.querySelectorAll('th.sortable-header').forEach(header => {
        header.style.cursor = 'pointer';
        header.style.userSelect = 'none';
        header.addEventListener('click', () => {
          const col = parseInt(header.dataset.column);
          const newOrder = currentSortCol === col && currentOrder === 'asc' ? 'desc' : 'asc';
          currentSortCol = col;
          currentOrder = newOrder;
          sortTable(table, col, newOrder);
          updateHeaderIndicators(table, col, newOrder);
        });
      });

      // Set initial header indicator
      updateHeaderIndicators(table, defaultSortCol, defaultOrder);
    });

    function sortTable(table, columnIndex, order) {
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const header = table.querySelectorAll('th.sortable-header')[columnIndex];
      const dataType = header?.dataset.type || 'string';

      rows.sort((a, b) => {
        const aCell = a.children[columnIndex];
        const bCell = b.children[columnIndex];
        let aVal = aCell.textContent.trim();
        let bVal = bCell.textContent.trim();

        if (dataType === 'number') {
          aVal = parseFloat(aVal.replace(/[$,]/g, ''));
          bVal = parseFloat(bVal.replace(/[$,]/g, ''));
        } else if (dataType === 'date') {
          aVal = new Date(aVal).getTime();
          bVal = new Date(bVal).getTime();
        }

        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
      });

      const tbody = table.querySelector('tbody');
      rows.forEach(row => tbody.appendChild(row));
    }

    function updateHeaderIndicators(table, columnIndex, order) {
      table.querySelectorAll('th.sortable-header').forEach((h, i) => {
        if (i === columnIndex) {
          h.textContent = h.textContent.replace(/ +[↑↓]/, '');
          h.textContent += ' ' + (order === 'asc' ? '↑' : '↓');
        } else {
          h.textContent = h.textContent.replace(/ +[↑↓]/, '');
        }
      });
    }

    // Handle live usage data from extension
    
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'updateLiveUsage') {
        globalDailyAlertThreshold = message.dailyAlertThreshold || 0;
        globalWeeklyAlertThreshold = message.weeklyAlertThreshold || 0;
        updateLiveUsageDisplay(message.hourly, message.daily, message.todaysSummary, message.projects);
        checkAndDisplayAlerts();
      }
    });

    function updateLiveUsageDisplay(hourlyData, dailyData, todaysSummary, projectsData) {
      const formatTokens = (count) => {
        if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
        if (count >= 1000) return (count / 1000).toFixed(0) + 'K';
        return count.toString();
      };

      // Update summary
      const summaryDiv = document.getElementById('live-summary');
      if (summaryDiv && todaysSummary) {
        summaryDiv.innerHTML = \`
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px;">
            <div>
              <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">TODAY'S COST</div>
              <div style="font-size: 28px; font-weight: bold; color: var(--vscode-textLink-foreground);">$\${todaysSummary.cost.toFixed(2)}</div>
            </div>
            <div>
              <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">BILLED TOKENS</div>
              <div style="font-size: 20px; font-weight: bold;">\${formatTokens(todaysSummary.billedTokens)}</div>
              <div style="font-size: 9px; color: var(--vscode-descriptionForeground);">(input + output)</div>
            </div>
            <div>
              <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">CACHE READ</div>
              <div style="font-size: 20px; font-weight: bold; color: var(--vscode-charts-green);">\${formatTokens(todaysSummary.cacheReadTokens)}</div>
              <div style="font-size: 9px; color: var(--vscode-descriptionForeground);">saved 90%</div>
            </div>
            <div>
              <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">CACHE WRITE</div>
              <div style="font-size: 20px; font-weight: bold; color: var(--vscode-charts-blue);">\${formatTokens(todaysSummary.cacheWriteTokens)}</div>
              <div style="font-size: 9px; color: var(--vscode-descriptionForeground);">+25% cost</div>
            </div>
          </div>
        \`;
      }

      // Update projects list
      const projectsDiv = document.getElementById('projects-list');
      if (projectsDiv && projectsData && Object.keys(projectsData).length > 0) {
        const maxCost = Math.max(...Object.values(projectsData).map(p => p.cost), 0.01);
        let projectsHtml = '';
        for (const [projectName, data] of Object.entries(projectsData)) {
          const barWidth = maxCost > 0 ? (data.cost / maxCost) * 100 : 0;
          const billedTokens = data.billedTokens || 0;
          const cacheReadTokens = data.cacheReadTokens || 0;
          const cacheWriteTokens = data.cacheWriteTokens || 0;
          const totalTokens = billedTokens + cacheReadTokens + cacheWriteTokens;
          const tokenBreakdown = \`Billed: \${billedTokens.toLocaleString()} | Cache Read: \${cacheReadTokens.toLocaleString()} | Cache Write: \${cacheWriteTokens.toLocaleString()}\`;
          projectsHtml += \`
            <div class="breakdown-item">
              <div class="breakdown-time" style="min-width: 200px; font-weight: 500;">\${projectName}</div>
              <div class="breakdown-bar-wrapper">
                <div class="breakdown-bar safe" style="width: \${barWidth}%"></div>
              </div>
              <div class="breakdown-stats">
                <div class="breakdown-cost">$\${data.cost.toFixed(2)}</div>
                <div class="breakdown-tokens" title="\${tokenBreakdown}">\${totalTokens.toLocaleString()} tokens</div>
              </div>
            </div>
          \`;
        }
        projectsDiv.innerHTML = projectsHtml;
      }

      // Update hourly breakdown
      if (hourlyData && hourlyData.length > 0) {
        const maxCost = Math.max(...hourlyData.map(h => h.cost));
        const dailyAlertThreshold = globalDailyAlertThreshold || 0;
        let hourlyHtml = '';
        for (const hour of hourlyData) {
          const barWidth = maxCost > 0 ? (hour.cost / maxCost) * 100 : 0;
          const isAlert = dailyAlertThreshold > 0 && hour.cost >= dailyAlertThreshold;
          const hourStr = String(hour.hour).padStart(2, '0');
          const barClass = isAlert ? 'alert' : 'safe';
          const totalTokens = (hour.billedTokens || 0) + (hour.cacheReadTokens || 0) + (hour.cacheWriteTokens || 0);
          hourlyHtml += \`
            <div class="breakdown-item \${isAlert ? 'alert' : ''}">
              <div class="breakdown-time">\${hourStr}:00</div>
              <div class="breakdown-bar-wrapper">
                <div class="breakdown-bar \${barClass}" style="width: \${barWidth}%"></div>
              </div>
              <div class="breakdown-stats">
                <div class="breakdown-cost">$\${hour.cost.toFixed(2)}</div>
                <div class="breakdown-tokens" title="Billed: \${(hour.billedTokens || 0).toLocaleString()} | Cache Read: \${(hour.cacheReadTokens || 0).toLocaleString()} | Cache Write: \${(hour.cacheWriteTokens || 0).toLocaleString()}">\${totalTokens.toLocaleString()} total</div>
              </div>
            </div>
          \`;
        }
        document.getElementById('hourly-breakdown').innerHTML = hourlyHtml;
      }

      // Update daily comparison
      if (dailyData) {
        // Create a map of dates to data for quick lookup
        const dataMap = {};
        if (Array.isArray(dailyData) && dailyData.length > 0) {
          for (const day of dailyData) {
            dataMap[day.date] = day;
          }
        }

        // Generate last 7 days including today
        const today = new Date();
        const last7Days = [];
        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          last7Days.push({
            date: dateStr,
            cost: (dataMap[dateStr]?.cost || 0),
            billedTokens: (dataMap[dateStr]?.billedTokens || 0),
            cachedTokens: (dataMap[dateStr]?.cachedTokens || 0),
          });
        }

        const maxCost = Math.max(...last7Days.map(d => d.cost), 0.01);
        const dailyAlertThreshold = globalDailyAlertThreshold || 0;
        const todayStr = today.toISOString().split('T')[0];
        let dailyHtml = '';

        for (const day of last7Days) {
          const barWidth = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
          const isAlert = dailyAlertThreshold > 0 && day.cost >= dailyAlertThreshold;
          const barClass = isAlert ? 'alert' : 'safe';
          const dateObj = new Date(day.date + 'T00:00:00');
          const formattedDate = dateObj.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
          });
          const dateLabel = day.date === todayStr ? \`Today (\${formattedDate})\` : formattedDate;
          const totalTokens = (day.billedTokens || 0) + (day.cacheReadTokens || 0) + (day.cacheWriteTokens || 0);
          const tokenBreakdown = \`Billed: \${(day.billedTokens || 0).toLocaleString()} | Cache Read: \${(day.cacheReadTokens || 0).toLocaleString()} | Cache Write: \${(day.cacheWriteTokens || 0).toLocaleString()}\`;
          dailyHtml += \`
            <div class="breakdown-item \${isAlert ? 'alert' : ''}">
              <div class="breakdown-time">\${dateLabel}</div>
              <div class="breakdown-bar-wrapper">
                <div class="breakdown-bar \${barClass}" style="width: \${barWidth}%"></div>
              </div>
              <div class="breakdown-stats">
                <div class="breakdown-cost">$\${day.cost.toFixed(2)}</div>
                <div class="breakdown-tokens" title="\${tokenBreakdown}">\${totalTokens.toLocaleString()} total</div>
              </div>
            </div>
          \`;
        }
        document.getElementById('daily-comparison').innerHTML = dailyHtml;
      }
    }
  </script>
</body>
</html>`;
  }
}
