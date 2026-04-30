import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getNonce } from "../utils/webviewHelpers";
import { FacetsService, ImpactData } from "../services/facetsService";

export class ImpactDashboardPanel {
  public static readonly viewType = "aiUsageCost.impactDashboard";
  private static currentPanel: ImpactDashboardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => {
      ImpactDashboardPanel.currentPanel = undefined;
    });

    this._panel.webview.html = this.getHtml();
  }

  static createOrShow(extensionUri: vscode.Uri): void {
    if (ImpactDashboardPanel.currentPanel) {
      ImpactDashboardPanel.currentPanel._panel.webview.html =
        ImpactDashboardPanel.currentPanel.getHtml();
      ImpactDashboardPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ImpactDashboardPanel.viewType,
      "Claude AI Impact Dashboard",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    ImpactDashboardPanel.currentPanel = new ImpactDashboardPanel(
      panel,
      extensionUri,
    );
  }

  private getHtml(): string {
    const nonce = getNonce();

    // Read Chart.js inline
    const chartJsPath = path.join(
      this._extensionUri.fsPath,
      "media",
      "chart.min.js",
    );
    const chartJsContent = fs.existsSync(chartJsPath)
      ? fs.readFileSync(chartJsPath, "utf-8")
      : "";

    const impact = FacetsService.load();
    const dataJson = JSON.stringify(impact);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <title>Claude AI Impact Dashboard</title>
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
    .container { max-width: 1200px; margin: 0 auto; }

    /* Header */
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 20px;
      color: var(--vscode-editor-foreground, #cccccc);
    }

    /* Stat cards — green theme */
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 600px) { .stat-grid { grid-template-columns: 1fr; } }

    .stat-card {
      background: var(--vscode-editorWidget-background, #252526);
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, #454545));
      padding: 16px 20px;
      border-top: 3px solid #4caf50;
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
      color: #4caf50;
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
      border-bottom: 2px solid #4caf50;
      background: var(--vscode-tab-activeBackground, var(--vscode-editor-background, #1e1e1e));
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Section headings */
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--vscode-editor-foreground, #cccccc);
      border-left: 3px solid #4caf50;
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

    .disclaimer {
      background: rgba(255, 193, 7, 0.1);
      border: 1px solid rgba(255, 193, 7, 0.3);
      border-radius: 4px;
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 12px;
      color: var(--vscode-editor-foreground, #cccccc);
    }
    .disclaimer strong { color: #ffb300; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }

    code {
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background, #1e1e1e));
      border: 1px solid var(--vscode-widget-border, #454545);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-editor-foreground, #cccccc);
    }
  </style>
</head>
<body>
<div class="container">

  <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 20px;">
    <h1 style="margin-bottom: 0;">Claude Code Impact Analysis</h1>
    <span id="overview-period" style="font-size: 13px; color: var(--vscode-descriptionForeground, #888); font-style: italic;">—</span>
  </div>

  <details style="margin-bottom: 20px; background: rgba(79,195,247,0.06); border: 1px solid rgba(79,195,247,0.3); border-radius: 6px;">
    <summary style="cursor: pointer; padding: 10px 16px; font-size: 13px; font-weight: 600; color: var(--vscode-charts-blue, #4fc3f7); user-select: none;">ℹ️ How calculations work &amp; reliability disclaimer</summary>
    <div style="padding: 12px 16px 16px; font-size: 12px; line-height: 1.6; color: var(--vscode-editor-foreground);">
      <div style="background: rgba(255,193,7,0.08); border: 1px solid rgba(255,193,7,0.4); border-radius: 4px; padding: 12px; margin-bottom: 12px;">
        <p style="font-weight: 600; color: #cca700; margin-bottom: 4px;">⚠️ What is estimated vs. what is measured</p>
        <p style="margin-bottom: 6px;">The <strong>time saved, dev value saved, and ROI</strong> figures are <strong>rough heuristic estimates — not measurements</strong>. There is no recording of actual time spent, no comparison against a baseline without Claude, and no empirical study backing the numbers. Treat them as indicative only.</p>
        <p><strong>What IS reliable:</strong> token counts, API costs, session counts, success rates, helpfulness scores, and outcome distributions — these are read directly from your local data files.</p>
      </div>
      <p style="margin-bottom: 6px;"><strong>Time saved (per session) — estimated:</strong> Each session's <code>primary_success</code> type is mapped to a hardcoded baseline (e.g. <em>multi_file_changes</em> → 45 min, <em>single_file_fix</em> → 15 min). These values are arbitrary. They are multiplied by a complexity factor <code>min(3, 1 + goalCount × 0.15)</code>. Only <em>fully_achieved</em> / <em>mostly_achieved</em> sessions count.</p>
      <p style="margin-bottom: 6px;"><strong>Dev value saved — estimated:</strong> Estimated minutes saved ÷ 60 × hourly rate (configured in extension settings).</p>
      <p style="margin-bottom: 6px;"><strong>% Time saved — estimated:</strong> Estimated hours saved ÷ (contracted hrs/wk × weeks of data) × 100. The denominator is derived from the facets date range and is reliable; the numerator is the estimate above.</p>
      <p style="margin-bottom: 6px;"><strong>Token cost — measured:</strong> Read directly from JSONL session transcripts under <code>~/.claude/projects/</code> and matched to each facets session by ID. Pricing: Sonnet $3 in / $15 out · Opus $5 in / $25 out · Haiku $1 in / $5 out (per 1M tokens).</p>
      <p><strong>ROI — partially estimated:</strong> Dev value saved ÷ total token cost. The cost side is accurate; the value side is the heuristic estimate above. Read as an optimistic upper bound, not a precise measurement.</p>
    </div>
  </details>

  <div id="no-facets-data" style="display:none">
    <div style="background: var(--vscode-editorWidget-background, #252526); border-radius: 6px; border: 1px solid var(--vscode-widget-border, #454545); padding: 32px 40px; margin-bottom: 20px;">
      <h2 style="font-size: 18px; margin-bottom: 16px; color: var(--vscode-editor-foreground);">No Impact Analysis Data Found</h2>
      <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground);">
        Impact analysis data is generated by running the <code>/insights</code> slash command during a Claude Code session.
        Each session you analyse will be saved as a JSON file in <code>~/.claude/usage-data/facets/</code>.
      </p>

      <div style="background: rgba(76, 175, 80, 0.08); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 4px; padding: 20px; margin-bottom: 20px;">
        <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 12px; color: #4caf50;">How to generate insights data</h3>
        <ol style="padding-left: 20px; line-height: 2; font-size: 13px; color: var(--vscode-editor-foreground);">
          <li>Complete a coding task using Claude Code in your terminal</li>
          <li>At the end of the session, type <code>/insights</code> and press Enter</li>
          <li>Claude will analyse the session and save a JSON file to <code>~/.claude/usage-data/facets/</code></li>
          <li>Come back here — the dashboard will populate automatically</li>
        </ol>
      </div>

      <div style="background: rgba(255, 193, 7, 0.08); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 4px; padding: 16px; margin-bottom: 20px; font-size: 12px;">
        <strong style="color: #ffb300;">Tip:</strong> You can run <code>/insights</code> after any Claude Code session to build up your impact data over time.
        The more sessions you analyse, the more accurate your ROI and time-saved estimates will be.
      </div>

      <div style="font-size: 12px; color: var(--vscode-descriptionForeground); padding-top: 8px; border-top: 1px solid var(--vscode-editorGroup-border, #454545);">
        <strong>Data location:</strong> <code>~/.claude/usage-data/facets/</code><br>
        <strong>Config:</strong> Enable <em>Show Insights Analysis</em> in extension settings (<code>aiUsageCost.showInsightsAnalysis</code>)
      </div>
    </div>
  </div>

  <div id="report-content" style="display:none">

    <!-- Tab navigation -->
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="impact">Impact</button>
      <button class="tab-btn" data-tab="outcomes">Outcomes</button>
      <button class="tab-btn" data-tab="details">Details</button>
    </div>

    <!-- Tab: Overview -->
    <div id="tab-overview" class="tab-panel active">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Success Rate</div>
          <div class="stat-value" id="overview-success">0%</div>
          <div class="stat-sub">across <span id="overview-sessions">0</span> sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Time Saved (est.)</div>
          <div class="stat-value" id="overview-time">—</div>
          <div class="stat-sub" id="overview-time-sub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">% Time Saved</div>
          <div class="stat-value" id="overview-pct">0%</div>
          <div class="stat-sub">of contracted hours</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ROI</div>
          <div class="stat-value" id="overview-roi">—</div>
          <div class="stat-sub">dev value / token cost</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Dev Value Saved (est.)</div>
          <div class="stat-value" id="overview-devvalue">—</div>
          <div class="stat-sub">based on hourly rate</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Token Cost</div>
          <div class="stat-value" style="font-size: 20px;" id="overview-tokencost">—</div>
          <div class="stat-sub">actual API spend</div>
        </div>
      </div>

      <h2 class="section-title">Outcome Distribution</h2>
      <div class="chart-card"><canvas id="sessionTypeChart"></canvas></div>
    </div>

    <!-- Tab: Impact -->
    <div id="tab-impact" class="tab-panel">
      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 20px;">
        <div class="stat-card">
          <div class="stat-label">Dev Value Saved</div>
          <div class="stat-value" id="impact-devvalue">£0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Token Cost</div>
          <div class="stat-value" style="font-size: 20px;" id="impact-cost">$0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Net ROI</div>
          <div class="stat-value" id="impact-roi">—</div>
        </div>
      </div>

      <h2 class="section-title">Top Session Types by Time Saved</h2>
      <div class="chart-card"><canvas id="topSessionTypesChart"></canvas></div>

      <h2 class="section-title">Time Saved Breakdown</h2>
      <div class="table-wrap" id="timeBreakdownTable"></div>
    </div>

    <!-- Tab: Outcomes -->
    <div id="tab-outcomes" class="tab-panel">
      <h2 class="section-title">Outcome Distribution</h2>
      <div id="outcomeTable"></div>

      <h2 class="section-title">Goal Categories Summary</h2>
      <div class="grid-2" style="margin-bottom: 20px;">
        <div class="chart-card"><canvas id="goalCategoryChart"></canvas></div>
        <div id="goalCategoryTable"></div>
      </div>

    </div>

    <!-- Tab: Details -->
    <div id="tab-details" class="tab-panel">
      <h2 class="section-title">Session Details</h2>
      <div class="table-wrap" id="sessionsTable"></div>
    </div>

  </div>

</div>

<script nonce="${nonce}">
${chartJsContent}
</script>

<script nonce="${nonce}">
const IMPACT_DATA = ${dataJson};

function formatTime(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs > 0) return hrs + 'h ' + mins + 'm';
  return mins + 'm';
}

function initDashboard() {
  if (!IMPACT_DATA.hasData) {
    document.getElementById('no-facets-data').style.display = 'block';
    document.getElementById('report-content').style.display = 'none';
    return;
  }

  document.getElementById('report-content').style.display = 'block';
  document.getElementById('no-facets-data').style.display = 'none';

  // Temporarily show all tab panels so Chart.js can measure canvas dimensions
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'block'; });

  // Overview tab
  document.getElementById('overview-sessions').textContent = IMPACT_DATA.sessionCount;
  document.getElementById('overview-success').textContent = IMPACT_DATA.successRate.toFixed(1) + '%';  // sub-line set separately via overview-sessions
  document.getElementById('overview-time').textContent = formatTime(IMPACT_DATA.timeSavedMinutes);
  document.getElementById('overview-time-sub').textContent = IMPACT_DATA.timeSavedMinutes.toLocaleString() + ' minutes';
  document.getElementById('overview-pct').textContent = IMPACT_DATA.percentTimeSaved.toFixed(1) + '%';
  document.getElementById('overview-roi').textContent = IMPACT_DATA.roi != null ? IMPACT_DATA.roi.toFixed(1) + '×' : 'N/A';  document.getElementById('overview-devvalue').textContent = '\u00a3' + IMPACT_DATA.devValueSaved.toFixed(2);
  document.getElementById('overview-tokencost').textContent = '$' + IMPACT_DATA.totalTokenCost.toFixed(4);
  const periodStr = IMPACT_DATA.dateFrom && IMPACT_DATA.dateTo
    ? new Date(IMPACT_DATA.dateFrom).toLocaleDateString() + ' → ' + new Date(IMPACT_DATA.dateTo).toLocaleDateString()
    : '—';
  document.getElementById('overview-period').textContent = periodStr;

  // Impact tab
  document.getElementById('impact-devvalue').textContent = '£' + IMPACT_DATA.devValueSaved.toFixed(2);
  document.getElementById('impact-cost').textContent = '$' + IMPACT_DATA.totalTokenCost.toFixed(4);
  document.getElementById('impact-roi').textContent = IMPACT_DATA.roi != null ? IMPACT_DATA.roi.toFixed(1) + '×' : 'N/A';

  // Build charts (all panels are visible so dimensions are correct)
  buildSessionTypeChart();
  buildTopSessionTypesChart();
  buildGoalCategoryChart();
  buildGoalCategoryTable();
  buildTimeBreakdownTable();
  buildOutcomeTable();
  buildSessionsTable();

  // Restore: hide all panels except the active one
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'none'; p.classList.remove('active'); });
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn) {
    const panel = document.getElementById('tab-' + activeBtn.dataset.tab);
    if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
  }
}

function buildSessionTypeChart() {
  const ctx = document.getElementById('sessionTypeChart');
  if (!ctx) return;
  const data = Object.entries(IMPACT_DATA.sessionTypeDistribution).sort((a,b) => b[1] - a[1]).slice(0, 8);
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{
        label: 'Count',
        data: data.map(d => d[1]),
        backgroundColor: '#4caf50'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } }
    }
  });
}

function buildTopSessionTypesChart() {
  const ctx = document.getElementById('topSessionTypesChart');
  if (!ctx) return;
  // Rough estimate: use baselines to compute time per session type
  const baselineMap = {
    'multi_file_changes': 45, 'architecture_decision': 60, 'debugging_fix': 30,
    'single_file_fix': 15, 'code_review': 20, 'refactoring': 40,
    'documentation': 10, 'test_writing': 25, 'feature_implementation': 60,
    'explanation': 10
  };
  const timeByType = {};
  for (const [type, count] of Object.entries(IMPACT_DATA.sessionTypeDistribution)) {
    const base = baselineMap[type] || 20;
    timeByType[type] = base * count; // rough, doesn't account for complexity
  }
  const data = Object.entries(timeByType).sort((a,b) => b[1] - a[1]).slice(0, 8);
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{
        label: 'Minutes',
        data: data.map(d => d[1]),
        backgroundColor: '#4caf50'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } }
    }
  });
}

function groupGoalCategories(goalMap) {
  const groups = {
    'Fixing & Debugging': { keywords: ['fix', 'debug', 'bug', 'error', 'issue', 'patch', 'trouble'], goals: [] },
    'Implementation':     { keywords: ['implement', 'feature', 'build', 'create', 'new', 'add'], goals: [] },
    'Refactoring & Optimisation': { keywords: ['refactor', 'optimize', 'optimise', 'clean', 'improve', 'restructure', 'performance'], goals: [] },
    'Review & Analysis':  { keywords: ['review', 'analyze', 'analyse', 'audit', 'examine', 'check', 'test'], goals: [] },
    'Documentation':      { keywords: ['document', 'comment', 'readme', 'guide', 'tutorial'], goals: [] },
    'Other':              { keywords: [], goals: [] }
  };
  for (const [goal, count] of Object.entries(goalMap)) {
    const lower = goal.toLowerCase();
    let placed = false;
    for (const [name, g] of Object.entries(groups)) {
      if (name === 'Other') continue;
      if (g.keywords.some(kw => lower.includes(kw))) {
        g.goals.push({ goal, count });
        placed = true;
        break;
      }
    }
    if (!placed) groups['Other'].goals.push({ goal, count });
  }
  const result = {};
  for (const [name, g] of Object.entries(groups)) {
    if (g.goals.length > 0) {
      g.goals.sort((a, b) => b.count - a.count);
      result[name] = g.goals;
    }
  }
  return result;
}

function buildGoalCategoryTable() {
  const el = document.getElementById('goalCategoryTable');
  if (!el) return;
  const raw = IMPACT_DATA.goalCategoryDistribution;
  const entries = Object.entries(raw);
  if (!entries.length) { el.innerHTML = ''; return; }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const grouped = groupGoalCategories(raw);

  let html = '<div style="font-size:12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px;">' +
    '<strong>' + total + '</strong> total goals across <strong>' + IMPACT_DATA.sessionCount + '</strong> sessions. Click a group to expand.' +
    '</div>';

  for (const [groupName, goals] of Object.entries(grouped)) {
    const groupTotal = goals.reduce((s, g) => s + g.count, 0);
    const groupPct = ((groupTotal / total) * 100).toFixed(1);
    html += '<details style="margin-bottom: 6px; border: 1px solid var(--vscode-widget-border, #454545); border-radius: 4px; overflow: hidden;">' +
      '<summary style="cursor: pointer; padding: 8px 12px; font-size: 12px; font-weight: 600; background: var(--vscode-sideBarSectionHeader-background, #333); display: flex; justify-content: space-between; user-select: none;">' +
      '<span>' + groupName + '</span>' +
      '<span style="font-weight: 400; opacity: 0.7;">' + groupPct + '% &nbsp;(' + groupTotal + ')</span>' +
      '</summary>' +
      '<table style="width:100%; border-collapse: collapse; background: var(--vscode-editorWidget-background, #252526);">' +
      '<thead><tr style="border-bottom: 1px solid var(--vscode-widget-border, #454545);">' +
      '<th style="padding: 6px 12px; text-align: left; font-size: 11px; opacity: 0.7;">Goal</th>' +
      '<th style="padding: 6px 12px; text-align: right; font-size: 11px; opacity: 0.7;">Count</th>' +
      '<th style="padding: 6px 12px; text-align: right; font-size: 11px; opacity: 0.7;">%</th>' +
      '</tr></thead><tbody>';
    for (const { goal, count } of goals) {
      const pct = ((count / total) * 100).toFixed(1);
      html += '<tr style="border-bottom: 1px solid var(--vscode-list-inactiveSelectionBackground, #2a2d2e);">' +
        '<td style="padding: 5px 12px; font-size: 12px;">' + goal.replace(/_/g, ' ') + '</td>' +
        '<td style="padding: 5px 12px; font-size: 12px; text-align: right;">' + count + '</td>' +
        '<td style="padding: 5px 12px; font-size: 12px; text-align: right; opacity: 0.7;">' + pct + '%</td>' +
        '</tr>';
    }
    html += '</tbody></table></details>';
  }
  el.innerHTML = html;
}

function buildGoalCategoryChart() {
  const ctx = document.getElementById('goalCategoryChart');
  if (!ctx) return;
  const grouped = groupGoalCategories(IMPACT_DATA.goalCategoryDistribution);
  const labels = Object.keys(grouped);
  const values = labels.map(g => grouped[g].reduce((s, e) => s + e.count, 0));
  const colors = ['#4fc3f7', '#89d185', '#f48771', '#cca700', '#0d9488', '#b180d7'];
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 2 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } }
    }
  });
}

function buildTimeBreakdownTable() {
  const table = document.getElementById('timeBreakdownTable');
  if (!table) return;
  const baselineMap = {
    'multi_file_changes': 45, 'architecture_decision': 60, 'debugging_fix': 30,
    'single_file_fix': 15, 'code_review': 20, 'refactoring': 40,
    'documentation': 10, 'test_writing': 25, 'feature_implementation': 60,
    'explanation': 10
  };
  const rows = [];
  for (const [type, count] of Object.entries(IMPACT_DATA.sessionTypeDistribution).sort((a,b) => b[1] - a[1])) {
    const base = baselineMap[type] || 20;
    const total = base * count;
    rows.push([type, count, formatTime(total), total]);
  }
  let html = '<table><thead><tr><th>Session Type</th><th class="r">Count</th><th class="r">Est. Time</th><th class="r">Minutes</th></tr></thead><tbody>';
  for (const [type, count, time, mins] of rows) {
    html += '<tr><td>' + type + '</td><td class="r">' + count + '</td><td class="r">' + time + '</td><td class="r" style="font-size:11px; opacity:0.6;">' + mins + '</td></tr>';
  }
  html += '</tbody></table>';
  table.innerHTML = html;
}

function buildOutcomeTable() {
  const table = document.getElementById('outcomeTable');
  if (!table) return;
  const data = Object.entries(IMPACT_DATA.outcomeDistribution).sort((a,b) => b[1] - a[1]);
  let html = '<div class="table-wrap"><table><thead><tr><th>Outcome</th><th class="r">Count</th><th class="r">%</th></tr></thead><tbody>';
  const total = IMPACT_DATA.sessionCount;
  for (const [outcome, count] of data) {
    const pct = ((count / total) * 100).toFixed(1);
    html += '<tr><td>' + outcome + '</td><td class="r">' + count + '</td><td class="r">' + pct + '%</td></tr>';
  }
  html += '</tbody></table></div>';
  table.innerHTML = html;
}

function buildSessionsTable() {
  const el = document.getElementById('sessionsTable');
  if (!el) return;
  const hourlyRate = IMPACT_DATA.timeSavedMinutes > 0
    ? (IMPACT_DATA.devValueSaved / (IMPACT_DATA.timeSavedMinutes / 60))
    : 50;
  const baselineMap = {
    'multi_file_changes': 45, 'architecture_decision': 60, 'debugging_fix': 30,
    'single_file_fix': 15, 'code_review': 20, 'refactoring': 40,
    'debugging': 30, 'documentation': 20, 'test_writing': 35, 'testing': 35,
    'feature_implementation': 60, 'explanation': 10, 'none': 0
  };

  // Build row data
  const rows = IMPACT_DATA.sessions.map(s => {
    const date = s.created_at ? new Date(s.created_at).toLocaleDateString() : '';
    const dateTs = s.created_at ? new Date(s.created_at).getTime() : 0;
    const type = s.primary_success || '—';
    const outcome = s.session_outcome || '—';
    const numGoals = s.goal_categories?.length || 0;
    const base = baselineMap[s.primary_success] || 20;
    const isSuccess = outcome === 'fully_achieved' || outcome === 'mostly_achieved';
    const complexity = Math.min(3, 1 + numGoals * 0.15);
    const timeMins = isSuccess ? Math.round(base * complexity) : 0;
    const devValue = (timeMins / 60) * hourlyRate;
    const cost = s.token_cost || 0;
    const summary = (s.brief_summary || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const typeLabel = type.replace(/_/g, ' ');
    const typeCell = summary
      ? '<span title="' + summary + '" style="border-bottom: 1px dashed currentColor; cursor: help;">' + typeLabel + '</span>'
      : typeLabel;
    return { date, dateTs, typeCell, type, outcome, numGoals, timeMins, devValue, cost };
  });

  // Sort state
  if (!window._sessionSort) window._sessionSort = { col: 'dateTs', dir: -1 };

  function renderTable(sort) {
    const sorted = [...rows].sort((a, b) => {
      const va = a[sort.col]; const vb = b[sort.col];
      if (typeof va === 'string') return sort.dir * va.localeCompare(vb);
      return sort.dir * (va - vb);
    });

    const cols = [
      { key: 'dateTs',   label: 'Date',        align: '' },
      { key: 'type',     label: 'Session Type', align: '' },
      { key: 'outcome',  label: 'Outcome',      align: '' },
      { key: 'numGoals', label: '# Goals',      align: 'r' },
      { key: 'timeMins', label: 'Time Saved',   align: 'r' },
      { key: 'devValue', label: 'Value Saved',  align: 'r' },
      { key: 'cost',     label: 'Token Cost',   align: 'r' },
    ];

    const arrow = (key) => sort.col === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ' ↕';
    const thStyle = 'padding: 10px 14px; font-size: 12px; font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; background: var(--vscode-sideBarSectionHeader-background, #333); border-bottom: 1px solid var(--vscode-widget-border, #454545);';

    let html = '<table style="width:100%; border-collapse: collapse; background: var(--vscode-editorWidget-background, #252526);"><thead><tr>';
    for (const c of cols) {
      html += '<th data-col="' + c.key + '" style="' + thStyle + (c.align === 'r' ? ' text-align:right;' : '') + '">' + c.label + arrow(c.key) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (const r of sorted) {
      html += '<tr style="border-bottom: 1px solid var(--vscode-list-inactiveSelectionBackground, #2a2d2e);">' +
        '<td style="padding:8px 14px; font-size:12px;">' + r.date + '</td>' +
        '<td style="padding:8px 14px; font-size:12px;">' + r.typeCell + '</td>' +
        '<td style="padding:8px 14px; font-size:12px;">' + r.outcome.replace(/_/g, ' ') + '</td>' +
        '<td style="padding:8px 14px; font-size:12px; text-align:right;">' + r.numGoals + '</td>' +
        '<td style="padding:8px 14px; font-size:12px; text-align:right;">' + (r.timeMins > 0 ? formatTime(r.timeMins) : '—') + '</td>' +
        '<td style="padding:8px 14px; font-size:12px; text-align:right;">' + (r.devValue > 0 ? '£' + r.devValue.toFixed(2) : '—') + '</td>' +
        '<td style="padding:8px 14px; font-size:12px; text-align:right;">' + (r.cost > 0 ? '$' + r.cost.toFixed(4) : '—') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = '<div style="overflow:auto;">' + html + '</div>';

    // Attach sort listeners
    el.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('click', function() {
        const col = this.getAttribute('data-col');
        if (window._sessionSort.col === col) {
          window._sessionSort.dir *= -1;
        } else {
          window._sessionSort = { col, dir: col === 'dateTs' ? -1 : -1 };
        }
        renderTable(window._sessionSort);
      });
    });
  }

  renderTable(window._sessionSort);
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    this.classList.add('active');
    const tabId = 'tab-' + this.dataset.tab;
    const panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
  });
});

// Initialize on load
window.addEventListener('DOMContentLoaded', initDashboard);
</script>
</body>
</html>`;
  }
}
