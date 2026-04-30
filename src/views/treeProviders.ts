import * as vscode from "vscode";

// ─── Reports Tree Provider ────────────────────────────────────────────────────

export class ReportsTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    command?: vscode.Command,
    description?: string,
    iconId?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (command) {
      this.command = command;
    }
    if (description) {
      this.description = description;
    }
    if (iconId) {
      this.iconPath = new vscode.ThemeIcon(iconId);
    }
  }
}

export class ReportsTreeProvider
  implements vscode.TreeDataProvider<ReportsTreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ReportsTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private lastUpdated?: Date;
  private nextUpdateAt?: Date;
  private tickInterval?: NodeJS.Timeout;

  notifyRefreshed(last: Date, next: Date): void {
    this.lastUpdated = last;
    this.nextUpdateAt = next;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  startCountdownTick(): void {
    if (this.tickInterval) {
      return;
    }
    // Refresh every 30 s so countdown stays roughly accurate
    this.tickInterval = setInterval(
      () => this._onDidChangeTreeData.fire(),
      30_000,
    );
  }

  stopCountdownTick(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
  }

  getLastUpdatedDescription(): string {
    if (!this.lastUpdated) {
      return '';
    }
    const diffMs = Date.now() - this.lastUpdated.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) {
      return 'updated just now';
    }
    return `updated ${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
  }

  private formatCountdown(): string {
    if (!this.nextUpdateAt) {
      return "—";
    }
    const diffMs = Math.max(0, this.nextUpdateAt.getTime() - Date.now());
    if (diffMs === 0) {
      return "updating...";
    }
    const totalSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(totalSecs / 60);
    if (diffMins > 0) {
      return `${diffMins} min${diffMins !== 1 ? "s" : ""}`;
    }
    const diffSecs = totalSecs % 60;
    return `${diffSecs} sec${diffSecs !== 1 ? "s" : ""}`;
  }

  getTreeItem(element: ReportsTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<ReportsTreeItem[]> {
    const showInsights = vscode.workspace
      .getConfiguration("aiUsageCost")
      .get<boolean>("showInsightsAnalysis", false);

    const items: ReportsTreeItem[] = [
      new ReportsTreeItem(
        "View Report Dashboard",
        {
          command: "aiUsageCost.openReportDashboard",
          title: "Open Report Dashboard",
        },
        undefined,
        "graph-line",
      ),
    ];

    if (showInsights) {
      items.push(
        new ReportsTreeItem(
          "View Impact Dashboard",
          {
            command: "aiUsageCost.openImpactDashboard",
            title: "Open Impact Dashboard",
          },
          undefined,
          "graph-scatter",
        ),
      );
    }

    items.push(
      new ReportsTreeItem(
        "Print Report to Console",
        {
          command: "aiUsageCost.printReportToConsole",
          title: "Print Report",
        },
        undefined,
        "output",
      ),
    );

    return Promise.resolve(items);
  }

  dispose(): void {
    this.stopCountdownTick();
    this._onDidChangeTreeData.dispose();
  }
}

// ─── Config Settings Tree Provider ───────────────────────────────────────────

export class ConfigTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    command?: vscode.Command,
    iconId?: string,
    tooltip?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    if (command) {
      this.command = command;
    }
    if (iconId) {
      this.iconPath = new vscode.ThemeIcon(iconId);
    }
    if (tooltip) {
      this.tooltip = tooltip;
    }
  }
}

export class ConfigSettingsTreeProvider
  implements vscode.TreeDataProvider<ConfigTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ConfigTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConfigTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<ConfigTreeItem[]> {
    const config = vscode.workspace.getConfiguration("aiUsageCost");
    const daily = config.get<number>("dailyAlertThreshold", 10);
    const weekly = config.get<number>("weeklyAlertThreshold", 50);
    const showInsights = config.get<boolean>("showInsightsAnalysis", false);
    const hourlyRate = config.get<number>("developerHourlyRate", 50);
    const hoursPerWeek = config.get<number>("developerHoursPerWeek", 40);
    const billingType = config.get<string>("billingType", "api");

    const billingLabel = billingType === "max" ? "Max (est. only)" : "API (pay-per-token)";

    const items: ConfigTreeItem[] = [
      new ConfigTreeItem(
        "Billing type",
        billingLabel,
        {
          command: "aiUsageCost.editBillingType",
          title: "Set Billing Type",
        },
        "credit-card",
        billingType === "max"
          ? "Claude Max subscription — cost figures are API-rate estimates, not actual charges (click to change)"
          : "Pay-per-token API billing (click to change)",
      ),
      new ConfigTreeItem(
        "Daily alert",
        daily === 0 ? "disabled" : `$${daily}`,
        {
          command: "aiUsageCost.editDailyAlertThreshold",
          title: "Edit Daily Alert Threshold",
        },
        "bell",
        "Click to change daily cost alert threshold",
      ),
      new ConfigTreeItem(
        "Weekly alert",
        weekly === 0 ? "disabled" : `$${weekly}`,
        {
          command: "aiUsageCost.editWeeklyAlertThreshold",
          title: "Edit Weekly Alert Threshold",
        },
        "bell-dot",
        "Click to change weekly cost alert threshold",
      ),
    ];

    if (showInsights) {
      items.push(
        new ConfigTreeItem(
          "Hourly rate",
          `${hourlyRate}/hr`,
          {
            command: "aiUsageCost.editInsightsHourlyRate",
            title: "Edit Developer Hourly Rate",
          },
          "person",
          "Developer hourly rate for ROI calculation (click to edit)",
        ),
        new ConfigTreeItem(
          "Hours/week",
          `${hoursPerWeek}h`,
          {
            command: "aiUsageCost.editInsightsHoursPerWeek",
            title: "Edit Developer Hours Per Week",
          },
          "clock",
          "Contracted hours per week for % time saved calculation (click to edit)",
        ),
      );
    }

    items.push(
      new ConfigTreeItem(
        "All settings",
        "",
        {
          command: "workbench.action.openSettings",
          title: "Open Settings",
          arguments: ["aiUsageCost"],
        },
        "gear",
        "Open VS Code settings for this extension",
      ),
    );
    return Promise.resolve(items);
  }
}
