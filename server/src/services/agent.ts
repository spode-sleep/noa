import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync, spawn } from 'child_process';

const AGENT_GIT_AUTHOR = 'AI Librarian <ai-librarian@box.local>';
const GOOSE_TIMEOUT_MS = 600000; // 10 minutes max per goose invocation
const MAX_OUTPUT_CHARS = 50000; // Max chars to capture from goose output

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

// --- Goose integration (https://github.com/block/goose) ---
// Goose is an open source AI coding agent by Block with built-in developer tools,
// native Ollama support, and structured JSON output.

function resolveGoosePath(): string {
  const envPath = process.env.GOOSE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  try {
    return execSync('which goose', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'goose';
  }
}

/** Ensure goose config directory and config.yaml exist for Ollama */
function ensureGooseConfig(model: string) {
  const configDir = path.join(process.env.HOME || '/tmp', '.config', 'goose');
  const configFile = path.join(configDir, 'config.yaml');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
  const config = [
    'GOOSE_PROVIDER: "ollama"',
    `GOOSE_MODEL: "${model}"`,
    'GOOSE_MODE: "auto"',
    'keyring: false',
    'GOOSE_TELEMETRY_ENABLED: false',
    '',
    'extensions:',
    '  developer:',
    '    bundled: true',
    '    enabled: true',
    '    name: developer',
    '    timeout: 300',
    '    type: builtin',
  ].join('\n');

  fs.writeFileSync(configFile, config, 'utf-8');
  process.env.OLLAMA_HOST = ollamaHost;
}

/** Strip ANSI escape codes */
function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[mK]/g, '');
}

/** Boilerplate lines from goose output that should be filtered */
const GOOSE_BOILERPLATE_RE = /^(logging to |starting session|Closing session|[\u2500\u256D\u2570\u2502]|goose v)/i;

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

  if (!/^[a-f0-9]{7,40}$/.test(oldSha)) return steps;

  try {
    const log = execFileSync('git', ['log', '--oneline', `${oldSha}..HEAD`], { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    if (log) {
      for (const line of log.split('\n')) {
        if (line.trim()) steps.push({ type: 'tool', tool: 'git_commit', args: {}, result: `Commit ${line.trim()}` });
      }
    }
  } catch { /* no new commits */ }

  try {
    const changedFiles = execFileSync('git', ['diff', '--name-only', `${oldSha}..HEAD`], { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    if (changedFiles) {
      for (const file of changedFiles.split('\n')) {
        if (!file.trim()) continue;
        try {
          const fileDiff = execFileSync('git', ['diff', `${oldSha}..HEAD`, '--', file], { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 });
          const { before, after } = parseUnifiedDiffHunks(fileDiff);
          steps.push({
            type: 'tool', tool: before ? 'edit_file' : 'write_file',
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

  try {
    const uncommitted = execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 }).trim();
    const allUncommitted = new Set([...uncommitted.split('\n').filter(Boolean), ...staged.split('\n').filter(Boolean)]);
    for (const file of allUncommitted) {
      try {
        const fileDiff = execFileSync('git', ['diff', 'HEAD', '--', file], { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 10000 });
        const { before, after } = parseUnifiedDiffHunks(fileDiff);
        steps.push({ type: 'tool', tool: 'edit_file', args: { file_path: file }, result: `Uncommitted changes in ${file}`, diff: { before, after } });
      } catch {
        steps.push({ type: 'tool', tool: 'edit_file', args: { file_path: file }, result: `Uncommitted changes in ${file}` });
      }
    }
  } catch { /* no uncommitted */ }

  return steps;
}

/** Build a context summary from conversation history */
function buildHistoryContext(history: Array<{ role: string; content: string }>): string {
  const recent = history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6);
  if (recent.length === 0) return '';
  const ctx = recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`).join('\n\n');
  return `\n\nPrevious conversation context:\n${ctx}\n\n`;
}

/** Run goose as a subprocess and capture its output */
function runGooseProcess(
  goosePath: string,
  message: string,
  workdir: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const args = [
      'run',
      '-t', message,
      '--no-session',
      '--with-builtin', 'developer',
    ];

    console.log(`[agent] Running goose in: ${workdir}`);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      NO_COLOR: '1',
    };

    const proc = spawn(goosePath, args, {
      cwd: path.resolve(workdir),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(-MAX_OUTPUT_CHARS);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(-MAX_OUTPUT_CHARS);
    });

    proc.on('close', (code) => {
      if (!resolved) { resolved = true; resolve({ stdout, stderr, exitCode: code ?? 1 }); }
    });

    proc.on('error', (err) => {
      if (!resolved) { resolved = true; resolve({ stdout, stderr: stderr + '\nProcess error: ' + err.message, exitCode: 1 }); }
    });

    // Safety timeout
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill(); } catch { /* ignore */ }
        resolve({ stdout, stderr: stderr + '\nProcess timed out', exitCode: 124 });
      }
    }, GOOSE_TIMEOUT_MS);

    proc.on('close', () => clearTimeout(timer));
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

// --- Main agent runner using goose ---

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
  console.log(`[agent] Starting goose agent for repo="${repoName}" branch="${branch}" firstMessage=${isFirstMessage}`);

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

  // Build the message for goose, including conversation context
  const historyContext = buildHistoryContext(history);
  const fullMessage = historyContext
    ? `${historyContext}Current request:\n${userMessage}`
    : userMessage;

  // Capture HEAD before goose runs — we'll use git to detect changes afterward
  const resolvedWorkdir = path.resolve(workdir);
  let headBefore = '';
  try {
    headBefore = execSync('git rev-parse HEAD', { cwd: resolvedWorkdir, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { /* empty repo? */ }

  // Configure and run goose
  ensureGooseConfig(model);
  const goosePath = resolveGoosePath();
  actions.push({ type: 'tool', tool: 'goose', args: { model }, result: `Running goose with model ${model}...` });

  try {
    const result = await runGooseProcess(goosePath, fullMessage, workdir);

    console.log(`[agent] Goose exited with code ${result.exitCode}`);
    if (result.stderr.trim()) {
      console.log(`[agent] Goose stderr: ${result.stderr.trim().slice(0, 500)}`);
    }

    // 1. Extract response from goose output (strip ANSI + boilerplate)
    const outputLines = stripAnsi(result.stdout).split('\n');
    const cleanLines = outputLines.filter(l => l.trim() && !GOOSE_BOILERPLATE_RE.test(l.trim()));
    let response = cleanLines.join('\n').trim();

    // 2. Auto-commit any remaining uncommitted changes
    autoCommitChanges(workdir, actions);

    // 3. Build tool call steps from git (commits + per-file diffs since headBefore)
    if (headBefore) {
      const gitSteps = buildStepsFromGit(workdir, headBefore);
      actions.push(...gitSteps);
    }

    if (result.exitCode !== 0 && !response) {
      response = `Goose error (exit code ${result.exitCode}): ${(result.stderr || 'Process failed').slice(0, 1000)}`;
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
    console.error(`[agent] Goose error: ${err.message || String(err)}`);
    autoCommitChanges(workdir, actions);
    pushToWarez(workdir, actions);

    return {
      response: `Agent error: ${err.message || String(err)}`,
      actions,
      currentBranch: getCurrentBranch(workdir),
    };
  }
}
