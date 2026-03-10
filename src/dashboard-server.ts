import { createServer, Server } from 'http';
import crypto from 'crypto';
import { logger } from './logger.js';
import { DASHBOARD_PORT } from './config.js';

interface DashboardPage {
  html: string;
  expiresAt: number;
}

const pages = new Map<string, DashboardPage>();
let server: Server | null = null;

const DASHBOARD_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function stopDashboardServer(): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server!.close(() => resolve());
    server = null;
  });
}

export function startDashboardServer(): Promise<void> {
  if (server) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const match = req.url?.match(/^\/dash\/([a-f0-9]+)$/);
      if (!match) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const token = match[1];
      const page = pages.get(token);

      if (!page || page.expiresAt < Date.now()) {
        pages.delete(token);
        res.writeHead(410);
        res.end('This dashboard link has expired.');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page.html);
    });

    const bindHost = process.env.DASHBOARD_BIND_HOST || '127.0.0.1';
    server.listen(DASHBOARD_PORT, bindHost, () => {
      logger.info({ port: DASHBOARD_PORT }, 'Dashboard server started');
      resolve();
    });

    server.on('error', reject);
  });
}

/**
 * Generate a dashboard page and return the URL.
 * The page auto-expires after 30 minutes.
 */
export function createDashboardPage(data: object): string {
  // Cleanup expired pages
  const now = Date.now();
  for (const [token, page] of pages) {
    if (page.expiresAt < now) pages.delete(token);
  }

  const token = crypto.randomBytes(16).toString('hex');
  const html = generateDashboardHtml(data);

  pages.set(token, {
    html,
    expiresAt: now + DASHBOARD_TTL_MS,
  });

  const host = process.env.DASHBOARD_HOST || 'localhost';
  return `http://${host}:${DASHBOARD_PORT}/dash/${token}`;
}

/**
 * Escape a string for safe embedding in an HTML <script> tag.
 * Prevents XSS by escaping </script> sequences and HTML entities in JSON.
 */
function escapeJsonForScript(jsonStr: string): string {
  return jsonStr
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Escape text content for safe insertion into innerHTML.
 */
function htmlEscapeInJS(): string {
  return `
    function esc(s) {
      var d = document.createElement('div');
      d.appendChild(document.createTextNode(s));
      return d.innerHTML;
    }
  `;
}

function generateDashboardHtml(data: object): string {
  const jsonData = escapeJsonForScript(JSON.stringify(data));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NanoClaw Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #8b949e; margin-bottom: 24px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card h2 { font-size: 16px; color: #8b949e; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .big-number { font-size: 36px; font-weight: 700; color: #58a6ff; }
    .stat-label { font-size: 12px; color: #8b949e; margin-top: 4px; }
    .chart-container { height: 200px; position: relative; }
    .bar-chart { display: flex; align-items: flex-end; gap: 2px; height: 100%; padding-top: 20px; }
    .bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; }
    .bar-stack { width: 100%; display: flex; flex-direction: column-reverse; }
    .bar { min-height: 2px; transition: height 0.3s; }
    .bar-label { font-size: 10px; color: #8b949e; margin-top: 4px; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #8b949e; padding: 8px 4px; border-bottom: 1px solid #30363d; }
    td { padding: 8px 4px; border-bottom: 1px solid #21262d; }
    .status-active { color: #3fb950; }
    .status-paused { color: #d29922; }
    .status-error { color: #f85149; }
    .status-idle { color: #8b949e; }
    .event-list { max-height: 400px; overflow-y: auto; }
    .event { padding: 8px 0; border-bottom: 1px solid #21262d; font-size: 13px; }
    .event-time { color: #8b949e; font-size: 11px; }
    .event-group { display: inline-block; background: #30363d; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; }
    .legend { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #8b949e; }
    .legend-color { width: 10px; height: 10px; border-radius: 2px; }
    .expires { color: #f85149; font-size: 12px; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <h1>NanoClaw Dashboard</h1>
  <div class="subtitle" id="generated-at"></div>

  <div class="grid">
    <div class="card">
      <h2>Cost This Month</h2>
      <div class="big-number" id="monthly-cost"></div>
      <div class="stat-label" id="monthly-stats"></div>
    </div>
    <div class="card">
      <h2>Active Agents</h2>
      <div class="big-number" id="active-count"></div>
      <div class="stat-label" id="agent-details"></div>
    </div>
    <div class="card">
      <h2>Scheduled Tasks</h2>
      <div class="big-number" id="task-count"></div>
      <div class="stat-label" id="task-details"></div>
    </div>
  </div>

  <div class="card" style="margin-bottom: 16px;">
    <h2>Daily Cost by Group</h2>
    <div class="legend" id="chart-legend"></div>
    <div class="chart-container">
      <div class="bar-chart" id="cost-chart"></div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Activity Feed (48hr)</h2>
      <div class="event-list" id="activity-feed"></div>
    </div>
    <div class="card">
      <h2>Tasks</h2>
      <table id="tasks-table">
        <thead>
          <tr><th>Task</th><th>Schedule</th><th>Status</th><th>Next Run</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <div class="expires">This dashboard expires 30 minutes after generation.</div>

  <script>
    var data = ${jsonData};

    ${htmlEscapeInJS()}

    // Generated at
    document.getElementById('generated-at').textContent =
      'Generated: ' + new Date(data.generated_at).toLocaleString();

    // Cost summary
    var cost = data.cost && data.cost.this_month ? data.cost.this_month : { total_usd: 0, request_count: 0, total_input_tokens: 0, total_output_tokens: 0 };
    document.getElementById('monthly-cost').textContent = '$' + cost.total_usd.toFixed(2);
    document.getElementById('monthly-stats').textContent =
      cost.request_count + ' API calls | ' +
      (cost.total_input_tokens + cost.total_output_tokens).toLocaleString() + ' tokens';

    // Active agents
    var agents = data.active_agents || [];
    document.getElementById('active-count').textContent = agents.length;
    document.getElementById('agent-details').textContent =
      agents.length > 0
        ? agents.map(function(a) { return (a.group_name || a.group_folder || 'unknown') + (a.is_idle ? ' (idle)' : ''); }).join(', ')
        : 'No containers running';

    // Tasks summary
    var tasks = data.tasks || [];
    var activeTasks = tasks.filter(function(t) { return t.status === 'active'; });
    document.getElementById('task-count').textContent = activeTasks.length + '/' + tasks.length;
    document.getElementById('task-details').textContent = activeTasks.length + ' active, ' +
      tasks.filter(function(t) { return t.status === 'paused'; }).length + ' paused';

    // Bar chart
    var dailyData = (data.cost && data.cost.daily_by_group) ? data.cost.daily_by_group : [];
    var groupSet = {};
    dailyData.forEach(function(d) { groupSet[d.group_folder] = true; });
    var groups = Object.keys(groupSet);
    var colors = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#f778ba'];
    var groupColors = {};
    groups.forEach(function(g, i) { groupColors[g] = colors[i % colors.length]; });

    // Legend
    var legendEl = document.getElementById('chart-legend');
    groups.forEach(function(g) {
      var item = document.createElement('div');
      item.className = 'legend-item';
      var colorDiv = document.createElement('div');
      colorDiv.className = 'legend-color';
      colorDiv.style.background = groupColors[g];
      item.appendChild(colorDiv);
      item.appendChild(document.createTextNode(g));
      legendEl.appendChild(item);
    });

    // Bars
    var dateSet = {};
    dailyData.forEach(function(d) { dateSet[d.date] = true; });
    var dates = Object.keys(dateSet).sort();
    var maxDayCost = 0.01;
    dates.forEach(function(date) {
      var dayTotal = 0;
      dailyData.forEach(function(d) { if (d.date === date) dayTotal += d.cost_usd; });
      if (dayTotal > maxDayCost) maxDayCost = dayTotal;
    });

    var chartEl = document.getElementById('cost-chart');
    dates.forEach(function(date) {
      var dayData = dailyData.filter(function(d) { return d.date === date; });
      var groupDiv = document.createElement('div');
      groupDiv.className = 'bar-group';

      var stack = document.createElement('div');
      stack.className = 'bar-stack';
      stack.style.height = '180px';

      dayData.forEach(function(d) {
        var bar = document.createElement('div');
        bar.className = 'bar';
        bar.style.background = groupColors[d.group_folder];
        bar.style.height = ((d.cost_usd / maxDayCost) * 100) + '%';
        bar.title = d.group_folder + ': $' + d.cost_usd.toFixed(2);
        stack.appendChild(bar);
      });

      var label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = date.slice(5); // MM-DD

      groupDiv.appendChild(stack);
      groupDiv.appendChild(label);
      chartEl.appendChild(groupDiv);
    });

    // Activity feed
    var feedEl = document.getElementById('activity-feed');
    var events = (data.activity || []).slice(0, 100);
    if (events.length === 0) {
      feedEl.textContent = 'No activity in the last 48 hours.';
    } else {
      events.forEach(function(evt) {
        var div = document.createElement('div');
        div.className = 'event';
        var icon = evt.event_type === 'message_received' ? '\\u2192' :
                   evt.event_type === 'agent_responded' ? '\\u2190' :
                   evt.event_type === 'task_ran' ? '\\u23F0' : '\\u2022';

        var timeDiv = document.createElement('div');
        timeDiv.className = 'event-time';
        timeDiv.textContent = new Date(evt.timestamp).toLocaleString();
        div.appendChild(timeDiv);

        var groupSpan = document.createElement('span');
        groupSpan.className = 'event-group';
        groupSpan.textContent = evt.group_name || evt.group_folder || 'unknown';
        div.appendChild(groupSpan);

        div.appendChild(document.createTextNode(' ' + icon + ' ' + (evt.summary || '')));
        feedEl.appendChild(div);
      });
    }

    // Tasks table
    var tbody = document.querySelector('#tasks-table tbody');
    if (tasks.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.setAttribute('colspan', '4');
      emptyCell.style.color = '#8b949e';
      emptyCell.textContent = 'No scheduled tasks.';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    } else {
      tasks.forEach(function(task) {
        var tr = document.createElement('tr');

        var tdTask = document.createElement('td');
        tdTask.textContent = (task.prompt || '').slice(0, 40) + (task.prompt && task.prompt.length > 40 ? '...' : '');
        tr.appendChild(tdTask);

        var tdSchedule = document.createElement('td');
        tdSchedule.textContent = (task.schedule_type || '') + ': ' + (task.schedule_value || '');
        tr.appendChild(tdSchedule);

        var tdStatus = document.createElement('td');
        tdStatus.className = 'status-' + (task.status || 'idle');
        tdStatus.textContent = task.status || 'unknown';
        tr.appendChild(tdStatus);

        var tdNext = document.createElement('td');
        tdNext.textContent = task.next_run ? new Date(task.next_run).toLocaleString() : 'N/A';
        tr.appendChild(tdNext);

        tbody.appendChild(tr);
      });
    }
  </script>
</body>
</html>`;
}
