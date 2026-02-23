import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';
import { Ollama, Tool, Message } from 'ollama';

const MAX_FILE_SIZE_BYTES = 512 * 1024;
const MAX_TOOL_ITERATIONS = 20;
const MAX_ACTION_RESULT_LENGTH = 200;
const MAX_TOOL_RESULT_CHARS = 8000;
const MAX_SEARCH_RESULTS = 50;
const MAX_GIT_LOG_COUNT = 50;
const MAX_RUN_COMMAND_TIMEOUT = 30000;
const MAX_TREE_ENTRIES_PER_DIR = 30;
const ALLOWED_COMMANDS = ['npm', 'npx', 'node', 'python', 'python3', 'pip', 'pip3', 'make', 'cargo', 'go', 'gcc', 'g++', 'javac', 'java', 'ruby', 'perl', 'cat', 'head', 'tail', 'wc', 'sort', 'grep', 'find', 'ls', 'pwd', 'echo', 'test', 'diff', 'patch'];
const SHELL_METACHARACTERS = /[;|&`$(){}><\n\r]/;
const EXCLUDED_TREE_DIRS = ['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build', '.next'];
const AGENT_GIT_AUTHOR = 'AI Librarian <ai-librarian@box.local>';

const KNOWN_TOOL_NAMES = new Set([
  'read_file', 'write_file', 'edit_file', 'list_files', 'search_files',
  'run_command', 'git_status', 'git_diff', 'git_commit', 'git_revert', 'git_log',
]);

// --- Text-based tool call parser ---
// Many local models output tool calls as JSON text instead of using the
// structured tool_calls mechanism. This parser extracts them from content.

interface ParsedToolCall {
  name: string;
  arguments: Record<string, string>;
}

interface ParseResult {
  toolCalls: ParsedToolCall[];
  segments: Array<{ type: 'thinking'; content: string } | { type: 'tool'; toolIndex: number }>;
}

// Escape literal newlines/tabs/CRs inside JSON string values.
// Local models often output multiline content with literal line breaks
// inside JSON strings, which makes JSON.parse fail.
function escapeJsonStringLiterals(text: string): string {
  let result = '';
  let inStr = false;
  let esc = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (esc) { result += ch; esc = false; continue; }
    if (ch === '\\' && inStr) { result += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; result += ch; continue; }
    if (inStr) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

function parseToolCallsFromText(text: string): ParseResult {
  const toolCalls: ParsedToolCall[] = [];
  const segments: ParseResult['segments'] = [];

  // Strip <tool_call> tags and markdown code fences
  const cleaned = text
    .replace(/<\/?tool_call>/g, '')
    .replace(/```(?:json)?\s*/g, '')
    .replace(/```/g, '');

  // Track positions of found tool call JSON blocks
  const toolSpans: Array<{ start: number; end: number; toolIndex: number }> = [];

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
            const jsonStr = cleaned.slice(i, j + 1);
            let obj;
            try {
              obj = JSON.parse(jsonStr);
            } catch {
              // Literal newlines inside JSON strings are invalid; try escaping them
              obj = JSON.parse(escapeJsonStringLiterals(jsonStr));
            }
            if (obj.name && KNOWN_TOOL_NAMES.has(obj.name)) {
              // Some models use "parameters" instead of "arguments"
              const toolIndex = toolCalls.length;
              toolCalls.push({
                name: obj.name,
                arguments: obj.arguments || obj.parameters || {},
              });
              toolSpans.push({ start: i, end: j + 1, toolIndex });
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

  // Build interleaved segments: thinking text between tool calls
  let pos = 0;
  for (const span of toolSpans) {
    const thinking = cleaned.slice(pos, span.start).trim();
    if (thinking) {
      segments.push({ type: 'thinking', content: thinking });
    }
    segments.push({ type: 'tool', toolIndex: span.toolIndex });
    pos = span.end;
  }
  // Trailing thinking after the last tool call
  const trailing = cleaned.slice(pos).trim();
  if (trailing) {
    segments.push({ type: 'thinking', content: trailing });
  }

  return { toolCalls, segments };
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
      description: 'Write content to a file in the repository (creates or overwrites). Use for NEW files or when rewriting the entire file.',
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
      name: 'edit_file',
      description: 'Make a targeted edit to an existing file by replacing a specific text block. More efficient than write_file for small changes. The old_text must match EXACTLY (including whitespace and indentation).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path to the file from repository root' },
          old_text: { type: 'string', description: 'The exact text block to find and replace (must match exactly)' },
          new_text: { type: 'string', description: 'The replacement text' },
        },
        required: ['file_path', 'old_text', 'new_text'],
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
      name: 'search_files',
      description: 'Search for a text pattern (regex supported) across files in the repository. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text or regex pattern to search for' },
          dir_path: { type: 'string', description: 'Relative directory to search in (use "." for entire repository)' },
          file_glob: { type: 'string', description: 'Optional glob to filter files, e.g. "*.ts", "*.py"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command in the repository directory. Use for builds, tests, linters, or any command-line operation. Commands are restricted to a safe allowlist.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute (e.g. "npm test", "python main.py", "make build")' },
        },
        required: ['command'],
      },
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
      name: 'git_log',
      description: 'Show recent commit history (last 10 commits by default)',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'string', description: 'Number of commits to show (default: 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_revert',
      description: 'Revert the repository to a specific commit (hard reset). Use git_log to find commits first.',
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

interface ToolResult {
  text: string;
  diff?: { before: string; after: string };
}

/** Force git to re-read file mtimes and detect changes made within the same second (racy git fix) */
function refreshGitIndex(repoPath: string) {
  try { execSync('git update-index --refresh', { cwd: repoPath, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }); } catch {}
}

function executeTool(toolName: string, args: Record<string, string>, repoPath: string): ToolResult {
  try {
    switch (toolName) {
      case 'read_file': {
        const rel = sanitizeRelativePath(args.file_path || '');
        if (!rel) return { text: 'Error: invalid file path' };
        const fullPath = path.join(repoPath, rel);
        if (!fs.existsSync(fullPath)) return { text: `Error: file not found: ${rel}` };
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE_BYTES) return { text: 'Error: file too large (max 512KB)' };
        return { text: fs.readFileSync(fullPath, 'utf-8') };
      }
      case 'write_file': {
        const rel = sanitizeRelativePath(args.file_path || '');
        if (!rel) return { text: 'Error: invalid file path' };
        const fullPath = path.join(repoPath, rel);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const before = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
        const after = args.content || '';
        fs.writeFileSync(fullPath, after, 'utf-8');
        return { text: `File written: ${rel}`, diff: { before, after } };
      }
      case 'edit_file': {
        const rel = sanitizeRelativePath(args.file_path || '');
        if (!rel) return { text: 'Error: invalid file path' };
        const fullPath = path.join(repoPath, rel);
        if (!fs.existsSync(fullPath)) return { text: `Error: file not found: ${rel}` };
        const oldText = args.old_text || '';
        const newText = args.new_text ?? '';
        if (!oldText) return { text: 'Error: old_text is required' };
        const content = fs.readFileSync(fullPath, 'utf-8');
        const idx = content.indexOf(oldText);
        if (idx === -1) return { text: `Error: old_text not found in ${rel}. Make sure the text matches exactly including whitespace.` };
        // Ensure only one occurrence to avoid ambiguous edits
        const secondIdx = content.indexOf(oldText, idx + 1);
        if (secondIdx !== -1) return { text: `Error: old_text matches multiple locations in ${rel}. Include more surrounding context to make it unique.` };
        const updated = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
        fs.writeFileSync(fullPath, updated, 'utf-8');
        const lineCount = oldText.split('\n').length;
        return { text: `File edited: ${rel} (replaced ${lineCount} ${lineCount === 1 ? 'line' : 'lines'})`, diff: { before: oldText, after: newText } };
      }
      case 'list_files': {
        const rel = sanitizeRelativePath(args.dir_path || '.');
        if (!rel) return { text: 'Error: invalid directory path' };
        const fullPath = path.join(repoPath, rel);
        if (!fs.existsSync(fullPath)) return { text: `Error: directory not found: ${rel}` };
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const listing = entries
          .filter(e => e.name !== '.git')
          .map(e => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`)
          .sort()
          .join('\n') || '(empty directory)';
        return { text: listing };
      }
      case 'search_files': {
        const pattern = args.pattern || '';
        if (!pattern) return { text: 'Error: pattern is required' };
        const searchDir = sanitizeRelativePath(args.dir_path || '.') || '.';
        const fullSearchDir = path.join(repoPath, searchDir);
        if (!fs.existsSync(fullSearchDir)) return { text: `Error: directory not found: ${searchDir}` };
        const grepArgs = ['grep', '-n', '-I', `--max-count=${MAX_SEARCH_RESULTS}`, '-e', pattern];
        if (args.file_glob) grepArgs.push('--', args.file_glob);
        try {
          const result = execFileSync('git', grepArgs,
            { cwd: fullSearchDir, encoding: 'utf-8', timeout: 15000 }
          ).trim();
          return { text: result || '(no matches)' };
        } catch (err: any) {
          if (err.status === 1) return { text: '(no matches)' };
          return { text: `Error: ${err.message || String(err)}` };
        }
      }
      case 'run_command': {
        const cmd = (args.command || '').trim();
        if (!cmd) return { text: 'Error: command is required' };
        if (SHELL_METACHARACTERS.test(cmd)) {
          return { text: 'Error: command contains forbidden shell characters (;|&`$(){}><). Use simple commands only.' };
        }
        const baseCmd = cmd.split(/\s+/)[0].replace(/^\.\//, '');
        if (!ALLOWED_COMMANDS.includes(baseCmd)) {
          return { text: `Error: command "${baseCmd}" is not allowed. Allowed: ${ALLOWED_COMMANDS.join(', ')}` };
        }
        try {
          const result = execSync(cmd, {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: MAX_RUN_COMMAND_TIMEOUT,
            env: { ...process.env, CI: 'true' },
          });
          return { text: result.trim() || '(command completed with no output)' };
        } catch (err: any) {
          const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
          return { text: output || `Error: command failed with exit code ${err.status}` };
        }
      }
      case 'git_status':
        refreshGitIndex(repoPath);
        return { text: execSync('git status --short', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(working tree clean)' };
      case 'git_diff':
        refreshGitIndex(repoPath);
        return { text: execSync('git diff', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(no changes)' };
      case 'git_commit': {
        const message = args.message || 'Agent commit';
        refreshGitIndex(repoPath);
        execSync('git add -A', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
        if (!status) return { text: 'Nothing to commit -- working tree is clean. No action needed.' };
        execSync(`git commit --author=${JSON.stringify(AGENT_GIT_AUTHOR)} -m ${JSON.stringify(message)}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        return { text: `Changes committed: ${message}` };
      }
      case 'git_log': {
        const count = parseInt(args.count || '10', 10);
        const safeCount = Math.min(Math.max(1, count), MAX_GIT_LOG_COUNT);
        return { text: execSync(`git log --oneline -n ${safeCount}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(no commits)' };
      }
      case 'git_revert': {
        const hash = args.commit_hash || '';
        if (!hash || !/^[a-f0-9]{4,40}$/i.test(hash)) return { text: 'Error: invalid commit hash' };
        execSync(`git reset --hard ${hash}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        return { text: `Repository reverted to commit: ${hash}` };
      }
      default:
        return { text: `Error: unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    return { text: `Error: ${err.message || String(err)}` };
  }
}

// --- Agent workspace ---
// Warez/ = git repos (standard .git). Agent clones from warez, pushes to warez.
// Non-bare repos accept pushes via receive.denyCurrentBranch=updateInstead.
// Agent workdirs live in <data>/agent-workdirs/<repo>.

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const WORKDIR_BASE = path.join(dataPath, 'agent-workdirs');

export function isBareRepo(repoPath: string): boolean {
  return !fs.existsSync(path.join(repoPath, '.git')) &&
         fs.existsSync(path.join(repoPath, 'HEAD'));
}

function getWorkdir(repoName: string, conversationId: string): string {
  return path.join(WORKDIR_BASE, `${repoName}-${conversationId}`);
}

export function cleanupWorkdir(repoName: string, conversationId: string): boolean {
  const workdir = getWorkdir(repoName, conversationId);
  if (fs.existsSync(workdir)) {
    console.log(`[agent] Cleaning up workdir: ${workdir}`);
    fs.rmSync(workdir, { recursive: true, force: true });
    return true;
  }
  return false;
}

export function cleanupWorkdirsForConversation(conversationId: string): number {
  if (!fs.existsSync(WORKDIR_BASE)) return 0;
  let count = 0;
  const entries = fs.readdirSync(WORKDIR_BASE, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(`-${conversationId}`)) {
      const fullPath = path.join(WORKDIR_BASE, entry.name);
      console.log(`[agent] Cleaning up workdir: ${fullPath}`);
      fs.rmSync(fullPath, { recursive: true, force: true });
      count++;
    }
  }
  return count;
}

// Allow pushes to non-bare repos by setting receive.denyCurrentBranch=updateInstead
function ensureReceivePush(repoPath: string): boolean {
  try {
    execFileSync('git', ['config', 'receive.denyCurrentBranch', 'updateInstead'],
      { cwd: repoPath, encoding: 'utf-8', timeout: 5000 });
    console.log(`[agent] Set receive.denyCurrentBranch=updateInstead on: ${repoPath}`);
    return true;
  } catch (err: any) {
    console.error(`[agent] Failed to set receive config: ${err.message}`);
    return false;
  }
}

function ensureAgentWorkdir(warezPath: string, repoName: string, conversationId: string, actions: AgentStep[]): string {
  const workdir = getWorkdir(repoName, conversationId);

  // If clone already exists, fetch latest from warez
  if (fs.existsSync(path.join(workdir, '.git'))) {
    console.log(`[agent] Workdir exists, fetching origin: ${workdir}`);
    try {
      execSync('git fetch origin', { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
    } catch {
      // fetch may fail, continue
    }
    return workdir;
  }

  // If directory exists but is not a git clone (corrupted), remove and re-clone
  if (fs.existsSync(workdir)) {
    console.log(`[agent] Workdir exists but no .git — removing and re-cloning: ${workdir}`);
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  // Create workdir base
  if (!fs.existsSync(WORKDIR_BASE)) {
    fs.mkdirSync(WORKDIR_BASE, { recursive: true });
  }

  // Clone from warez repo
  console.log(`[agent] Cloning from warez: ${warezPath} → ${workdir}`);
  try {
    execFileSync('git', ['clone', warezPath, workdir],
      { encoding: 'utf-8', timeout: 60000 });
    console.log(`[agent] Cloned successfully`);
    actions.push({ type: 'tool', tool: 'git_clone', args: { source: repoName }, result: 'Cloned from warez' });
  } catch (err: any) {
    console.error(`[agent] Clone failed: ${err.message}`);
    actions.push({ type: 'tool', tool: 'git_clone', args: { source: repoName }, result: `Clone error: ${err.message}` });
    return ''; // empty string signals failure — caller checks with `if (!workdir)`
  }

  return workdir;
}

// Auto-init git for non-git directories and enable push support
function autoInitGit(repoPath: string, actions: AgentStep[]) {
  if (fs.existsSync(path.join(repoPath, '.git'))) return;
  console.log(`[agent] Initializing git in: ${repoPath}`);
  try {
    execSync('git init', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    execSync('git add -A', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    execSync(`git commit --author=${JSON.stringify(AGENT_GIT_AUTHOR)} -m "Initial commit" --allow-empty`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    ensureReceivePush(repoPath);
    actions.push({ type: 'tool', tool: 'git_init', args: {}, result: 'Git initialized with initial commit' });
  } catch (err: any) {
    actions.push({ type: 'tool', tool: 'git_init', args: {}, result: `Git init error: ${err.message}` });
  }
}

// --- Agent types ---

// Truncate large tool results to prevent token overflow
function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  const half = Math.floor(MAX_TOOL_RESULT_CHARS / 2);
  return result.slice(0, half) + `\n\n... (truncated ${result.length - MAX_TOOL_RESULT_CHARS} chars) ...\n\n` + result.slice(-half);
}

// Compact repo tree for context (max 2 levels deep, excludes common non-code dirs)
function getRepoTreeOverview(repoPath: string, prefix = '', depth = 0): string {
  if (depth > 2) return '';
  try {
    const entries = fs.readdirSync(repoPath, { withFileTypes: true })
      .filter(e => !EXCLUDED_TREE_DIRS.includes(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_TREE_ENTRIES_PER_DIR);
    let tree = '';
    for (const entry of entries) {
      tree += `${prefix}${entry.isDirectory() ? '📁 ' : '   '}${entry.name}\n`;
      if (entry.isDirectory() && depth < 2) {
        tree += getRepoTreeOverview(path.join(repoPath, entry.name), prefix + '  ', depth + 1);
      }
    }
    return tree;
  } catch {
    return '';
  }
}

export interface AgentStep {
  type: 'thinking' | 'tool';
  content?: string;
  tool?: string;
  args?: Record<string, string>;
  result?: string;
  diff?: { before: string; after: string };
}

export interface AgentResult {
  response: string;
  actions: AgentStep[];
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

function hasUncommittedChanges(repoPath: string): boolean {
  try {
    refreshGitIndex(repoPath);
    const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function sanitizeBranchName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')  // replace non-alphanumeric chars with hyphens
    .replace(/-+/g, '-')            // collapse consecutive hyphens
    .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
}

async function generateBranchName(client: Ollama, model: string, userMessage: string): Promise<string> {
  try {
    const response = await client.chat({
      model,
      messages: [
        {
          role: 'system',
          content: 'Generate a short git branch name (2-4 words, kebab-case, lowercase, no special characters except hyphens) that describes the task. Respond with ONLY the branch name, nothing else. Examples: add-binary-search, fix-login-bug, update-readme, refactor-api-routes',
        },
        { role: 'user', content: userMessage },
      ],
    });
    const name = sanitizeBranchName(response.message.content || '');
    if (name.length >= 3 && name.length <= 60) return name;
  } catch {
    // fallback below
  }
  // Fallback: generate from timestamp
  return `agent-${Date.now().toString(36)}`;
}

function autoCommitChanges(repoPath: string, actions: AgentStep[]) {
  try {
    // Always stage everything first, then check
    refreshGitIndex(repoPath);
    execSync('git add -A', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
    if (!status) return;
    console.log(`[agent] Auto-committing uncommitted changes`);
    execSync(`git commit --author=${JSON.stringify(AGENT_GIT_AUTHOR)} -m "Agent: auto-commit changes"`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    actions.push({ type: 'tool', tool: 'git_commit', args: { message: 'Agent: auto-commit changes' }, result: 'Auto-committed uncommitted changes' });
  } catch (err: any) {
    console.error(`[agent] Auto-commit failed: ${err.message || String(err)}`);
  }
  // Safety check: warn if changes still remain
  if (hasUncommittedChanges(repoPath)) {
    console.warn(`[agent] WARNING: uncommitted changes still present after auto-commit`);
  }
}

function pushToWarez(workdir: string, actions: AgentStep[]) {
  try {
    const branch = getCurrentBranch(workdir);
    if (!branch) return;
    // Check if there are any commits to push (local ahead of remote or no upstream)
    let hasUnpushed = false;
    try {
      const log = execSync(`git log origin/${branch}..HEAD --oneline`, { cwd: workdir, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
      hasUnpushed = log.length > 0;
    } catch {
      // No upstream tracking branch yet — means everything is unpushed
      hasUnpushed = true;
    }
    if (!hasUnpushed) return;
    console.log(`[agent] Pushing branch ${branch} to warez`);
    try {
      execFileSync('git', ['push', '-u', 'origin', branch],
        { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
    } catch {
      // Push rejected (non-fast-forward) — pull --rebase and retry once
      console.log(`[agent] Push rejected, attempting pull --rebase and retry`);
      try {
        execSync(`git pull --rebase origin ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
        execFileSync('git', ['push', '-u', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      } catch {
        // Rebase conflict — abort and force push as last resort
        try { execSync('git rebase --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* ignore */ }
        console.log(`[agent] Rebase failed, force pushing`);
        execFileSync('git', ['push', '--force-with-lease', '-u', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      }
    }
    actions.push({ type: 'tool', tool: 'git_push', args: { branch }, result: `Pushed ${branch} to hub` });
  } catch (err: any) {
    console.error(`[agent] Push failed: ${err.message}`);
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
  conversationId: string,
): Promise<AgentResult> {
  const actions: AgentStep[] = [];
  console.log(`[agent] Starting agent for repo="${repoName}" branch="${branch}" firstMessage=${isFirstMessage}`);
  const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
  const client = new Ollama({
    host: ollamaHost,
    fetch: (url: RequestInfo | URL, init?: RequestInit) => {
      return fetch(url, { ...init, signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT) });
    },
  });

  // Ensure warez repo is git-initialized and accepts pushes
  if (!isBareRepo(repoPath)) {
    if (fs.existsSync(path.join(repoPath, '.git'))) {
      // Existing non-bare git repo → just enable push support
      ensureReceivePush(repoPath);
    } else {
      // Not a git repo at all → init with standard .git + enable push
      autoInitGit(repoPath, actions);
    }
  }

  // Clone from warez into agent workdir (per-conversation)
  const workdir = ensureAgentWorkdir(repoPath, repoName, conversationId, actions);
  if (!workdir) {
    return { response: 'Error: could not create agent workspace.', actions, currentBranch: '' };
  }

  // Checkout the requested branch if specified
  if (branch && /^[\w.\-/]+$/.test(branch)) {
    try {
      const currentBranch = getCurrentBranch(workdir);
      if (currentBranch !== branch) {
        console.log(`[agent] Checking out branch: ${branch}`);
        // Try local branch first, then remote tracking branch
        try {
          execSync(`git checkout ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
        } catch {
          execSync(`git checkout -b ${branch} origin/${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
        }
        actions.push({ type: 'tool', tool: 'git_checkout', args: { branch }, result: `Switched to branch: ${branch}` });
      }
      // Always pull latest changes (even if already on the branch)
      try {
        console.log(`[agent] Pulling latest changes for branch: ${branch}`);
        const pullOutput = execSync(`git pull --rebase origin ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
        actions.push({ type: 'tool', tool: 'git_pull', args: { branch }, result: pullOutput.trim() || 'Already up to date' });
      } catch {
        // Pull/rebase may fail due to conflicts or local-only branch
        // Abort any in-progress rebase to leave workdir clean
        try { execSync('git rebase --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* no rebase in progress */ }
        try { execSync('git merge --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* no merge in progress */ }
        console.log(`[agent] Pull failed (conflict or local-only branch), continuing with local state`);
      }
    } catch (err: any) {
      actions.push({ type: 'tool', tool: 'git_checkout', args: { branch }, result: `Checkout error: ${err.message}` });
    }
  }

  // On first message: generate branch name and create it before the agent loop
  let createdBranch = '';
  if (isFirstMessage) {
    console.log(`[agent] Generating branch name from prompt...`);
    const branchName = await generateBranchName(client, model, userMessage);
    if (!/^[\w.\-]+$/.test(branchName)) {
      actions.push({ type: 'tool', tool: 'git_create_branch', args: { branch_name: branchName }, result: 'Error: generated branch name is invalid' });
    } else {
      let uniqueName = branchName;
      try {
        // Ensure unique branch name by appending numeric suffix if it already exists
        const existingBranches = execSync('git branch --list', { cwd: workdir, encoding: 'utf-8' })
          .split('\n').map(b => b.replace(/^\*?\s+/, '').trim()).filter(Boolean);
        let suffix = 2;
        while (existingBranches.includes(uniqueName)) {
          uniqueName = `${branchName}-${suffix++}`;
        }
        execFileSync('git', ['checkout', '-b', uniqueName], { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
        createdBranch = uniqueName;
        console.log(`[agent] Created branch: ${uniqueName}`);
        actions.push({ type: 'tool', tool: 'git_create_branch', args: { branch_name: uniqueName }, result: `Branch created: ${uniqueName}` });
      } catch (err: any) {
        actions.push({ type: 'tool', tool: 'git_create_branch', args: { branch_name: uniqueName }, result: `Branch creation error: ${err.message}` });
      }
    }
  }

  const branchInfo = createdBranch
    ? `A new branch "${createdBranch}" has been automatically created for this task (parent: "${branch}").`
    : '';

  // Get compact repo overview for context on first message
  const repoTree = isFirstMessage ? getRepoTreeOverview(workdir) : '';
  const treeSection = repoTree ? `\nREPOSITORY STRUCTURE:\n${repoTree}` : '';

  const systemPrompt = `You are AI Librarian Code Agent — an AI assistant that can read, write, and manage code in local git repositories.
You are currently working with the repository "${repoName}" on branch "${createdBranch || getCurrentBranch(workdir)}".
${branchInfo}
${treeSection}
WORKFLOW (follow in order):
1. UNDERSTAND: Read relevant files and explore the codebase before making any changes
2. PLAN: Think about what changes are needed and explain your approach
3. IMPLEMENT: Make changes using edit_file for targeted edits or write_file for new files
4. VERIFY: Check your changes with git_status and git_diff, and run tests/builds with run_command if applicable
5. COMMIT: Always commit with git_commit when done

TOOL SELECTION GUIDE:
- edit_file: For modifying EXISTING files — replaces a specific text block (search/replace). More precise than write_file.
- write_file: For CREATING new files or when the entire file needs rewriting
- search_files: To find where functions/variables/patterns are used across the codebase
- run_command: To execute builds, tests, linters (e.g. "npm test", "python -m pytest", "make build")
- list_files: To explore directory structure
- read_file: To read file contents

IMPORTANT RULES:
- Do NOT create new branches. The branch has already been created for you.
- After completing changes, describe exactly what you changed: which files were modified/created, what was added/removed.${createdBranch ? `\n- Mention that changes were made on branch "${createdBranch}".` : ''}
- When working with files, ALWAYS determine the programming language FIRST by file extension (${FILE_EXTENSION_LANGUAGES}), and only if the extension is ambiguous or missing, then by content (shebangs, syntax patterns). Write code in the same programming language as the file.
- When writing entire files, include ALL the content — do not use placeholders like "// rest of the code".
- Prefer edit_file over write_file for existing files — it is safer and preserves unchanged parts.
- If a tool returns an error, explain what went wrong and try a different approach. If edit_file fails twice, switch to write_file.
- Do NOT re-read a file right after editing it — the edit_file/write_file result already confirms the change. Move on to the next task.
- Do NOT read the same file more than once in a row — you already have its content from the first read. Use the content you received immediately.
- AVOID loops of tool calls: if you find yourself calling the same tools repeatedly, STOP and either try a different approach or finish up.
- Every tool call MUST make concrete progress toward completing the task. If a tool call wouldn't change anything, don't make it.
- You can revert to a previous commit using git_revert if needed (use git_log to find the commit hash).
- ALWAYS commit your changes with git_commit before finishing. If there is any diff (git_diff shows changes), you MUST commit. Never leave uncommitted changes.
- Make small, focused, atomic changes. Avoid mixing unrelated changes in one edit.
- YOUR FINAL TOOL CALL MUST be git_commit if you made ANY file changes. Check with git_status first. Absolutely no uncommitted changes may remain. Push happens automatically after you finish.

Answer in the language the user writes in. Be concise about tool usage but explain what you're doing.`;

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let lastResponse = '';
  const recentToolNames: string[] = []; // Track tool name history for cycle detection
  let lastToolKey = '';
  let repeatCount = 0;
  const MAX_REPEAT_COUNT = 3;
  const WRAP_UP_THRESHOLD = Math.floor(MAX_TOOL_ITERATIONS * 0.75);

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // Inject "wrap up" hint when running low on iterations
      if (i === WRAP_UP_THRESHOLD) {
        messages.push({ role: 'system', content: `You have ${MAX_TOOL_ITERATIONS - i} iterations remaining. Wrap up: commit your changes and finish.` });
      }

      const response = await client.chat({
        model,
        messages,
        tools: AGENT_TOOLS,
      });

      let toolCalls = response.message.tool_calls || [];
      let parsedFromText = false;
      let parsedSegments: ParseResult['segments'] = [];

      // Fallback: parse tool calls from text content when model doesn't
      // use structured tool_calls (common with local models)
      if (toolCalls.length === 0 && response.message.content) {
        const parsed = parseToolCallsFromText(response.message.content);
        if (parsed.toolCalls.length > 0) {
          toolCalls = parsed.toolCalls.map(p => ({
            function: { name: p.name, arguments: p.arguments },
          }));
          parsedFromText = true;
          parsedSegments = parsed.segments;
        }
      }

      lastResponse = response.message.content || '';

      // If no tool calls found (neither structured nor text), this is
      // the final message — don't add it as thinking, just break
      if (toolCalls.length === 0) {
        break;
      }

      // Capture inner monologue between tool calls (only for intermediate iterations)
      const addThinkingParagraphs = (text: string) => {
        for (const para of text.split(/\n\n+/)) {
          const trimmed = para.trim();
          if (trimmed) actions.push({ type: 'thinking', content: trimmed });
        }
      };
      if (parsedFromText && parsedSegments.length > 0) {
        for (const seg of parsedSegments) {
          if (seg.type === 'thinking' && seg.content) addThinkingParagraphs(seg.content);
        }
      } else if (lastResponse.trim()) {
        addThinkingParagraphs(lastResponse);
      }

      // Detect repeated identical tool calls to prevent infinite loops
      const toolKey = toolCalls.map(tc => `${tc.function.name}(${JSON.stringify(tc.function.arguments)})`).join(';');
      if (toolKey === lastToolKey) {
        repeatCount++;
        if (repeatCount >= MAX_REPEAT_COUNT) {
          console.log(`[agent] Breaking loop: same tool call repeated ${repeatCount + 1} times`);
          break;
        }
      } else {
        lastToolKey = toolKey;
        repeatCount = 0;
      }

      // Detect cycling patterns (e.g. read→edit→read→edit)
      for (const tc of toolCalls) {
        recentToolNames.push(tc.function.name);
      }
      // Keep bounded: only need last 9 names max (cycleLen 3 × 3 repetitions)
      while (recentToolNames.length > 9) recentToolNames.shift();

      let cycleDetected = false;
      for (const cycleLen of [2, 3]) {
        if (recentToolNames.length < cycleLen * 3) continue;
        const window = recentToolNames.slice(-cycleLen * 3);
        const chunk1 = window.slice(0, cycleLen).join(',');
        const chunk2 = window.slice(cycleLen, cycleLen * 2).join(',');
        const chunk3 = window.slice(cycleLen * 2, cycleLen * 3).join(',');
        if (chunk1 === chunk2 && chunk1 === chunk3) {
          console.log(`[agent] Breaking loop: detected cycle pattern [${chunk1}] repeating 3 times`);
          messages.push({ role: 'system', content: `You are stuck in a loop (${chunk1} repeating). Stop and try a completely different approach, or commit what you have and finish.` });
          cycleDetected = true;
          break;
        }
      }
      if (cycleDetected) break;

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

        console.log(`[agent] Tool: ${toolName}(${Object.values(toolArgs).join(', ')})`);
        const result = executeTool(toolName, toolArgs, workdir);
        actions.push({ type: 'tool', tool: toolName, args: toolArgs, result: result.text.slice(0, MAX_ACTION_RESULT_LENGTH), diff: result.diff });

        // Add tool result to conversation
        // For text-parsed tool calls, use 'user' role so the model actually sees the result
        // (models may ignore 'tool' role when they didn't emit structured tool_calls)
        const resultRole = parsedFromText ? 'user' : 'tool';
        const resultContent = parsedFromText
          ? `[Tool result for ${toolName}]: ${truncateToolResult(result.text)}`
          : truncateToolResult(result.text);
        messages.push({ role: resultRole, content: resultContent });
      }
    }

    // Auto-commit any uncommitted changes
    autoCommitChanges(workdir, actions);

    // Push to warez (bare repo)
    pushToWarez(workdir, actions);

    console.log(`[agent] Done. Branch: ${getCurrentBranch(workdir)}, actions: ${actions.length}`);
    return {
      response: lastResponse || 'Done.',
      actions,
      currentBranch: getCurrentBranch(workdir),
    };
  } catch (err: any) {
    console.error(`[agent] Error: ${err.message || String(err)}`);
    // Auto-commit even on error
    autoCommitChanges(workdir, actions);
    pushToWarez(workdir, actions);

    return {
      response: `Agent error: ${err.message || String(err)}`,
      actions,
      currentBranch: getCurrentBranch(workdir),
    };
  }
}
