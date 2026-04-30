import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getNonce } from "../utils/webviewHelpers";

export class ReportDashboardPanel {
  public static readonly viewType = "aiUsageCost.reportDashboard";
  private static currentPanel: ReportDashboardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _fileWatcher: vscode.FileSystemWatcher | undefined;
  private _refreshTimeout: NodeJS.Timeout | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => {
      ReportDashboardPanel.currentPanel = undefined;
      this._fileWatcher?.dispose();
      if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
    });

    // Watch for changes to data files and refresh report
    this.setupFileWatcher();

    this._panel.webview.html = this.getHtml();
  }

  static createOrShow(extensionUri: vscode.Uri): void {
    if (ReportDashboardPanel.currentPanel) {
      ReportDashboardPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReportDashboardPanel.viewType,
      "Claude AI Usage Report",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    ReportDashboardPanel.currentPanel = new ReportDashboardPanel(
      panel,
      extensionUri,
    );
  }

  private setupFileWatcher(): void {
    // Watch ai-stats-data.json for changes
    const pattern = new vscode.RelativePattern(
      this._extensionUri.fsPath,
      "ai-stats-data.json",
    );

    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Debounce refresh to avoid too many rapid updates
    const handleChange = () => {
      if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
      this._refreshTimeout = setTimeout(() => {
        this._panel.webview.html = this.getHtml();
      }, 300); // Wait 300ms after file change before refreshing
    };

    this._fileWatcher.onDidChange(handleChange);
    this._fileWatcher.onDidCreate(handleChange);
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

  private getHtml(): string {
    const nonce = getNonce();

    // Read Chart.js inline so the nonce covers it and CSP is satisfied
    const chartJsPath = path.join(
      this._extensionUri.fsPath,
      "media",
      "chart.min.js",
    );
    const chartJsContent = fs.existsSync(chartJsPath)
      ? fs.readFileSync(chartJsPath, "utf-8")
      : "";

    const aiStats = this.getAiStatsData();
    const dataJson = aiStats ? JSON.stringify(aiStats) : "null";
    const generatedAt = aiStats?.generated_at
      ? new Date(aiStats.generated_at).toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Unknown";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <title>Claude AI Usage Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #cccccc);
      line-height: 1.5;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }

    /* Stat cards */
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--vscode-editorWidget-background, #252526);
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      padding: 16px 20px;
      border-top: 3px solid var(--vscode-focusBorder, #007fd4);
    }
    .stat-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground, #7f7f7f);
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 26px;
      font-weight: 700;
      color: var(--vscode-charts-blue, #4fc3f7);
      margin-bottom: 4px;
    }
    .stat-sub { font-size: 11px; color: var(--vscode-descriptionForeground, #7f7f7f); }

    /* Tab bar */
    .tab-bar {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border, #454545));
      margin-bottom: 20px;
      background: var(--vscode-editorGroupHeader-tabsBackground, #2d2d2d);
      border-radius: 4px 4px 0 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab-bar::-webkit-scrollbar { display: none; }
    .tab-btn {
      padding: 10px 18px;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--vscode-tab-inactiveForeground, #9d9d9d);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .tab-btn:hover {
      color: var(--vscode-tab-activeForeground, #ffffff);
      background: var(--vscode-tab-hoverBackground, rgba(255,255,255,0.05));
    }
    .tab-btn.active {
      color: var(--vscode-tab-activeForeground, #ffffff);
      border-bottom: 2px solid var(--vscode-focusBorder, #007fd4);
      background: var(--vscode-tab-activeBackground, var(--vscode-editor-background, #1e1e1e));
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Section headings */
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--vscode-editor-foreground, #cccccc);
      border-left: 3px solid var(--vscode-focusBorder, #007fd4);
      padding-left: 10px;
      margin: 24px 0 12px;
    }

    /* Chart cards */
    .chart-card {
      background: var(--vscode-editorWidget-background, #252526);
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      padding: 16px;
      margin-bottom: 20px;
      position: relative;
      height: 360px;
    }
    .chart-card canvas { max-height: 320px; }

    /* Tables */
    .table-wrap {
      overflow: hidden;
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      margin-bottom: 20px;
    }
    table { width: 100%; background: var(--vscode-editorWidget-background, #252526); border-collapse: collapse; }
    thead th {
      background: var(--vscode-sideBarSectionHeader-background, #333333);
      padding: 10px 14px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-editor-foreground, #cccccc);
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      white-space: nowrap;
    }
    thead th.r { text-align: right; }
    tbody tr { border-bottom: 1px solid var(--vscode-list-inactiveSelectionBackground, #2a2d2e); }
    tbody tr:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
    tbody td { padding: 10px 14px; font-size: 13px; }
    tbody td.r { text-align: right; }
    tfoot td {
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 700;
      background: var(--vscode-sideBarSectionHeader-background, #333333);
      border-top: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      color: var(--vscode-editor-foreground, #cccccc);
    }
    tfoot td.r { text-align: right; }
    .no-data {
      background: var(--vscode-editorWidget-background, #252526);
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      padding: 40px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #7f7f7f);
      font-style: italic;
      margin-bottom: 20px;
    }

    /* Grid layouts */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
    @media (max-width: 900px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }

    /* Small stat tables */
    .stat-table-wrap {
      overflow: hidden;
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      margin-bottom: 20px;
    }
    .stat-table-wrap table tbody tr:last-child { border-bottom: none; }

    /* Limit controls */
    .controls-card {
      background: var(--vscode-editorWidget-background, #252526);
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      padding: 16px 20px;
      margin-bottom: 16px;
    }
    .controls-row { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; }
    .controls-row label { font-size: 13px; font-weight: 500; color: var(--vscode-editor-foreground, #cccccc); }
    .controls-row input[type="number"] {
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #454545));
      border-radius: 4px;
      padding: 4px 8px;
      width: 90px;
      font-size: 13px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
    }
    .over-limit { background: rgba(var(--vscode-charts-red-rgb, 220,38,38), 0.12) !important; }
    .over-limit td { color: var(--vscode-charts-red, #f48771) !important; }

    /* Code badge */
    code {
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background, #1e1e1e));
      border: 1px solid var(--vscode-widget-border, #454545);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-editor-foreground, #cccccc);
    }

    /* Highlight row */
    .highlight-row td { background: rgba(79,195,247,0.08); }
    .highlight-value { color: var(--vscode-charts-blue, #4fc3f7); }

    /* Cache efficiency colours */
    .cache-green { color: var(--vscode-charts-green, #89d185); }
    .cache-yellow { color: var(--vscode-charts-yellow, #cca700); }
    .cache-red { color: var(--vscode-charts-red, #f48771); }
  </style>
</head>
<body>
<div class="container">

  <div id="no-data" style="display:none" class="no-data">
    No data found — make sure <code>ai-stats-data.json</code> exists in the extension folder.
  </div>

  <div id="report-content">

    <!-- Summary cards — always visible -->
    <div id="summary" class="stat-grid"></div>

    <!-- Tab navigation -->
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="usage">Usage</button>
      <button class="tab-btn" data-tab="distribution">Distribution</button>
      <button class="tab-btn" data-tab="tools">Tools</button>
      <button class="tab-btn" data-tab="stats">Stats</button>
      <button class="tab-btn" data-tab="limit-reporting">Limit Reporting</button>
    </div>

    <!-- Tab: Usage -->
    <div id="tab-usage" class="tab-panel active">
      <h2 class="section-title">Last 7 Days</h2>
      <div class="chart-card"><canvas id="last7DaysChart"></canvas></div>

      <h2 class="section-title">Cumulative Billed Tokens &amp; Cost Over Time</h2>
      <div class="chart-card"><canvas id="cumulativeChart"></canvas></div>

      <h2 class="section-title">Monthly Usage</h2>
      <div class="chart-card"><canvas id="monthlyChart"></canvas></div>

      <h2 class="section-title">Messages Per Day</h2>
      <div class="chart-card"><canvas id="messagesChart"></canvas></div>

      <h2 class="section-title">Usage Per Project</h2>
      <div id="project-table"></div>
    </div>

    <!-- Tab: Distribution -->
    <div id="tab-distribution" class="tab-panel">
      <h2 class="section-title">Hourly Distribution (Last 24 Hours)</h2>
      <div class="chart-card"><canvas id="hourlyChart"></canvas></div>

      <h2 class="section-title">Peak Hours of Day (All-Time)</h2>
      <div class="chart-card"><canvas id="peakHoursChart"></canvas></div>

    </div>

    <!-- Tab: Tools -->
    <div id="tab-tools" class="tab-panel">
      <h2 class="section-title">Tool Call Frequency</h2>
      <div id="tool-table"></div>
    </div>

    <!-- Tab: Stats -->
    <div id="tab-stats" class="tab-panel">
      <div class="grid-2">
        <div>
          <h2 class="section-title">Cost Per Hour (Working Day)</h2>
          <div id="cost-per-hour"></div>
        </div>
        <div>
          <h2 class="section-title">Cost Per Day (Average)</h2>
          <div id="cost-per-day"></div>
        </div>
      </div>
      <h2 class="section-title">&#x1F4B0; Usage by Model</h2>
      <div class="grid-2">
        <div id="model-table"></div>
        <div class="chart-card"><canvas id="modelPieChart"></canvas></div>
      </div>

      <div class="grid-2">
        <div>
          <h2 class="section-title">Cache Efficiency</h2>
          <div id="cache-efficiency"></div>
        </div>
        <div>
          <h2 class="section-title">Token Cost Breakdown</h2>
          <div id="token-breakdown"></div>
        </div>
      </div>
    </div>

    <!-- Tab: Limit Reporting -->
    <div id="tab-limit-reporting" class="tab-panel">
      <div class="controls-card">
        <div class="controls-row">
          <label>Daily Limit ($): <input type="number" id="dailyLimitInput" min="0" step="0.01" value="10"></label>
          <label>Working Days per Week: <input type="number" id="workingDaysInput" min="1" max="7" value="5"></label>
        </div>
      </div>

      <h2 class="section-title">Daily Usage Table</h2>
      <div id="daily-table"></div>

      <h2 class="section-title">Weekly Usage Table</h2>
      <div id="weekly-table"></div>
    </div>

  </div>

</div>

<script nonce="${nonce}">${chartJsContent}</script>
<script nonce="${nonce}">
  // ── Embedded data ──────────────────────────────────────────────
  const DATA = ${dataJson};

  // ── Helpers ────────────────────────────────────────────────────
  function fmt$(v) { return '$' + (v || 0).toFixed(2); }
  function fmtN(v) { return (v || 0).toLocaleString(); }
  function fmtDate(s) {
    return new Date(s).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
  }
  function fmtMonth(s) {
    const [y, m] = s.split('-');
    return new Date(+y, +m - 1).toLocaleDateString(undefined, { month:'short', year:'2-digit' });
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
  const C = {
    blue:   cssVar('--vscode-charts-blue',   '#4fc3f7'),
    green:  cssVar('--vscode-charts-green',  '#89d185'),
    red:    cssVar('--vscode-charts-red',    '#f48771'),
    orange: cssVar('--vscode-charts-orange', '#d18616'),
    amber:  cssVar('--vscode-charts-yellow', '#cca700'),
    teal:   '#0d9488',
    violet: cssVar('--vscode-charts-purple', '#b180d7'),
    pink:   '#db2777',
    slate:  cssVar('--vscode-charts-foreground', '#cccccc'),
    sky:    '#0284c7',
  };
  const editorBg = cssVar('--vscode-editor-background', '#1e1e1e');
  const PIE_COLORS = [C.blue, C.green, C.red, C.amber, C.teal, C.violet, C.pink, C.slate, C.sky, C.orange];

  const CHART_OPTS_BASE = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
  };

  function dual(yLabel, y1Label) {
    return {
      scales: {
        y:  { type:'linear', position:'left',  beginAtZero:true, title:{ display:true, text: yLabel } },
        y1: { type:'linear', position:'right', beginAtZero:true, title:{ display:true, text: y1Label }, grid:{ drawOnChartArea:false } },
      }
    };
  }

  function wrapTable(thead, tbody, tfoot) {
    return '<div class="table-wrap"><table>' +
      '<thead><tr>' + thead + '</tr></thead>' +
      '<tbody>' + tbody + '</tbody>' +
      (tfoot ? '<tfoot><tr>' + tfoot + '</tr></tfoot>' : '') +
      '</table></div>';
  }

  // ── Main init ──────────────────────────────────────────────────
  function initDashboard(data) {
    renderSummary(data);
    renderLast7Days(data);
    renderCumulative(data);
    renderMonthly(data);
    renderProjectTable(data);
    renderModelTable(data);
    renderHourly(data);
    renderMessages(data);
    renderCostPerHour(data);
    renderCostPerDay(data);
    renderCacheEfficiency(data);
    renderTokenBreakdown(data);
    renderPeakHours(data);
    renderToolTable(data);
    renderDailyTable(data, parseFloat(document.getElementById('dailyLimitInput').value) || 0);
    renderWeeklyTable(data, parseInt(document.getElementById('workingDaysInput').value) || 5);

    document.getElementById('dailyLimitInput').addEventListener('input', function() {
      renderDailyTable(data, parseFloat(this.value) || 0);
    });
    document.getElementById('workingDaysInput').addEventListener('input', function() {
      renderWeeklyTable(data, parseInt(this.value) || 5);
    });
  }

  // ── Summary cards ──────────────────────────────────────────────
  function renderSummary(data) {
    const t = data.totals || {};
    const today = new Date().toISOString().split('T')[0];
    const todayD = (data.daily || {})[today] || {};

    // This week
    const now = new Date();
    const dow = now.getDay();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - dow);
    let weekCost = 0, weekCount = 0;
    Object.entries(data.daily || {}).forEach(([d, v]) => {
      const date = new Date(d);
      if (date >= weekStart && date <= now) {
        weekCost += (v.cost || 0);
        weekCount += (v.count || 0);
      }
    });

    const oldest = Object.keys(data.daily || {}).sort()[0] || today;

    const cards = [
      { label: 'Total Since ' + fmtDate(oldest), value: fmt$(t.cost), sub: fmtN(t.count) + ' requests' },
      { label: 'This Week (starting ' + weekStart.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) + ')', value: fmt$(weekCost), sub: fmtN(weekCount) + ' requests' },
      { label: 'Today (' + fmtDate(today) + ')', value: fmt$(todayD.cost), sub: fmtN(todayD.count) + ' requests' },
      { label: 'Billed Tokens (All-time)', value: fmtN(t.input + t.output), sub: fmtN(t.input) + ' input · ' + fmtN(t.output) + ' output' },
      { label: 'Cache Read Tokens', value: fmtN(Math.round((t.cacheRead || 0) / 1e6)) + 'M', sub: 'Saved ~90% cost' },
      { label: 'Cache Write Tokens', value: fmtN(Math.round((t.cacheWrite || 0) / 1e6)) + 'M', sub: '+25% write cost' },
    ];

    document.getElementById('summary').innerHTML = cards.map(c => \`
      <div class="stat-card">
        <div class="stat-label">\${c.label}</div>
        <div class="stat-value">\${c.value}</div>
        <div class="stat-sub">\${c.sub}</div>
      </div>\`).join('');
  }

  // ── Last 7 days ────────────────────────────────────────────────
  function renderLast7Days(data) {
    const daily = data.daily || {};
    const now = new Date();
    const labels = [], costs = [], counts = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      labels.push(fmtDate(key));
      costs.push(+(daily[key]?.cost || 0).toFixed(4));
      counts.push(daily[key]?.count || 0);
    }
    new Chart(document.getElementById('last7DaysChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Cost ($)', data: costs, backgroundColor: C.blue, yAxisID: 'y' },
          { label: 'Requests', data: counts, backgroundColor: C.teal, yAxisID: 'y1' },
        ]
      },
      options: { ...CHART_OPTS_BASE, ...dual('Cost ($)', 'Requests') }
    });
  }

  // ── Cumulative ─────────────────────────────────────────────────
  function renderCumulative(data) {
    const daily = data.daily || {};
    const dates = Object.keys(daily).sort();
    let cumTokens = 0, cumCost = 0;
    const labels = [], tokensData = [], costData = [];
    dates.forEach(d => {
      const v = daily[d];
      cumTokens += (v.input || 0) + (v.output || 0);
      cumCost   += (v.cost || 0);
      labels.push(fmtDate(d));
      tokensData.push(cumTokens);
      costData.push(+cumCost.toFixed(4));
    });
    new Chart(document.getElementById('cumulativeChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Cumulative Billed Tokens', data: tokensData, borderColor: C.blue, backgroundColor: 'rgba(37,99,235,0.08)', fill:true, tension:0.3, borderWidth:2, yAxisID:'y' },
          { label: 'Cumulative Cost ($)',       data: costData,   borderColor: C.red,  backgroundColor: 'transparent',           fill:false, tension:0.3, borderWidth:2, borderDash:[5,3], yAxisID:'y1' },
        ]
      },
      options: {
        ...CHART_OPTS_BASE,
        plugins: { legend: { display:true, position:'top' }, tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1' ? ctx.dataset.label + ': ' + fmt$(ctx.parsed.y) : ctx.dataset.label + ': ' + fmtN(ctx.parsed.y) } } },
        scales: {
          y:  { beginAtZero:true, position:'left',  title:{ display:true, text:'Tokens' } },
          y1: { beginAtZero:true, position:'right', title:{ display:true, text:'Cost ($)' }, grid:{ drawOnChartArea:false }, ticks:{ callback: v => '$' + v.toFixed(2) } },
        }
      }
    });
  }

  // ── Monthly ────────────────────────────────────────────────────
  function renderMonthly(data) {
    const monthly = data.monthly || {};
    const months = Object.keys(monthly).sort();
    if (!months.length) return;
    new Chart(document.getElementById('monthlyChart'), {
      type: 'bar',
      data: {
        labels: months.map(fmtMonth),
        datasets: [
          { label: 'Cost ($)',  data: months.map(m => +(monthly[m].cost || 0).toFixed(4)),  backgroundColor: C.green, yAxisID:'y' },
          { label: 'Requests', data: months.map(m => monthly[m].count || 0), backgroundColor: C.amber, yAxisID:'y1' },
        ]
      },
      options: { ...CHART_OPTS_BASE, ...dual('Cost ($)', 'Requests') }
    });
  }

  // ── Projects table ─────────────────────────────────────────────
  function renderProjectTable(data) {
    const el = document.getElementById('project-table');
    const projects = data.projects;
    if (!projects || typeof projects !== 'object') { el.innerHTML = '<div class="no-data">No project data</div>'; return; }

    const rows = Object.entries(projects)
      .map(([name, p]) => ({ name, ...(p.total || {cost:0, count:0, input:0, output:0}) }))
      .sort((a, b) => b.cost - a.cost);

    if (!rows.length) { el.innerHTML = '<div class="no-data">No project data</div>'; return; }

    const totCost  = rows.reduce((s, r) => s + r.cost, 0);
    const totCount = rows.reduce((s, r) => s + r.count, 0);
    const totTok   = rows.reduce((s, r) => s + (r.input||0) + (r.output||0), 0);

    const tbody = rows.map(r => \`<tr>
      <td><code>\${r.name}</code></td>
      <td class="r">\${fmt$(r.cost)}</td>
      <td class="r">\${fmtN(r.count)}</td>
      <td class="r">\${fmtN((r.input||0)+(r.output||0))}</td>
    </tr>\`).join('');

    el.innerHTML = wrapTable(
      '<th>Project</th><th class="r">Cost</th><th class="r">Requests</th><th class="r">Billed Tokens</th>',
      tbody,
      \`<td>TOTAL</td><td class="r">\${fmt$(totCost)}</td><td class="r">\${fmtN(totCount)}</td><td class="r">\${fmtN(totTok)}</td>\`
    );
  }

  // ── Model table + pie ─────────────────────────────────────────
  function renderModelTable(data) {
    const el = document.getElementById('model-table');
    const projects = data.projects;
    if (!projects) { el.innerHTML = '<div class="no-data">No model data</div>'; return; }

    const modelStats = {};
    Object.values(projects).forEach(p => {
      if (!p.models) return;
      Object.entries(p.models).forEach(([model, s]) => {
        if (!modelStats[model]) modelStats[model] = { cost:0, count:0, input:0, output:0 };
        modelStats[model].cost   += s.cost   || 0;
        modelStats[model].count  += s.count  || 0;
        modelStats[model].input  += s.input  || 0;
        modelStats[model].output += s.output || 0;
      });
    });

    const rows = Object.entries(modelStats).sort((a,b) => b[1].cost - a[1].cost);
    if (!rows.length) { el.innerHTML = '<div class="no-data">No model data</div>'; return; }

    const tbody = rows.map(([model, s]) => \`<tr>
      <td>\${model}</td>
      <td class="r">\${fmt$(s.cost)}</td>
      <td class="r">\${fmtN(s.count)}</td>
      <td class="r">\${fmtN(s.input+s.output)}</td>
    </tr>\`).join('');

    el.innerHTML = wrapTable(
      '<th>Model</th><th class="r">Cost</th><th class="r">Requests</th><th class="r">Billed Tokens</th>',
      tbody
    );

    // Pie chart
    const models = rows.map(r => r[0]);
    const costs  = rows.map(r => r[1].cost);
    new Chart(document.getElementById('modelPieChart'), {
      type: 'pie',
      data: {
        labels: models,
        datasets: [{ data: costs, backgroundColor: PIE_COLORS.slice(0, models.length), borderColor: editorBg, borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmt$(ctx.parsed) } }
        }
      }
    });
  }

  // ── Hourly (last 24h) ─────────────────────────────────────────
  function renderHourly(data) {
    const hourly = data.hourly || {};
    const now = new Date();
    const labels = [], costs = [], counts = [];
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now); h.setHours(h.getHours() - i, 0, 0, 0);
      const key = h.toISOString().slice(0, 13);
      const v = hourly[key] || {};
      labels.push(h.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }));
      costs.push(+(v.cost || 0).toFixed(4));
      counts.push(v.count || 0);
    }
    new Chart(document.getElementById('hourlyChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Cost ($)',  data: costs,  backgroundColor: C.blue, yAxisID:'y' },
          { label: 'Requests', data: counts, backgroundColor: C.red,  yAxisID:'y1' },
        ]
      },
      options: { ...CHART_OPTS_BASE, ...dual('Cost ($)', 'Requests') }
    });
  }

  // ── Messages per day ──────────────────────────────────────────
  function renderMessages(data) {
    const daily = data.daily || {};
    const dates = Object.keys(daily).sort();
    new Chart(document.getElementById('messagesChart'), {
      type: 'line',
      data: {
        labels: dates.map(fmtDate),
        datasets: [{
          label: 'Requests per Day',
          data: dates.map(d => daily[d].count || 0),
          borderColor: C.green,
          backgroundColor: 'rgba(22,163,74,0.08)',
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 3,
        }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } }
    });
  }

  // ── Cost per hour ─────────────────────────────────────────────
  function renderCostPerHour(data) {
    const el = document.getElementById('cost-per-hour');
    const dailyData = Object.entries(data.daily || {});
    const workingDays = dailyData.filter(([d]) => { const day = new Date(d).getDay(); return day >= 1 && day <= 5; });
    const avgDay = workingDays.length > 0 ? workingDays.reduce((s,[,v]) => s + v.cost, 0) / workingDays.length : 0;
    const avgHour = avgDay / 8;
    el.innerHTML = \`<div class="stat-table-wrap"><table>
      <tbody>
        <tr><td>Average Cost per Working Day</td><td class="r" style="font-weight:700">\${fmt$(avgDay)}</td></tr>
        <tr><td>Working Hours per Day</td><td class="r">8h</td></tr>
        <tr class="highlight-row"><td style="font-weight:700">Average Cost per Hour</td><td class="r highlight-value" style="font-weight:700">\${fmt$(avgHour)}</td></tr>
      </tbody>
    </table></div>\`;
  }

  // ── Cost per day ──────────────────────────────────────────────
  function renderCostPerDay(data) {
    const el = document.getElementById('cost-per-day');
    const costs = Object.values(data.daily || {}).map(v => v.cost || 0);
    if (!costs.length) { el.innerHTML = '<div class="no-data">No data</div>'; return; }
    const avg = costs.reduce((a,b) => a+b, 0) / costs.length;
    const min = Math.min(...costs);
    const max = Math.max(...costs);
    el.innerHTML = \`<div class="stat-table-wrap"><table>
      <tbody>
        <tr class="highlight-row"><td style="font-weight:700">Average Daily Cost</td><td class="r highlight-value" style="font-weight:700">\${fmt$(avg)}</td></tr>
        <tr><td>Minimum Daily Cost</td><td class="r">\${fmt$(min)}</td></tr>
        <tr><td>Maximum Daily Cost</td><td class="r">\${fmt$(max)}</td></tr>
        <tr><td>Daily Cost Range</td><td class="r">\${fmt$(max - min)}</td></tr>
      </tbody>
    </table></div>\`;
  }

  // ── Cache efficiency ──────────────────────────────────────────
  function renderCacheEfficiency(data) {
    const el = document.getElementById('cache-efficiency');
    const t = data.totals || {};
    const totalInputLike = (t.input || 0) + (t.cacheRead || 0);
    const hitRate = totalInputLike > 0 ? (t.cacheRead / totalInputLike * 100) : 0;
    const cls = hitRate > 70 ? 'cache-green' : hitRate > 40 ? 'cache-yellow' : 'cache-red';
    el.innerHTML = \`<div class="stat-table-wrap"><table>
      <tbody>
        <tr><td>Cache Hit Rate</td><td class="r \${cls}" style="font-weight:700">\${hitRate.toFixed(1)}%</td></tr>
        <tr><td>Fresh Input Tokens</td><td class="r">\${fmtN(t.input)}</td></tr>
        <tr><td>Cache Read Tokens</td><td class="r">\${fmtN(t.cacheRead)}</td></tr>
        <tr><td>Cache Write Tokens</td><td class="r">\${fmtN(t.cacheWrite)}</td></tr>
      </tbody>
    </table></div>\`;
  }

  // ── Token cost breakdown ──────────────────────────────────────
  function renderTokenBreakdown(data) {
    const el = document.getElementById('token-breakdown');
    // Try dashboard.cost_by_token_type first, fallback to totals
    const breakdown = data.dashboard?.cost_by_token_type;
    if (breakdown) {
      const rows = [
        ['Input tokens cost', breakdown.input ],
        ['Output tokens cost', breakdown.output ],
        ['Cache read cost', breakdown.cache_read ],
        ['Cache write cost', breakdown.cache_write ],
      ].filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);
      el.innerHTML = \`<div class="stat-table-wrap"><table>
        <tbody>
          \${rows.map(([l,v]) => \`<tr><td>\${l}</td><td class="r">\${fmt$(v)}</td></tr>\`).join('')}
        </tbody>
      </table></div>\`;
    } else {
      el.innerHTML = '<div class="no-data">No breakdown data</div>';
    }
  }

  // ── Peak hours chart ──────────────────────────────────────────
  function renderPeakHours(data) {
    // Aggregate hourly_distribution entries by hour 0-23
    const hourOfDay = {};
    for (let h = 0; h < 24; h++) hourOfDay[h] = 0;

    const dist = data.dashboard?.hourly_distribution || [];
    dist.forEach(entry => {
      const h = entry.hour;
      if (h >= 0 && h < 24) hourOfDay[h] += (entry.messages || 0);
    });

    const labels = [];
    for (let h = 0; h < 24; h++) {
      if (h === 0) labels.push('12am');
      else if (h === 12) labels.push('12pm');
      else labels.push((h % 12) + (h < 12 ? 'am' : 'pm'));
    }

    new Chart(document.getElementById('peakHoursChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Requests', data: Object.values(hourOfDay), backgroundColor: C.blue }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Requests' } } }
      }
    });
  }

  // ── Tool table ────────────────────────────────────────────────
  function renderToolTable(data) {
    const el = document.getElementById('tool-table');
    const tools = data.tool_summary || data.dashboard?.tool_summary || [];
    if (!tools.length) {
      el.innerHTML = '<div class="no-data">No tool usage data available</div>';
      return;
    }
    const sorted = [...tools].sort((a, b) => b.usageCount - a.usageCount);
    const tbody = sorted.map(t => \`<tr>
      <td style="font-weight:500">\${t.name}</td>
      <td class="r">\${fmtN(t.usageCount)}</td>
      <td class="r" style="color:#9ca3af;font-size:12px">\${t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : '—'}</td>
    </tr>\`).join('');
    el.innerHTML = wrapTable(
      '<th>Tool</th><th class="r">Uses</th><th class="r">Last Used</th>',
      tbody
    );
  }

  // ── Daily table ───────────────────────────────────────────────
  function renderDailyTable(data, limit) {
    const el = document.getElementById('daily-table');
    const daily = data.daily || {};
    const days = Object.keys(daily).sort().reverse();
    if (!days.length) { el.innerHTML = '<div class="no-data">No daily data</div>'; return; }

    const tbody = days.map(d => {
      const v = daily[d];
      const over = limit > 0 && (v.cost || 0) > limit;
      return \`<tr class="\${over ? 'over-limit' : ''}">
        <td>\${fmtDate(d)}</td>
        <td class="r">\${fmt$(v.cost)}</td>
        <td class="r">\${fmtN(v.count)}</td>
        <td class="r">\${fmtN((v.input||0)+(v.output||0))}</td>
      </tr>\`;
    }).join('');

    el.innerHTML = wrapTable(
      '<th>Date</th><th class="r">Cost</th><th class="r">Requests</th><th class="r">Billed Tokens</th>',
      tbody
    );
  }

  // ── Weekly table ──────────────────────────────────────────────
  function renderWeeklyTable(data, workingDays) {
    const el = document.getElementById('weekly-table');
    const weekly = data.weekly || {};
    const weeks = Object.keys(weekly).sort().reverse();
    if (!weeks.length) { el.innerHTML = '<div class="no-data">No weekly data</div>'; return; }

    const limit = parseFloat(document.getElementById('dailyLimitInput').value) || 0;

    const tbody = weeks.map(w => {
      const v = weekly[w];
      const avgPerDay = workingDays > 0 ? (v.cost || 0) / workingDays : (v.cost || 0);
      const over = limit > 0 && avgPerDay > limit;
      return \`<tr class="\${over ? 'over-limit' : ''}">
        <td>\${w}</td>
        <td class="r">\${fmt$(v.cost)}</td>
        <td class="r">\${fmtN(v.count)}</td>
        <td class="r">\${fmtN((v.input||0)+(v.output||0))}</td>
        <td class="r">\${fmt$(avgPerDay)}</td>
      </tr>\`;
    }).join('');

    el.innerHTML = wrapTable(
      '<th>Week</th><th class="r">Cost</th><th class="r">Requests</th><th class="r">Billed Tokens</th><th class="r">Avg/Working Day</th>',
      tbody
    );
  }

  // ── Tab switching ─────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'none'; p.classList.remove('active'); });
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + btn.dataset.tab);
      if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
    });
  });

  // ── Boot ─────────────────────────────────────────────────────
  if (!DATA) {
    document.getElementById('no-data').style.display = '';
    document.getElementById('report-content').style.display = 'none';
  } else {
    // Temporarily show all panels so Chart.js can measure canvas dimensions
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'block'; });
    initDashboard(DATA);
    // Restore: hide all except active
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'none'; p.classList.remove('active'); });
    const activePanel = document.querySelector('.tab-btn.active');
    if (activePanel) {
      const panel = document.getElementById('tab-' + activePanel.dataset.tab);
      if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
    }
  }
</script>
</body>
</html>`;
  }
}
