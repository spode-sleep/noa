import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync, spawn } from 'child_process';

const AGENT_GIT_AUTHOR = 'AI Librarian <ai-librarian@box.local>';
const AIDER_TIMEOUT_MS = 600000; // 10 minutes max per aider invocation
const MAX_OUTPUT_CHARS = 50000; // Max chars to capture from aider output

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

// --- Utility functions ---

/** Force git to re-read file mtimes and detect changes made within the same second (racy git fix) */
function refreshGitIndex(repoPath: string) {
  try { execSync('git update-index --refresh', { cwd: repoPath, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }); } catch {}
}

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
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function autoCommitChanges(repoPath: string, actions: AgentStep[]) {
  try {
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
  if (hasUncommittedChanges(repoPath)) {
    console.warn(`[agent] WARNING: uncommitted changes still present after auto-commit`);
  }
}

function pushToWarez(workdir: string, actions: AgentStep[]) {
  try {
    const branch = getCurrentBranch(workdir);
    if (!branch) return;
    let hasUnpushed = false;
    try {
      const log = execSync(`git log origin/${branch}..HEAD --oneline`, { cwd: workdir, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
      hasUnpushed = log.length > 0;
    } catch {
      hasUnpushed = true;
    }
    if (!hasUnpushed) return;
    console.log(`[agent] Pushing branch ${branch} to warez`);
    try {
      execFileSync('git', ['push', '-u', 'origin', branch],
        { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
    } catch {
      console.log(`[agent] Push rejected, attempting pull --rebase and retry`);
      try {
        execSync(`git pull --rebase origin ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
        execFileSync('git', ['push', '-u', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      } catch {
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

// --- Aider integration ---

function resolveAiderPath(): string {
  const envPath = process.env.AIDER_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  // Try to find aider in PATH
  try {
    return execSync('which aider', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'aider'; // fallback — let spawn try PATH lookup
  }
}

function buildAiderModelArg(model: string): string {
  // If model already has a provider prefix (e.g. "ollama/model"), use as-is
  if (model.includes('/')) {
    // Aider expects "ollama_chat/<model>" for Ollama models
    if (!model.startsWith('ollama_chat/') && !model.startsWith('openai/') &&
        !model.startsWith('anthropic/') && !model.startsWith('ollama/')) {
      return `ollama_chat/${model}`;
    }
    // Convert ollama/ to ollama_chat/ for aider
    if (model.startsWith('ollama/')) {
      return `ollama_chat/${model.slice(7)}`;
    }
    return model;
  }
  // Default: assume Ollama model
  return `ollama_chat/${model}`;
}

/** Aider boilerplate lines that should be skipped in output parsing */
const AIDER_BOILERPLATE_RE = /^(Aider v|Analytics |You can skip|\.aider\*?|\.gitignore$|No files matched|Warning:|Updating|Main model:|Weak model:|Editor model:|Git diffs|Dropped|Use \/|Tokens:|Model:|─|Git repo|Repo-map|Added \.aider|Diff since)/;

/** Extract ► THINKING sections from aider stdout as thinking steps */
function extractThinkingSections(output: string): AgentStep[] {
  const steps: AgentStep[] = [];
  const sectionRegex = /[-─]+\s*►\s*(THINKING|ANSWER)\s*/g;
  if (!sectionRegex.test(output)) return steps;
  sectionRegex.lastIndex = 0;

  let lastIndex = 0;
  let lastType = 'raw';
  let match;
  while ((match = sectionRegex.exec(output)) !== null) {
    if (lastType === 'thinking' && match.index > lastIndex) {
      const content = output.slice(lastIndex, match.index).trim();
      if (content) {
        const cleaned = content.split('\n').filter(l => !AIDER_BOILERPLATE_RE.test(l.trim())).join('\n').trim();
        if (cleaned) steps.push({ type: 'thinking', content: cleaned });
      }
    }
    lastType = match[1] === 'THINKING' ? 'thinking' : 'answer';
    lastIndex = match.index + match[0].length;
  }
  if (lastType === 'thinking' && lastIndex < output.length) {
    const content = output.slice(lastIndex).trim();
    if (content) {
      const cleaned = content.split('\n').filter(l => !AIDER_BOILERPLATE_RE.test(l.trim())).join('\n').trim();
      if (cleaned) steps.push({ type: 'thinking', content: cleaned });
    }
  }
  return steps;
}

/** Parse a unified diff hunk into before/after text */
function parseUnifiedDiffHunks(diffOutput: string): { before: string; after: string } {
  const before: string[] = [];
  const after: string[] = [];
  for (const line of diffOutput.split('\n')) {
    if (line.startsWith('@@')) continue;
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('diff --git')) continue;
    if (line.startsWith('index ')) continue;
    if (line.startsWith('new file') || line.startsWith('deleted file')) continue;
    if (line.startsWith('-')) {
      before.push(line.slice(1));
    } else if (line.startsWith('+')) {
      after.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    }
  }
  return { before: before.join('\n'), after: after.join('\n') };
}

/** Build timeline steps from git state: commits + per-file diffs since oldSha */
function buildStepsFromGit(workdir: string, oldSha: string): AgentStep[] {
  const steps: AgentStep[] = [];
  const resolvedWorkdir = path.resolve(workdir);

  // Get commits made since oldSha
  try {
    const log = execSync(`git log --oneline ${oldSha}..HEAD`, { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    if (log) {
      for (const line of log.split('\n')) {
        if (line.trim()) {
          steps.push({ type: 'tool', tool: 'git_commit', args: {}, result: `Commit ${line.trim()}` });
        }
      }
    }
  } catch { /* no new commits — that's fine */ }

  // Get per-file diffs since oldSha (committed changes)
  try {
    const changedFiles = execSync(`git diff --name-only ${oldSha}..HEAD`, { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    if (changedFiles) {
      for (const file of changedFiles.split('\n')) {
        if (!file.trim()) continue;
        try {
          const fileDiff = execSync(`git diff ${oldSha}..HEAD -- ${JSON.stringify(file)}`, { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 });
          const { before, after } = parseUnifiedDiffHunks(fileDiff);
          steps.push({
            type: 'tool',
            tool: before ? 'edit_file' : 'write_file',
            args: { file_path: file },
            result: `${before ? 'Applied edit to' : 'Wrote'} ${file}`,
            diff: { before, after },
          });
        } catch {
          steps.push({ type: 'tool', tool: 'edit_file', args: { file_path: file }, result: `Changed ${file}` });
        }
      }
    }
  } catch { /* no changes */ }

  // Also check for uncommitted changes (staged + unstaged)
  try {
    const uncommitted = execSync('git diff HEAD --name-only', { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    const staged = execSync('git diff --cached --name-only', { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    const allUncommitted = new Set([
      ...uncommitted.split('\n').filter(Boolean),
      ...staged.split('\n').filter(Boolean),
    ]);
    for (const file of allUncommitted) {
      try {
        const fileDiff = execSync(`git diff HEAD -- ${JSON.stringify(file)}`, { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 });
        const { before, after } = parseUnifiedDiffHunks(fileDiff);
        steps.push({
          type: 'tool',
          tool: 'edit_file',
          args: { file_path: file },
          result: `Uncommitted changes in ${file}`,
          diff: { before, after },
        });
      } catch {
        steps.push({ type: 'tool', tool: 'edit_file', args: { file_path: file }, result: `Uncommitted changes in ${file}` });
      }
    }
  } catch { /* no uncommitted changes */ }

  return steps;
}

/** Build a context summary from conversation history for aider */
function buildHistoryContext(history: Array<{ role: string; content: string }>): string {
  const recent = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-6);
  if (recent.length === 0) return '';
  const ctx = recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`).join('\n\n');
  return `\n\nPrevious conversation context:\n${ctx}\n\n`;
}

/** Run aider as a subprocess and capture its output */
function runAiderProcess(
  aiderPath: string,
  model: string,
  message: string,
  workdir: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
    const modelArg = buildAiderModelArg(model);

    // Write message to a temp file — avoids shell arg length issues.
    // Use path.resolve() to get absolute path — workdir may be relative (e.g. ../data/...)
    // NOTE: Only the user's actual request goes here. Aider has its own internal system prompt
    // for code editing. Embedding extra "system" instructions causes LLM refusals on local models.
    const messageFile = path.resolve(workdir, '.aider-message.tmp');
    try {
      fs.writeFileSync(messageFile, message, 'utf-8');
    } catch (err: any) {
      console.error(`[agent] Failed to write message file: ${err.message}`);
    }

    // Core CLI flags only — all "disable" settings go via env vars for max compatibility
    const args = [
      '--model', modelArg,
      '--yes',
      '--auto-commits',
    ];

    // Use --message-file if the file was written, otherwise fall back to --message
    if (fs.existsSync(messageFile)) {
      args.push('--message-file', messageFile);
    } else {
      args.push('--message', message);
    }

    console.log(`[agent] Running aider in: ${workdir} (model: ${modelArg})`);

    // Environment variables to prevent browser opening, sudo requests, and hangs.
    // Env vars are the most compatible way to configure aider across all versions.
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      OLLAMA_API_BASE: ollamaHost,
      // Prevent aider from checking for updates (which triggers sudo pip install and browser)
      AIDER_CHECK_UPDATE: 'false',
      // Prevent aider from showing release notes (which opens browser)
      AIDER_SHOW_RELEASE_NOTES: 'false',
      // Prevent aider from suggesting shell commands
      AIDER_SUGGEST_SHELL_COMMANDS: 'false',
      // Disable streaming for subprocess capture
      AIDER_STREAM: 'false',
      // Prevent any browser from opening
      BROWSER: 'echo',
      // Disable terminal colors/formatting
      NO_COLOR: '1',
      // Disable analytics
      AIDER_ANALYTICS_DISABLE: 'true',
    };

    const proc = spawn(aiderPath, args, {
      cwd: path.resolve(workdir),
      env,
      // stdin='ignore' → /dev/null, avoids "Input is not a terminal" warning and hangs
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_CHARS) {
        stdout = stdout.slice(-MAX_OUTPUT_CHARS);
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = stderr.slice(-MAX_OUTPUT_CHARS);
      }
    });

    const cleanup = () => {
      try { if (fs.existsSync(messageFile)) fs.unlinkSync(messageFile); } catch { /* ignore */ }
    };

    proc.on('close', (code) => {
      cleanup();
      if (!resolved) { resolved = true; resolve({ stdout, stderr, exitCode: code ?? 1 }); }
    });

    proc.on('error', (err) => {
      cleanup();
      if (!resolved) { resolved = true; resolve({ stdout, stderr: stderr + `\nProcess error: ${err.message}`, exitCode: 1 }); }
    });

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        resolve({ stdout, stderr: stderr + '\nProcess timed out', exitCode: 124 });
      }
    }, AIDER_TIMEOUT_MS);
  });
}

/** Generate a branch name using Ollama directly (lightweight call) */
async function generateBranchName(model: string, userMessage: string): Promise<string> {
  const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
  try {
    const payload = JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Generate a short git branch name (2-4 words, kebab-case, lowercase, no special characters except hyphens) that describes the task. Respond with ONLY the branch name, nothing else. Examples: add-binary-search, fix-login-bug, update-readme, refactor-api-routes',
        },
        { role: 'user', content: userMessage },
      ],
      stream: false,
    });

    const url = new URL('/api/chat', ollamaHost);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json() as { message?: { content?: string } };
    const name = sanitizeBranchName(data.message?.content || '');
    if (name.length >= 3 && name.length <= 60) return name;
  } catch {
    // fallback below
  }
  return `agent-${Date.now().toString(36)}`;
}

// --- Main agent runner using aider ---

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
  console.log(`[agent] Starting aider agent for repo="${repoName}" branch="${branch}" firstMessage=${isFirstMessage}`);

  // Ensure warez repo is git-initialized and accepts pushes
  if (!isBareRepo(repoPath)) {
    if (fs.existsSync(path.join(repoPath, '.git'))) {
      ensureReceivePush(repoPath);
    } else {
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
        try {
          execSync(`git checkout ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
        } catch {
          execSync(`git checkout -b ${branch} origin/${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
        }
        actions.push({ type: 'tool', tool: 'git_checkout', args: { branch }, result: `Switched to branch: ${branch}` });
      }
      try {
        console.log(`[agent] Pulling latest changes for branch: ${branch}`);
        const pullOutput = execSync(`git pull --rebase origin ${branch}`, { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
        actions.push({ type: 'tool', tool: 'git_pull', args: { branch }, result: pullOutput.trim() || 'Already up to date' });
      } catch {
        try { execSync('git rebase --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* no rebase in progress */ }
        try { execSync('git merge --abort', { cwd: workdir, encoding: 'utf-8', timeout: 10000 }); } catch { /* no merge in progress */ }
        console.log(`[agent] Pull failed (conflict or local-only branch), continuing with local state`);
      }
    } catch (err: any) {
      actions.push({ type: 'tool', tool: 'git_checkout', args: { branch }, result: `Checkout error: ${err.message}` });
    }
  }

  // On first message: generate branch name and create it
  let createdBranch = '';
  if (isFirstMessage) {
    console.log(`[agent] Generating branch name from prompt...`);
    const branchName = await generateBranchName(model, userMessage);
    if (!/^[\w.\-]+$/.test(branchName)) {
      actions.push({ type: 'tool', tool: 'git_create_branch', args: { branch_name: branchName }, result: 'Error: generated branch name is invalid' });
    } else {
      let uniqueName = branchName;
      try {
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

  // Build the message for aider, including conversation context
  const historyContext = buildHistoryContext(history);
  const fullMessage = historyContext
    ? `${historyContext}Current request:\n${userMessage}`
    : userMessage;

  // Capture HEAD before aider runs — we'll use git to detect changes afterward
  const resolvedWorkdir = path.resolve(workdir);
  let headBefore = '';
  try {
    headBefore = execSync('git rev-parse HEAD', { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { /* empty repo? */ }

  // Run aider
  const aiderPath = resolveAiderPath();
  actions.push({ type: 'tool', tool: 'aider', args: { model }, result: `Running aider with model ${buildAiderModelArg(model)}...` });

  try {
    const result = await runAiderProcess(aiderPath, model, fullMessage, workdir);

    console.log(`[agent] Aider exited with code ${result.exitCode}`);
    // Filter out harmless "Input is not a terminal" warning from stderr
    const filteredStderr = result.stderr
      .split('\n')
      .filter(line => !line.includes('Input is not a terminal'))
      .join('\n')
      .trim();
    if (filteredStderr) {
      console.log(`[agent] Aider stderr: ${filteredStderr.slice(0, 500)}`);
    }

    // 1. Extract thinking sections from stdout (► THINKING markers)
    const thinkingSteps = extractThinkingSections(result.stdout);
    actions.push(...thinkingSteps);

    // 2. Auto-commit any remaining uncommitted changes before diffing
    autoCommitChanges(workdir, actions);

    // 3. Build tool call steps from git (commits + per-file diffs since headBefore)
    if (headBefore) {
      const gitSteps = buildStepsFromGit(workdir, headBefore);
      actions.push(...gitSteps);
    }

    // 4. Extract the last message (LLM's conversational response)
    let response = extractAiderResponse(result.stdout);

    if (result.exitCode !== 0 && !response) {
      const errMsg = filteredStderr || 'Aider process failed';
      response = `Aider error (exit code ${result.exitCode}): ${errMsg.slice(0, 1000)}`;
    }

    // Push to warez
    pushToWarez(workdir, actions);

    console.log(`[agent] Done. Branch: ${getCurrentBranch(workdir)}, actions: ${actions.length}`);
    return {
      response: response || 'Done.',
      actions,
      currentBranch: getCurrentBranch(workdir),
    };
  } catch (err: any) {
    console.error(`[agent] Aider error: ${err.message || String(err)}`);
    autoCommitChanges(workdir, actions);
    pushToWarez(workdir, actions);

    return {
      response: `Agent error: ${err.message || String(err)}`,
      actions,
      currentBranch: getCurrentBranch(workdir),
    };
  }
}

/** Extract the LLM's conversational response from aider stdout, filtering boilerplate and diffs.
 *  Diffs are now handled by buildStepsFromGit — this only extracts the text message. */
function extractAiderResponse(output: string): string {
  // If output has ► THINKING / ► ANSWER markers, extract only ANSWER section text
  const sectionRegex = /[-─]+\s*►\s*(THINKING|ANSWER)\s*/g;
  const hasMarkers = sectionRegex.test(output);
  sectionRegex.lastIndex = 0;

  let textToProcess = output;
  if (hasMarkers) {
    const answerParts: string[] = [];
    let lastIndex = 0;
    let lastType = 'raw';
    let match;
    while ((match = sectionRegex.exec(output)) !== null) {
      if (lastType === 'answer' && match.index > lastIndex) {
        answerParts.push(output.slice(lastIndex, match.index));
      }
      lastType = match[1] === 'THINKING' ? 'thinking' : 'answer';
      lastIndex = match.index + match[0].length;
    }
    if (lastType === 'answer' && lastIndex < output.length) {
      answerParts.push(output.slice(lastIndex));
    }
    textToProcess = answerParts.join('\n');
  }

  const lines = textToProcess.split('\n');
  const responseLines: string[] = [];
  let inDiff = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip diff blocks entirely (both unified and SEARCH/REPLACE)
    if (/^(@@\s|diff --git|index [a-f0-9]|---\s+a\/|(\+\+\+)\s+b\/)/.test(trimmed)) { inDiff = true; continue; }
    if (/^(<<<<<<< SEARCH|=======|>>>>>>> REPLACE)/.test(trimmed)) { inDiff = true; continue; }
    if (inDiff && /^[+\-]/.test(trimmed)) continue;
    if (inDiff && !trimmed) continue; // empty lines inside diff
    if (inDiff) inDiff = false;

    // Skip aider markers and boilerplate
    if (/^(Editing|Applied edit to|Creating|Wrote|Added .* to the chat|Commit [a-f0-9]|>)/.test(trimmed)) continue;
    if (AIDER_BOILERPLATE_RE.test(trimmed)) continue;

    // Skip standalone filenames (path-like lines)
    if (/^[\w/\\][\w./\\-]*\.\w+$/.test(trimmed)) continue;

    // Skip separator lines
    if (/^-{3,}$/.test(trimmed)) continue;

    // Skip empty lines at the beginning
    if (responseLines.length === 0 && !trimmed) continue;

    responseLines.push(line);
  }

  // Trim trailing empty lines
  while (responseLines.length > 0 && !responseLines[responseLines.length - 1].trim()) {
    responseLines.pop();
  }

  return responseLines.join('\n').trim();
}
