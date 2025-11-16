# Installing the Workflow Best Practices Skill

## Overview
The skill provides educational context and examples that complement the hard enforcement of the MCP server.

## Installation Steps

### 1. Create the skill directory

The skill needs to be placed in Claude Code's user skills directory:

```bash
mkdir -p /mnt/skills/user/workflow-best-practices
```

### 2. Copy the skill file

Copy `WORKFLOW_SKILL.md` to the skills directory as `SKILL.md`:

```bash
cp D:\cc_build_mcp\WORKFLOW_SKILL.md /mnt/skills/user/workflow-best-practices/SKILL.md
```

Or manually create the file at:
`/mnt/skills/user/workflow-best-practices/SKILL.md`

And paste the contents from `WORKFLOW_SKILL.md`.

### 3. Verify the skill is loaded

Restart Claude Code, then ask:

```
Tell me about the workflow best practices skill
```

Claude Code should reference the workflow patterns and explain the enforced development flow.

## How It Works Together

- **MCP Server**: Provides the `workflow_*` tools and enforces state transitions
- **Skill**: Provides context on WHY the workflow exists and HOW to use it effectively

When Claude Code hits an MCP constraint (like "Cannot commit - tests must pass"), the skill helps it understand:
- Why that constraint exists
- What to do instead
- Common scenarios and solutions

## Testing the Complete System

1. **Start an issue**:
   ```
   workflow_start_issue({ issue_number: 1 })
   ```

2. **Try to commit without tests** (should fail):
   ```
   workflow_commit({ message: "test" })
   ```
   
   Expected: ❌ Error about needing to run tests first

3. **Check status**:
   ```
   workflow_status
   ```
   
   Expected: Shows current state and available actions

4. Claude Code should reference the skill when explaining what to do next.

## File Locations Summary

- MCP Server: `/home/scarter/mcp-servers/workflow-enforcer/`
- Skill: `/mnt/skills/user/workflow-best-practices/SKILL.md`
- Config: `/home/scarter/.config/claude/claude_desktop_config.json`

## Updating the Skill

To update the skill content:

1. Edit `/mnt/skills/user/workflow-best-practices/SKILL.md`
2. Restart Claude Code
3. The new content is immediately available

No rebuild needed - skills are loaded fresh each time.
