import fs from 'fs';
import path from 'path';

import { getDb } from './db.js';
import { resolveGroupIpcPath } from './group-folder.js';
import { GroupQueue } from './group-queue.js';

// --- Interfaces ---

export interface CostSummary {
  total_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  request_count: number;
}

export interface DailyCostByGroup {
  date: string; // YYYY-MM-DD
  group_folder: string;
  cost_usd: number;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ActivityEvent {
  timestamp: string;
  group_folder: string;
  group_name: string;
  event_type:
    | 'message_received'
    | 'agent_invoked'
    | 'agent_responded'
    | 'task_ran';
  summary: string;
}

export interface ActiveAgent {
  group_jid: string;
  group_name: string;
  group_folder: string;
  container_name: string | null;
  is_idle: boolean;
  is_task: boolean;
  running_task_id: string | null;
}

export interface TaskWithHistory {
  id: string;
  group_folder: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  status: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  recent_runs: Array<{
    run_at: string;
    duration_ms: number;
    status: string;
    error: string | null;
  }>;
}

// --- Query functions ---

/**
 * Get total cost summary for a given month.
 */
export function getMonthlyCost(year: number, month: number): CostSummary {
  const db = getDb();
  const startDate = new Date(year, month - 1, 1).toISOString();
  const endDate = new Date(year, month, 1).toISOString();

  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(cost_usd), 0) as total_usd,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
        COUNT(*) as request_count
      FROM api_usage
      WHERE timestamp >= ? AND timestamp < ?`,
    )
    .get(startDate, endDate) as CostSummary;

  return row;
}

/**
 * Get daily cost breakdown grouped by date and group folder.
 */
export function getDailyCostByGroup(since: string): DailyCostByGroup[] {
  const db = getDb();

  return db
    .prepare(
      `SELECT
        DATE(timestamp) as date,
        COALESCE(group_folder, 'unknown') as group_folder,
        SUM(cost_usd) as cost_usd,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM api_usage
      WHERE timestamp >= ?
      GROUP BY date, group_folder
      ORDER BY date, group_folder`,
    )
    .all(since) as DailyCostByGroup[];
}

/**
 * Get chronological activity feed from messages and task runs.
 * Joins with registered_groups to resolve group names and folders.
 */
export function getActivityFeed(
  since: string,
  groupFolder?: string,
): ActivityEvent[] {
  const db = getDb();

  // Build the UNION query with optional group folder filter.
  // The messages table has chat_jid; registered_groups maps jid -> folder + name.
  const folderParam = groupFolder ?? null;

  const rows = db
    .prepare(
      `SELECT * FROM (
        -- User messages
        SELECT
          m.timestamp,
          COALESCE(rg.folder, 'unknown') as group_folder,
          COALESCE(rg.name, m.chat_jid) as group_name,
          'message_received' as event_type,
          COALESCE(m.sender_name, '') || ': ' || SUBSTR(COALESCE(m.content, ''), 1, 100) as summary
        FROM messages m
        LEFT JOIN registered_groups rg ON rg.jid = m.chat_jid
        WHERE m.timestamp >= ? AND m.is_bot_message = 0
          AND (? IS NULL OR rg.folder = ?)

        UNION ALL

        -- Bot responses
        SELECT
          m.timestamp,
          COALESCE(rg.folder, 'unknown') as group_folder,
          COALESCE(rg.name, m.chat_jid) as group_name,
          'agent_responded' as event_type,
          SUBSTR(COALESCE(m.content, ''), 1, 100) as summary
        FROM messages m
        LEFT JOIN registered_groups rg ON rg.jid = m.chat_jid
        WHERE m.timestamp >= ? AND m.is_bot_message = 1
          AND (? IS NULL OR rg.folder = ?)

        UNION ALL

        -- Task runs
        SELECT
          r.run_at as timestamp,
          t.group_folder as group_folder,
          COALESCE(rg2.name, t.group_folder) as group_name,
          'task_ran' as event_type,
          SUBSTR(t.prompt, 1, 50) || ' -> ' || COALESCE(r.status, 'unknown') as summary
        FROM task_run_logs r
        JOIN scheduled_tasks t ON r.task_id = t.id
        LEFT JOIN registered_groups rg2 ON rg2.jid = t.chat_jid
        WHERE r.run_at >= ?
          AND (? IS NULL OR t.group_folder = ?)
      )
      ORDER BY timestamp DESC
      LIMIT 200`,
    )
    .all(
      since,
      folderParam,
      folderParam,
      since,
      folderParam,
      folderParam,
      since,
      folderParam,
      folderParam,
    ) as ActivityEvent[];

  return rows;
}

/**
 * Get active agents from the in-memory GroupQueue, enriched with group names.
 */
export function getActiveAgents(queue: GroupQueue): ActiveAgent[] {
  const db = getDb();
  const activeGroups = queue.getActiveGroups();

  return activeGroups.map((ag) => {
    // Look up group name from registered_groups
    const row = db
      .prepare('SELECT name, folder FROM registered_groups WHERE jid = ?')
      .get(ag.groupJid) as { name: string; folder: string } | undefined;

    return {
      group_jid: ag.groupJid,
      group_name: row?.name ?? ag.groupJid,
      group_folder: ag.groupFolder ?? row?.folder ?? 'unknown',
      container_name: ag.containerName,
      is_idle: ag.isIdle,
      is_task: ag.isTask,
      running_task_id: ag.runningTaskId,
    };
  });
}

/**
 * Get all scheduled tasks with their last 5 run logs each.
 */
export function getTasksWithHistory(): TaskWithHistory[] {
  const db = getDb();

  const tasks = db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as Array<{
    id: string;
    group_folder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
    last_run: string | null;
    last_result: string | null;
  }>;

  const recentRunsStmt = db.prepare(
    `SELECT run_at, duration_ms, status, error
     FROM task_run_logs
     WHERE task_id = ?
     ORDER BY run_at DESC
     LIMIT 5`,
  );

  return tasks.map((task) => {
    const runs = recentRunsStmt.all(task.id) as Array<{
      run_at: string;
      duration_ms: number;
      status: string;
      error: string | null;
    }>;

    return {
      id: task.id,
      group_folder: task.group_folder,
      prompt: task.prompt,
      schedule_type: task.schedule_type,
      schedule_value: task.schedule_value,
      status: task.status,
      next_run: task.next_run,
      last_run: task.last_run,
      last_result: task.last_result,
      recent_runs: runs,
    };
  });
}

// --- Data assembler (for IPC-triggered dashboard) ---

/**
 * Assemble full dashboard data object from a getActiveAgents function.
 * Used by the open_dashboard IPC handler where we don't have a GroupQueue reference.
 */
export function getDashboardData(
  getActiveAgentsFn: () => Array<{
    groupJid: string;
    containerName: string | null;
    groupFolder: string | null;
    isIdle: boolean;
    isTask: boolean;
    runningTaskId: string | null;
  }>,
): object {
  const db = getDb();
  const now = new Date();
  const twoDaysAgo = new Date(
    now.getTime() - 48 * 60 * 60 * 1000,
  ).toISOString();

  // Convert raw active groups to ActiveAgent[] (same logic as getActiveAgents)
  const activeGroups = getActiveAgentsFn();
  const activeAgents: ActiveAgent[] = activeGroups.map((ag) => {
    const row = db
      .prepare('SELECT name, folder FROM registered_groups WHERE jid = ?')
      .get(ag.groupJid) as { name: string; folder: string } | undefined;

    return {
      group_jid: ag.groupJid,
      group_name: row?.name ?? ag.groupJid,
      group_folder: ag.groupFolder ?? row?.folder ?? 'unknown',
      container_name: ag.containerName,
      is_idle: ag.isIdle,
      is_task: ag.isTask,
      running_task_id: ag.runningTaskId,
    };
  });

  return {
    generated_at: now.toISOString(),
    cost: {
      this_month: getMonthlyCost(now.getFullYear(), now.getMonth() + 1),
      daily_by_group: getDailyCostByGroup(twoDaysAgo),
    },
    activity: getActivityFeed(twoDaysAgo),
    active_agents: activeAgents,
    tasks: getTasksWithHistory(),
  };
}

// --- Snapshot writer ---

/**
 * Write a JSON snapshot of all dashboard data to the group's IPC directory
 * so the container MCP tool can read it.
 *
 * Main groups see all data; non-main groups only see their own activity.
 */
export function writeDashboardSnapshot(
  groupFolder: string,
  isMain: boolean,
  queue: GroupQueue,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const now = new Date();
  const twoDaysAgo = new Date(
    now.getTime() - 48 * 60 * 60 * 1000,
  ).toISOString();

  const snapshot = {
    generated_at: now.toISOString(),
    cost: {
      this_month: getMonthlyCost(now.getFullYear(), now.getMonth() + 1),
      daily_by_group: getDailyCostByGroup(twoDaysAgo),
    },
    activity: getActivityFeed(twoDaysAgo, isMain ? undefined : groupFolder),
    active_agents: getActiveAgents(queue),
    tasks: getTasksWithHistory(),
  };

  const snapshotFile = path.join(groupIpcDir, 'dashboard_snapshot.json');
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
}
