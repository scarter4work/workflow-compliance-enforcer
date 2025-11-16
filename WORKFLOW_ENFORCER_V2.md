# Workflow Enforcer MCP v2.0.0

## Overview

The **Workflow Enforcer** is a Model Context Protocol (MCP) server designed for client-mandated development workflows. It ensures compliance with strict development processes while providing visibility, audit trails, and persistence across Claude Code sessions.

## What's New in v2.0

### 🎯 Core Features

1. **State Persistence** - Workflow state survives Claude Code restarts
2. **Pre-flight Checks** - Validates required scripts/files before starting
3. **Workflow Visualization** - Real-time progress display
4. **Audit Trail & Compliance Reports** - Automatic compliance documentation
5. **Configuration System** - Per-project workflow customization
6. **Multiple Workflow Templates** - Different workflows for different tasks
7. **Better Error Messages** - Actionable suggestions for common issues
8. **Time Tracking** - Duration tracking for all steps

### 🔒 Compliance-First Design

This tool is built for environments where workflows are **client-mandated** and **non-negotiable**:
- Government contracts
- Enterprise clients
- Regulated industries (healthcare, finance)
- SOC2/ISO compliance requirements

## Installation

1. Build the MCP server:
```bash
cd /path/to/cc_build_mcp
npm install
npm run build
```

2. Add to Claude Code MCP configuration (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "workflow-enforcer": {
      "command": "node",
      "args": ["/path/to/cc_build_mcp/build/index.js"]
    }
  }
}
```

3. Restart Claude Code

## Configuration

Create a `.workflow-enforcer.json` file in your project root:

```json
{
  "mode": "strict",
  "template": "full-deployment",
  "test_command": "npm test",
  "deploy_method": "git-push",
  "deploy_script": "./deploy.sh",
  "production_verification": "script",
  "production_test_command": "npm run test:prod",
  "production_url": "https://your-app.com",
  "skip_deploy_for_patterns": ["docs/**", "*.md"]
}
```

### Configuration Options

| Option | Values | Description |
|--------|--------|-------------|
| `mode` | `strict`, `lenient` | Strict = no shortcuts; Lenient = warnings instead of errors |
| `template` | `full-deployment`, `tests-only`, `docs-only` | Workflow template to use |
| `test_command` | string | Command to run tests (default: `npm test`) |
| `deploy_method` | `git-push`, `script`, `manual` | How to deploy |
| `deploy_script` | string | Path to deploy script (if `deploy_method='script'`) |
| `production_verification` | `smoke-test`, `script`, `manual`, `none` | How to verify production |
| `production_test_command` | string | Command for production tests |
| `production_url` | string | URL for smoke test |

## Workflow Templates

### Full Deployment (default)
```
1. Start Issue
2. Run Tests
3. Commit Changes
4. Deploy to Production
5. Verify Production
6. Close Issue
```

### Tests Only
```
1. Start Issue
2. Run Tests
3. Commit Changes
4. Close Issue
```

### Docs Only
```
1. Start Issue
2. Commit Changes
3. Close Issue
```

## Available Tools

### workflow_start_issue
Begin work on a GitHub issue.

**Parameters:**
- `issue_number` (required): GitHub issue number
- `resume` (optional): Resume from saved state

**Pre-flight Checks:**
- ✅ `npm test` exists in package.json
- ✅ `npm run test:prod` exists (if production_verification='script')
- ✅ Deploy script exists (if deploy_method='script')

**Example:**
```javascript
workflow_start_issue({ issue_number: 68 })
```

**Output:**
```
✅ Started work on issue #68: Test Coverage for Payment Handlers

⚙️ Configuration: full-deployment (strict mode)

⚠️ Pre-flight Check Results:
✅ npm test - Found
✅ npm run test:prod - Found
✅ ./deploy.sh - Found

📋 Workflow Progress (full-deployment):

✅ 1. Start Issue (workflow_start_issue)
⬜ 2. Run Tests (workflow_run_tests)
⬜ 3. Commit Changes (workflow_commit)
⬜ 4. Deploy to Production (workflow_deploy)
⬜ 5. Verify Production (workflow_verify_prod)
⬜ 6. Close Issue (workflow_close_issue)

Next step: Write your code, then run workflow_run_tests
```

### workflow_run_tests
Run the test suite.

**Parameters:**
- `test_command` (optional): Override default test command

**Example:**
```javascript
workflow_run_tests({ test_command: "npm test -- --verbose" })
```

**Tracks:**
- Test duration
- Test output (truncated)
- Pass/fail status

### workflow_commit
Commit code (only available after tests pass).

**Parameters:**
- `message` (required): Commit message

**Auto-adds:**
- `Refs #{issue_number}` to commit message

**Example:**
```javascript
workflow_commit({ message: "fix(tests): Fix payment handler tests" })
```

### workflow_deploy
Deploy to production.

**Behavior depends on config:**
- `git-push`: Assumes deploy happens via push (no script needed)
- `script`: Runs deploy script
- `manual`: Pauses for manual deployment

**Example:**
```javascript
workflow_deploy({ environment: "production" })
```

### workflow_verify_prod
Verify production deployment.

**Verification methods:**
- `none`: Skip verification
- `smoke-test`: Simple HTTP 200 check
- `script`: Run production test command
- `manual`: Pause for manual verification

**Example:**
```javascript
workflow_verify_prod()
```

### workflow_close_issue
Close issue and generate audit report.

**Parameters:**
- `save_audit_report` (optional, default: true): Save report to `.workflow/reports/`

**Generates:**
- Audit report with timestamps, durations, steps
- Saves to `.workflow/reports/issue-{number}-report.md`
- Posts summary to GitHub issue

**Example:**
```javascript
workflow_close_issue({ save_audit_report: true })
```

### workflow_status
Check current workflow state.

**Parameters:**
- `detailed` (optional): Show detailed history

**Example:**
```javascript
workflow_status({ detailed: true })
```

**Output:**
```
📊 Workflow Status:

State: TESTS_PASSED
Active Issue: #68 - Test Coverage for Payment Handlers
Commit: None

📋 Workflow Progress (full-deployment):

✅ 1. Start Issue (workflow_start_issue)
✅ 2. Run Tests (workflow_run_tests)
⏳ 3. Commit Changes (workflow_commit) ← YOU ARE HERE
⬜ 4. Deploy to Production (workflow_deploy)
⬜ 5. Verify Production (workflow_verify_prod)
⬜ 6. Close Issue (workflow_close_issue)

Available actions:
  - workflow_commit

Step History:
✅ Start Issue - 11/16/2025, 12:15:34 PM
✅ Run Tests - 11/16/2025, 12:20:15 PM (54231ms)
```

### workflow_config
View or update configuration.

**Parameters:**
- `action`: `view` or `set`
- `config` (if action='set'): Configuration object

**Example:**
```javascript
// View current config
workflow_config({ action: "view" })

// Update config
workflow_config({
  action: "set",
  config: {
    template: "tests-only",
    production_verification: "none"
  }
})
```

## State Persistence

Workflow state is automatically saved to `.workflow/issue-{number}.json` after each step.

**Resume after restart:**
```javascript
workflow_start_issue({ issue_number: 68, resume: true })
```

**State includes:**
- Current step
- Timestamps
- Test results
- Commit hash
- Deployment ID
- Step history

## Audit Reports

Example audit report (`.workflow/reports/issue-68-report.md`):

```
📊 Workflow Completion Report - Issue #68
======================================================================

Issue: 🧪🔒 CRITICAL: Test Coverage for Payment & Webhook Handlers
Started: 2025-11-16T17:12:08.000Z
Completed: 2025-11-16T17:25:48.000Z
Duration: 0h 13m 40s

Steps Completed:
✅ Start Issue           - 2025-11-16T17:12:08.000Z
✅ Run Tests             - 2025-11-16T17:16:45.000Z (54231ms)
✅ Commit Changes        - 2025-11-16T17:21:30.000Z
✅ Deploy to Production  - 2025-11-16T17:23:26.000Z (116000ms)
✅ Verify Production     - 2025-11-16T17:25:36.000Z (8500ms)
✅ Close Issue           - 2025-11-16T17:25:48.000Z

Commits:
- d5cebf5: fix(tests): Fix payment handler tests - PostgreSQL compatibility

Attestation: All required workflow steps completed successfully.
Signed: workflow-enforcer v2.0.0
```

## Error Messages & Suggested Fixes

The workflow provides actionable error messages:

**Example 1: Missing deploy script**
```
❌ Deployment failed: ENOENT: no such file or directory './deploy.sh'

Suggested fixes:
1. Add "deploy": "your-deploy-command" to package.json scripts
2. Create ./deploy.sh script
3. Set deploy_method to "git-push" in .workflow-enforcer.json
```

**Example 2: Tests must pass before commit**
```
❌ Cannot commit. Current state: TESTS_FAILED

Tests must pass before committing.
Run workflow_run_tests first.
```

## Use Cases

### Enterprise Client Workflow
```json
{
  "mode": "strict",
  "template": "full-deployment",
  "deploy_method": "manual",
  "production_verification": "manual"
}
```
- All steps enforced
- Manual gates for deployment and verification
- Full audit trail for compliance

### CI/CD Automated Workflow
```json
{
  "mode": "strict",
  "template": "full-deployment",
  "deploy_method": "git-push",
  "production_verification": "smoke-test",
  "production_url": "https://api.example.com/health"
}
```
- Automated deployment via git push
- Quick smoke test verification
- Fast feedback loop

### Documentation Changes
```json
{
  "mode": "lenient",
  "template": "docs-only"
}
```
- No tests required
- No deployment required
- Quick commit and close

## Comparison: v1.0 vs v2.0

| Feature | v1.0 | v2.0 |
|---------|------|------|
| State Persistence | ❌ | ✅ Survives restarts |
| Pre-flight Checks | ❌ | ✅ Validates before start |
| Workflow Visualization | ❌ | ✅ Real-time progress |
| Audit Reports | ❌ | ✅ Automatic generation |
| Configuration | ❌ Hardcoded | ✅ Per-project |
| Templates | ❌ One size fits all | ✅ 3 templates |
| Error Messages | ⚠️ Generic | ✅ Actionable suggestions |
| Time Tracking | ❌ | ✅ Per-step duration |
| Resume Capability | ❌ | ✅ Resume from any step |

## FAQ

**Q: Can I skip a step in strict mode?**
A: No. Strict mode enforces all steps. Use lenient mode or a different template if you need flexibility.

**Q: What happens if Claude Code crashes mid-workflow?**
A: Use `workflow_start_issue({ issue_number: X, resume: true })` to resume from where you left off.

**Q: How do I use this with GitHub Actions?**
A: Set `deploy_method: "git-push"` and the workflow will treat the git push as deployment.

**Q: Can I have different workflows for different issue types?**
A: Yes! Configure different templates and switch via `workflow_config`.

**Q: Is the audit report admissible for compliance?**
A: The audit report provides a timestamped record of all workflow steps. Consult your compliance team for specific requirements.

**Q: What if my client requires a step that's not in the workflow?**
A: Contact the workflow-enforcer maintainer to add custom steps. The tool is designed to be extended.

## Troubleshooting

**Issue: "Failed to start issue"**
- Check: GitHub CLI installed (`gh --version`)
- Check: GitHub CLI authenticated (`gh auth status`)
- Check: Issue exists (`gh issue view {number}`)

**Issue: "Tests failed" but they pass locally**
- Check: Test command in config matches your local command
- Check: Environment variables set correctly
- Check: Dependencies installed (`npm install`)

**Issue: "Deployment failed"**
- Check: Deploy script exists and is executable
- Check: Deploy script path is correct in config
- Check: If using git-push, ensure remote is configured

## Support

For issues, feature requests, or questions:
- GitHub Issues: (your repo)
- MCP Documentation: https://modelcontextprotocol.io

## License

(Your license here)

---

**Built for compliance. Designed for real-world client workflows.**
