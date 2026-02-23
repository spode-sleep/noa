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

/** Parse aider SEARCH/REPLACE blocks from output into edit steps with diffs */
function parseSearchReplaceBlocks(output: string): AgentStep[] {
  const steps: AgentStep[] = [];
  // Aider outputs: filename\n<<<<<<< SEARCH\n...old...\n=======\n...new...\n>>>>>>> REPLACE
  // The gm flags let ^ match at line starts, so this works even mid-output
  const blockRegex = /^([^\n]+)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/gm;
  let match;
  while ((match = blockRegex.exec(output)) !== null) {
    const filePath = match[1].trim();
    const before = match[2];
    const after = match[3];
    // Heuristic: skip if the line above SEARCH looks like prose, not a filepath
    // (real paths are short and don't have multiple consecutive spaces)
    if (filePath.length > 200 || /\s{2,}/.test(filePath)) continue;
    steps.push({
      type: 'tool',
      tool: 'edit_file',
      args: { file_path: filePath },
      result: `Applied edit to ${filePath}`,
      diff: { before, after },
    });
  }
  return steps;
}

/** Parse aider output into AgentStep actions for the frontend timeline */
function parseAiderOutput(output: string): AgentStep[] {
  const steps: AgentStep[] = [];

  // First, extract all SEARCH/REPLACE blocks as edit_file steps with diffs
  const editSteps = parseSearchReplaceBlocks(output);
  // Track which files had SEARCH/REPLACE diffs to avoid duplicate "Editing" line steps
  const filesWithDiffs = new Set(editSteps.map(s => s.args?.file_path));

  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Aider file edit markers (only add if we don't already have a diff for this file)
    if (/^Editing\s+/.test(trimmed) || /^Applied edit to\s+/.test(trimmed)) {
      const file = trimmed.replace(/^(Editing|Applied edit to)\s+/, '').trim();
      if (!filesWithDiffs.has(file)) {
        steps.push({ type: 'tool', tool: 'edit_file', args: { file_path: file }, result: trimmed });
      }
    } else if (/^Creating\s+/.test(trimmed) || /^Wrote\s+/.test(trimmed)) {
      const file = trimmed.replace(/^(Creating|Wrote)\s+/, '').trim();
      if (!filesWithDiffs.has(file)) {
        steps.push({ type: 'tool', tool: 'write_file', args: { file_path: file }, result: trimmed });
      }
    } else if (/^Added\s+.*to the chat/.test(trimmed)) {
      const file = trimmed.replace(/^Added\s+/, '').replace(/\s+to the chat.*/, '').trim();
      steps.push({ type: 'tool', tool: 'read_file', args: { file_path: file }, result: trimmed });
    } else if (/^Commit [a-f0-9]+/.test(trimmed)) {
      steps.push({ type: 'tool', tool: 'git_commit', args: {}, result: trimmed });
    } else if (/^Git repo.*found/.test(trimmed) || /^Repo-map/.test(trimmed)) {
      // Skip internal aider messages
    } else if (/^(<<<<<<< SEARCH|=======|>>>>>>> REPLACE)/.test(trimmed)) {
      // Skip SEARCH/REPLACE markers (already parsed by parseSearchReplaceBlocks)
    } else if (/^>\s+/.test(trimmed)) {
      // User prompt echo — skip
    } else if (trimmed.length > 10 && !trimmed.startsWith('─') && !trimmed.startsWith('Warning')) {
      // Thinking/explanation text from aider
      steps.push({ type: 'thinking', content: trimmed });
    }
  }

  // Insert edit steps with diffs at the beginning (they represent the core changes)
  return [...editSteps, ...steps];
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

/** System prompt appended to every aider request to enforce efficient, commit-oriented behavior */
const AIDER_SYSTEM_PROMPT = `WORKFLOW (follow in order):
1. UNDERSTAND: Read relevant files and explore the codebase before making any changes
2. PLAN: Think about what changes are needed and explain your approach
3. IMPLEMENT: Make targeted edits to existing files or create new files as needed
4. VERIFY: Review your changes (check status, diff), run tests or builds if applicable
5. COMMIT: Always commit your changes when done

CRITICAL RULES — follow strictly:

1. EVERY session MUST produce a git commit unless the user explicitly says "don't commit" or "no commit".
   If you changed any file, you MUST commit before finishing. Never end with uncommitted changes.

2. Be EFFICIENT. Before editing, plan your changes. Do NOT:
   - Read files you won't modify
   - Re-read files you already read
   - Make empty edits or no-op changes
   - Suggest changes without applying them
   - Repeat the same edit that already failed

3. AVOID LOOPING. If an edit fails (search block not found), try a DIFFERENT approach:
   - Use a different search block with more context
   - Or rewrite the whole file
   - Do NOT retry the same failed edit more than once

4. Make REAL changes. Every response must either:
   - Apply concrete file edits, OR
   - Explain why no changes are needed (only if the task is truly complete or impossible)

5. Be CONCISE in explanations. Focus on what you changed and why. Skip lengthy preambles.

6. Answer in the SAME LANGUAGE as the user's message.`;

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

    // Write config file in workdir — more compatible than CLI flags across aider versions
    const configFile = path.join(workdir, '.aider.conf.yml');
    const promptFile = path.join(workdir, '.aider.system-prompt.md');
    try {
      fs.writeFileSync(promptFile, AIDER_SYSTEM_PROMPT, 'utf-8');
    } catch (err: any) {
      console.error(`[agent] Failed to write system prompt file: ${err.message}`);
    }
    try {
      const config = [
        `model: ${modelArg}`,
        'yes-always: true',
        'auto-commits: true',
        'stream: false',
        'pretty: false',
        'check-update: false',
        'show-model-warnings: false',
        'auto-lint: false',
        'suggest-shell-commands: false',
        'subtree-only: true',
        'detect-urls: false',
      ];
      if (fs.existsSync(promptFile)) {
        config.push(`system-prompt-extras: ${promptFile}`);
      }
      fs.writeFileSync(configFile, config.join('\n') + '\n', 'utf-8');
    } catch (err: any) {
      console.error(`[agent] Failed to write aider config file: ${err.message}`);
    }

    // Use only universally supported CLI flags; everything else is in .aider.conf.yml
    const args = [
      '--yes-always',
      '--message', message,
    ];

    console.log(`[agent] Running aider in: ${workdir} (model: ${modelArg})`);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      OLLAMA_API_BASE: ollamaHost,
    };

    const proc = spawn(aiderPath, args, {
      cwd: workdir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
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

    // Close stdin immediately — aider runs non-interactively with --message
    proc.stdin.end();

    const cleanup = () => {
      try { if (fs.existsSync(promptFile)) fs.unlinkSync(promptFile); } catch { /* ignore */ }
      try { if (fs.existsSync(configFile)) fs.unlinkSync(configFile); } catch { /* ignore */ }
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

  // Run aider
  const aiderPath = resolveAiderPath();
  actions.push({ type: 'tool', tool: 'aider', args: { model }, result: `Running aider with model ${buildAiderModelArg(model)}...` });

  try {
    const result = await runAiderProcess(aiderPath, model, fullMessage, workdir);

    console.log(`[agent] Aider exited with code ${result.exitCode}`);
    if (result.stderr) {
      console.log(`[agent] Aider stderr: ${result.stderr.slice(0, 500)}`);
    }

    // Parse aider output into timeline steps
    const aiderSteps = parseAiderOutput(result.stdout);
    actions.push(...aiderSteps);

    // Extract the meaningful response from aider output
    // Aider outputs the LLM response mixed with file editing markers
    let response = extractAiderResponse(result.stdout);

    if (result.exitCode !== 0 && !response) {
      const errMsg = result.stderr.trim() || 'Aider process failed';
      response = `Aider error (exit code ${result.exitCode}): ${errMsg.slice(0, 1000)}`;
    }

    // Auto-commit any remaining uncommitted changes (aider may leave some)
    autoCommitChanges(workdir, actions);

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

/** Extract the main AI response text from aider's output, filtering out tool markers */
function extractAiderResponse(output: string): string {
  const lines = output.split('\n');
  const responseLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code blocks
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      responseLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      responseLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Skip aider internal markers
    if (/^(Editing|Applied edit to|Creating|Wrote|Added .* to the chat|Commit [a-f0-9]|Git repo|Repo-map|Use \/|Tokens:|Model:|─|>)/.test(trimmed)) {
      continue;
    }

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
