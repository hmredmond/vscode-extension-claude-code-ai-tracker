import * as vscode from "vscode";
import { FacetsService } from "../services/facetsService";
import { getNonce, getUri } from "../utils/webviewHelpers";

export class ImpactSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "aiUsageCost.impactSidebar";
  private currentWebview: vscode.Webview | undefined;
  private currentWebviewView: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    this.currentWebview = webviewView.webview;
    this.currentWebviewView = webviewView;

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === 'ready') {
        this.refresh();
      } else if (message.command === 'openImpactDashboard') {
        vscode.commands.executeCommand('aiUsageCost.openImpactDashboard');
      }
    });
  }

  async refresh(): Promise<void> {
    if (!this.currentWebview) {
      return;
    }

    const hasFolder = FacetsService.hasFacetsFolder();
    if (!hasFolder) {
      this.currentWebview.postMessage({ command: "updateData", hasFolder: false });
      if (this.currentWebviewView) {
        this.currentWebviewView.description = "no data";
      }
      return;
    }

    try {
      const impact = FacetsService.load();
      this.currentWebview.postMessage({
        command: "updateData",
        hasFolder: true,
        hasData: impact.hasData,
        sessionCount: impact.sessionCount,
        successRate: impact.successRate,
        timeSavedMinutes: impact.timeSavedMinutes,
        percentTimeSaved: impact.percentTimeSaved,
        roi: impact.roi,
        devValueSaved: impact.devValueSaved,
        totalTokenCost: impact.totalTokenCost,
        avgHelpfulness: impact.avgHelpfulness,
        dateFrom: impact.dateFrom,
        dateTo: impact.dateTo,
        outcomeDistribution: impact.outcomeDistribution,
        sessionTypeDistribution: impact.sessionTypeDistribution,
        frictionFactors: impact.frictionFactors,
      });
      if (this.currentWebviewView) {
        if (impact.hasData) {
          this.currentWebviewView.description = `${impact.sessionCount} sessions · ${impact.successRate.toFixed(0)}% success`;
        } else {
          this.currentWebviewView.description = "no sessions yet";
        }
      }
    } catch {
      this.currentWebview.postMessage({
        command: "updateData",
        hasFolder: true,
        hasData: false,
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
  <title>Impact Analysis</title>
  <style>
    body { padding: 12px; min-height: 200px; }
    .setup-box {
      border: 1px solid var(--vscode-editorGroup-border, #cccccc);
      border-left: 3px solid rgba(76, 175, 80, 0.6);
      border-radius: 4px;
      padding: 12px;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .setup-box p { margin-bottom: 10px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
    .setup-box ol { padding-left: 18px; color: var(--vscode-descriptionForeground); line-height: 1.8; }
    code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      background: rgba(127,127,127,0.15);
      padding: 1px 4px;
      border-radius: 2px;
    }
    .roi-label { font-size: 11px; }
    .disclaimer {
      font-size: 10px;
      opacity: 0.6;
      padding: 6px 0 4px;
      line-height: 1.4;
    }
  </style>
</head>
<body>

  <!-- No folder found -->
  <div id="no-folder" style="display:none;">
    <div class="setup-box">
      <p>No insights data found. Run the <code>/insights</code> slash command in Claude Code after a session to get started.</p>
      <ol>
        <li>Complete a task with Claude Code</li>
        <li>Type <code>/insights</code> and press Enter</li>
        <li>Data saves to <code>~/.claude/usage-data/facets/</code></li>
      </ol>
    </div>
    <button id="openSetupBtn" style="font-size: 11px; padding: 4px 10px; cursor: pointer; width: 100%;">View setup guide →</button>
  </div>

  <!-- Folder found but no sessions yet -->
  <div id="no-data" style="display:none;">
    <div class="setup-box">
      <p>Folder found but no sessions yet. Run <code>/insights</code> at the end of a Claude Code session to record it.</p>
    </div>
    <button id="openDashboardBtnEmpty" style="font-size: 11px; padding: 4px 10px; cursor: pointer; width: 100%;">View setup guide →</button>
  </div>

  <!-- Data available -->
  <div id="data-section" style="display:none;">

    <h2>Session Overview</h2>
    <div class="cost-display">
      <div class="cost-value" id="successRate">—</div>
      <div class="cost-detail">success rate</div>
      <div class="cost-detail" id="sessionsLabel" style="margin-top: 2px; opacity: 0.6; font-size: 10px;">—</div>
      <div class="cost-detail" id="periodLabel" style="margin-top: 2px; opacity: 0.6; font-size: 10px;">—</div>
    </div>

    <h2>Est. Time Saved</h2>
    <div class="cost-display">
      <div class="cost-value" id="timeSaved">—</div>
      <div class="cost-detail" id="pctTimeSaved">—</div>
    </div>

    <h2>ROI</h2>
    <div class="cost-display">
      <div class="cost-value" id="roi">—</div>
      <div class="cost-detail" id="roiLabel">dev value / token cost</div>
      <div class="cost-detail" id="tokenCostLabel" style="margin-top: 2px; opacity: 0.6; font-size: 10px;">—</div>
    </div>

    <div class="disclaimer" style="margin-top: 12px;">⚠️ Time saved and ROI are rough heuristic estimates, not measurements.</div>

  </div>

  <script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.command !== 'updateData') return;

    document.getElementById('no-folder').style.display = 'none';
    document.getElementById('no-data').style.display = 'none';
    document.getElementById('data-section').style.display = 'none';

    if (!m.hasFolder) {
      document.getElementById('no-folder').style.display = 'block';
      return;
    }

    if (!m.hasData) {
      document.getElementById('no-data').style.display = 'block';
      return;
    }

    document.getElementById('data-section').style.display = 'block';

    // Success rate & sessions
    document.getElementById('successRate').textContent = m.successRate.toFixed(0) + '%';
    document.getElementById('sessionsLabel').textContent = m.sessionCount + ' sessions analysed';

    // Period
    const periodEl = document.getElementById('periodLabel');
    if (periodEl && m.dateFrom && m.dateTo) {
      const from = new Date(m.dateFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const to = new Date(m.dateTo).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      periodEl.textContent = from + ' – ' + to;
    }

    // Time saved
    const hrs = Math.floor(m.timeSavedMinutes / 60);
    const mins = Math.round(m.timeSavedMinutes % 60);
    const timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
    document.getElementById('timeSaved').textContent = timeStr;
    document.getElementById('pctTimeSaved').textContent = m.percentTimeSaved.toFixed(1) + '% of contracted hours';

    // ROI
    const roiEl = document.getElementById('roi');
    const roiLabel = document.getElementById('roiLabel');
    const tokenCostLabel = document.getElementById('tokenCostLabel');
    if (m.roi != null) {
      roiEl.textContent = m.roi.toFixed(1) + '\u00d7';
      if (roiLabel) roiLabel.textContent = 'dev value / token cost';
    } else if (m.devValueSaved > 0) {
      roiEl.textContent = '\u00a3' + m.devValueSaved.toFixed(0);
      if (roiLabel) roiLabel.textContent = 'est. dev value saved';
    } else {
      roiEl.textContent = 'N/A';
      if (roiLabel) roiLabel.textContent = 'no token cost data';
    }
    if (tokenCostLabel && m.totalTokenCost > 0) {
      tokenCostLabel.textContent = 'token cost: $' + m.totalTokenCost.toFixed(4);
    }

  });

  // Signal to extension that JS is ready to receive data
  vscode.postMessage({ command: 'ready' });

  document.addEventListener('click', (e) => {
    const id = e.target && e.target.id;
    if (id === 'openSetupBtn' || id === 'openDashboardBtnEmpty') {
      vscode.postMessage({ command: 'openImpactDashboard' });
    }
  });
  </script>
</body>
</html>`;
  }
}
