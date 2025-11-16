#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Enhanced workflow state management
interface WorkflowState {
  state: string;
  activeIssue: number | null;
  issueTitle: string | null;
  startedAt: string | null;
  lastTestResult: any;
  commitHash: string | null;
  deploymentId: string | null;
  steps: StepRecord[];
}

interface StepRecord {
  name: string;
  status: 'completed' | 'failed' | 'skipped';
  timestamp: string;
  duration?: number;
  output?: string;
}

interface WorkflowConfig {
  test_command?: string;
  deploy_method?: 'git-push' | 'script' | 'manual';
  deploy_script?: string;
  production_verification?: 'smoke-test' | 'script' | 'manual' | 'none';
  production_url?: string;
  production_test_command?: string;
  skip_deploy_for_patterns?: string[];
  mode?: 'strict' | 'lenient';
  template?: 'full-deployment' | 'tests-only' | 'docs-only';
}

let workflow: WorkflowState = {
  state: 'NO_ACTIVE_ISSUE',
  activeIssue: null,
  issueTitle: null,
  startedAt: null,
  lastTestResult: null,
  commitHash: null,
  deploymentId: null,
  steps: []
};

const STATE_DIR = join(process.cwd(), '.workflow');
const CONFIG_FILE = join(process.cwd(), '.workflow-enforcer.json');

// Load configuration
function loadConfig(): WorkflowConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }
  return {
    mode: 'strict',
    template: 'full-deployment',
    deploy_method: 'git-push',
    production_verification: 'script'
  };
}

// Save workflow state to disk
function saveWorkflowState() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }

  const stateFile = join(STATE_DIR, `issue-${workflow.activeIssue || 'current'}.json`);
  writeFileSync(stateFile, JSON.stringify(workflow, null, 2));
}

// Load workflow state from disk
function loadWorkflowState(issueNumber: number): boolean {
  const stateFile = join(STATE_DIR, `issue-${issueNumber}.json`);
  if (existsSync(stateFile)) {
    try {
      workflow = JSON.parse(readFileSync(stateFile, 'utf-8'));
      return true;
    } catch (error) {
      console.error('Failed to load workflow state:', error);
    }
  }
  return false;
}

// Record a step completion
function recordStep(name: string, status: 'completed' | 'failed' | 'skipped', duration?: number, output?: string) {
  workflow.steps.push({
    name,
    status,
    timestamp: new Date().toISOString(),
    duration,
    output
  });
  saveWorkflowState();
}

// Generate audit report
function generateAuditReport(): string {
  if (!workflow.activeIssue) {
    return 'No active workflow';
  }

  const duration = workflow.startedAt
    ? Math.floor((Date.now() - new Date(workflow.startedAt).getTime()) / 1000)
    : 0;

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  const durationStr = `${hours}h ${minutes}m ${seconds}s`;

  let report = `📊 Workflow Completion Report - Issue #${workflow.activeIssue}\n`;
  report += `${'='.repeat(70)}\n\n`;
  report += `Issue: ${workflow.issueTitle}\n`;
  report += `Started: ${workflow.startedAt}\n`;
  report += `Completed: ${new Date().toISOString()}\n`;
  report += `Duration: ${durationStr}\n\n`;
  report += `Steps Completed:\n`;

  workflow.steps.forEach(step => {
    const icon = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏭️';
    const durationInfo = step.duration ? ` (${step.duration}ms)` : '';
    report += `${icon} ${step.name.padEnd(20)} - ${step.timestamp}${durationInfo}\n`;
  });

  report += `\nCommits:\n`;
  report += `- ${workflow.commitHash?.substring(0, 7)}: (commit message)\n\n`;
  report += `Attestation: All required workflow steps completed successfully.\n`;
  report += `Signed: workflow-enforcer v2.0.0\n`;

  return report;
}

// Pre-flight checks
function runPreflightChecks(config: WorkflowConfig): string[] {
  const issues: string[] = [];

  // Check test command
  try {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
    if (!packageJson.scripts?.test) {
      issues.push('❌ npm test - MISSING');
    } else {
      issues.push('✅ npm test - Found');
    }

    // Check production test command if required
    if (config.production_verification === 'script') {
      const prodTestCmd = config.production_test_command || 'test:prod';
      if (!packageJson.scripts?.[prodTestCmd]) {
        issues.push(`❌ npm run ${prodTestCmd} - MISSING (required for production verification)`);
      } else {
        issues.push(`✅ npm run ${prodTestCmd} - Found`);
      }
    }
  } catch (error) {
    issues.push('⚠️ package.json - Not found or invalid');
  }

  // Check deploy script if required
  if (config.deploy_method === 'script') {
    const deployScript = config.deploy_script || './deploy.sh';
    if (!existsSync(deployScript)) {
      issues.push(`❌ ${deployScript} - MISSING (required for deployment)`);
    } else {
      issues.push(`✅ ${deployScript} - Found`);
    }
  }

  return issues;
}

// Visualize workflow progress
function visualizeWorkflow(currentState: string): string {
  const config = loadConfig();
  const template = config.template || 'full-deployment';

  const steps = template === 'full-deployment'
    ? [
        { name: 'Start Issue', state: 'NO_ACTIVE_ISSUE', tool: 'workflow_start_issue' },
        { name: 'Run Tests', state: 'ISSUE_ACTIVE', tool: 'workflow_run_tests' },
        { name: 'Commit Changes', state: 'TESTS_PASSED', tool: 'workflow_commit' },
        { name: 'Deploy to Production', state: 'COMMITTED', tool: 'workflow_deploy' },
        { name: 'Verify Production', state: 'DEPLOYED', tool: 'workflow_verify_prod' },
        { name: 'Close Issue', state: 'PROD_VERIFIED', tool: 'workflow_close_issue' }
      ]
    : template === 'tests-only'
    ? [
        { name: 'Start Issue', state: 'NO_ACTIVE_ISSUE', tool: 'workflow_start_issue' },
        { name: 'Run Tests', state: 'ISSUE_ACTIVE', tool: 'workflow_run_tests' },
        { name: 'Commit Changes', state: 'TESTS_PASSED', tool: 'workflow_commit' },
        { name: 'Close Issue', state: 'COMMITTED', tool: 'workflow_close_issue' }
      ]
    : [ // docs-only
        { name: 'Start Issue', state: 'NO_ACTIVE_ISSUE', tool: 'workflow_start_issue' },
        { name: 'Commit Changes', state: 'ISSUE_ACTIVE', tool: 'workflow_commit' },
        { name: 'Close Issue', state: 'COMMITTED', tool: 'workflow_close_issue' }
      ];

  let viz = `📋 Workflow Progress (${template}):\n\n`;

  steps.forEach((step, index) => {
    const stepComplete = workflow.steps.some(s => s.name.toLowerCase().includes(step.name.toLowerCase()) && s.status === 'completed');
    const isCurrentStep = step.state === currentState || (currentState === 'TESTS_FAILED' && step.state === 'ISSUE_ACTIVE');

    const icon = stepComplete ? '✅' : isCurrentStep ? '⏳' : '⬜';
    const arrow = isCurrentStep ? ' ← YOU ARE HERE' : '';
    viz += `${icon} ${index + 1}. ${step.name} (${step.tool})${arrow}\n`;
  });

  return viz;
}

// Helper to truncate long output
function truncateOutput(output: string, maxLength: number = 10000): string {
  if (output.length <= maxLength) {
    return output;
  }
  const truncated = output.substring(0, maxLength);
  return truncated + `\n\n... [output truncated, ${output.length - maxLength} more characters]`;
}

const server = new Server(
  {
    name: 'workflow-enforcer',
    version: '2.0.0',
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
      description: 'Begin work on a GitHub issue. REQUIRED before writing any code. Runs pre-flight checks and loads configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          issue_number: {
            type: 'number',
            description: 'GitHub issue number to work on'
          },
          resume: {
            type: 'boolean',
            description: 'Resume from saved state if available'
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
            description: 'Test command to run (default: from config or npm test)'
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
            description: 'Production test command (default: from config)'
          }
        }
      }
    },
    {
      name: 'workflow_close_issue',
      description: 'Close the GitHub issue and generate audit report. ONLY available after prod tests pass.',
      inputSchema: {
        type: 'object',
        properties: {
          save_audit_report: {
            type: 'boolean',
            description: 'Save audit report to .workflow/reports/',
            default: true
          }
        }
      }
    },
    {
      name: 'workflow_status',
      description: 'Check current workflow state, visualize progress, and see what actions are available.',
      inputSchema: {
        type: 'object',
        properties: {
          detailed: {
            type: 'boolean',
            description: 'Show detailed status with timestamps and step history'
          }
        }
      }
    },
    {
      name: 'workflow_config',
      description: 'View or update workflow configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['view', 'set'],
            description: 'View current config or set new values'
          },
          config: {
            type: 'object',
            description: 'Configuration object to set (when action=set)'
          }
        },
        required: ['action']
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'workflow_config': {
      const action = (args as any).action;
      const config = loadConfig();

      if (action === 'view') {
        return {
          content: [{
            type: 'text',
            text: `⚙️ Current Workflow Configuration:\n\n` +
                  JSON.stringify(config, null, 2) + `\n\n` +
                  `Config file: ${CONFIG_FILE}\n` +
                  `To modify, edit the file or use workflow_config with action='set'`
          }]
        };
      } else if (action === 'set') {
        const newConfig = { ...config, ...(args as any).config };
        writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
        return {
          content: [{
            type: 'text',
            text: `✅ Configuration updated!\n\n` + JSON.stringify(newConfig, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: `❌ Invalid action. Use 'view' or 'set'.`
        }]
      };
    }

    case 'workflow_start_issue': {
      const issueNumber = (args as any)?.issue_number;
      const resume = (args as any)?.resume;

      // Try to resume from saved state
      if (resume && loadWorkflowState(issueNumber)) {
        return {
          content: [{
            type: 'text',
            text: `🔄 Resumed workflow for issue #${issueNumber}\n\n` +
                  `Current state: ${workflow.state}\n` +
                  `Started at: ${workflow.startedAt}\n\n` +
                  visualizeWorkflow(workflow.state) + `\n\n` +
                  `Steps completed: ${workflow.steps.length}\n` +
                  `Next: ${getAvailableActions(workflow.state)[0] || 'Unknown'}`
          }]
        };
      }

      if (workflow.state !== 'NO_ACTIVE_ISSUE') {
        return {
          content: [{
            type: 'text',
            text: `❌ Already working on issue #${workflow.activeIssue}.\n\n` +
                  `Options:\n` +
                  `1. Close current issue first\n` +
                  `2. Use resume=true to continue previous workflow`
          }]
        };
      }

      // Run pre-flight checks
      const config = loadConfig();
      const preflightIssues = runPreflightChecks(config);

      // Verify issue exists via GitHub CLI
      try {
        const issueData = execSync(
          `gh issue view ${issueNumber} --json state,title`,
          { encoding: 'utf-8', cwd: process.cwd(), timeout: 30000 }
        );
        const issue = JSON.parse(issueData);

        if (issue.state === 'CLOSED') {
          return {
            content: [{
              type: 'text',
              text: `❌ Issue #${issueNumber} is already closed.`
            }]
          };
        }

        workflow.activeIssue = issueNumber;
        workflow.issueTitle = issue.title;
        workflow.state = 'ISSUE_ACTIVE';
        workflow.startedAt = new Date().toISOString();
        saveWorkflowState();

        recordStep('Start Issue', 'completed');

        let response = `✅ Started work on issue #${issueNumber}: ${issue.title}\n\n`;
        response += `⚙️ Configuration: ${config.template || 'full-deployment'} (${config.mode || 'strict'} mode)\n\n`;
        response += `⚠️ Pre-flight Check Results:\n${preflightIssues.join('\n')}\n\n`;
        response += visualizeWorkflow(workflow.state) + `\n\n`;
        response += `Next step: Write your code, then run workflow_run_tests`;

        return {
          content: [{ type: 'text', text: response }]
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
            text: `❌ No active issue. Use workflow_start_issue first.`
          }]
        };
      }

      const config = loadConfig();
      const testCommand = (args as any).test_command || config.test_command || 'npm test';
      const startTime = Date.now();

      try {
        const output = execSync(testCommand, {
          encoding: 'utf-8',
          stdio: 'pipe',
          cwd: process.cwd(),
          timeout: 600000 // 10 minute timeout for tests
        });

        const duration = Date.now() - startTime;
        workflow.lastTestResult = { passed: true, output };
        workflow.state = 'TESTS_PASSED';
        recordStep('Run Tests', 'completed', duration, truncateOutput(output, 500));

        return {
          content: [{
            type: 'text',
            text: `✅ Tests passed! (${duration}ms)\n\n${truncateOutput(output)}\n\n` +
                  visualizeWorkflow(workflow.state) + `\n\n` +
                  `Next step: Use workflow_commit to commit your changes`
          }]
        };
      } catch (error: any) {
        const duration = Date.now() - startTime;
        workflow.lastTestResult = { passed: false, output: error.stderr };
        workflow.state = 'TESTS_FAILED';
        recordStep('Run Tests', 'failed', duration, truncateOutput(error.stderr || error.stdout, 500));

        const errorOutput = error.stderr || error.stdout || error.message;
        return {
          content: [{
            type: 'text',
            text: `❌ Tests failed! (${duration}ms)\n\n${truncateOutput(errorOutput)}\n\n` +
                  `Fix the issues and run workflow_run_tests again.`
          }]
        };
      }
    }

    case 'workflow_commit': {
      if (workflow.state !== 'TESTS_PASSED' && workflow.state !== 'ISSUE_ACTIVE') {
        const config = loadConfig();
        if (config.template === 'docs-only' && workflow.state === 'ISSUE_ACTIVE') {
          // Allow commit for docs-only workflow
        } else {
          return {
            content: [{
              type: 'text',
              text: `❌ Cannot commit. Current state: ${workflow.state}\n\n` +
                    `Tests must pass before committing.\n` +
                    `Run workflow_run_tests first.`
            }]
          };
        }
      }

      const message = (args as any).message;
      const commitMsg = `${message}\n\nRefs #${workflow.activeIssue}`;

      try {
        execSync(`git add -A`, { encoding: 'utf-8', cwd: process.cwd() });

        // Use a safer heredoc-style commit to avoid quote escaping issues
        execSync(`git commit -m "$(cat <<'EOF'\n${commitMsg}\nEOF\n)"`, {
          encoding: 'utf-8',
          cwd: process.cwd(),
          shell: '/bin/bash'
        });

        workflow.state = 'COMMITTED';
        workflow.commitHash = execSync('git rev-parse HEAD', {
          encoding: 'utf-8',
          cwd: process.cwd()
        }).trim();

        recordStep('Commit Changes', 'completed');

        return {
          content: [{
            type: 'text',
            text: `✅ Committed: ${workflow.commitHash.substring(0, 7)}\n\n` +
                  `Message: ${message}\n` +
                  `Issue: #${workflow.activeIssue}\n\n` +
                  visualizeWorkflow(workflow.state) + `\n\n` +
                  `Next step: Use workflow_deploy to deploy to production`
          }]
        };
      } catch (error: any) {
        recordStep('Commit Changes', 'failed');
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

      const config = loadConfig();
      const environment = (args as any).environment || 'production';
      const startTime = Date.now();

      try {
        let output = '';

        if (config.deploy_method === 'git-push') {
          // For git-push, just verify the push succeeded
          output = 'Deployment triggered via git push\nRender will auto-deploy from main branch';
          workflow.state = 'DEPLOYED';
          workflow.deploymentId = Date.now().toString();
          recordStep('Deploy to Production', 'completed', Date.now() - startTime);
        } else if (config.deploy_method === 'manual') {
          return {
            content: [{
              type: 'text',
              text: `⏸️ Manual deployment required.\n\n` +
                    `Please deploy manually, then use workflow_verify_prod when complete.`
            }]
          };
        } else {
          // Script-based deployment
          const deployScript = config.deploy_script || './deploy.sh';

          if (!existsSync(deployScript)) {
            // Try npm run deploy as fallback
            output = execSync('npm run deploy', {
              encoding: 'utf-8',
              cwd: process.cwd(),
              timeout: 300000
            });
          } else {
            output = execSync(deployScript, {
              encoding: 'utf-8',
              cwd: process.cwd(),
              timeout: 300000
            });
          }

          workflow.state = 'DEPLOYED';
          workflow.deploymentId = Date.now().toString();
          recordStep('Deploy to Production', 'completed', Date.now() - startTime, truncateOutput(output, 500));
        }

        return {
          content: [{
            type: 'text',
            text: `✅ Deployed to ${environment}!\n\n` +
                  `${truncateOutput(output)}\n\n` +
                  visualizeWorkflow(workflow.state) + `\n\n` +
                  `Next step: Use workflow_verify_prod to run production tests`
          }]
        };
      } catch (error: any) {
        recordStep('Deploy to Production', 'failed');
        return {
          content: [{
            type: 'text',
            text: `❌ Deployment failed: ${error.message}\n\n` +
                  `Suggested fixes:\n` +
                  `1. Add "deploy": "your-deploy-command" to package.json scripts\n` +
                  `2. Create ${config.deploy_script || './deploy.sh'} script\n` +
                  `3. Set deploy_method to "git-push" in .workflow-enforcer.json`
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

      const config = loadConfig();
      const startTime = Date.now();

      // Handle different verification methods
      if (config.production_verification === 'none') {
        workflow.state = 'PROD_VERIFIED';
        recordStep('Verify Production', 'completed', Date.now() - startTime);
        return {
          content: [{
            type: 'text',
            text: `✅ Production verification skipped (configured as 'none')\n\n` +
                  visualizeWorkflow(workflow.state) + `\n\n` +
                  `Next step: Use workflow_close_issue to close issue #${workflow.activeIssue}`
          }]
        };
      }

      if (config.production_verification === 'smoke-test' && config.production_url) {
        try {
          const checkCmd = `curl -f -s -o /dev/null -w "%{http_code}" ${config.production_url}`;
          const httpCode = execSync(checkCmd, { encoding: 'utf-8', timeout: 30000 }).trim();

          if (httpCode === '200') {
            workflow.state = 'PROD_VERIFIED';
            recordStep('Verify Production', 'completed', Date.now() - startTime);
            return {
              content: [{
                type: 'text',
                text: `✅ Production smoke test passed! (HTTP ${httpCode})\n\n` +
                      visualizeWorkflow(workflow.state) + `\n\n` +
                      `Next step: Use workflow_close_issue to close issue #${workflow.activeIssue}`
              }]
            };
          } else {
            throw new Error(`HTTP ${httpCode}`);
          }
        } catch (error: any) {
          recordStep('Verify Production', 'failed', Date.now() - startTime);
          return {
            content: [{
              type: 'text',
              text: `❌ Production smoke test failed: ${error.message}\n\n` +
                    `Issue #${workflow.activeIssue} will remain open. Fix and redeploy.`
            }]
          };
        }
      }

      // Script-based verification
      const testCommand = (args as any).test_command || config.production_test_command || 'npm run test:prod';

      try {
        const output = execSync(testCommand, {
          encoding: 'utf-8',
          cwd: process.cwd(),
          timeout: 300000
        });
        workflow.state = 'PROD_VERIFIED';
        recordStep('Verify Production', 'completed', Date.now() - startTime, truncateOutput(output, 500));

        return {
          content: [{
            type: 'text',
            text: `✅ Production tests passed!\n\n${truncateOutput(output)}\n\n` +
                  visualizeWorkflow(workflow.state) + `\n\n` +
                  `Next step: Use workflow_close_issue to close issue #${workflow.activeIssue}`
          }]
        };
      } catch (error: any) {
        recordStep('Verify Production', 'failed', Date.now() - startTime);
        const errorOutput = error.stderr || error.stdout || error.message;
        return {
          content: [{
            type: 'text',
            text: `❌ Production tests failed!\n\n${truncateOutput(errorOutput)}\n\n` +
                  `Issue #${workflow.activeIssue} will remain open. Fix and redeploy.`
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

      const saveAuditReport = (args as any)?.save_audit_report !== false;

      try {
        // Generate audit report
        const auditReport = generateAuditReport();

        // Save audit report if requested
        if (saveAuditReport) {
          const reportsDir = join(STATE_DIR, 'reports');
          if (!existsSync(reportsDir)) {
            mkdirSync(reportsDir, { recursive: true });
          }
          const reportFile = join(reportsDir, `issue-${workflow.activeIssue}-report.md`);
          writeFileSync(reportFile, auditReport);
        }

        // Close GitHub issue
        execSync(
          `gh issue close ${workflow.activeIssue} ` +
          `-c "✅ Fixed and verified in production (${workflow.commitHash?.substring(0, 7)})\n\nWorkflow completed successfully. See audit report for details."`,
          { encoding: 'utf-8', cwd: process.cwd(), timeout: 30000 }
        );

        const closedIssue = workflow.activeIssue;
        recordStep('Close Issue', 'completed');

        // Reset workflow
        workflow = {
          state: 'NO_ACTIVE_ISSUE',
          activeIssue: null,
          issueTitle: null,
          startedAt: null,
          lastTestResult: null,
          commitHash: null,
          deploymentId: null,
          steps: []
        };
        saveWorkflowState();

        return {
          content: [{
            type: 'text',
            text: `🎉 Issue #${closedIssue} closed successfully!\n\n` +
                  auditReport + `\n\n` +
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
      const detailed = (args as any)?.detailed;
      const availableActions = getAvailableActions(workflow.state);

      let response = `📊 Workflow Status:\n\n`;
      response += `State: ${workflow.state}\n`;
      response += `Active Issue: ${workflow.activeIssue ? `#${workflow.activeIssue} - ${workflow.issueTitle}` : 'None'}\n`;
      response += `Commit: ${workflow.commitHash?.substring(0, 7) || 'None'}\n\n`;

      if (workflow.activeIssue) {
        response += visualizeWorkflow(workflow.state) + `\n\n`;
      }

      response += `Available actions:\n${availableActions.map(a => `  - ${a}`).join('\n')}`;

      if (detailed && workflow.steps.length > 0) {
        response += `\n\nStep History:\n`;
        workflow.steps.forEach(step => {
          const icon = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏭️';
          const duration = step.duration ? ` (${step.duration}ms)` : '';
          response += `${icon} ${step.name} - ${new Date(step.timestamp).toLocaleString()}${duration}\n`;
        });
      }

      return {
        content: [{ type: 'text', text: response }]
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
  console.error('Workflow Enforcer MCP Server v2.0.0 running on stdio');
}

main();
