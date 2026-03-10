---
name: new-skill
description: Develop a new skill for a managed instance's NanoClaw fork and submit it as a PR. Use when the user wants to add a new capability to an instance.
---

# Create New Skill via PR

## Overview

Develop a new container skill (SKILL.md) or Claude Code project skill for a managed instance's NanoClaw fork, and submit it as a pull request.

## Skill Types

There are two types of skills in NanoClaw:

### Container Skills (`container/skills/<name>/SKILL.md`)
- Available to the agent running inside containers
- Synced into each group's `.claude/skills/` at container startup
- Used for runtime capabilities (browsing, writing, etc.)
- These are what the agent sees when handling messages

### Project Skills (`.claude/skills/<name>/SKILL.md`)
- Available to Claude Code when working on the NanoClaw project itself
- Used for operational tasks (setup, debug, deploy, etc.)
- These are what the developer/operator sees

## Workflow

### 1. Understand the Skill

Ask the user:
- What should this skill do?
- Who is it for? (the container agent or the project operator)
- Which instance(s) should have it?
- Are there existing skills to use as a reference?

### 2. Design the SKILL.md

Every SKILL.md follows this structure:

```markdown
---
name: <skill-name>
description: <one-line description of when to use this skill>
---

# <Skill Title>

## Overview
<What this skill does and why>

## Workflow
<Step-by-step instructions for the agent to follow>

## Error Handling
<What to do when things go wrong>
```

Key principles:
- **The SKILL.md IS the implementation.** It contains instructions the agent follows, not code to execute.
- **Be specific.** Include exact commands, file paths, and expected outputs.
- **Handle errors.** Every step should have a fallback or error path.
- **Keep it focused.** One skill, one job.

### 3. Create the PR

```bash
cd /workspace/project
git checkout -b feat/skill-<name>
```

Create the skill directory and file:

```bash
# For container skills:
mkdir -p container/skills/<name>
# Write SKILL.md

# For project skills:
mkdir -p .claude/skills/<name>
# Write SKILL.md
```

Test that the SKILL.md is valid:
- Has correct YAML frontmatter (name, description)
- Instructions are clear and actionable
- Commands are correct and tested
- No broken references to files or tools

Commit and push:

```bash
git add container/skills/<name>/SKILL.md  # or .claude/skills/<name>/SKILL.md
git commit -m "feat: add /<name> skill for <purpose>"
git push origin feat/skill-<name>
```

Create the PR:

```bash
gh pr create \
  --title "feat: add /<name> skill" \
  --body "## Summary
Adds the /<name> skill for <purpose>.

## Skill Type
<container|project> skill

## What it does
<description>

## Testing
- [ ] SKILL.md has valid frontmatter
- [ ] Instructions are clear and complete
- [ ] Commands are tested and correct"
```

### 4. After the PR

- Tell the user the PR is ready
- After merge, the skill will be available on the next container run (container skills) or immediately (project skills)
- If the skill needs to be deployed to a running instance, suggest using `/deploy`

## Reference: Existing Skills

Look at these for patterns:
- `container/skills/agent-browser/SKILL.md` -- complex tool with many commands
- `container/skills/brainstorming/SKILL.md` -- structured workflow with gates
- `container/skills/writing-plans/SKILL.md` -- planning and handoff workflow

## Principles

- **Skills are instructions, not code.** The SKILL.md tells the agent what to do.
- **One skill, one purpose.** Don't overload a skill with unrelated capabilities.
- **Always via PR.** Even for simple skills, go through the PR flow.
- **Test the instructions.** Walk through the SKILL.md mentally to check for gaps.
