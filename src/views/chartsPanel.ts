import * as vscode from "vscode";
import { DashboardData } from "../types";
import { AiStatsDataService } from "../services/aiStatsDataService";
import { getNonce, getUri } from "../utils/webviewHelpers";

export class ChartsPanel {
  public static currentPanel: ChartsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    outputChannel: vscode.OutputChannel,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.outputChannel = outputChannel;

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose(), null),
      this.panel.webview.onDidReceiveMessage(
        (message) => this.handleMessage(message),
        null,
      ),
    );

    this.setupWebview();
    this.loadData();
  }

  private setupWebview() {
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
        vscode.Uri.joinPath(this.extensionUri, "node_modules"),
      ],
    };
    this.panel.webview.html = this.getHtml();
  }

  private async loadData() {
    try {
      this.outputChannel.appendLine(
        "\n=== CHARTS PANEL: Loading dashboard data ===",
      );
      const aiStatsData = await AiStatsDataService.runAndGet(
        this.outputChannel,
      );

      if (aiStatsData?.dashboard) {
        this.outputChannel.appendLine("✅ Dashboard data loaded successfully");
        // Extract dashboard section from ai-stats-data
        const dashboardData = aiStatsData.dashboard as DashboardData;
        this.panel.webview.postMessage({
          command: "setData",
          data: dashboardData,
          hourly: aiStatsData.hourly || {}, // Include last 24hrs hourly data
        });
      } else {
        this.outputChannel.appendLine(
          "⚠️  No dashboard data available. Run generate-data.js to generate data.",
        );
        this.panel.webview.postMessage({
          command: "setError",
          error: "No dashboard data available",
        });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(
        `❌ Error loading dashboard data: ${errMsg}`,
      );
      this.panel.webview.postMessage({
        command: "setError",
        error: errMsg,
      });
    }
  }

  private async handleMessage(message: any) {
    switch (message.command) {
      case "refresh":
        await this.loadData();
        break;
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    const chartJsUri =
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net; img-src data:">
  <title>AI Usage Cost - Charts</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-editorGroup-border);
    }

    .header h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }

    .refresh-btn {
      padding: 6px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }

    .refresh-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .kpi-card {
      padding: 12px;
      background: var(--vscode-editorGroup-background);
      border: 1px solid var(--vscode-editorGroup-border);
      border-radius: 4px;
    }

    .kpi-label {
      font-size: 11px;
      opacity: 0.7;
      margin-bottom: 4px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .kpi-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--vscode-charts-green);
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--vscode-editorGroup-border);
      flex-wrap: wrap;
    }

    .tab {
      padding: 8px 12px;
      background: transparent;
      border: none;
      color: var(--vscode-editor-foreground);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      opacity: 0.7;
      transition: opacity 0.2s;
      font-size: 12px;
      font-weight: 500;
    }

    .tab:hover {
      opacity: 1;
    }

    .tab.active {
      opacity: 1;
      border-bottom-color: var(--vscode-focusBorder);
    }

    .tab-content {
      display: none;
      animation: fadeIn 0.2s ease;
    }

    .tab-content.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .chart-container {
      position: relative;
      height: 300px;
      margin-bottom: 24px;
      background: var(--vscode-editorGroup-background);
      border: 1px solid var(--vscode-editorGroup-border);
      border-radius: 4px;
      padding: 12px;
    }

    .table-container {
      overflow-x: auto;
      background: var(--vscode-editorGroup-background);
      border: 1px solid var(--vscode-editorGroup-border);
      border-radius: 4px;
      margin-bottom: 24px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    thead {
      background: var(--vscode-editor-background);
      border-bottom: 2px solid var(--vscode-editorGroup-border);
    }

    th {
      padding: 8px 12px;
      text-align: left;
      font-weight: 600;
      opacity: 0.8;
      cursor: pointer;
      user-select: none;
    }

    th:hover {
      background: var(--vscode-editorGroup-background);
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-editorGroup-border);
    }

    tbody tr:hover {
      background: var(--vscode-editor-background);
    }

    .loading {
      text-align: center;
      padding: 40px 20px;
      opacity: 0.7;
    }

    .error {
      padding: 16px;
      background: rgba(255, 0, 0, 0.1);
      border: 1px solid var(--vscode-errorForeground);
      border-radius: 4px;
      color: var(--vscode-errorForeground);
      margin-bottom: 16px;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-top: 12px;
    }

    .stat-item {
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 3px;
      font-size: 11px;
    }

    .stat-label {
      opacity: 0.7;
      margin-bottom: 2px;
    }

    .stat-value {
      font-weight: 600;
      font-size: 14px;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="header">
      <h1>📊 Claude Code Usage Charts</h1>
      <button class="refresh-btn" id="refreshBtn">🔄 Refresh</button>
    </div>

    <div id="error" class="error" style="display: none;"></div>

    <div id="loading" class="loading">
      <p>Loading dashboard data...</p>
    </div>

    <div id="content" style="display: none;">
      <div class="kpi-row" id="kpiRow"></div>

      <div class="tabs" id="tabsContainer"></div>

      <div id="tabsContent"></div>
    </div>
  </div>

  <script src="${chartJsUri}" nonce="${nonce}"><\/script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let dashboardData = null;
    let hourlyData = null;
    let currentTab = 'token-api-value';

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.command) {
        case 'setData':
          dashboardData = message.data;
          hourlyData = message.hourly || {};
          renderDashboard();
          break;
        case 'setError':
          showError(message.error);
          break;
      }
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    function showError(error) {
      document.getElementById('loading').style.display = 'none';
      const errorDiv = document.getElementById('error');
      errorDiv.textContent = '❌ Error: ' + error;
      errorDiv.style.display = 'block';
    }

    function renderDashboard() {
      if (!dashboardData) return;

      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';

      // Render KPI cards
      renderKPI();

      // Render tabs
      renderTabs();

      // Render initial tab content
      showTab(currentTab);
    }

    function renderKPI() {
      const kpi = dashboardData.kpi;
      const kpiRow = document.getElementById('kpiRow');
      kpiRow.innerHTML = \`
        <div class="kpi-card">
          <div class="kpi-label">Total</div>
          <div class="kpi-value">\$\${kpi.total_cost.toFixed(2)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Messages</div>
          <div class="kpi-value">\${kpi.total_messages.toLocaleString()}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Sessions</div>
          <div class="kpi-value">\${kpi.total_sessions}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Output Tokens</div>
          <div class="kpi-value">\${(kpi.total_output_tokens / 1000).toFixed(1)}K</div>
        </div>
      \`;
    }

    function renderTabs() {
      const tabs = [
        { id: 'token-api-value', label: 'Token & API Value' },
        { id: 'activity', label: 'Activity' },
        { id: 'projects', label: 'Projects' },
        { id: 'sessions', label: 'Sessions' }
      ];

      const tabsContainer = document.getElementById('tabsContainer');
      tabsContainer.innerHTML = tabs.map(tab =>
        \`<button class="tab \${tab.id === currentTab ? 'active' : ''}" data-tab="\${tab.id}">\${tab.label}</button>\`
      ).join('');

      tabsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab')) {
          showTab(e.target.dataset.tab);
        }
      });
    }

    function showTab(tabId) {
      currentTab = tabId;

      // Update active tab button
      document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
      });

      // Render content
      const content = document.getElementById('tabsContent');
      content.innerHTML = '';

      switch (tabId) {
        case 'token-api-value':
          renderTokenApiValueTab(content);
          break;
        case 'activity':
          renderActivityTab(content);
          break;
        case 'projects':
          renderProjectsTab(content);
          break;
        case 'sessions':
          renderSessionsTab(content);
          break;
      }
    }

    function renderTokenApiValueTab(container) {
      const html = \`
        <h2>Cumulative API Value</h2>
        <div class="chart-container">
          <canvas id="cumulativeChart"><\/canvas>
        </div>

        <div class="grid-2">
          <div>
            <h2>Model Distribution (API Value)</h2>
            <div class="chart-container">
              <canvas id="modelDistributionChart"><\/canvas>
            </div>
          </div>
          <div>
            <h2>API Value by Token Type</h2>
            <div class="chart-container">
              <canvas id="tokenTypeChart"><\/canvas>
            </div>
          </div>
        </div>

        <h2>Model Detail</h2>
        <div class="table-container">
          <table id="modelTable">
            <thead>
              <tr>
                <th>Model</th>
                <th>API Value (\$)</th>
                <th>Output Tokens</th>
                <th>Input Tokens</th>
                <th>Cache Read</th>
                <th>API Calls</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      \`;
      container.innerHTML = html;

      // Render charts after content is added
      setTimeout(() => {
        renderTokenApiValueCharts();
      }, 0);
    }

    function renderTokenApiValueCharts() {
      const data = dashboardData;

      // Cumulative Chart
      new Chart(document.getElementById('cumulativeChart'), {
        type: 'line',
        data: {
          labels: data.cumulative_costs.map(d => d.date),
          datasets: [{
            label: 'Cumulative Cost',
            data: data.cumulative_costs.map(d => d.cost),
            borderColor: '#FF6B35',
            backgroundColor: 'rgba(255, 107, 53, 0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } }
        }
      });

      // Model Distribution
      new Chart(document.getElementById('modelDistributionChart'), {
        type: 'doughnut',
        data: {
          labels: data.model_summary.map(m => m.model),
          datasets: [{
            data: data.model_summary.map(m => m.cost),
            backgroundColor: data.model_summary.map((_, idx) =>
              \`hsl(\${idx * 360 / data.model_summary.length}, 70%, 50%)\`
            )
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } }
        }
      });

      // Token Type Chart
      const tokenData = data.cost_by_token_type;
      new Chart(document.getElementById('tokenTypeChart'), {
        type: 'bar',
        data: {
          labels: ['Input', 'Output', 'Cache Read', 'Cache Write'],
          datasets: [{
            label: 'Cost (\$)',
            data: [tokenData.input, tokenData.output, tokenData.cache_read, tokenData.cache_write],
            backgroundColor: ['#2196F3', '#FF6B35', '#4CAF50', '#9C27B0']
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } }
        }
      });

      // Model Table
      const tbody = document.querySelector('#modelTable tbody');
      tbody.innerHTML = data.model_summary.map(m => \`
        <tr>
          <td>\${m.model}</td>
          <td>\$\${m.cost.toFixed(2)}</td>
          <td>\${(m.output_tokens / 1000).toFixed(1)}K</td>
          <td>\${(m.input_tokens / 1000).toFixed(1)}K</td>
          <td>\${(m.cache_read_tokens / 1000).toFixed(1)}K</td>
          <td>\${m.calls}</td>
        </tr>
      \`).join('');
    }

    function renderActivityTab(container) {
      const html = \`
        <h2>Messages & Sessions per Day</h2>
        <div class="chart-container">
          <canvas id="dailyActivityChart"><\/canvas>
        </div>

        <h2>Hourly Distribution (Last 24hrs)</h2>
        <div class="chart-container">
          <canvas id="hourlyChart"><\/canvas>
        </div>
      \`;
      container.innerHTML = html;

      setTimeout(() => {
        // Daily Activity
        new Chart(document.getElementById('dailyActivityChart'), {
          type: 'bar',
          data: {
            labels: dashboardData.daily_messages.map(d => d.date),
            datasets: [
              {
                label: 'Messages',
                data: dashboardData.daily_messages.map(d => d.messages),
                backgroundColor: '#2196F3'
              },
              {
                label: 'Sessions',
                data: dashboardData.daily_messages.map(d => d.sessions),
                backgroundColor: '#4CAF50'
              }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });

        // Hourly (Last 24 hours)
        const hourlyKeys = Object.keys(hourlyData || {}).sort();
        const hourlyLabels = hourlyKeys.map(k => k); // e.g., "2026-02-26T09"
        const hourlyValues = hourlyKeys.map(k => {
          const h = hourlyData[k];
          return h.count || 0;
        });

        new Chart(document.getElementById('hourlyChart'), {
          type: 'bar',
          data: {
            labels: hourlyLabels,
            datasets: [{
              label: 'API Calls',
              data: hourlyValues,
              backgroundColor: '#FF6B35'
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }, 0);
    }

    function renderProjectsTab(container) {
      const topProjects = dashboardData.projects
        .map(p => ({...p, billedTokens: p.input_tokens + p.output_tokens}))
        .sort((a, b) => b.billedTokens - a.billedTokens)
        .slice(0, 15);
      const html = \`
        <h2>Projects by Billed Tokens (Top 15)</h2>
        <div class="chart-container">
          <canvas id="projectsChart"><\/canvas>
        </div>

        <h2>All Projects</h2>
        <div class="table-container">
          <table id="projectsTable">
            <thead>
              <tr>
                <th>Project</th>
                <th>Sessions</th>
                <th>Messages</th>
                <th>API Value (\$)</th>
                <th>Output Tokens</th>
                <th>File Size (MB)</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      \`;
      container.innerHTML = html;

      setTimeout(() => {
        // Projects Chart
        new Chart(document.getElementById('projectsChart'), {
          type: 'bar',
          data: {
            labels: topProjects.map(p => p.name),
            datasets: [{
              label: 'Billed Tokens',
              data: topProjects.map(p => p.billedTokens / 1000000),
              backgroundColor: '#00BCD4'
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
          }
        });

        // Projects Table
        const tbody = document.querySelector('#projectsTable tbody');
        tbody.innerHTML = dashboardData.projects.map(p => \`
          <tr>
            <td>\${p.name}</td>
            <td>\${p.sessions}</td>
            <td>\${p.messages}</td>
            <td>\$\${p.cost.toFixed(2)}</td>
            <td>\${(p.output_tokens / 1000).toFixed(1)}K</td>
            <td>\${p.file_size_mb.toFixed(1)}</td>
          </tr>
        \`).join('');
      }, 0);
    }

    function renderSessionsTab(container) {
      const html = \`
        <h2>Sessions</h2>
        <div class="table-container">
          <table id="sessionsTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Duration (min)</th>
                <th>Cost (\$)</th>
                <th>Messages</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      \`;
      container.innerHTML = html;

      const tbody = document.querySelector('#sessionsTable tbody');
      tbody.innerHTML = dashboardData.sessions.slice(0, 100).map(s => \`
        <tr>
          <td>\${s.date}</td>
          <td>\${s.project}</td>
          <td>\${s.duration_min.toFixed(1)}</td>
          <td>\$\${s.cost.toFixed(2)}</td>
          <td>\${s.messages}</td>
          <td>\${s.primary_model}</td>
        </tr>
      \`).join('');
    }

  <\/script>
</body>
</html>`;
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    outputChannel: vscode.OutputChannel,
  ) {
    if (ChartsPanel.currentPanel) {
      ChartsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "aiUsageCost.charts",
      "AI Usage Cost - Charts",
      vscode.ViewColumn.One,
      {},
    );

    ChartsPanel.currentPanel = new ChartsPanel(
      panel,
      extensionUri,
      outputChannel,
    );
  }

  private dispose() {
    ChartsPanel.currentPanel = undefined;
    this.disposables.forEach(d => d.dispose());
    this.disposables.length = 0;
    this.panel.dispose();
  }
}
