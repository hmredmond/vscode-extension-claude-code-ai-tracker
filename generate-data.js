
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// Read custom pricing overrides passed from the VS Code extension via env var
let _customPricingOverrides = {};
try {
  if (process.env.AIUSAGECOST_PRICING_JSON) {
    _customPricingOverrides = JSON.parse(process.env.AIUSAGECOST_PRICING_JSON);
  }
} catch (e) {
  // ignore malformed env var
}

main().catch(err => {
  console.error('Error generating ai-stats-data.json:', err);
  process.exit(1);
});

function getModelPricing(model) {
  const DEFAULTS = {
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  };

  // Resolve base pricing (exact match, then partial, then sensible fallback)
  let base = DEFAULTS[model];
  if (!base) {
    const m = model.toLowerCase();
    if (m.includes('haiku')) base = DEFAULTS['claude-haiku-4-5-20251001'];
    else if (m.includes('sonnet')) base = DEFAULTS['claude-sonnet-4-5-20250929'];
    else if (m.includes('opus')) base = DEFAULTS['claude-opus-4-6'];
    else base = DEFAULTS['claude-sonnet-4-5-20250929']; // sensible mid-range fallback
  }

  // Apply any custom overrides from VS Code config (exact key match, then partial)
  if (model in _customPricingOverrides) {
    return { ...base, ..._customPricingOverrides[model] };
  }
  const lower = model.toLowerCase();
  for (const [key, override] of Object.entries(_customPricingOverrides)) {
    if (lower.includes(key.toLowerCase())) {
      return { ...base, ...override };
    }
  }

  return base;
}

function calculateCost(usage, model) {
  const pricing = getModelPricing(model);
  const inputCost = (usage.input_tokens || 0) / 1_000_000 * pricing.input;
  const outputCost = (usage.output_tokens || 0) / 1_000_000 * pricing.output;
  const cacheReadCost = (usage.cache_read_input_tokens || 0) / 1_000_000 * pricing.cacheRead;
  const cacheWriteCost = (usage.cache_creation_input_tokens || 0) / 1_000_000 * pricing.cacheWrite;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

async function extractUsageFromFile(filePath, projectName) {
  const records = [];
  if (!fs.existsSync(filePath)) {
    return records;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const seenMsgReq = new Set();

  for await (const line of rl) {
    try {
      const record = JSON.parse(line);
      // Only count assistant responses (filter out user messages)
      if (record.message && 
          record.message.usage && 
          record.timestamp && 
          record.message.model &&
          record.message.role === 'assistant') {
        // Deduplicate by message.id and requestId
        const msgId = record.message.id || '';
        const reqId = record.requestId || '';
        const dedupeKey = `${msgId}-${reqId}`;
        if (!seenMsgReq.has(dedupeKey)) {
          seenMsgReq.add(dedupeKey);
          const cost = calculateCost(record.message.usage, record.message.model);
          const inputTokens = record.message.usage.input_tokens || 0;
          const outputTokens = record.message.usage.output_tokens || 0;
          const billedTokens = inputTokens + outputTokens;
          const cacheReadTokens = record.message.usage.cache_read_input_tokens || 0;
          const cacheWriteTokens = record.message.usage.cache_creation_input_tokens || 0;
          records.push({
            timestamp: new Date(record.timestamp),
            project: projectName,
            model: record.message.model,
            cost,
            inputTokens,
            outputTokens,
            billedTokens,
            cacheReadTokens,
            cacheWriteTokens
          });
        }
      }
    } catch (e) {
      // Skip invalid JSON lines
    }
  }
  return records;
}
async function getDailyComparison(days = 7, projectFilter = null) {
  const allRecords = await getAllRecords(projectFilter);
  const dailyData = new Map(); // Key: date, Value: Map of project -> data
  const today = new Date();

  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().split('T')[0];
    const dayRecords = allRecords.filter(r => r.timestamp.toISOString().split('T')[0] === dateStr);
    if (dayRecords.length > 0) {
      const projectData = new Map();
      for (const record of dayRecords) {
        const projectName = record.project;
        if (!projectData.has(projectName)) {
          projectData.set(projectName, {
            cost: 0,
            inputTokens: 0,
            outputTokens: 0,
            billedTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            count: 0,
            models: new Set()
          });
        }
        const proj = projectData.get(projectName);
        proj.cost += record.cost;
        proj.inputTokens += record.inputTokens;
        proj.outputTokens += record.outputTokens;
        proj.billedTokens += record.billedTokens;
        proj.cacheReadTokens += record.cacheReadTokens;
        proj.cacheWriteTokens += record.cacheWriteTokens;
        proj.count += 1;
        if (record.model) {
          proj.models.add(record.model);
        }
      }
      dailyData.set(dateStr, projectData);
    }
  }
  return dailyData;
}
// Recursively find all JSONL files in a directory
function findJsonlFilesRecursively(dir) {
  const files = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isFile() && item.endsWith('.jsonl')) {
          files.push(fullPath);
        } else if (stats.isDirectory()) {
          // Recursively search subdirectories
          files.push(...findJsonlFilesRecursively(fullPath));
        }
      } catch (e) {
        // Skip files/dirs that can't be read
      }
    }
  } catch (e) {
    // Skip directories that can't be read
  }
  return files;
}

async function getAllRecords(projectFilter = null) {
  const allRecords = [];
  const seenRecords = new Set(); // Track unique records by timestamp + tokens
  const projectsDir = path.join(os.homedir(), '.claude', 'projects'); // Always use home directory
console.log(`🔍 Scanning projects in: ${projectsDir}`);
  if (!fs.existsSync(projectsDir)) {
    return allRecords;
  }

  // Get all directories in projects folder and filter to those with .jsonl files (recursively)
  let projectFolders = fs.readdirSync(projectsDir).filter(f => {
    const folderPath = path.join(projectsDir, f);
    try {
      const stats = fs.statSync(folderPath);
      if (stats.isDirectory()) {
        // Check if any JSONL files exist in this folder or subdirectories
        const jsonlFiles = findJsonlFilesRecursively(folderPath);
        return jsonlFiles.length > 0;
      }
    } catch (e) {
      console.warn(`Warning: Could not read folder ${folderPath}, skipping.`);
      // Skip if can't read
    }
    return false;
  });

  // Apply project filter if specified
  if (projectFilter) {
    projectFolders = projectFolders.filter(f => f.includes(projectFilter));
    console.log(`\n🔍 Filtering to projects matching: "${projectFilter}"`);
  }
  console.log(`\n📁 Found ${projectFolders.length} project folder(s):`);

  for (const projectFolder of projectFolders) {
    const projectPath = path.join(projectsDir, projectFolder);
    let projectRecordCount = 0;
    try {
      // Recursively find all JSONL files in this project folder
      const files = findJsonlFilesRecursively(projectPath);

      for (const file of files) {
        const fileRecords = await extractUsageFromFile(file, projectFolder);
        // Deduplicate records based on timestamp + input/output tokens
        for (const record of fileRecords) {
          const recordKey = `${record.timestamp.getTime()}-${record.inputTokens}-${record.outputTokens}-${record.cacheReadTokens}-${record.cacheWriteTokens}`;
          if (!seenRecords.has(recordKey)) {
            seenRecords.add(recordKey);
            allRecords.push(record);
            projectRecordCount++;
          }
        }
      }
      if (projectRecordCount > 0) {
        console.log(`   ${projectFolder}: ${projectRecordCount} records`);
      }
    } catch (e) {
      // Skip folders that can't be read
    }
  }
  return allRecords;
}
async function main() {

  const allRecords = await getAllRecords();
  // Helper: get time buckets
  function getBuckets(date) {
    const d = new Date(date);
    const hour = d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const day = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const week = `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + 6 - d.getDay()) / 7)).padStart(2, '0')}`;
    const month = d.toISOString().slice(0, 7); // YYYY-MM
    return { hour, day, week, month };
  }

  // Aggregation structures
  const projectStats = {};
  const skillsGlobal = {};
  const toolsGlobal = {};
  // For cumulative totals
  let totalCost = 0, totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalCount = 0;
  // For time buckets
  const hourly = {}, daily = {}, weekly = {}, monthly = {};

  for (const rec of allRecords) {
    const project = rec.project;
    const model = rec.model;
    const ts = rec.timestamp;
    const { hour, day, week, month } = getBuckets(ts);
    // Initialize project
    if (!projectStats[project]) {
      projectStats[project] = {
        models: {},
        skills: {},
        tools: {},
        hourly: {},
        daily: {},
        weekly: {},
        monthly: {},
        total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 }
      };
    }
    // Model breakdown
    if (!projectStats[project].models[model]) {
      projectStats[project].models[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 };
    }
    // Time buckets (per project)
    for (const [bucket, key] of Object.entries({ hourly: hour, daily: day, weekly: week, monthly: month })) {
      if (!projectStats[project][bucket][key]) {
        projectStats[project][bucket][key] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 };
      }
    }
    // Aggregate tokens/cost
    const input = rec.inputTokens;
    const output = rec.outputTokens;
    const cacheRead = rec.cacheReadTokens;
    const cacheWrite = rec.cacheWriteTokens;
    const cost = rec.cost;
    // By model
    projectStats[project].models[model].input += input;
    projectStats[project].models[model].output += output;
    projectStats[project].models[model].cacheRead += cacheRead;
    projectStats[project].models[model].cacheWrite += cacheWrite;
    projectStats[project].models[model].cost += cost;
    projectStats[project].models[model].count += 1;
    // By time (per project)
    projectStats[project].hourly[hour].input += input;
    projectStats[project].hourly[hour].output += output;
    projectStats[project].hourly[hour].cacheRead += cacheRead;
    projectStats[project].hourly[hour].cacheWrite += cacheWrite;
    projectStats[project].hourly[hour].cost += cost;
    projectStats[project].hourly[hour].count += 1;
    projectStats[project].daily[day].input += input;
    projectStats[project].daily[day].output += output;
    projectStats[project].daily[day].cacheRead += cacheRead;
    projectStats[project].daily[day].cacheWrite += cacheWrite;
    projectStats[project].daily[day].cost += cost;
    projectStats[project].daily[day].count += 1;
    projectStats[project].weekly[week].input += input;
    projectStats[project].weekly[week].output += output;
    projectStats[project].weekly[week].cacheRead += cacheRead;
    projectStats[project].weekly[week].cacheWrite += cacheWrite;
    projectStats[project].weekly[week].cost += cost;
    projectStats[project].weekly[week].count += 1;
    projectStats[project].monthly[month].input += input;
    projectStats[project].monthly[month].output += output;
    projectStats[project].monthly[month].cacheRead += cacheRead;
    projectStats[project].monthly[month].cacheWrite += cacheWrite;
    projectStats[project].monthly[month].cost += cost;
    projectStats[project].monthly[month].count += 1;
    // By total (per project)
    projectStats[project].total.input += input;
    projectStats[project].total.output += output;
    projectStats[project].total.cacheRead += cacheRead;
    projectStats[project].total.cacheWrite += cacheWrite;
    projectStats[project].total.cost += cost;
    projectStats[project].total.count += 1;
    // Skills/tools (if present)
    if (rec.skills) {
      for (const skill of rec.skills) {
        projectStats[project].skills[skill] = (projectStats[project].skills[skill] || 0) + 1;
        skillsGlobal[skill] = (skillsGlobal[skill] || 0) + 1;
      }
    }
    if (rec.tools) {
      for (const tool of rec.tools) {
        projectStats[project].tools[tool] = (projectStats[project].tools[tool] || 0) + 1;
        toolsGlobal[tool] = (toolsGlobal[tool] || 0) + 1;
      }
    }
    // Global time buckets (across all projects)
    if (!hourly[hour]) hourly[hour] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 };
    if (!daily[day]) daily[day] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 };
    if (!weekly[week]) weekly[week] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 };
    if (!monthly[month]) monthly[month] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 };
    hourly[hour].input += input;
    hourly[hour].output += output;
    hourly[hour].cacheRead += cacheRead;
    hourly[hour].cacheWrite += cacheWrite;
    hourly[hour].cost += cost;
    hourly[hour].count += 1;
    daily[day].input += input;
    daily[day].output += output;
    daily[day].cacheRead += cacheRead;
    daily[day].cacheWrite += cacheWrite;
    daily[day].cost += cost;
    daily[day].count += 1;
    weekly[week].input += input;
    weekly[week].output += output;
    weekly[week].cacheRead += cacheRead;
    weekly[week].cacheWrite += cacheWrite;
    weekly[week].cost += cost;
    weekly[week].count += 1;
    monthly[month].input += input;
    monthly[month].output += output;
    monthly[month].cacheRead += cacheRead;
    monthly[month].cacheWrite += cacheWrite;
    monthly[month].cost += cost;
    monthly[month].count += 1;
    // Cumulative totals
    totalInput += input;
    totalOutput += output;
    totalCacheRead += cacheRead;
    totalCacheWrite += cacheWrite;
    totalCost += cost;
    totalCount += 1;
  }

  // Filter hourly data to only last 24 hours
  const now = new Date();
  const last24hCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last24hCutoffStr = last24hCutoff.toISOString().slice(0, 13); // YYYY-MM-DDTHH

  // Filter global hourly data
  const filteredHourly = {};
  for (const [hour, data] of Object.entries(hourly)) {
    if (hour >= last24hCutoffStr) {
      filteredHourly[hour] = data;
    }
  }

  // Filter hourly data in project stats
  for (const project of Object.keys(projectStats)) {
    const filteredProjectHourly = {};
    for (const [hour, data] of Object.entries(projectStats[project].hourly)) {
      if (hour >= last24hCutoffStr) {
        filteredProjectHourly[hour] = data;
      }
    }
    projectStats[project].hourly = filteredProjectHourly;
  }

  // Add skills/tools usage from ~/.claude.json
  const claudeStats = getClaudeStats();

  // Convert to dashboard-compatible format for KPI and sessions
  const projectList = [];
  const allSessions = [];
  let kpiTotalCost = 0;
  let kpiTotalMessages = 0;
  let firstSessionDate = null;
  let lastSessionDate = null;

  // Build project list and calculate KPIs
  for (const [projName, projData] of Object.entries(projectStats)) {
    projectList.push({
      name: projName,
      sessions: projData.total.count,
      messages: Object.values(projData.tools).reduce((a, b) => a + b, 0),
      cost: projData.total.cost,
      input_tokens: projData.total.input,
      output_tokens: projData.total.output,
      cache_read_tokens: projData.total.cacheRead,
      cache_write_tokens: projData.total.cacheWrite,
      file_size_mb: 0
    });
    kpiTotalCost += projData.total.cost;
  }
  projectList.sort((a, b) => b.cost - a.cost);

  // Build daily costs for dashboard
  const dailyCosts = [];
  for (const [day, data] of Object.entries(daily)) {
    const entry = { date: day, total: data.cost };
    dailyCosts.push(entry);
    if (!firstSessionDate || day < firstSessionDate) firstSessionDate = day;
    if (!lastSessionDate || day > lastSessionDate) lastSessionDate = day;
  }
  dailyCosts.sort((a, b) => a.date.localeCompare(b.date));

  // Build cumulative costs
  let cumCost = 0;
  const cumulativeCosts = dailyCosts.map(d => ({
    date: d.date,
    cost: (cumCost += d.total)
  }));

  // Output structure with both formats
  const output = {
    generated_at: new Date().toISOString(),
    totals: {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      cost: totalCost,
      count: totalCount
    },
    hourly: filteredHourly,
    daily,
    weekly,
    monthly,
    projects: projectStats,
    skills: claudeStats.skills,
    tools: claudeStats.tools,
    // Dashboard-compatible format
    dashboard: {
      generated_at: new Date().toISOString(),
      kpi: {
        total_cost: totalCost,
        actual_plan_cost: 0,
        total_sessions: totalCount,
        total_messages: kpiTotalMessages,
        total_output_tokens: totalOutput,
        total_input_tokens: totalInput,
        first_session: firstSessionDate || '',
        last_session: lastSessionDate || '',
        total_projects: Object.keys(projectStats).length
      },
      daily_costs: dailyCosts,
      cumulative_costs: cumulativeCosts,
      daily_messages: Object.entries(daily).map(([date, data]) => ({
        date,
        messages: data.count,
        sessions: data.count
      })),
      hourly_distribution: Object.entries(hourly).map(([hour, data]) => ({
        hour: parseInt(hour.split('T')[1].split(':')[0]),
        messages: data.count
      })),
      weekday_distribution: Array(7).fill(0).map((_, i) => ({
        day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
        messages: 0
      })),
      models: [...new Set(Object.values(projectStats).flatMap(p => Object.keys(p.models)))],
      model_summary: Object.entries(projectStats).flatMap(([_, p]) =>
        Object.entries(p.models).map(([model, data]) => ({
          model,
          cost: data.cost,
          input_tokens: data.input,
          output_tokens: data.output,
          cache_read_tokens: data.cacheRead,
          cache_write_tokens: data.cacheWrite,
          calls: data.count
        }))
      ),
      cost_by_token_type: {
        input: (totalInput / 1_000_000) * 3,
        output: (totalOutput / 1_000_000) * 15,
        cache_read: (totalCacheRead / 1_000_000) * 0.3,
        cache_write: (totalCacheWrite / 1_000_000) * 3.75
      },
      projects: projectList,
      sessions: allSessions,
      tool_summary: claudeStats.tools,
      insights: {
        plugins: {},
        todos: {},
        file_history: {},
        storage: {},
        plans: []
      }
    }
  };

  fs.writeFileSync(path.join(__dirname, 'ai-stats-data.json'), JSON.stringify(output, null, 2));
  console.log('✅ ai-stats-data.json written (includes dashboard data)');
}



function getClaudeStats() {
  const stats = { skills: [], tools: [] };
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');

  try {
    if (!fs.existsSync(claudeJsonPath)) {
      return stats;
    }

    const fileContent = fs.readFileSync(claudeJsonPath, 'utf-8');
    const claudeData = JSON.parse(fileContent);

    if (claudeData.skillUsage && typeof claudeData.skillUsage === 'object') {
      for (const [name, data] of Object.entries(claudeData.skillUsage)) {
        stats.skills.push({
          name,
          usageCount: data.usageCount || 0,
          lastUsedAt: data.lastUsedAt || 0
        });
      }
    }

    if (claudeData.toolUsage && typeof claudeData.toolUsage === 'object') {
      for (const [name, data] of Object.entries(claudeData.toolUsage)) {
        stats.tools.push({
          name,
          usageCount: data.usageCount || 0,
          lastUsedAt: data.lastUsedAt || 0
        });
      }
    }

    stats.skills.sort((a, b) => b.usageCount - a.usageCount);
    stats.tools.sort((a, b) => b.usageCount - a.usageCount);
  } catch (error) {
    console.error('Error reading Claude stats:', error);
  }

  return stats;
}

function getGitUsername() {
  try {
    return execSync('git config --get user.name', { encoding: 'utf-8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

async function generateReport(projectFilter = null) {
  console.log('Generating Claude Usage Cost Report...');

  const gitUsername = getGitUsername();
  const allRecords = await getAllRecords(projectFilter);
  console.log(`📋 Found ${allRecords.length} unique records`);
  
  const dailyData = await getDailyComparison(7, projectFilter);
  const claudeStats = getClaudeStats();

  // Calculate totals from nested structure
  let totalCost = 0;
  let totalRecords = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalBilledTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;

  for (const [date, projectsMap] of dailyData.entries()) {
    for (const [project, data] of projectsMap.entries()) {
      totalCost += data.cost;
      totalRecords += data.count;
      totalInputTokens += data.inputTokens;
      totalOutputTokens += data.outputTokens;
      totalBilledTokens += data.billedTokens;
      totalCacheReadTokens += data.cacheReadTokens;
      totalCacheWriteTokens += data.cacheWriteTokens;
    }
  }


  // Only output ai-stats-data.json
  // ...existing code...
}

// Parse command-line arguments
const args = process.argv.slice(2);
const projectFilterArg = args.find(arg => arg.startsWith('--project='));
const projectFilter = ''; //projectFilterArg ? projectFilterArg.split('=')[1] : null;

// Run the generator
generateReport(projectFilter).catch(err => {
  console.error('Error generating ai-stats-data.json:', err);
  process.exit(1);
});
