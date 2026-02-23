import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';
import { Ollama, Tool, Message } from 'ollama';

const MAX_FILE_SIZE_BYTES = 512 * 1024;
const MAX_TOOL_ITERATIONS = 15;
const MAX_ACTION_RESULT_LENGTH = 200;

const KNOWN_TOOL_NAMES = new Set([
  'read_file', 'write_file', 'list_files', 'search_files',
  'git_status', 'git_diff', 'git_commit', 'git_revert', 'git_log',
]);

// --- Text-based tool call parser ---
// Many local models output tool calls as JSON text instead of using the
// structured tool_calls mechanism. This parser extracts them from content.

interface ParsedToolCall {
  name: string;
  arguments: Record<string, string>;
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
      case 'search_files': {
        const pattern = args.pattern || '';
        if (!pattern) return 'Error: pattern is required';
        const searchDir = sanitizeRelativePath(args.dir_path || '.') || '.';
        const fullSearchDir = path.join(repoPath, searchDir);
        if (!fs.existsSync(fullSearchDir)) return `Error: directory not found: ${searchDir}`;
        // Use git grep for fast, safe, .gitignore-aware search
        const globArg = args.file_glob ? ` -- ${JSON.stringify(args.file_glob)}` : '';
        try {
          const result = execSync(
            `git grep -n -I --max-count=50 -e ${JSON.stringify(pattern)}${globArg}`,
            { cwd: fullSearchDir, encoding: 'utf-8', timeout: 15000 }
          ).trim();
          return result || '(no matches)';
        } catch (err: any) {
          // git grep returns exit code 1 for no matches
          if (err.status === 1) return '(no matches)';
          return `Error: ${err.message || String(err)}`;
        }
      }
      case 'git_status':
        return execSync('git status --short', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(working tree clean)';
      case 'git_diff':
        return execSync('git diff', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(no changes)';
      case 'git_commit': {
        const message = args.message || 'Agent commit';
        execSync('git add -A', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
        if (!status) return 'Nothing to commit -- working tree is clean. No action needed.';
        execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        return `Changes committed: ${message}`;
      }
      case 'git_log': {
        const count = parseInt(args.count || '10', 10);
        const safeCount = Math.min(Math.max(1, count), 50);
        return execSync(`git log --oneline -n ${safeCount}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(no commits)';
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

// --- Agent workspace ---
// Warez/ = bare repos (the "GitHub hub"). Agent clones from warez, pushes to warez.
// Non-bare repos are converted to bare on first agent use.
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

function convertToBare(repoPath: string, actions: AgentAction[]): boolean {
  const tmpPath = repoPath + '-bare-tmp-' + Date.now();
  console.log(`[agent] Converting to bare repo: ${repoPath}`);
  try {
    execFileSync('git', ['clone', '--bare', repoPath, tmpPath],
      { encoding: 'utf-8', timeout: 60000 });
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.renameSync(tmpPath, repoPath);
    console.log(`[agent] Converted to bare repository`);
    actions.push({ tool: 'convert_to_bare', args: {}, result: 'Converted to bare repository' });
    return true;
  } catch (err: any) {
    // Clean up temp if it exists
    try { fs.rmSync(tmpPath, { recursive: true, force: true }); } catch { /* ignore */ }
    console.error(`[agent] Failed to convert to bare: ${err.message}`);
    actions.push({ tool: 'convert_to_bare', args: {}, result: `Error: ${err.message}` });
    return false;
  }
}

function ensureAgentWorkdir(warezPath: string, repoName: string, conversationId: string, actions: AgentAction[]): string {
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

  // Clone from warez (bare repo)
  console.log(`[agent] Cloning from warez: ${warezPath} → ${workdir}`);
  try {
    execFileSync('git', ['clone', warezPath, workdir],
      { encoding: 'utf-8', timeout: 60000 });
    console.log(`[agent] Cloned successfully`);
    actions.push({ tool: 'git_clone', args: { source: repoName }, result: 'Cloned from warez' });
  } catch (err: any) {
    console.error(`[agent] Clone failed: ${err.message}`);
    actions.push({ tool: 'git_clone', args: { source: repoName }, result: `Clone error: ${err.message}` });
    return ''; // empty string signals failure — caller checks with `if (!workdir)`
  }

  return workdir;
}

// Auto-init git for non-git directories, then convert to bare
function autoInitGit(repoPath: string, actions: AgentAction[]) {
  if (fs.existsSync(path.join(repoPath, '.git'))) return;
  console.log(`[agent] Initializing git in: ${repoPath}`);
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

function hasUncommittedChanges(repoPath: string): boolean {
  try {
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

function autoCommitChanges(repoPath: string, actions: AgentAction[]) {
  if (!hasUncommittedChanges(repoPath)) return;
  console.log(`[agent] Auto-committing uncommitted changes`);
  try {
    execSync('git add -A', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    execSync('git commit -m "Agent: auto-commit changes"', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    actions.push({ tool: 'git_commit', args: { message: 'Agent: auto-commit changes' }, result: 'Auto-committed uncommitted changes' });
  } catch {
    // ignore commit errors (e.g. nothing to commit)
  }
}

function pushToWarez(workdir: string, actions: AgentAction[]) {
  try {
    const branch = getCurrentBranch(workdir);
    if (!branch) return;
    console.log(`[agent] Pushing branch ${branch} to warez`);
    try {
      execFileSync('git', ['push', 'origin', branch],
        { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
    } catch {
      // Push rejected (non-fast-forward) — pull --rebase and retry once
      console.log(`[agent] Push rejected, attempting pull --rebase and retry`);
      try {
        execSync(`git pull --rebase origin ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
        execFileSync('git', ['push', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      } catch {
        // Rebase conflict — abort and force push as last resort
        try { execSync('git rebase --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* ignore */ }
        console.log(`[agent] Rebase failed, force pushing`);
        execFileSync('git', ['push', '--force-with-lease', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      }
    }
    actions.push({ tool: 'git_push', args: { branch }, result: `Pushed ${branch} to hub` });
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
  const actions: AgentAction[] = [];
  console.log(`[agent] Starting agent for repo="${repoName}" branch="${branch}" firstMessage=${isFirstMessage}`);
  const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
  const client = new Ollama({
    host: ollamaHost,
    fetch: (url: RequestInfo | URL, init?: RequestInit) => {
      return fetch(url, { ...init, signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT) });
    },
  });

  // Ensure warez repo is bare (convert if needed)
  if (!isBareRepo(repoPath)) {
    if (fs.existsSync(path.join(repoPath, '.git'))) {
      // Non-bare git repo → convert to bare
      if (!convertToBare(repoPath, actions)) {
        return { response: 'Error: could not convert repository to bare.', actions, currentBranch: '' };
      }
    } else {
      // Not a git repo at all → init + convert
      autoInitGit(repoPath, actions);
      if (!convertToBare(repoPath, actions)) {
        return { response: 'Error: could not initialize bare repository.', actions, currentBranch: '' };
      }
    }
  }

  // Clone from warez (bare) into agent workdir (per-conversation)
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
        actions.push({ tool: 'git_checkout', args: { branch }, result: `Switched to branch: ${branch}` });
      }
      // Always pull latest changes (even if already on the branch)
      try {
        console.log(`[agent] Pulling latest changes for branch: ${branch}`);
        execSync(`git pull --rebase origin ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      } catch {
        // Pull/rebase may fail due to conflicts or local-only branch
        // Abort any in-progress rebase to leave workdir clean
        try { execSync('git rebase --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* no rebase in progress */ }
        try { execSync('git merge --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* no merge in progress */ }
        console.log(`[agent] Pull failed (conflict or local-only branch), continuing with local state`);
      }
    } catch (err: any) {
      actions.push({ tool: 'git_checkout', args: { branch }, result: `Checkout error: ${err.message}` });
    }
  }

  // On first message: generate branch name and create it before the agent loop
  let createdBranch = '';
  if (isFirstMessage) {
    console.log(`[agent] Generating branch name from prompt...`);
    const branchName = await generateBranchName(client, model, userMessage);
    if (!/^[\w.\-]+$/.test(branchName)) {
      actions.push({ tool: 'git_create_branch', args: { branch_name: branchName }, result: 'Error: generated branch name is invalid' });
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
        actions.push({ tool: 'git_create_branch', args: { branch_name: uniqueName }, result: `Branch created: ${uniqueName}` });
      } catch (err: any) {
        actions.push({ tool: 'git_create_branch', args: { branch_name: uniqueName }, result: `Branch creation error: ${err.message}` });
      }
    }
  }

  const branchInfo = createdBranch
    ? `A new branch "${createdBranch}" has been automatically created for this task (parent: "${branch}").`
    : '';

  const systemPrompt = `You are NOA Code Agent — an AI assistant that can read, write, and manage code in local git repositories.
You are currently working with the repository "${repoName}" on branch "${createdBranch || getCurrentBranch(workdir)}".
${branchInfo}

WORKFLOW for code changes:
1. Explore the repository structure with list_files
2. Read relevant files to understand the codebase
3. Use search_files to find specific patterns, functions, or usages across files
4. Make changes with write_file
5. Verify with git_status and git_diff
6. Commit with git_commit
7. Use git_log to review recent commit history when needed

IMPORTANT RULES:
- Do NOT create new branches. The branch has already been created for you.
- After completing changes, describe exactly what you changed: which files were modified/created, what was added/removed.${createdBranch ? `\n- Mention that changes were made on branch "${createdBranch}".` : ''}
- When working with files, ALWAYS determine the programming language FIRST by file extension (${FILE_EXTENSION_LANGUAGES}), and only if the extension is ambiguous or missing, then by content (shebangs, syntax patterns). Write code in the same language as the file.
- When writing entire files, include ALL the content — do not use placeholders like "// rest of the code".
- You can revert to a previous commit using git_revert if needed (use git_log to find the commit hash).
- Always commit your changes with git_commit when done.

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
  let lastToolKey = '';
  let repeatCount = 0;
  const MAX_REPEAT_COUNT = 3;

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.chat({
        model,
        messages,
        tools: AGENT_TOOLS,
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

      lastResponse = response.message.content || '';

      // If no tool calls found (neither structured nor text), break out of loop
      if (toolCalls.length === 0) {
        break;
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
        actions.push({ tool: toolName, args: toolArgs, result: result.slice(0, MAX_ACTION_RESULT_LENGTH) });

        // Add tool result to conversation
        messages.push({ role: 'tool', content: result });
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
