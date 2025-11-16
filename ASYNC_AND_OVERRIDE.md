# Improving Long-Running Task Handling & Emergency Override

## Problem Statement

Claude Code has two issues:
1. **Doesn't check on long-running tasks** - Says "I'll check on the tests" then never does
2. **No escape hatch** - If workflow gets stuck, there's no way out without manual intervention

## Solution 1: Async Tools with Progress Updates

### Overview

Split long-running operations into three phases:
- **Start** - Kicks off the operation (non-blocking)
- **Check** - Polls for status (non-blocking)
- **Wait** - Blocks until completion (blocking)

### Implementation in MCP Server

Add these imports to `src/index.ts`:

```typescript
import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
```

Update the `WorkflowState` interface:

```typescript
interface WorkflowState {
  state: string;
  activeIssue: number | null;
  lastTestResult: any;
  commitHash: string | null;
  deploymentId: string | null;
  testProcessId: number | null;  // Add this
  testOutputFile: string | null;  // Add this
}
```

Add helper functions:

```typescript
// Check if a process is still running
function isProcessRunning(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);  // Signal 0 just checks if process exists
    return true;
  } catch {
    return false;
  }
}

// Read test results from output file
function readTestResults(outputFile: string): { passed: boolean; output: string } {
  if (!existsSync(outputFile)) {
    return { passed: false, output: 'Test output file not found' };
  }
  
  try {
    const output = readFileSync(outputFile, 'utf-8');
    // Simple heuristic: if output contains certain strings, tests failed
    const failed = output.includes('FAIL') || 
                   output.includes('failed') || 
                   output.includes('Error:');
    return { passed: !failed, output };
  } catch (error: any) {
    return { passed: false, output: `Error reading results: ${error.message}` };
  }
}
```

Add new tools to the tool list:

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ... existing tools ...
    {
      name: 'workflow_run_tests_async',
      description: 'Start running tests asynchronously (non-blocking). Returns immediately. Use workflow_check_tests to check status.',
      inputSchema: {
        type: 'object',
        properties: {
          test_command: {
            type: 'string',
            description: 'Test command to run (default: npm test)',
            default: 'npm test'
          }
        }
      }
    },
    {
      name: 'workflow_check_tests',
      description: 'Check the status of running tests. CALL THIS PERIODICALLY until tests complete. Returns running/passed/failed status.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'workflow_wait_for_tests',
      description: 'Block and wait for tests to complete. Use this if you want to wait rather than polling.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ]
}));
```

Add the tool implementations:

```typescript
case 'workflow_run_tests_async': {
  if (workflow.state === 'NO_ACTIVE_ISSUE') {
    return {
      content: [{
        type: 'text',
        text: `❌ No active issue. Use workflow_start_issue first.`
      }]
    };
  }
  
  if (workflow.state === 'TESTS_RUNNING') {
    return {
      content: [{
        type: 'text',
        text: `⏳ Tests are already running (PID: ${workflow.testProcessId})\n` +
              `Use workflow_check_tests to check status.`
      }]
    };
  }

  const testCommand = (args as any).test_command || 'npm test';
  const outputFile = `/tmp/workflow-test-output-${Date.now()}.txt`;
  
  // Start tests in background, redirecting output to file
  const child = spawn('bash', ['-c', `${testCommand} > ${outputFile} 2>&1`], {
    detached: true,
    stdio: 'ignore'
  });
  
  child.unref();  // Allow parent to exit
  
  workflow.testProcessId = child.pid || null;
  workflow.testOutputFile = outputFile;
  workflow.state = 'TESTS_RUNNING';
  saveState(workflow);
  
  return {
    content: [{
      type: 'text',
      text: `🧪 Tests started asynchronously (PID: ${child.pid})\n` +
            `Command: ${testCommand}\n` +
            `Output: ${outputFile}\n\n` +
            `⚠️ IMPORTANT: You MUST check on these tests!\n` +
            `Use workflow_check_tests to see if they've completed.\n` +
            `DO NOT proceed without checking the results.`
    }]
  };
}

case 'workflow_check_tests': {
  if (workflow.state !== 'TESTS_RUNNING') {
    return {
      content: [{
        type: 'text',
        text: `No tests currently running. State: ${workflow.state}\n` +
              `Last test result: ${workflow.lastTestResult?.passed ? '✅ Passed' : '❌ Failed'}`
      }]
    };
  }
  
  // Check if process still running
  if (isProcessRunning(workflow.testProcessId)) {
    return {
      content: [{
        type: 'text',
        text: `⏳ Tests still running (PID: ${workflow.testProcessId})\n\n` +
              `Check again in a few moments using workflow_check_tests.\n` +
              `Or use workflow_wait_for_tests to block until completion.`
      }]
    };
  }
  
  // Process finished, read results
  const result = readTestResults(workflow.testOutputFile!);
  workflow.lastTestResult = result;
  workflow.state = result.passed ? 'TESTS_PASSED' : 'TESTS_FAILED';
  workflow.testProcessId = null;
  saveState(workflow);
  
  if (result.passed) {
    return {
      content: [{
        type: 'text',
        text: `✅ Tests completed successfully!\n\n${result.output}\n\n` +
              `Next step: Use workflow_commit to commit your changes`
      }]
    };
  } else {
    return {
      content: [{
        type: 'text',
        text: `❌ Tests failed!\n\n${result.output}\n\n` +
              `Fix the issues and run workflow_run_tests_async again.`
      }]
    };
  }
}

case 'workflow_wait_for_tests': {
  if (workflow.state !== 'TESTS_RUNNING') {
    return {
      content: [{
        type: 'text',
        text: `No tests currently running. State: ${workflow.state}`
      }]
    };
  }
  
  // Block until process completes
  return {
    content: [{
      type: 'text',
      text: `⏳ Waiting for tests to complete (PID: ${workflow.testProcessId})...\n` +
            `This will block until tests finish.`
    }]
  };
  
  // Poll every second
  while (isProcessRunning(workflow.testProcessId)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Tests completed, read results
  const result = readTestResults(workflow.testOutputFile!);
  workflow.lastTestResult = result;
  workflow.state = result.passed ? 'TESTS_PASSED' : 'TESTS_FAILED';
  workflow.testProcessId = null;
  saveState(workflow);
  
  if (result.passed) {
    return {
      content: [{
        type: 'text',
        text: `✅ Tests completed successfully!\n\n${result.output}\n\n` +
              `Next step: Use workflow_commit to commit your changes`
      }]
    };
  } else {
    return {
      content: [{
        type: 'text',
        text: `❌ Tests failed!\n\n${result.output}\n\n` +
              `Fix the issues and run workflow_run_tests_async again.`
      }]
    };
  }
}
```

### How to Use

Claude Code can now:

**Option A: Poll for status**
```
workflow_run_tests_async()
// ... do other things ...
workflow_check_tests()
// ... if still running ...
workflow_check_tests()
// ... until complete ...
```

**Option B: Block and wait**
```
workflow_run_tests_async()
workflow_wait_for_tests()
// Blocks until tests complete
```

## Solution 2: Skill Updates to Enforce Checking

### Add to WORKFLOW_SKILL.md

Add a new section after "## Tool Reference":

```markdown
## CRITICAL: Long-Running Operations

### When Tests Are Running

The workflow has TWO ways to run tests:

1. **workflow_run_tests** (original) - BLOCKS until complete
2. **workflow_run_tests_async** (new) - Returns immediately

### If Using Async Tests (Recommended for Long Tests)

After calling `workflow_run_tests_async`, you **MUST**:

1. **Inform the user** tests are running
2. **Actually check** using `workflow_check_tests`
3. **Keep checking** until you get a result (✅ or ❌)
4. **Report the results** to the user

### Wrong Pattern ❌

```
workflow_run_tests_async()
"I'll check on the tests..."
*never checks*
*moves on to other tasks*
```

### Correct Pattern ✅

```
workflow_run_tests_async()
→ "Tests started. Let me check on them..."

workflow_check_tests()
→ "Still running, checking again..."

workflow_check_tests()
→ "✅ Tests passed! Ready to commit."
```

### Absolutely Required Behavior

**IF YOU START ASYNC TESTS, YOU MUST CHECK THEM.**

Do NOT:
- Say "I'll monitor the tests" without actually calling workflow_check_tests
- Assume tests passed without checking
- Move on to other work without confirming test results
- Tell the user you're "waiting" without actually polling

DO:
- Call workflow_check_tests multiple times until complete
- Report actual results to the user
- Take action based on pass/fail results

### Setting Reminders for Yourself

When you start async tests, you should:

1. Tell the user tests are running
2. Set a mental "TODO: check tests"
3. After a reasonable pause (let user respond or wait a bit)
4. Actually run workflow_check_tests
5. Report results
6. If still running, check again

**This is not optional. This is mandatory.**

### If You Forget

If you realize you started tests but never checked:
1. Immediately run workflow_check_tests
2. Apologize to the user for not checking
3. Report the actual results
4. Then proceed based on those results

### Alternative: Use Blocking Tests

If you keep forgetting to check:
- Use `workflow_run_tests` (original blocking version)
- It forces you to wait for results
- Simpler, but blocks your other work
```

## Solution 3: Emergency Override System

### The Problem

Sometimes the workflow gets stuck:
- Tests are hanging forever
- Deployment failed but workflow is confused
- User needs to force-close an issue
- Emergency hotfix needed

**Only the USER should be able to break out, not Claude Code.**

### Implementation

Add to the MCP server tools:

```typescript
{
  name: 'workflow_emergency_override',
  description: 'EMERGENCY ONLY: User-approved override to reset workflow state. Requires user confirmation. Claude Code should NEVER call this directly.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['reset', 'force_close_issue', 'skip_tests', 'force_commit'],
        description: 'The override action to perform'
      },
      user_confirmation: {
        type: 'string',
        description: 'User must type "I approve" (case-insensitive) to confirm'
      },
      reason: {
        type: 'string',
        description: 'Explanation of why override is needed'
      }
    },
    required: ['action', 'user_confirmation', 'reason']
  }
}
```

Implementation:

```typescript
case 'workflow_emergency_override': {
  const action = (args as any).action;
  const confirmation = (args as any).user_confirmation;
  const reason = (args as any).reason;
  
  // CRITICAL: Verify user confirmation (case-insensitive)
  if (confirmation.toLowerCase() !== 'i approve') {
    return {
      content: [{
        type: 'text',
        text: `🚨 EMERGENCY OVERRIDE DENIED\n\n` +
              `User confirmation required: "I approve" (case-insensitive)\n` +
              `You provided: "${confirmation}"\n\n` +
              `This is a safety measure to prevent accidental workflow breaks.`
      }]
    };
  }
  
  // Log the override for audit
  console.error(`🚨 EMERGENCY OVERRIDE: ${action} - Reason: ${reason}`);
  
  let message = '';
  
  switch (action) {
    case 'reset':
      // Complete reset
      workflow = {
        state: 'NO_ACTIVE_ISSUE',
        activeIssue: null,
        lastTestResult: null,
        commitHash: null,
        deploymentId: null,
        testProcessId: null,
        testOutputFile: null
      };
      saveState(workflow);
      message = `🚨 Workflow completely reset.\n` +
                `All state cleared. You can start fresh with workflow_start_issue.\n` +
                `Reason: ${reason}`;
      break;
      
    case 'force_close_issue':
      if (!workflow.activeIssue) {
        return {
          content: [{
            type: 'text',
            text: `No active issue to close.`
          }]
        };
      }
      
      const issueToClose = workflow.activeIssue;
      
      try {
        execSync(
          `gh issue close ${issueToClose} -c "⚠️ Force-closed via emergency override: ${reason}"`,
          { encoding: 'utf-8' }
        );
        
        workflow = {
          state: 'NO_ACTIVE_ISSUE',
          activeIssue: null,
          lastTestResult: null,
          commitHash: null,
          deploymentId: null,
          testProcessId: null,
          testOutputFile: null
        };
        saveState(workflow);
        
        message = `🚨 Issue #${issueToClose} force-closed.\n` +
                  `Workflow reset.\n` +
                  `Reason: ${reason}`;
      } catch (error: any) {
        message = `Failed to close issue: ${error.message}`;
      }
      break;
      
    case 'skip_tests':
      if (workflow.state !== 'ISSUE_ACTIVE' && workflow.state !== 'TESTS_FAILED') {
        return {
          content: [{
            type: 'text',
            text: `Current state (${workflow.state}) doesn't require test skip.`
          }]
        };
      }
      
      workflow.state = 'TESTS_PASSED';
      workflow.lastTestResult = {
        passed: true,
        output: '⚠️ Tests skipped via emergency override',
        overridden: true
      };
      saveState(workflow);
      
      message = `⚠️ Tests marked as passed (OVERRIDE).\n` +
                `You can now commit.\n` +
                `Reason: ${reason}\n\n` +
                `WARNING: This bypasses test verification!`;
      break;
      
    case 'force_commit':
      if (workflow.state === 'NO_ACTIVE_ISSUE') {
        return {
          content: [{
            type: 'text',
            text: `Cannot force commit without an active issue.`
          }]
        };
      }
      
      workflow.state = 'COMMITTED';
      workflow.commitHash = 'OVERRIDE';
      saveState(workflow);
      
      message = `⚠️ Workflow advanced to COMMITTED state.\n` +
                `Reason: ${reason}\n\n` +
                `You can now deploy.`;
      break;
      
    default:
      return {
        content: [{
          type: 'text',
          text: `Unknown override action: ${action}`
        }]
      };
  }
  
  return {
    content: [{
      type: 'text',
      text: message
    }]
  };
}
```

### Add to Skill

Add this section to WORKFLOW_SKILL.md:

```markdown
## Emergency Override (USER ONLY)

### When to Use

The emergency override exists for situations like:
- Tests are hanging and won't complete
- Deployment failed but workflow is stuck
- Critical hotfix needed immediately
- Workflow state is corrupted

### How It Works

**USER initiates, NOT Claude Code.**

The user must explicitly request an override and provide confirmation.

### Available Override Actions

1. **reset** - Complete workflow reset, clears all state
2. **force_close_issue** - Force-close the active issue
3. **skip_tests** - Mark tests as passed without running them (⚠️ DANGEROUS)
4. **force_commit** - Advance to COMMITTED state without tests

### Usage Pattern

**User says:**
> "Emergency override: reset the workflow, I approve"

**Claude Code should:**
1. Recognize this as an override request
2. Extract: action='reset', confirmation='I approve' (or 'I APPROVE', 'i approve' - case doesn't matter)
3. Call workflow_emergency_override with user's reason

Example:
```
workflow_emergency_override({
  action: 'reset',
  user_confirmation: 'I APPROVE',
  reason: 'Tests hanging, user requested reset'
})
```

### CRITICAL: Claude Code Rules

**NEVER call workflow_emergency_override unless:**
1. The USER explicitly requests it
2. The USER provides the words "I approve" (any capitalization)
3. You can explain the reason to the system

**DO NOT:**
- Suggest using override to bypass workflow
- Call override because you're impatient
- Use override to "fix" normal workflow issues
- Assume user wants override without explicit request

### Example Dialog

**Wrong:**
```
User: "The tests are taking forever"
Claude: "Let me use emergency override to skip them"  ❌
```

**Correct:**
```
User: "The tests are taking forever"
Claude: "Let me check their status with workflow_check_tests"  ✅

User: "Just skip the tests this time, emergency override"
Claude: "To proceed with override, please confirm by saying 'I approve'"

User: "I approve"
Claude: *calls workflow_emergency_override*  ✅
```

### Audit Trail

All overrides are logged with:
- Action taken
- Reason provided
- Timestamp

This ensures accountability.

### After Override

After an emergency override:
1. Explain what was changed
2. Explain the implications (e.g., "tests were skipped")
3. Ask user how to proceed
4. Resume normal workflow from new state
```

## Implementation Checklist

### MCP Server Changes

- [ ] Add `testProcessId` and `testOutputFile` to WorkflowState
- [ ] Add helper functions: `isProcessRunning()`, `readTestResults()`
- [ ] Add `workflow_run_tests_async` tool
- [ ] Add `workflow_check_tests` tool
- [ ] Add `workflow_wait_for_tests` tool
- [ ] Add `workflow_emergency_override` tool
- [ ] Update state save/load to handle new fields
- [ ] Rebuild with `npm run build`

### Skill Updates

- [ ] Add "CRITICAL: Long-Running Operations" section
- [ ] Add "Wrong Pattern vs Correct Pattern" examples
- [ ] Add "Emergency Override (USER ONLY)" section
- [ ] Add examples of proper vs improper override usage
- [ ] Emphasize checking async operations

### Testing

**Test async operations:**
```bash
workflow_start_issue({ issue_number: 1 })
workflow_run_tests_async()
# Wait a moment
workflow_check_tests()
# Should show running or completed
```

**Test emergency override:**
```bash
# User says: "Emergency override: reset the workflow, I approve"
workflow_emergency_override({
  action: 'reset',
  user_confirmation: 'I approve',  # Any case works: 'I APPROVE', 'i approve', etc.
  reason: 'Testing override system'
})
# Should reset workflow
```

**Test override denial:**
```bash
workflow_emergency_override({
  action: 'reset',
  user_confirmation: 'yes',  # Wrong confirmation
  reason: 'Testing'
})
# Should be denied
```

## Benefits

1. **Async operations** - Claude Code can check periodically instead of saying "I'll check" and forgetting
2. **Skill enforcement** - Clear rules about checking on operations
3. **Emergency escape** - User can override when needed
4. **Safety** - Claude Code cannot use override without explicit user approval
5. **Audit trail** - All overrides are logged

## Migration Path

Keep the original `workflow_run_tests` for backward compatibility:
- Simple cases: use blocking `workflow_run_tests`
- Long tests: use async `workflow_run_tests_async` + `workflow_check_tests`
- Stuck workflow: user can request emergency override
