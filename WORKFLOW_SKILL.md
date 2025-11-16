# Workflow Best Practices

## Overview
This skill provides context and examples for the enforced development workflow. 
The workflow is **physically enforced** by the `workflow-enforcer` MCP server.

## The Mandatory Workflow

You MUST follow this exact sequence:

1. **Start Issue** → `workflow_start_issue`
2. **Write Code** → Use normal file tools
3. **Run Tests** → `workflow_run_tests`
4. **Commit** → `workflow_commit` (only after tests pass)
5. **Deploy** → `workflow_deploy`
6. **Verify Production** → `workflow_verify_prod`
7. **Close Issue** → `workflow_close_issue`

## Why This Workflow Exists

### Why Start with an Issue?
- Ensures all work is tracked
- Provides context for code reviewers
- Links commits to requirements
- Enables better project management

### Why Run Tests Before Commit?
- Prevents broken code from entering the repository
- Catches regressions early
- Maintains code quality standards
- Saves time debugging later

### Why Verify in Production?
- Integration tests don't catch everything
- Real-world data behaves differently
- Network, latency, and scaling issues appear in prod
- Confirms the actual problem is solved

## Common Scenarios

### Scenario 1: Tests Fail

```
You: workflow_run_tests
MCP: ❌ Tests failed! [output]

CORRECT RESPONSE:
1. Analyze the test failure
2. Fix the code
3. Run workflow_run_tests again
4. DO NOT try to commit

WRONG RESPONSE:
- "I'll commit anyway and fix it later" ❌
- Trying to use git commit directly ❌
```

### Scenario 2: Forgot to Start Issue

```
You: *writes code*
You: workflow_run_tests
MCP: ❌ No active issue. Use workflow_start_issue first.

CORRECT RESPONSE:
1. Use workflow_start_issue with the issue number
2. Then proceed with testing

This happens because you skipped step 1.
```

### Scenario 3: Production Tests Fail

```
You: workflow_verify_prod
MCP: ❌ Production tests failed!

CORRECT RESPONSE:
1. Investigate the prod failure
2. Fix the code locally
3. Run workflow_run_tests
4. workflow_commit with fix
5. workflow_deploy again
6. workflow_verify_prod again

The issue remains open until prod tests pass.
```

### Scenario 4: No Active Issue

```
You: workflow_commit("Fix bug")
MCP: ❌ Cannot commit. Current state: NO_ACTIVE_ISSUE

CORRECT RESPONSE:
1. Use workflow_start_issue first
2. Then write your code
3. Then run tests
4. Then commit

You cannot commit without an active issue.
```

## Tool Reference

### workflow_status
**Use this when confused about what to do next.**

Shows:
- Current workflow state
- Active issue number
- Available next actions

Example:
```
workflow_status
→ State: TESTS_PASSED
  Active Issue: #42
  Available: workflow_commit
```

### workflow_start_issue
**Always use this FIRST before any coding.**

Parameters:
- `issue_number`: The GitHub issue number

Example:
```
workflow_start_issue({ issue_number: 123 })
```

This verifies the issue exists and is open via GitHub CLI.

### workflow_run_tests
**Always use this after writing or changing code.**

Parameters:
- `test_command` (optional): Custom test command (default: `npm test`)

Examples:
```
workflow_run_tests()
workflow_run_tests({ test_command: "yarn test" })
workflow_run_tests({ test_command: "./run-tests.sh" })
```

Don't skip this even if you think your code is perfect.

### workflow_commit
**Only available after tests pass.**

Parameters:
- `message`: Commit message (issue reference is auto-added)

Example:
```
workflow_commit({ message: "Add user authentication feature" })
```

This will automatically add "Refs #123" to your commit.

### workflow_deploy
**Only available after commit.**

Parameters:
- `environment` (optional): Target environment (default: `production`)

Example:
```
workflow_deploy()
workflow_deploy({ environment: "staging" })
```

Looks for deploy scripts in this order:
1. `./deploy.sh`
2. `./scripts/deploy.sh`
3. `npm run deploy`

### workflow_verify_prod
**REQUIRED after deploy.**

Parameters:
- `test_command` (optional): Custom prod test (default: `npm run test:prod`)

Examples:
```
workflow_verify_prod()
workflow_verify_prod({ test_command: "curl https://myapp.com/health" })
```

### workflow_close_issue
**Only available after prod tests pass.**

No parameters needed.

Example:
```
workflow_close_issue()
```

This closes the GitHub issue with a comment about the verified deployment.

## Anti-Patterns to Avoid

### ❌ The Optimist
"The code looks good, I'll just commit it."
→ NO. Run tests. Always.

### ❌ The Bypasser
"I'll just use git commit directly."
→ Won't work. The MCP enforces workflow_commit only.

### ❌ The Apologizer
"Sorry, I forgot to run tests. I'll commit and fix it later."
→ The workflow prevents this. Just run the tests now.

### ❌ The Skipper
"Production tests take too long, let's just close the issue."
→ Cannot close until prod tests pass. This is intentional.

### ❌ The Multi-Tasker
"I'll work on issue #123 and #124 at the same time."
→ One issue at a time. Close the current one first.

## Integration with Other Tools

You still have access to:
- Normal file editing (`str_replace`, `create_file`, etc.)
- `bash_tool` for other commands
- Regular development tools
- `view` for reading files

The workflow tools only enforce the **commit/deploy/close** gates.

## State Machine Reference

```
NO_ACTIVE_ISSUE
    ↓ workflow_start_issue
ISSUE_ACTIVE
    ↓ workflow_run_tests
TESTS_FAILED ←┐ (fix code and retry)
    ↓          │
TESTS_PASSED   │
    ↓ workflow_commit
COMMITTED
    ↓ workflow_deploy
DEPLOYED
    ↓ workflow_verify_prod
PROD_VERIFIED
    ↓ workflow_close_issue
NO_ACTIVE_ISSUE (ready for next issue)
```

## Troubleshooting

### "I'm stuck in TESTS_FAILED state"
Fix your code, then run `workflow_run_tests` again.

### "I want to abandon this issue"
Close it manually via GitHub, then the workflow will reset. Or fix the tests.

### "Can I work on multiple issues at once?"
No. One issue at a time. Close the current one first.

### "The MCP server isn't responding"
1. Check if it's loaded: run `workflow_status`
2. Check Claude Code logs for errors
3. Verify the MCP server is in your config
4. Restart Claude Code

### "Tests are taking too long"
You can override the test command:
```
workflow_run_tests({ test_command: "npm test -- --fast" })
```

But don't skip tests entirely.

## Success Pattern

```
workflow_start_issue({ issue_number: 123 })
→ ✅ Started issue #123

*write code using str_replace, create_file, etc.*

workflow_run_tests()
→ ✅ Tests passed

workflow_commit({ message: "Add feature X" })
→ ✅ Committed

workflow_deploy()
→ ✅ Deployed

workflow_verify_prod()
→ ✅ Prod tests passed

workflow_close_issue()
→ 🎉 Issue #123 closed
```

This is the happy path. Follow it.

## Error Recovery

### If tests fail
1. Read the error output
2. Fix the code
3. Run `workflow_run_tests` again
4. Don't try to commit

### If deployment fails
1. Check the deployment logs
2. Fix the deployment script or configuration
3. Commit any fixes needed
4. Run `workflow_deploy` again

### If prod tests fail
1. **DO NOT CLOSE THE ISSUE**
2. Investigate the prod failure (could be a real bug)
3. Fix the code locally
4. Run through the full workflow again:
   - `workflow_run_tests`
   - `workflow_commit`
   - `workflow_deploy`
   - `workflow_verify_prod`

## When to Check Status

Use `workflow_status` when:
- You're unsure what to do next
- You forgot where you are in the workflow
- You want to verify the active issue number
- The MCP gives you an error you don't understand

## Remember

The MCP server makes it **impossible** to:
- Commit without an active issue
- Commit without passing tests
- Deploy without committing
- Close an issue without verifying in production

These are not suggestions. These are enforced constraints.

Work with the workflow, not against it.
