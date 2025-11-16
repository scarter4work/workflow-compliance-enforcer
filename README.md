# Workflow Compliance Enforcer MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)

> **Enforce client-mandated development workflows with audit trails, state persistence, and compliance reporting.**

A Model Context Protocol (MCP) server designed for enterprise, government, and regulated industries where development workflows are **non-negotiable** and **compliance is critical**.

## Why This Exists

In enterprise consulting and government contracts, clients often mandate strict development workflows:
- ✅ Tests **must** pass before commit
- ✅ Code **must** be deployed before issue close
- ✅ Production **must** be verified
- ✅ Audit trail **must** exist for compliance

**This MCP server enforces those workflows** and provides proof of compliance.

## Features

### 🔒 Compliance-First
- **State Persistence** - Workflow survives Claude Code restarts
- **Audit Trails** - Automatic compliance reports with timestamps
- **Pre-flight Checks** - Validates required scripts before starting
- **Time Tracking** - Duration tracking for all steps

### 🎯 Workflow Management
- **Visual Progress** - Real-time workflow visualization
- **Multiple Templates** - Different workflows for different tasks
- **Resume Capability** - Pick up where you left off after crashes
- **Better Errors** - Actionable suggestions for common issues

### ⚙️ Configurable
- **Per-Project Config** - Different workflows for different projects
- **Deployment Methods** - Git-push, script-based, or manual
- **Verification Strategies** - Smoke test, script, manual, or none
- **Strict/Lenient Modes** - Enforce or warn

## Quick Start

### Installation

1. **Clone and build:**
```bash
git clone https://github.com/scarter4work/workflow-compliance-enforcer.git
cd workflow-compliance-enforcer
npm install
npm run build
```

2. **Add to Claude Code MCP config** (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "workflow-enforcer": {
      "command": "node",
      "args": ["/path/to/workflow-compliance-enforcer/build/index.js"]
    }
  }
}
```

3. **Restart Claude Code**

### Configuration

Create `.workflow-enforcer.json` in your project root:

```json
{
  "mode": "strict",
  "template": "full-deployment",
  "test_command": "npm test",
  "deploy_method": "git-push",
  "production_verification": "script",
  "production_test_command": "npm run test:prod"
}
```

## Usage

### Basic Workflow

```javascript
// 1. Start work on an issue
workflow_start_issue({ issue_number: 42 })

// 2. Write your code, then run tests
workflow_run_tests()

// 3. Commit (only works after tests pass)
workflow_commit({ message: "fix: resolve authentication bug" })

// 4. Deploy to production
workflow_deploy()

// 5. Verify production
workflow_verify_prod()

// 6. Close issue and generate audit report
workflow_close_issue()
```

### Resume After Crash

```javascript
// If Claude Code crashes mid-workflow
workflow_start_issue({ issue_number: 42, resume: true })
// Picks up exactly where you left off!
```

### Check Progress

```javascript
workflow_status({ detailed: true })
```

**Output:**
```
📊 Workflow Status:

State: TESTS_PASSED
Active Issue: #42 - Fix authentication bug
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
```

## Workflow Templates

### Full Deployment (default)
For production features requiring full release cycle:
1. Start Issue → 2. Run Tests → 3. Commit → 4. Deploy → 5. Verify → 6. Close

### Tests Only
For internal changes that don't need deployment:
1. Start Issue → 2. Run Tests → 3. Commit → 4. Close

### Docs Only
For documentation changes:
1. Start Issue → 2. Commit → 3. Close

## Audit Reports

Every completed workflow generates an audit report:

```
📊 Workflow Completion Report - Issue #42
======================================================================

Issue: Fix authentication bug
Started: 2025-11-16T12:00:00.000Z
Completed: 2025-11-16T12:45:30.000Z
Duration: 0h 45m 30s

Steps Completed:
✅ Start Issue           - 2025-11-16T12:00:00.000Z
✅ Run Tests             - 2025-11-16T12:15:00.000Z (12450ms)
✅ Commit Changes        - 2025-11-16T12:20:00.000Z
✅ Deploy to Production  - 2025-11-16T12:35:00.000Z (145000ms)
✅ Verify Production     - 2025-11-16T12:43:00.000Z (8200ms)
✅ Close Issue           - 2025-11-16T12:45:30.000Z

Commits:
- a1b2c3d: fix: resolve authentication bug

Attestation: All required workflow steps completed successfully.
Signed: workflow-enforcer v2.0.0
```

Saved to `.workflow/reports/issue-42-report.md` for compliance purposes.

## Configuration Options

| Option | Values | Description |
|--------|--------|-------------|
| `mode` | `strict`, `lenient` | Strict = enforced; Lenient = warnings |
| `template` | `full-deployment`, `tests-only`, `docs-only` | Workflow to use |
| `test_command` | string | Test command (default: `npm test`) |
| `deploy_method` | `git-push`, `script`, `manual` | How to deploy |
| `production_verification` | `smoke-test`, `script`, `manual`, `none` | How to verify |

See [WORKFLOW_ENFORCER_V2.md](./WORKFLOW_ENFORCER_V2.md) for complete documentation.

## Use Cases

### Enterprise Client
```json
{
  "mode": "strict",
  "template": "full-deployment",
  "deploy_method": "manual",
  "production_verification": "manual"
}
```
Manual gates for deployment and verification with full audit trail.

### CI/CD Automation
```json
{
  "mode": "strict",
  "template": "full-deployment",
  "deploy_method": "git-push",
  "production_verification": "smoke-test",
  "production_url": "https://api.example.com/health"
}
```
Automated deployment with quick smoke test verification.

### Internal Development
```json
{
  "mode": "lenient",
  "template": "tests-only"
}
```
Skip deployment for internal changes, but still enforce tests.

## Available Tools

- `workflow_start_issue` - Begin work with pre-flight checks
- `workflow_run_tests` - Run test suite with duration tracking
- `workflow_commit` - Commit code (only after tests pass)
- `workflow_deploy` - Deploy to production
- `workflow_verify_prod` - Verify production deployment
- `workflow_close_issue` - Close issue and generate audit report
- `workflow_status` - Check current workflow state
- `workflow_config` - View/update configuration

## Requirements

- Node.js 18+
- GitHub CLI (`gh`) for issue management
- Claude Code with MCP support

## Comparison: v1.0 vs v2.0

| Feature | v1.0 | v2.0 |
|---------|------|------|
| State Persistence | ❌ | ✅ |
| Pre-flight Checks | ❌ | ✅ |
| Workflow Visualization | ❌ | ✅ |
| Audit Reports | ❌ | ✅ |
| Configuration | ❌ Hardcoded | ✅ Per-project |
| Templates | ❌ One size fits all | ✅ 3 templates |
| Error Messages | ⚠️ Generic | ✅ Actionable |
| Time Tracking | ❌ | ✅ |
| Resume Capability | ❌ | ✅ |

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

For major changes, please open an issue first.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues:** [GitHub Issues](https://github.com/scarter4work/workflow-compliance-enforcer/issues)
- **Documentation:** [Full Docs](./WORKFLOW_ENFORCER_V2.md)
- **MCP Docs:** [Model Context Protocol](https://modelcontextprotocol.io)

## Acknowledgments

Built with [Model Context Protocol](https://modelcontextprotocol.io) by Anthropic.

---

**Built for compliance. Designed for real-world client workflows.**
