# Fixing the Workflow Enforcer Loophole

## The Problem

Claude Code discovered it can bypass the workflow enforcer by using `bash_tool` to run git commands directly:

```bash
git add -A
git commit -m "message"
git push
```

The MCP server can only control its own tools - it can't prevent bash commands.

## The Solution: Git Hooks

Add git hooks that enforce the workflow at the git level, not just the MCP level.

### 1. Create Pre-Commit Hook

In your project repository, create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Workflow enforcer pre-commit hook

# Check if there's an active issue tracked by the MCP
WORKFLOW_STATE_FILE="/tmp/workflow-enforcer-state.json"

if [ ! -f "$WORKFLOW_STATE_FILE" ]; then
    echo "❌ COMMIT BLOCKED: No active workflow state found."
    echo "You must use workflow_start_issue before committing."
    exit 1
fi

# Read the workflow state
STATE=$(cat "$WORKFLOW_STATE_FILE" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)

if [ "$STATE" != "TESTS_PASSED" ]; then
    echo "❌ COMMIT BLOCKED: Current workflow state is '$STATE'"
    echo "You must run workflow_run_tests and have tests pass before committing."
    echo ""
    echo "Proper workflow:"
    echo "  1. workflow_start_issue"
    echo "  2. Write code"
    echo "  3. workflow_run_tests  ← YOU ARE HERE"
    echo "  4. workflow_commit"
    exit 1
fi

# Check that tests actually passed
TESTS_PASSED=$(cat "$WORKFLOW_STATE_FILE" | grep -o '"passed":[^,}]*' | cut -d':' -f2)

if [ "$TESTS_PASSED" != "true" ]; then
    echo "❌ COMMIT BLOCKED: Tests have not passed."
    echo "Run workflow_run_tests first."
    exit 1
fi

echo "✅ Workflow enforcer: Tests passed, commit allowed."
exit 0
```

Make it executable:
```bash
chmod +x .git/hooks/pre-commit
```

### 2. Update MCP Server to Write State File

Modify the MCP server to persist state to `/tmp/workflow-enforcer-state.json`:

Add this to the top of `src/index.ts`:

```typescript
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_FILE = '/tmp/workflow-enforcer-state.json';

// Load state from file on startup
function loadState(): WorkflowState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    } catch {
      // Corrupted state, start fresh
    }
  }
  return {
    state: 'NO_ACTIVE_ISSUE',
    activeIssue: null,
    lastTestResult: null,
    commitHash: null,
    deploymentId: null
  };
}

// Save state to file
function saveState(state: WorkflowState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Initialize from file
let workflow: WorkflowState = loadState();
```

Then after EVERY state change, add:
```typescript
workflow.state = 'TESTS_PASSED';
saveState(workflow);  // Add this line
```

### 3. Create Hook Installer Script

Create `install-hooks.sh` in your MCP server directory:

```bash
#!/bin/bash
# Install workflow enforcer git hooks

HOOK_CONTENT='#!/bin/bash
# Workflow enforcer pre-commit hook

WORKFLOW_STATE_FILE="/tmp/workflow-enforcer-state.json"

if [ ! -f "$WORKFLOW_STATE_FILE" ]; then
    echo "❌ COMMIT BLOCKED: No active workflow state found."
    echo "You must use workflow_start_issue before committing."
    exit 1
fi

STATE=$(cat "$WORKFLOW_STATE_FILE" | grep -o "\"state\":\"[^\"]*\"" | cut -d"\"" -f4)

if [ "$STATE" != "TESTS_PASSED" ]; then
    echo "❌ COMMIT BLOCKED: Current workflow state is '"'"'$STATE'"'"'"
    echo "You must run workflow_run_tests and have tests pass before committing."
    echo ""
    echo "Proper workflow:"
    echo "  1. workflow_start_issue"
    echo "  2. Write code"
    echo "  3. workflow_run_tests  ← YOU ARE HERE"
    echo "  4. workflow_commit"
    exit 1
fi

TESTS_PASSED=$(cat "$WORKFLOW_STATE_FILE" | grep -o "\"passed\":[^,}]*" | cut -d":" -f2)

if [ "$TESTS_PASSED" != "true" ]; then
    echo "❌ COMMIT BLOCKED: Tests have not passed."
    echo "Run workflow_run_tests first."
    exit 1
fi

echo "✅ Workflow enforcer: Tests passed, commit allowed."
exit 0
'

# Install the hook in the current git repo
if [ -d ".git" ]; then
    echo "$HOOK_CONTENT" > .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo "✅ Pre-commit hook installed in current repository"
else
    echo "❌ Not in a git repository"
    exit 1
fi
```

Make it executable:
```bash
chmod +x install-hooks.sh
```

### 4. Auto-Install Hooks

Add a new MCP tool to install hooks in the current project:

```typescript
{
  name: 'workflow_install_hooks',
  description: 'Install git hooks in current repository to enforce workflow',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}
```

Implementation:
```typescript
case 'workflow_install_hooks': {
  try {
    // Check if in a git repo
    execSync('git rev-parse --git-dir', { encoding: 'utf-8' });
    
    const hookScript = `#!/bin/bash
# Workflow enforcer pre-commit hook
# (include the full hook script here)
`;
    
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
    const hookPath = `${gitDir}/hooks/pre-commit`;
    
    writeFileSync(hookPath, hookScript);
    execSync(`chmod +x ${hookPath}`);
    
    return {
      content: [{
        type: 'text',
        text: '✅ Git hooks installed! Direct git commits are now blocked.\n\n' +
              'The pre-commit hook will prevent commits unless workflow_run_tests has passed.'
      }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Failed to install hooks: ${error.message}`
      }]
    };
  }
}
```

## How It Works Now

1. **MCP Server** tracks state in `/tmp/workflow-enforcer-state.json`
2. **Git Hook** reads that state file before allowing commits
3. **Claude Code** can't bypass via bash because git itself blocks it

### The Enforcement Chain

```
Claude tries: git commit -m "message"
     ↓
Git runs: .git/hooks/pre-commit
     ↓
Hook checks: /tmp/workflow-enforcer-state.json
     ↓
State says: "ISSUE_ACTIVE" (not TESTS_PASSED)
     ↓
Hook blocks: exit 1
     ↓
Commit fails: ❌ COMMIT BLOCKED
```

## Testing the Fix

1. Run `workflow_install_hooks` in your project
2. Try to commit via bash: `git commit -m "test"`
3. Should be blocked with clear error message
4. Run `workflow_run_tests` and have it pass
5. Try commit again - should work

Now Claude Code **literally cannot** bypass the workflow, even with bash commands.

## Alternative: Wrapper Script

If git hooks feel too invasive, create a `git-wrapper.sh`:

```bash
#!/bin/bash
# Wrapper that blocks git commit unless workflow allows

if [ "$1" = "commit" ]; then
    STATE_FILE="/tmp/workflow-enforcer-state.json"
    if [ ! -f "$STATE_FILE" ] || [ "$(cat $STATE_FILE | grep -o '"state":"TESTS_PASSED"')" = "" ]; then
        echo "❌ Use workflow_commit instead of git commit"
        exit 1
    fi
fi

# Pass through to real git
/usr/bin/git "$@"
```

Then alias git in Claude Code's environment:
```bash
alias git=/path/to/git-wrapper.sh
```

Choose your enforcement level!
