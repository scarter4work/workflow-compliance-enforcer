# Build Workflow Enforcer MCP Server

## Overview
This guide will walk you through creating a complete MCP (Model Context Protocol) server that enforces a strict development workflow: Issue → Code → Test → Commit → Deploy → Prod Test → Close Issue.

## Project Setup

### 1. Create Project Directory

```bash
mkdir -p /home/scarter/mcp-servers/workflow-enforcer
cd /home/scarter/mcp-servers/workflow-enforcer
```

### 2. Initialize Node.js Project

```bash
npm init -y
```

### 3. Install Dependencies

```bash
npm install @modelcontextprotocol/sdk
npm install --save-dev @types/node typescript
```

### 4. Initialize TypeScript

```bash
npx tsc --init
```

## Project Structure

Create the following structure:

```
/home/scarter/mcp-servers/workflow-enforcer/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts
├── build/           (created by tsc)
│   └── index.js
└── node_modules/
```

## File Contents

### package.json

Replace the contents with:

```json
{
  "name": "workflow-enforcer",
  "version": "1.0.0",
  "type": "module",
  "description": "MCP server enforcing development workflow",
  "main": "build/index.js",
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "prepare": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### tsconfig.json

Replace the contents with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### src/index.ts

Create the main MCP server file:

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';

// Workflow state management
interface WorkflowState {
  state: string;
  activeIssue: number | null;
  lastTestResult: any;
  commitHash: string | null;
  deploymentId: string | null;
}

let workflow: WorkflowState = {
  state: 'NO_ACTIVE_ISSUE',
  activeIssue: null,
  lastTestResult: null,
  commitHash: null,
  deploymentId: null
};

const server = new Server(
  {
    name: 'workflow-enforcer',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'workflow_start_issue',
      description: 'Begin work on a GitHub issue. REQUIRED before writing any code.',
      inputSchema: {
        type: 'object',
        properties: {
          issue_number: {
            type: 'number',
            description: 'GitHub issue number to work on'
          }
        },
        required: ['issue_number']
      }
    },
    {
      name: 'workflow_run_tests',
      description: 'Run the test suite. REQUIRED after writing code, before committing.',
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
      name: 'workflow_commit',
      description: 'Commit code. ONLY available after tests pass.',
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Commit message'
          }
        },
        required: ['message']
      }
    },
    {
      name: 'workflow_deploy',
      description: 'Deploy to production. ONLY available after commit.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            description: 'Environment to deploy to',
            default: 'production'
          }
        }
      }
    },
    {
      name: 'workflow_verify_prod',
      description: 'Run production verification tests. REQUIRED after deploy.',
      inputSchema: {
        type: 'object',
        properties: {
          test_command: {
            type: 'string',
            description: 'Production test command (default: npm run test:prod)',
            default: 'npm run test:prod'
          }
        }
      }
    },
    {
      name: 'workflow_close_issue',
      description: 'Close the GitHub issue. ONLY available after prod tests pass.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'workflow_status',
      description: 'Check current workflow state and what actions are available.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'workflow_start_issue': {
      if (workflow.state !== 'NO_ACTIVE_ISSUE') {
        return {
          content: [{
            type: 'text',
            text: `❌ Already working on issue #${workflow.activeIssue}. Close it first.`
          }]
        };
      }

      // Verify issue exists via GitHub CLI
      try {
        const issueData = execSync(
          `gh issue view ${args.issue_number} --json state,title`,
          { encoding: 'utf-8' }
        );
        const issue = JSON.parse(issueData);

        if (issue.state === 'CLOSED') {
          return {
            content: [{
              type: 'text',
              text: `❌ Issue #${args.issue_number} is already closed.`
            }]
          };
        }

        workflow.activeIssue = args.issue_number;
        workflow.state = 'ISSUE_ACTIVE';

        return {
          content: [{
            type: 'text',
            text: `✅ Started work on issue #${args.issue_number}: ${issue.title}\n\n` +
                  `Next step: Write your code, then run workflow_run_tests`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `❌ Failed to start issue: ${error.message}\n\n` +
                  `Make sure the issue exists and you have GitHub CLI installed.`
          }]
        };
      }
    }

    case 'workflow_run_tests': {
      if (workflow.state === 'NO_ACTIVE_ISSUE') {
        return {
          content: [{
            type: 'text',
            text: `❌ No active issue. Use workflow_start_issue first.\n\n` +
                  `See the 'workflow-best-practices' skill for examples.`
          }]
        };
      }

      const testCommand = (args as any).test_command || 'npm test';

      try {
        const output = execSync(testCommand, {
          encoding: 'utf-8',
          stdio: 'pipe'
        });

        workflow.lastTestResult = { passed: true, output };
        workflow.state = 'TESTS_PASSED';

        return {
          content: [{
            type: 'text',
            text: `✅ Tests passed!\n\n${output}\n\n` +
                  `Next step: Use workflow_commit to commit your changes`
          }]
        };
      } catch (error: any) {
        workflow.lastTestResult = { passed: false, output: error.stderr };
        workflow.state = 'TESTS_FAILED';

        return {
          content: [{
            type: 'text',
            text: `❌ Tests failed!\n\n${error.stderr || error.stdout}\n\n` +
                  `Fix the issues and run workflow_run_tests again.`
          }]
        };
      }
    }

    case 'workflow_commit': {
      if (workflow.state !== 'TESTS_PASSED') {
        return {
          content: [{
            type: 'text',
            text: `❌ Cannot commit. Current state: ${workflow.state}\n\n` +
                  `Tests must pass before committing.\n` +
                  `Run workflow_run_tests first.`
          }]
        };
      }

      const message = (args as any).message;
      const commitMsg = `${message}\n\nRefs #${workflow.activeIssue}`;
      
      try {
        execSync(`git add -A`, { encoding: 'utf-8' });
        execSync(`git commit -m "${commitMsg}"`, { encoding: 'utf-8' });
        
        workflow.state = 'COMMITTED';
        workflow.commitHash = execSync('git rev-parse HEAD', { 
          encoding: 'utf-8' 
        }).trim();

        return {
          content: [{
            type: 'text',
            text: `✅ Committed: ${workflow.commitHash.substring(0, 7)}\n\n` +
                  `Message: ${message}\n` +
                  `Issue: #${workflow.activeIssue}\n\n` +
                  `Next step: Use workflow_deploy to deploy to production`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `❌ Commit failed: ${error.message}`
          }]
        };
      }
    }

    case 'workflow_deploy': {
      if (workflow.state !== 'COMMITTED') {
        return {
          content: [{
            type: 'text',
            text: `❌ Cannot deploy. Current state: ${workflow.state}\n\n` +
                  `You must commit before deploying.`
          }]
        };
      }

      const environment = (args as any).environment || 'production';

      try {
        // Look for deploy script in common locations
        let deployCommand = '';
        
        try {
          execSync('test -f ./deploy.sh', { encoding: 'utf-8' });
          deployCommand = './deploy.sh';
        } catch {
          try {
            execSync('test -f ./scripts/deploy.sh', { encoding: 'utf-8' });
            deployCommand = './scripts/deploy.sh';
          } catch {
            // Check package.json for deploy script
            deployCommand = 'npm run deploy';
          }
        }

        const output = execSync(deployCommand, { encoding: 'utf-8' });
        workflow.state = 'DEPLOYED';
        workflow.deploymentId = Date.now().toString();

        return {
          content: [{
            type: 'text',
            text: `✅ Deployed to ${environment}!\n\n` +
                  `${output}\n\n` +
                  `Next step: Use workflow_verify_prod to run production tests`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `❌ Deployment failed: ${error.message}\n\n` +
                  `Make sure you have a deploy script (./deploy.sh or npm run deploy)`
          }]
        };
      }
    }

    case 'workflow_verify_prod': {
      if (workflow.state !== 'DEPLOYED') {
        return {
          content: [{
            type: 'text',
            text: `❌ Cannot verify. Must deploy first.\n` +
                  `Current state: ${workflow.state}`
          }]
        };
      }

      const testCommand = (args as any).test_command || 'npm run test:prod';

      try {
        const output = execSync(testCommand, { encoding: 'utf-8' });
        workflow.state = 'PROD_VERIFIED';

        return {
          content: [{
            type: 'text',
            text: `✅ Production tests passed!\n\n${output}\n\n` +
                  `Next step: Use workflow_close_issue to close issue #${workflow.activeIssue}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `❌ Production tests failed!\n\n${error.stderr || error.stdout}\n\n` +
                  `Issue #${workflow.activeIssue} will remain open. ` +
                  `Fix and redeploy.`
          }]
        };
      }
    }

    case 'workflow_close_issue': {
      if (workflow.state !== 'PROD_VERIFIED') {
        return {
          content: [{
            type: 'text',
            text: `❌ Cannot close issue. Current state: ${workflow.state}\n\n` +
                  `Production tests must pass first.`
          }]
        };
      }

      try {
        execSync(
          `gh issue close ${workflow.activeIssue} ` +
          `-c "✅ Fixed and verified in production (${workflow.commitHash?.substring(0, 7)})"`,
          { encoding: 'utf-8' }
        );

        const closedIssue = workflow.activeIssue;
        
        // Reset workflow
        workflow = {
          state: 'NO_ACTIVE_ISSUE',
          activeIssue: null,
          lastTestResult: null,
          commitHash: null,
          deploymentId: null
        };

        return {
          content: [{
            type: 'text',
            text: `🎉 Issue #${closedIssue} closed successfully!\n\n` +
                  `Workflow complete. Ready for next issue.`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `❌ Failed to close issue: ${error.message}\n\n` +
                  `Make sure you have GitHub CLI installed and authenticated.`
          }]
        };
      }
    }

    case 'workflow_status': {
      const availableActions = getAvailableActions(workflow.state);
      
      return {
        content: [{
          type: 'text',
          text: `📊 Workflow Status:\n\n` +
                `State: ${workflow.state}\n` +
                `Active Issue: ${workflow.activeIssue || 'None'}\n` +
                `Commit: ${workflow.commitHash?.substring(0, 7) || 'None'}\n\n` +
                `Available actions:\n${availableActions.map(a => `  - ${a}`).join('\n')}`
        }]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

function getAvailableActions(state: string): string[] {
  const actions: Record<string, string[]> = {
    'NO_ACTIVE_ISSUE': ['workflow_start_issue'],
    'ISSUE_ACTIVE': ['workflow_run_tests'],
    'TESTS_FAILED': ['workflow_run_tests (fix code first)'],
    'TESTS_PASSED': ['workflow_commit'],
    'COMMITTED': ['workflow_deploy'],
    'DEPLOYED': ['workflow_verify_prod'],
    'PROD_VERIFIED': ['workflow_close_issue']
  };
  return actions[state] || [];
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Workflow Enforcer MCP Server running on stdio');
}

main();
```

## Build the Project

```bash
cd /home/scarter/mcp-servers/workflow-enforcer
npm run build
```

This will create `build/index.js` from your TypeScript source.

## Configure Claude Code

Edit `/home/scarter/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "workflow-enforcer": {
      "command": "node",
      "args": [
        "/home/scarter/mcp-servers/workflow-enforcer/build/index.js"
      ]
    }
  }
}
```

If the file doesn't exist, create it with the above content.

## Restart Claude Code

After configuration, restart Claude Code to load the MCP server.

## Verify Installation

Once Claude Code restarts, test the server:

```
workflow_status
```

You should see:
```
📊 Workflow Status:

State: NO_ACTIVE_ISSUE
Active Issue: None
Commit: None

Available actions:
  - workflow_start_issue
```

## Prerequisites

Make sure you have installed:

1. **Node.js** (v18 or higher)
   ```bash
   node --version
   ```

2. **GitHub CLI** (for issue management)
   ```bash
   gh --version
   gh auth login  # if not already authenticated
   ```

## Usage Example

```bash
# 1. Start work on an issue
workflow_start_issue(123)

# 2. Write your code using normal tools

# 3. Run tests
workflow_run_tests()

# 4. Commit (only works if tests passed)
workflow_commit("Add new feature")

# 5. Deploy
workflow_deploy()

# 6. Verify in production
workflow_verify_prod()

# 7. Close issue
workflow_close_issue()
```

## Customization

### Change Test Command

Default is `npm test`. Override in your project by passing `test_command`:

```
workflow_run_tests({ test_command: "yarn test" })
```

### Change Production Test Command

Default is `npm run test:prod`. Override:

```
workflow_verify_prod({ test_command: "curl https://myapp.com/health" })
```

### Change Deploy Script

The server looks for deploy scripts in this order:
1. `./deploy.sh`
2. `./scripts/deploy.sh`
3. `npm run deploy`

Create one of these in your project.

## Troubleshooting

### Check if MCP server is loaded

```
workflow_status
```

If this command isn't recognized, the server isn't loaded.

### View MCP logs

```bash
tail -f /home/scarter/.config/claude/logs/mcp-*.log
```

### Test the server manually

```bash
cd /home/scarter/mcp-servers/workflow-enforcer
node build/index.js
```

Should output: "Workflow Enforcer MCP Server running on stdio"

### Rebuild after changes

```bash
cd /home/scarter/mcp-servers/workflow-enforcer
npm run build
# Restart Claude Code
```

## Development Mode

For active development, use watch mode:

```bash
npm run watch
```

This rebuilds automatically when you change `src/index.ts`.

## Next Steps

After the MCP server is working, create the companion skill at:
`/mnt/skills/user/workflow-best-practices/SKILL.md`

This will provide context and examples to Claude Code about why the workflow exists and how to use it effectively.
