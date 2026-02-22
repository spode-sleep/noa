import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Ollama, Tool, Message } from 'ollama';

const MAX_FILE_SIZE_BYTES = 512 * 1024;
const MAX_TOOL_ITERATIONS = 15;
const MAX_ACTION_RESULT_LENGTH = 200;

const KNOWN_TOOL_NAMES = new Set([
  'read_file', 'write_file', 'list_files',
  'git_create_branch', 'git_status', 'git_diff', 'git_commit', 'git_revert',
]);

// --- Text-based tool call parser ---
// Many local models output tool calls as JSON text instead of using the
// structured tool_calls mechanism. This parser extracts them from content.

interface ParsedToolCall {
  name: string;
  arguments: Record<string, string>;
}

function parseToolCallsFromText(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = [];

  // Strip <tool_call> tags and markdown code fences
  const cleaned = text
    .replace(/<\/?tool_call>/g, '')
    .replace(/```(?:json)?\s*/g, '')
    .replace(/```/g, '');

  // Try to parse JSON objects starting at each '{' by tracking brace depth
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(cleaned.slice(i, j + 1));
            if (obj.name && KNOWN_TOOL_NAMES.has(obj.name)) {
              // Some models use "parameters" instead of "arguments"
              results.push({
                name: obj.name,
                arguments: obj.arguments || obj.parameters || {},
              });
            }
          } catch {
            // malformed JSON, skip
          }
          i = j; // skip past this object
          break;
        }
      }
    }
  }

  return results;
}

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
  {
    type: 'function',
    function: {
      name: 'git_revert',
      description: 'Revert the repository to a specific commit (hard reset). Use git_status to see recent changes first.',
      parameters: {
        type: 'object',
        properties: {
          commit_hash: { type: 'string', description: 'The commit hash to revert to' },
        },
        required: ['commit_hash'],
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
        if (stat.size > MAX_FILE_SIZE_BYTES) return 'Error: file too large (max 512KB)';
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
        if (!branch || !/^[\w.\-]+$/.test(branch)) return 'Error: invalid branch name';
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
      case 'git_revert': {
        const hash = args.commit_hash || '';
        if (!hash || !/^[a-f0-9]{4,40}$/i.test(hash)) return 'Error: invalid commit hash';
        execSync(`git reset --hard ${hash}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        return `Repository reverted to commit: ${hash}`;
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
  currentBranch: string;
}

// --- Main agent runner using official Ollama client ---

const AGENT_REQUEST_TIMEOUT = 300000; // 5 minutes per Ollama request

const FILE_EXTENSION_LANGUAGES = '.py=Python, .ts=TypeScript, .js=JavaScript, .jsx/.tsx=React, .rs=Rust, .go=Go, .java=Java, .cpp/.cc/.c/.h/.hpp=C/C++, .rb=Ruby, .lua=Lua, .php=PHP, .swift=Swift, .kt=Kotlin, .cs=C#, .sh/.bash=Shell, .json=JSON, .yaml/.yml=YAML, .toml=TOML, .xml=XML, .html/.htm=HTML, .css=CSS, .scss/.sass=SCSS/Sass, .sql=SQL, .md=Markdown, .fth/.fs/.4th=Forth, .hs=Haskell, .ex/.exs=Elixir, .erl=Erlang, .clj=Clojure, .scala=Scala, .r/.R=R, .jl=Julia, .pl/.pm=Perl, .zig=Zig, .nim=Nim, .dart=Dart, .v=V, .ml/.mli=OCaml, .lisp/.cl=Common Lisp, .scm=Scheme, .asm/.s=Assembly, .ps1=PowerShell, .bat/.cmd=Batch, .dockerfile/Dockerfile=Dockerfile, .tf=Terraform, .proto=Protobuf, .graphql/.gql=GraphQL, .vue=Vue, .svelte=Svelte';

function getCurrentBranch(repoPath: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

export async function runAgent(
  model: string,
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  repoPath: string,
  repoName: string,
  branch: string,
  isGitRepo: boolean,
  isFirstMessage: boolean,
): Promise<AgentResult> {
  const actions: AgentAction[] = [];
  const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
  const client = new Ollama({
    host: ollamaHost,
    fetch: (url: RequestInfo | URL, init?: RequestInit) => {
      return fetch(url, { ...init, signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT) });
    },
  });

  // Checkout the requested branch if specified and repo is a git repo
  if (isGitRepo && branch && /^[\w.\-/]+$/.test(branch)) {
    try {
      const currentBranch = getCurrentBranch(repoPath);
      if (currentBranch !== branch) {
        execSync(`git checkout ${branch}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        actions.push({ tool: 'git_checkout', args: { branch }, result: `Switched to branch: ${branch}` });
      }
    } catch (err: any) {
      actions.push({ tool: 'git_checkout', args: { branch }, result: `Checkout error: ${err.message}` });
    }
  }

  const systemPrompt = `You are NOA Code Agent — an AI assistant that can read, write, and manage code in local git repositories.
You are currently working with the repository "${repoName}"${branch ? ` on branch "${branch}"` : ''}.
${!isGitRepo ? 'This directory is NOT a git repository yet. Git will be auto-initialized when you use any git tool.' : ''}

WORKFLOW for code changes:
1. First, explore the repository structure with list_files
2. Read relevant files to understand the codebase
${isFirstMessage ? '3. MANDATORY: Create a new branch for your changes with git_create_branch BEFORE any write_file calls\n' : ''}4. Make changes with write_file
5. Verify with git_status
6. Commit with git_commit

IMPORTANT RULES:
${isFirstMessage ? '- You MUST create a new branch using git_create_branch before making any changes. This is required.\n- In your response, always mention the name of the new branch you created.\n' : '- A branch was already created in a previous message. Do NOT create new branches.\n'}- After completing changes, describe exactly what you changed: which files were modified/created, what was added/removed.
- When working with files, ALWAYS determine the programming language FIRST by file extension (${FILE_EXTENSION_LANGUAGES}), and only if the extension is ambiguous or missing, then by content (shebangs, syntax patterns). Write code in the same language as the file.
- You can revert to a previous commit using git_revert if needed.

Answer in the language the user writes in. Be concise about tool usage but explain what you're doing.`;

  // Only include git_create_branch on first message
  const tools = isFirstMessage
    ? AGENT_TOOLS
    : AGENT_TOOLS.filter(t => t.function.name !== 'git_create_branch');

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
        tools,
      });

      let toolCalls = response.message.tool_calls || [];
      let parsedFromText = false;

      // Fallback: parse tool calls from text content when model doesn't
      // use structured tool_calls (common with local models)
      if (toolCalls.length === 0 && response.message.content) {
        const parsed = parseToolCallsFromText(response.message.content);
        if (parsed.length > 0) {
          toolCalls = parsed.map(p => ({
            function: { name: p.name, arguments: p.arguments },
          }));
          parsedFromText = true;
        }
      }

      // If no tool calls found (neither structured nor text), return final response
      if (toolCalls.length === 0) {
        return {
          response: response.message.content || 'Done.',
          actions,
          currentBranch: getCurrentBranch(repoPath),
        };
      }

      // Add assistant message to history — preserve structured tool_calls
      // when available, use plain content when parsed from text
      if (parsedFromText) {
        messages.push({ role: 'assistant', content: response.message.content || '' });
      } else {
        messages.push(response.message);
      }

      // Execute each tool call
      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        const toolArgs = (tc.function.arguments || {}) as Record<string, string>;

        // Block branch creation after first message
        if (toolName === 'git_create_branch' && !isFirstMessage) {
          messages.push({ role: 'tool', content: 'Error: branch creation is only allowed in the first message' });
          continue;
        }

        // Auto-init git if needed before any git operation
        if (toolName.startsWith('git_')) {
          autoInitGit(repoPath, actions);
        }

        const result = executeTool(toolName, toolArgs, repoPath);
        actions.push({ tool: toolName, args: toolArgs, result: result.slice(0, MAX_ACTION_RESULT_LENGTH) });

        // Add tool result to conversation
        messages.push({ role: 'tool', content: result });
      }
    }

    // If we hit the iteration limit, return the last content
    return {
      response: 'Agent reached maximum iterations.',
      actions,
      currentBranch: getCurrentBranch(repoPath),
    };
  } catch (err: any) {
    return {
      response: `Agent error: ${err.message || String(err)}`,
      actions,
      currentBranch: getCurrentBranch(repoPath),
    };
  }
}
