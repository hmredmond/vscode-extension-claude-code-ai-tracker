import * as vscode from "vscode";
import { StorageService } from "./services/storageService";
import { getCurrentBranch, getProjectName } from "./services/gitService";
import { StatsCacheService } from "./services/statsCacheService";
import { JsonlCostService } from "./services/jsonlCostService";
import { SidebarProvider } from "./views/sidebarProvider";
import { ImpactSidebarProvider } from "./views/impactSidebarProvider";
import { DashboardPanel } from "./views/dashboardPanel";
import { ChartsPanel } from "./views/chartsPanel";
import { ReportDashboardPanel } from "./views/reportDashboardPanel";
import { ImpactDashboardPanel } from "./views/impactDashboardPanel";
import { AiStatsDataService } from "./services/aiStatsDataService";
import { FacetsService } from "./services/facetsService";
import { formatDate } from "./utils/webviewHelpers";
import { CostRecord } from "./types";
import { captureCost } from "./services/claudeCapture";
import { ReportsTreeProvider, ConfigSettingsTreeProvider } from "./views/treeProviders";
import { setCustomPricingOverrides, ModelPricing } from "./utils/pricing";

let outputChannel: vscode.OutputChannel;
let storageService: StorageService;
let sidebarProvider: SidebarProvider;
let reportsProvider: ReportsTreeProvider;
let configProvider: ConfigSettingsTreeProvider;
let impactSidebarProvider: ImpactSidebarProvider;
let statusBarItem: vscode.StatusBarItem;
let statusBarMode: "daily" | "weekly" | "monthly" | "alltime" = "daily";

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Claude AI usage costs");
  outputChannel.appendLine("[DEBUG] Extension activated");
  storageService = new StorageService(context.globalState);

  // Initialize services with the extension path
  AiStatsDataService.setExtensionPath(context.extensionUri);

  // Apply custom pricing overrides from VS Code config
  const applyPricingConfig = () => {
    const cfg = vscode.workspace.getConfiguration("aiUsageCost");
    const overrides = cfg.get<Record<string, Partial<ModelPricing>>>("customModelPricing", {});
    setCustomPricingOverrides(overrides);
  };
  applyPricingConfig();

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "aiUsageCost.cycleStatusBarMode";
  statusBarItem.tooltip =
    "Click to cycle through daily/weekly/monthly/all time costs";
  context.subscriptions.push(statusBarItem);

  outputChannel.appendLine("Claude AI usage costs extension activated");

  // Register sidebar provider (webview - Cost Overview)
  sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider,
    ),
  );

  // Register Reports tree view
  reportsProvider = new ReportsTreeProvider();
  const reportsTreeView = vscode.window.createTreeView("aiUsageCost.reports", {
    treeDataProvider: reportsProvider,
    showCollapseAll: false,
  });
  reportsProvider.startCountdownTick();
  context.subscriptions.push(reportsProvider);

  // Register Config Settings tree view
  configProvider = new ConfigSettingsTreeProvider();
  vscode.window.createTreeView("aiUsageCost.configSettings", {
    treeDataProvider: configProvider,
    showCollapseAll: false,
  });

  // Register Insights sidebar webview
  impactSidebarProvider = new ImpactSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ImpactSidebarProvider.viewId,
      impactSidebarProvider,
    ),
  );

  // Build the session→cost index in the background so FacetsService can use token costs.
  // Re-build whenever the sidebar refreshes so new sessions are picked up.
  JsonlCostService.buildSessionCostIndex().catch(() => { /* non-fatal */ });

  // After each sidebar refresh, update the Reports tree timing
  const origRefresh = sidebarProvider.refresh.bind(sidebarProvider);
  sidebarProvider.refresh = async (...args: Parameters<typeof origRefresh>) => {
    await origRefresh(...args);
    const now = new Date();
    const pollMins = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<number>("pollIntervalMinutes", 5);
    reportsProvider.notifyRefreshed(
      now,
      new Date(now.getTime() + pollMins * 60 * 1000),
    );
    reportsTreeView.description = reportsProvider.getLastUpdatedDescription();
    // Rebuild session cost index then refresh impact sidebar
    JsonlCostService.buildSessionCostIndex()
      .catch(() => { /* non-fatal */ })
      .then(() => impactSidebarProvider.refresh());
  };

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("aiUsageCost.dailyAlertThreshold") ||
        event.affectsConfiguration("aiUsageCost.weeklyAlertThreshold")
      ) {
        // Refresh sidebar
        if (sidebarProvider) {
          sidebarProvider.refresh();
        }
        configProvider.refresh();
        // Update status bar
        updateStatusBarItem();
      }
      if (event.affectsConfiguration("aiUsageCost.showInsightsAnalysis") ||
          event.affectsConfiguration("aiUsageCost.developerHourlyRate") ||
          event.affectsConfiguration("aiUsageCost.developerHoursPerWeek")) {
        configProvider.refresh();
        reportsProvider.refresh();
        if (sidebarProvider) {
          sidebarProvider.refresh();
        }
        impactSidebarProvider.refresh();
      }
      if (event.affectsConfiguration("aiUsageCost.customModelPricing") ||
          event.affectsConfiguration("aiUsageCost.billingType")) {
        applyPricingConfig();
        configProvider.refresh();
        if (sidebarProvider) {
          sidebarProvider.refresh();
        }
      }
    }),
  );

  // Register show history command
  const historyCommand = vscode.commands.registerCommand(
    "aiUsageCost.showHistory",
    handleShowHistory,
  );
  context.subscriptions.push(historyCommand);

  // Register import historical data command
  const importCommand = vscode.commands.registerCommand(
    "aiUsageCost.importHistorical",
    handleImportHistorical,
  );
  context.subscriptions.push(importCommand);

  // Register import from JSONL command
  const importJsonlCommand = vscode.commands.registerCommand(
    "aiUsageCost.importFromJsonl",
    handleImportFromJsonl,
  );
  context.subscriptions.push(importJsonlCommand);

  // Register clear all data command
  const clearCommand = vscode.commands.registerCommand(
    "aiUsageCost.clearAllData",
    handleClearAllData,
  );
  context.subscriptions.push(clearCommand);

  // Register open dashboard command
  const dashboardCommand = vscode.commands.registerCommand(
    "aiUsageCost.openDashboard",
    async (tab?: string) => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }
      DashboardPanel.createOrShow(context.extensionUri);
    },
  );
  context.subscriptions.push(dashboardCommand);

  // Register open charts command
  const chartsCommand = vscode.commands.registerCommand(
    "aiUsageCost.openCharts",
    async () => {
      ChartsPanel.createOrShow(context.extensionUri, outputChannel);
    },
  );
  context.subscriptions.push(chartsCommand);

  // Register open report dashboard command
  const reportDashboardCommand = vscode.commands.registerCommand(
    "aiUsageCost.openReportDashboard",
    async () => {
      ReportDashboardPanel.createOrShow(context.extensionUri);
    },
  );
  context.subscriptions.push(reportDashboardCommand);

  // Register open impact dashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand("aiUsageCost.openImpactDashboard", () => {
      const cfg = vscode.workspace.getConfiguration("aiUsageCost");
      if (!cfg.get<boolean>("showInsightsAnalysis", false)) {
        vscode.window.showInformationMessage(
          "Enable 'Show Insights Analysis' in settings (aiUsageCost.showInsightsAnalysis) to use the Impact Analysis panel.",
          "Open Settings",
        ).then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "aiUsageCost.showInsightsAnalysis",
            );
          }
        });
        return;
      }
      ImpactDashboardPanel.createOrShow(context.extensionUri);
    }),
  );

  // Register edit insights config commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "aiUsageCost.editInsightsHourlyRate",
      async () => {
        const cfg = vscode.workspace.getConfiguration("aiUsageCost");
        const current = cfg.get<number>("developerHourlyRate", 50);
        const input = await vscode.window.showInputBox({
          title: "Developer Hourly Rate",
          prompt: "Enter your hourly rate (used for ROI calculation in Impact Analysis)",
          value: String(current),
          validateInput: (v) =>
            isNaN(Number(v)) || Number(v) < 0
              ? "Enter a non-negative number"
              : undefined,
        });
        if (input !== undefined) {
          await cfg.update(
            "developerHourlyRate",
            parseFloat(input) || 50,
            vscode.ConfigurationTarget.Global,
          );
          configProvider.refresh();
          impactSidebarProvider.refresh();
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "aiUsageCost.editInsightsHoursPerWeek",
      async () => {
        const cfg = vscode.workspace.getConfiguration("aiUsageCost");
        const current = cfg.get<number>("developerHoursPerWeek", 40);
        const input = await vscode.window.showInputBox({
          title: "Developer Hours Per Week",
          prompt: "Enter contracted hours per week (used for % time saved in Impact Analysis)",
          value: String(current),
          validateInput: (v) =>
            isNaN(Number(v)) || Number(v) <= 0
              ? "Enter a positive number"
              : undefined,
        });
        if (input !== undefined) {
          await cfg.update(
            "developerHoursPerWeek",
            parseFloat(input) || 40,
            vscode.ConfigurationTarget.Global,
          );
          configProvider.refresh();
          impactSidebarProvider.refresh();
        }
      },
    ),
  );

  // Register print report to console command
  const printReportCommand = vscode.commands.registerCommand(
    "aiUsageCost.printReportToConsole",
    async () => {
      if (sidebarProvider) {
        await (sidebarProvider as any).printReportToConsole();
      }
    },
  );
  context.subscriptions.push(printReportCommand);

  // Register edit billing type command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "aiUsageCost.editBillingType",
      async () => {
        const cfg = vscode.workspace.getConfiguration("aiUsageCost");
        const current = cfg.get<string>("billingType", "api");
        const picked = await vscode.window.showQuickPick(
          [
            {
              label: "api",
              description: "Pay-per-token API billing (standard Anthropic rates)",
              picked: current === "api",
            },
            {
              label: "max",
              description: "Claude Max subscription (costs shown are API-rate estimates only)",
              picked: current === "max",
            },
          ],
          { title: "Select Billing Type", placeHolder: "How are you billed for Claude Code?" },
        );
        if (picked) {
          await cfg.update("billingType", picked.label, vscode.ConfigurationTarget.Global);
          applyPricingConfig();
          configProvider.refresh();
          if (sidebarProvider) {
            sidebarProvider.refresh();
          }
        }
      },
    ),
  );

  // Register edit alert threshold commands
  const editDailyThresholdCommand = vscode.commands.registerCommand(
    "aiUsageCost.editDailyAlertThreshold",
    async () => {
      const config = vscode.workspace.getConfiguration("aiUsageCost");
      const current = config.get<number>("dailyAlertThreshold", 10);
      const input = await vscode.window.showInputBox({
        title: "Daily Alert Threshold",
        prompt: "Enter daily cost threshold in USD (0 to disable)",
        value: String(current),
        validateInput: (v) =>
          isNaN(Number(v)) || Number(v) < 0
            ? "Enter a non-negative number"
            : undefined,
      });
      if (input !== undefined) {
        await config.update(
          "dailyAlertThreshold",
          parseFloat(input) || 0,
          vscode.ConfigurationTarget.Global,
        );
        sidebarProvider?.refresh();
        configProvider.refresh();
      }
    },
  );
  context.subscriptions.push(editDailyThresholdCommand);

  const editWeeklyThresholdCommand = vscode.commands.registerCommand(
    "aiUsageCost.editWeeklyAlertThreshold",
    async () => {
      const config = vscode.workspace.getConfiguration("aiUsageCost");
      const current = config.get<number>("weeklyAlertThreshold", 50);
      const input = await vscode.window.showInputBox({
        title: "Weekly Alert Threshold",
        prompt: "Enter weekly cost threshold in USD (0 to disable)",
        value: String(current),
        validateInput: (v) =>
          isNaN(Number(v)) || Number(v) < 0
            ? "Enter a non-negative number"
            : undefined,
      });
      if (input !== undefined) {
        await config.update(
          "weeklyAlertThreshold",
          parseFloat(input) || 0,
          vscode.ConfigurationTarget.Global,
        );
        sidebarProvider?.refresh();
        configProvider.refresh();
      }
    },
  );
  context.subscriptions.push(editWeeklyThresholdCommand);

  // Register refresh costs command (Cost Overview section header button)
  context.subscriptions.push(
    vscode.commands.registerCommand("aiUsageCost.refreshCosts", async () => {
      if (sidebarProvider) {
        await sidebarProvider.refresh();
      }
    }),
  );

  // Register toggle status bar command
  const toggleStatusBarCommand = vscode.commands.registerCommand(
    "aiUsageCost.toggleStatusBar",
    async () => {
      const isVisible = context.globalState.get<boolean>(
        "aiUsageCost.statusBarVisible",
        false,
      );
      const newState = !isVisible;
      context.globalState.update("aiUsageCost.statusBarVisible", newState);

      if (newState) {
        updateStatusBarItem();
        statusBarItem.show();
      } else {
        statusBarItem.hide();
      }

      // Notify sidebar of the change
      if (sidebarProvider) {
        await sidebarProvider.refresh();
      }
    },
  );
  context.subscriptions.push(toggleStatusBarCommand);

  // Register cycle status bar mode command
  const cycleStatusBarCommand = vscode.commands.registerCommand(
    "aiUsageCost.cycleStatusBarMode",
    async () => {
      const modes: Array<"daily" | "weekly" | "monthly" | "alltime"> = [
        "daily",
        "weekly",
        "monthly",
        "alltime",
      ];
      const currentIndex = modes.indexOf(statusBarMode);
      statusBarMode = modes[(currentIndex + 1) % modes.length];
      await updateStatusBarItem();
    },
  );
  context.subscriptions.push(cycleStatusBarCommand);

  // Register manual cost capture command
  const captureNowCommand = vscode.commands.registerCommand(
    "aiUsageCost.captureNow",
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }
      const cwd = workspaceFolder.uri.fsPath;
      outputChannel.appendLine(`[DEBUG] Getting project name for cwd: ${cwd}`);
      const project = await getProjectName(cwd);
      outputChannel.appendLine(`[DEBUG] Project name: ${project}`);
      outputChannel.appendLine(`[DEBUG] Getting git branch for cwd: ${cwd}`);
      const branch = await getCurrentBranch(cwd);
      outputChannel.appendLine(`[DEBUG] Git branch: ${branch}`);
      const claudePath =
        vscode.workspace
          .getConfiguration("aiUsageCost")
          .get<string>("claudeCliPath") || "claude";
      outputChannel.show();
      outputChannel.appendLine("\n--- Manual Claude Cost Capture ---");
      try {
        outputChannel.appendLine(`[DEBUG] Capturing cost with claudePath: ${claudePath}, cwd: ${cwd}`);
        const rawData = await captureCost(claudePath, cwd);
        outputChannel.appendLine(`[DEBUG] Raw cost data: ${JSON.stringify(rawData)}`);
        const record: CostRecord = {
          ...rawData,
          project,
          branch,
          timestamp: Date.now(),
        };
        outputChannel.appendLine(`[DEBUG] Appending record: ${JSON.stringify(record)}`);
        storageService.append(record);
        outputChannel.appendLine(
          `✓ Captured cost: $${record.totalCost.toFixed(4)} | ${record.inputTokens} input, ${record.outputTokens} output tokens`,
        );
        // Refresh sidebar and status bar
        if (sidebarProvider) {
          outputChannel.appendLine(`[DEBUG] Refreshing sidebarProvider after cost capture`);
          await sidebarProvider.refresh();
        }
        outputChannel.appendLine(`[DEBUG] Updating status bar item after cost capture`);
        await updateStatusBarItem();
        vscode.window.showInformationMessage(
          `Manual cost captured: $${record.totalCost.toFixed(4)}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[DEBUG] Error capturing cost: ${message}`);
        outputChannel.appendLine(`[DEBUG] Error stack: ${error instanceof Error ? error.stack : ''}`);
        outputChannel.appendLine(`✗ Error capturing cost: ${message}`);
        vscode.window.showErrorMessage(`Failed to capture cost: ${message}`);
      }
    },
  );
  context.subscriptions.push(captureNowCommand);

  // Check if status bar should be visible
  const shouldShowStatusBar = context.globalState.get<boolean>(
    "aiUsageCost.statusBarVisible",
    false,
  );
  if (shouldShowStatusBar) {
    updateStatusBarItem();
    statusBarItem.show();
  }

  // Run generate-data.js in background on activation (fire-and-forget)
  AiStatsDataService.run(outputChannel).catch((error) => {
    outputChannel.appendLine(`Note: AI stats data generation error (non-critical): ${error}`);
  });

  outputChannel.appendLine(
    "Commands registered: captureNow, showHistory, importHistorical, openDashboard, openCharts",
  );
}

async function handleShowHistory() {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "No workspace folder open. Please open a folder first.",
      );
      return;
    }

    outputChannel.show();
    outputChannel.appendLine("\n--- Claude AI usage costs History ---");

    const cwd = workspaceFolder.uri.fsPath;
    outputChannel.appendLine(`[DEBUG] Getting project name for cwd: ${cwd}`);
    const project = await getProjectName(cwd);
    outputChannel.appendLine(`[DEBUG] Project name: ${project}`);
    outputChannel.appendLine(`[DEBUG] Getting git branch for cwd: ${cwd}`);
    const branch = await getCurrentBranch(cwd);
    outputChannel.appendLine(`[DEBUG] Git branch: ${branch}`);
    outputChannel.appendLine(`[DEBUG] Getting history for project: ${project}, branch: ${branch}`);
    const history = storageService.getHistory(project, branch);

    if (history.length === 0) {
      outputChannel.appendLine(
        `No records found for project "${project}" on branch "${branch}"`,
      );
      return;
    }

    outputChannel.appendLine(
      `Showing ${history.length} record(s) for project "${project}" branch "${branch}":\n`,
    );

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    history.forEach((record, index) => {
      const date = formatDate(record.timestamp);
      outputChannel.appendLine(`Record ${index + 1}:`);
      outputChannel.appendLine(`  Date: ${date}`);
      outputChannel.appendLine(`  Cost: $${record.totalCost.toFixed(2)}`);
      outputChannel.appendLine(
        `  Tokens: ${record.inputTokens.toLocaleString()} input, ${record.outputTokens.toLocaleString()} output`,
      );

      totalCost += record.totalCost;
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;
    });

    outputChannel.appendLine("\n--- Summary ---");
    outputChannel.appendLine(`Total Cost: $${totalCost.toFixed(2)}`);
    outputChannel.appendLine(
      `Total Input Tokens: ${totalInputTokens.toLocaleString()}`,
    );
    outputChannel.appendLine(
      `Total Output Tokens: ${totalOutputTokens.toLocaleString()}`,
    );
    outputChannel.appendLine(
      `Average Cost per Record: $${(totalCost / history.length).toFixed(2)}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    outputChannel.appendLine(`✗ Error: ${message}`);
  }
}

async function handleImportHistorical() {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "No workspace folder open. Please open a folder first.",
      );
      return;
    }

    outputChannel.show();
    outputChannel.appendLine(
      "\n--- Importing Historical Data from Stats Cache ---",
    );

    // Get the stats cache path from settings
    const statsCachePath =
      vscode.workspace
        .getConfiguration("aiUsageCost")
        .get<string>("statsCachePath") || "~/.claude/stats-cache.json";

    outputChannel.appendLine(`Stats Cache Path: ${statsCachePath}`);

    // Read and parse the cache file
    outputChannel.appendLine("Reading stats cache file...");
    const cacheData = StatsCacheService.readCacheFile(statsCachePath);

    // Get project and branch info for the current workspace
    const cwd = workspaceFolder.uri.fsPath;
    outputChannel.appendLine(`[DEBUG] Getting project name for cwd: ${cwd}`);
    const project = await getProjectName(cwd);
    outputChannel.appendLine(`[DEBUG] Project name: ${project}`);
    outputChannel.appendLine(`[DEBUG] Getting git branch for cwd: ${cwd}`);
    const branch = await getCurrentBranch(cwd);
    outputChannel.appendLine(`[DEBUG] Git branch: ${branch}`);
    outputChannel.appendLine(`Importing data for project: ${project}, branch: ${branch}`);
    outputChannel.appendLine(`[DEBUG] Summarizing model usage from cacheData`);
    const modelSummary = StatsCacheService.summarizeModelUsage(cacheData);
    outputChannel.appendLine(`\nModels found in cache: ${modelSummary.length}`);
    outputChannel.appendLine("Model Summary:");

    let totalHistoricalCost = 0;

    for (const model of modelSummary) {
      outputChannel.appendLine(`\n  ${model.model}:`);
      outputChannel.appendLine(
        `    Input Tokens: ${model.inputTokens.toLocaleString()}`,
      );
      outputChannel.appendLine(
        `    Output Tokens: ${model.outputTokens.toLocaleString()}`,
      );
      if (model.cacheReadTokens > 0) {
        outputChannel.appendLine(
          `    Cache Read Tokens: ${model.cacheReadTokens.toLocaleString()}`,
        );
      }
      if (model.cacheWriteTokens > 0) {
        outputChannel.appendLine(
          `    Cache Write Tokens: ${model.cacheWriteTokens.toLocaleString()}`,
        );
      }
      outputChannel.appendLine(`    Cost: $${model.totalCost.toFixed(2)}`);
      totalHistoricalCost += model.totalCost;
    }

    // Convert to records and store them
    outputChannel.appendLine(`[DEBUG] Converting cacheData to project/branch records`);
    const records = StatsCacheService.convertToProjectBranchRecords(
      cacheData,
      project,
      branch,
    );

    outputChannel.appendLine(
      `\nStoring ${records.length} historical record(s)...`,
    );

    // Clear existing data for this project/branch before importing
    outputChannel.appendLine(`[DEBUG] Clearing storage for project: ${project}, branch: ${branch}`);
    storageService.clearForProjectBranch(project, branch);

    for (const record of records) {
      outputChannel.appendLine(`[DEBUG] Appending imported record: ${JSON.stringify(record)}`);
      storageService.append(record);
    }

    outputChannel.appendLine(`✓ Successfully imported historical data`);
    outputChannel.appendLine(
      `\nTotal Historical Cost: $${totalHistoricalCost.toFixed(2)}`,
    );
    outputChannel.appendLine('Run "Show Cost History" to view all records');

    // Refresh sidebar and status bar
    if (sidebarProvider) {
      outputChannel.appendLine(`[DEBUG] Refreshing sidebarProvider after import`);
      await sidebarProvider.refresh(undefined, project, branch);
    }
    outputChannel.appendLine(`[DEBUG] Updating status bar item after import`);
    await updateStatusBarItem();

    vscode.window.showInformationMessage(
      `Imported ${records.length} historical records. Total cost: $${totalHistoricalCost.toFixed(2)}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    outputChannel.appendLine(`✗ Error: ${message}`);
    vscode.window.showErrorMessage(
      `Failed to import historical data: ${message}`,
    );
  }
}

async function handleImportFromJsonl(): Promise<void> {
  try {
    outputChannel.show();
    outputChannel.appendLine(
      "\n--- Importing costs from Claude Code session logs ---",
    );

    const result = await JsonlCostService.importAllJsonlCosts();
    const { records, fileCount, totalCost } = result;

    outputChannel.appendLine(`Found ${fileCount} session files`);
    outputChannel.appendLine(`Extracted ${records.length} cost records`);

    let addedCount = 0;
    for (const record of records) {
      storageService.append(record);
      addedCount++;
    }

    outputChannel.appendLine(`✓ Successfully imported ${addedCount} records`);
    outputChannel.appendLine(
      `\nTotal Cost from Sessions: $${totalCost.toFixed(2)}`,
    );

    // Refresh sidebar and status bar
    if (sidebarProvider) {
      await sidebarProvider.refresh();
    }
    await updateStatusBarItem();

    vscode.window.showInformationMessage(
      `Imported ${addedCount} cost records from ${fileCount} session files. Total: $${totalCost.toFixed(2)}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    outputChannel.appendLine(`✗ Error: ${message}`);
    vscode.window.showErrorMessage(
      `Failed to import from session logs: ${message}`,
    );
  }
}

async function handleClearAllData(): Promise<void> {
  try {
    const confirm = await vscode.window.showWarningMessage(
      "Are you sure you want to delete ALL stored cost data? This cannot be undone.",
      { modal: true },
      "Clear Data",
      "Cancel",
    );

    if (confirm !== "Clear Data") {
      return;
    }

    outputChannel.show();
    outputChannel.appendLine("\n--- Clearing All Data ---");

    storageService.clear();

    outputChannel.appendLine("✓ All cost data cleared successfully");

    // Refresh UI
    if (sidebarProvider) {
      await sidebarProvider.refresh();
    }
    await updateStatusBarItem();

    vscode.window.showInformationMessage("All cost data has been cleared");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    outputChannel.appendLine(`✗ Error: ${message}`);
    vscode.window.showErrorMessage(`Failed to clear data: ${message}`);
  }
}

async function updateStatusBarItem(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    statusBarItem.hide();
    return;
  }

  try {
    // Get data from ai-stats-data.json (single source of truth, matches sidebar)
    const aiStatsData = await AiStatsDataService.getData();
    if (!aiStatsData || !aiStatsData.daily) {
      statusBarItem.hide();
      return;
    }

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // Daily - today's cost from daily data
    const dailyCost = aiStatsData.daily[todayStr]?.cost ?? 0;

    // Weekly - last 7 days
    let weeklyCost = 0;
    for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString().split("T")[0];
      weeklyCost += aiStatsData.daily[dateStr]?.cost ?? 0;
    }

    // Monthly - last 30 days
    let monthlyCost = 0;
    for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString().split("T")[0];
      monthlyCost += aiStatsData.daily[dateStr]?.cost ?? 0;
    }

    // All time
    const allTimeCost = aiStatsData.totals?.cost ?? 0;

    let text = "";
    switch (statusBarMode) {
      case "daily":
        text = `Today: $${dailyCost.toFixed(2)}`;
        break;
      case "weekly":
        text = `Week: $${weeklyCost.toFixed(2)}`;
        break;
      case "monthly":
        text = `Month: $${monthlyCost.toFixed(2)}`;
        break;
      case "alltime":
        text = `All: $${allTimeCost.toFixed(2)}`;
        break;
    }
    statusBarItem.text = text;
    statusBarItem.show();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    outputChannel.appendLine(`✗ Error updating status bar: ${message}`);
  }
}
