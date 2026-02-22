import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Ollama, Tool, Message } from 'ollama';

// --- Path safety ---

function sanitizeRelativePath(relPath: string): string | null {
  const normalized = path.normalize(relPath);
  if (path.isAbsolute(normalized) || normalized.startsWith('..')) return null;
  if (normalized.includes('.git' + path.sep) || normalized === '.git') return null;
  return normalized;
}

// --- Tool definitions for Ollama ---

const AGENT_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the repository',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path to the file from repository root' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file in the repository (creates or overwrites)',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path to the file from repository root' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories at a given path in the repository',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { type: 'string', description: 'Relative directory path from repository root (use "." for root)' },
        },
        required: ['dir_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_create_branch',
      description: 'Create a new git branch and switch to it',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: 'Name of the new branch' },
        },
        required: ['branch_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Show the current git status (changed, staged, untracked files)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show the diff of current uncommitted changes',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Stage all changes and commit with a message',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
        },
        required: ['message'],
      },
    },
  },
];

// --- Tool execution ---

function executeTool(toolName: string, args: Record<string, string>, repoPath: string): string {
  try {
    switch (toolName) {
      case 'read_file': {
        const rel = sanitizeRelativePath(args.file_path || '');
        if (!rel) return 'Error: invalid file path';
        const fullPath = path.join(repoPath, rel);
        if (!fs.existsSync(fullPath)) return `Error: file not found: ${rel}`;
        const stat = fs.statSync(fullPath);
        if (stat.size > 512 * 1024) return 'Error: file too large (max 512KB)';
        return fs.readFileSync(fullPath, 'utf-8');
      }
      case 'write_file': {
        const rel = sanitizeRelativePath(args.file_path || '');
        if (!rel) return 'Error: invalid file path';
        const fullPath = path.join(repoPath, rel);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, args.content || '', 'utf-8');
        return `File written: ${rel}`;
      }
      case 'list_files': {
        const rel = sanitizeRelativePath(args.dir_path || '.');
        if (!rel) return 'Error: invalid directory path';
        const fullPath = path.join(repoPath, rel);
        if (!fs.existsSync(fullPath)) return `Error: directory not found: ${rel}`;
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        return entries
          .filter(e => e.name !== '.git')
          .map(e => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`)
          .sort()
          .join('\n') || '(empty directory)';
      }
      case 'git_create_branch': {
        const branch = args.branch_name || '';
        if (!branch || !/^[\w.\-/]+$/.test(branch)) return 'Error: invalid branch name';
        execSync(`git checkout -b ${branch}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        return `Branch created and checked out: ${branch}`;
      }
      case 'git_status':
        return execSync('git status --short', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(working tree clean)';
      case 'git_diff':
        return execSync('git diff', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(no changes)';
      case 'git_commit': {
        const message = args.message || 'Agent commit';
        execSync('git add -A', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        return `Changes committed: ${message}`;
      }
      default:
        return `Error: unknown tool: ${toolName}`;
    }
  } catch (err: any) {
    return `Error: ${err.message || String(err)}`;
  }
}

// Auto-init git for non-git directories
function autoInitGit(repoPath: string, actions: AgentAction[]) {
  if (fs.existsSync(path.join(repoPath, '.git'))) return;
  try {
    execSync('git init', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    execSync('git add -A', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    execSync('git commit -m "Initial commit" --allow-empty', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    actions.push({ tool: 'git_init', args: {}, result: 'Git initialized with initial commit' });
  } catch (err: any) {
    actions.push({ tool: 'git_init', args: {}, result: `Git init error: ${err.message}` });
  }
}

// --- Agent types ---

export interface AgentAction {
  tool: string;
  args: Record<string, string>;
  result: string;
}

export interface AgentResult {
  response: string;
  actions: AgentAction[];
}

// --- Main agent runner using official Ollama client ---

const MAX_TOOL_ITERATIONS = 15;

export async function runAgent(
  model: string,
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  repoPath: string,
  repoName: string,
  branch: string,
  isGitRepo: boolean,
): Promise<AgentResult> {
  const actions: AgentAction[] = [];
  const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
  const client = new Ollama({ host: ollamaHost });

  const systemPrompt = `You are NOA Code Agent — an AI assistant that can read, write, and manage code in local git repositories.
You are currently working with the repository "${repoName}"${branch ? ` on branch "${branch}"` : ''}.
${!isGitRepo ? 'This directory is NOT a git repository yet. Git will be auto-initialized when you use any git tool.' : ''}

WORKFLOW for code changes:
1. First, explore the repository structure with list_files
2. Read relevant files to understand the codebase
3. Create a new branch for your changes with git_create_branch
4. Make changes with write_file
5. Verify with git_status
6. Commit with git_commit

Answer in the language the user writes in. Be concise about tool usage but explain what you're doing.`;

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.chat({
        model,
        messages,
        tools: AGENT_TOOLS,
      });

      // If no tool calls, return the final response
      if (!response.message.tool_calls || response.message.tool_calls.length === 0) {
        return {
          response: response.message.content || 'Done.',
          actions,
        };
      }

      // Add assistant message with tool calls to history
      messages.push(response.message);

      // Execute each tool call
      for (const tc of response.message.tool_calls) {
        const toolName = tc.function.name;
        const toolArgs = (tc.function.arguments || {}) as Record<string, string>;

        // Auto-init git if needed before any git operation
        if (toolName.startsWith('git_')) {
          autoInitGit(repoPath, actions);
        }

        const result = executeTool(toolName, toolArgs, repoPath);
        actions.push({ tool: toolName, args: toolArgs, result: result.slice(0, 200) });

        // Add tool result to conversation
        messages.push({ role: 'tool', content: result });
      }
    }

    // If we hit the iteration limit, return the last content
    return {
      response: 'Agent reached maximum iterations.',
      actions,
    };
  } catch (err: any) {
    return {
      response: `Agent error: ${err.message || String(err)}`,
      actions,
    };
  }
}
