# Scheduled Tasks Setup Guide

This document describes the recommended scheduled tasks for a NanoClaw DevOps deployment. Tasks are scheduled via the admin channel using the `schedule_task` MCP tool.

## Overview

Scheduled tasks run automatically on a cron schedule. They execute in the context of the admin group (main channel) and can target specific groups or instances.

## Recommended Tasks

### 1. Instance Health Monitoring

Check all managed instances for health issues every 6 hours.

```
schedule_task(
  prompt: "Run /diagnose on all registered instances. If any instance has problems (disk > 85%, memory > 90%, service down, or errors in logs), send a summary. If all instances are healthy, just report 'All instances healthy' with a brief status line.",
  schedule_type: "cron",
  schedule_value: "0 */6 * * *"
)
```

**Why**: Catches disk filling up, memory leaks, crashed services, and other issues before they become emergencies.

### 2. Deployment Checking

Check all instances for pending deployments every 2 hours during business hours.

```
schedule_task(
  prompt: "Run /check-deploys to see if any instances are behind on deployments. Report any instances that need updates. If all are current, report 'All instances up to date'.",
  schedule_type: "cron",
  schedule_value: "0 8-20/2 * * 1-5"
)
```

**Why**: Ensures code changes that have been merged actually get deployed to all instances in a timely manner.

### 3. Upstream Sync Check

Check for upstream nanoclaw updates weekly on Monday mornings.

```
schedule_task(
  prompt: "Run /sync-upstream to check if there are new commits from the upstream nanoclaw repository. If there are updates available, create a PR with the changes and report what's new. If already up to date, report 'No upstream updates'.",
  schedule_type: "cron",
  schedule_value: "0 9 * * 1"
)
```

**Why**: Keeps the fork current with upstream bug fixes and features without manual checking.

### 4. Daily Log Summary

Generate a daily summary of instance activity.

```
schedule_task(
  prompt: "SSH into each registered instance and check: 1) How many messages were processed in the last 24 hours (check logs), 2) Any errors or warnings in the last 24 hours, 3) Current uptime. Provide a brief daily summary.",
  schedule_type: "cron",
  schedule_value: "0 8 * * *"
)
```

**Why**: Provides visibility into daily operations without needing to manually check each instance.

## Setting Up Tasks

### Via the Admin Channel

Send a message to the admin channel asking DevOps to set up scheduled tasks:

> Set up the standard monitoring tasks: health checks every 6 hours, deploy checks every 2 hours on weekdays, and weekly upstream sync checks on Monday mornings.

### Via the MCP Tool Directly

Each task can be created individually using the `schedule_task` MCP tool as shown in the examples above.

### Listing Scheduled Tasks

Ask DevOps in the admin channel:

> List all scheduled tasks

Or use the MCP tool:

```
list_scheduled_tasks()
```

### Cancelling a Task

Ask DevOps:

> Cancel the deploy checking scheduled task

Or use the MCP tool with the task ID:

```
cancel_scheduled_task(task_id: "<task-id>")
```

## Cron Schedule Reference

| Pattern | Meaning |
|---------|---------|
| `0 */6 * * *` | Every 6 hours |
| `0 8-20/2 * * 1-5` | Every 2 hours, 8am-8pm, Mon-Fri |
| `0 9 * * 1` | Monday at 9am |
| `0 8 * * *` | Daily at 8am |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 * * 0` | Sunday at midnight |

## Task Targeting

Tasks run in the admin channel context by default. To target a specific group:

```
schedule_task(
  prompt: "...",
  schedule_type: "cron",
  schedule_value: "0 9 * * 1",
  target_group_jid: "120363336345536173@g.us"
)
```

## Notes

- All times are in the server's local timezone (configured in NanoClaw settings)
- Tasks that fail will be retried on the next scheduled run
- Scheduled task output is sent as a message to the channel
- Keep task prompts concise — they run unattended so clear instructions help
- Monitor task results for the first few runs to ensure they work as expected
