import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { runAgent, AgentResult } from '../services/agent';

const router = Router();

const DEFAULT_MODEL = 'huihui_ai/qwen3-abliterated:8b-v2';

function getConfiguredModels(): string[] {
  const envModels = process.env.LLM_MODELS;
  if (envModels) {
    const models = envModels.split(',').map(m => m.trim()).filter(Boolean);
    return models.length > 0 ? models : [DEFAULT_MODEL];
  }
  return [DEFAULT_MODEL];
}

function isModelAllowed(model: string): boolean {
  return getConfiguredModels().includes(model);
}

const warezPaths = (process.env.WAREZ_LIBRARY_PATH || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

interface RepoInfo {
  name: string;
  path: string;
  description: string;
  lastCommitDate: string;
  lastCommitMessage: string;
  branch: string;
  commitCount: number;
  isGitRepo: boolean;
}

function getGitInfo(repoPath: string): Partial<RepoInfo> {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const lastCommitDate = execSync('git log -1 --format=%ci', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const lastCommitMessage = execSync('git log -1 --format=%s', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const commitCount = parseInt(execSync('git rev-list --count HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim(), 10) || 0;

    // Try to get description from .git/description or first line of README
    let description = '';
    const descFile = path.join(repoPath, '.git', 'description');
    if (fs.existsSync(descFile)) {
      const desc = fs.readFileSync(descFile, 'utf-8').trim();
      if (desc && desc !== 'Unnamed repository; edit this file \'description\' to name the repository.') {
        description = desc;
      }
    }

    return { branch, lastCommitDate, lastCommitMessage, commitCount, description };
  } catch {
    return {};
  }
}

function findRepos(): RepoInfo[] {
  const repos: RepoInfo[] = [];

  for (const warezPath of warezPaths) {
    if (!fs.existsSync(warezPath)) continue;

    const entries = fs.readdirSync(warezPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(warezPath, entry.name);
      const gitDir = path.join(fullPath, '.git');
      const isGitRepo = fs.existsSync(gitDir);

      const info = isGitRepo ? getGitInfo(fullPath) : {};
      repos.push({
        name: entry.name,
        path: fullPath,
        description: info.description || '',
        lastCommitDate: info.lastCommitDate || '',
        lastCommitMessage: info.lastCommitMessage || '',
        branch: info.branch || '',
        commitCount: info.commitCount || 0,
        isGitRepo,
      });
    }
  }

  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

// GET /api/warez/repos - List all git repositories
router.get('/repos', (_req: Request, res: Response) => {
  try {
    const repos = findRepos();
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list repos', details: String(err) });
  }
});

// GET /api/warez/repos/:name - Get repo details + README
router.get('/repos/:name', (req: Request, res: Response) => {
  try {
    // Validate name to prevent path traversal
    const name = req.params.name;
    if (!name || name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
      res.status(400).json({ error: 'Invalid repository name' });
      return;
    }

    const repos = findRepos();
    const repo = repos.find(r => r.name === name);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    // Find and read README (limit to 1MB)
    let readme = '';
    const readmeNames = ['README.md', 'README.MD', 'readme.md', 'README', 'README.txt', 'README.rst'];
    const MAX_README_SIZE = 1024 * 1024;
    for (const rname of readmeNames) {
      const readmePath = path.join(repo.path, rname);
      if (fs.existsSync(readmePath)) {
        const stat = fs.statSync(readmePath);
        if (stat.size <= MAX_README_SIZE) {
          readme = fs.readFileSync(readmePath, 'utf-8');
        }
        break;
      }
    }

    // Get file tree (top level)
    const files: { name: string; type: string }[] = [];
    const entries = fs.readdirSync(repo.path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      files.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      });
    }
    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ ...repo, readme, files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get repo details', details: String(err) });
  }
});

// Helper: validate repo name and find repo
function findRepoByName(name: string): RepoInfo | null {
  if (!name || name.includes('/') || name.includes('\\') || name === '..' || name === '.') return null;
  const repos = findRepos();
  return repos.find(r => r.name === name) || null;
}

// GET /api/warez/repos/:name/branches - List git branches
router.get('/repos/:name/branches', (req: Request, res: Response) => {
  try {
    const repo = findRepoByName(req.params.name as string);
    if (!repo) { res.status(404).json({ error: 'Repository not found' }); return; }
    if (!repo.isGitRepo) { res.json({ branches: [], current: '' }); return; }

    const branchesRaw = execSync('git branch --no-color', { cwd: repo.path, encoding: 'utf-8', timeout: 10000 });
    const lines = branchesRaw.split('\n').filter(Boolean);
    let current = '';
    const branches = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('* ')) {
        current = trimmed.slice(2);
        return current;
      }
      return trimmed;
    });
    res.json({ branches, current });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list branches', details: String(err) });
  }
});

// POST /api/warez/repos/:name/git/init - Initialize git in a non-git directory
router.post('/repos/:name/git/init', (req: Request, res: Response) => {
  try {
    const repo = findRepoByName(req.params.name as string);
    if (!repo) { res.status(404).json({ error: 'Repository not found' }); return; }
    if (repo.isGitRepo) { res.json({ message: 'Already a git repository' }); return; }

    execSync('git init', { cwd: repo.path, encoding: 'utf-8', timeout: 10000 });
    execSync('git add -A', { cwd: repo.path, encoding: 'utf-8', timeout: 10000 });
    execSync('git commit -m "Initial commit" --allow-empty', { cwd: repo.path, encoding: 'utf-8', timeout: 10000 });
    res.json({ message: 'Git initialized with initial commit' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to initialize git', details: String(err) });
  }
});

// POST /api/warez/repos/:name/agent/chat - AI agent chat for code changes
router.post('/repos/:name/agent/chat', async (req: Request, res: Response) => {
  try {
    const repo = findRepoByName(req.params.name as string);
    if (!repo) { res.status(404).json({ error: 'Repository not found' }); return; }

    const { message, history, model: requestedModel } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const trimmedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
    const selectedModel = (trimmedModel && isModelAllowed(trimmedModel))
      ? trimmedModel
      : getConfiguredModels()[0];

    const result = await runAgent(
      selectedModel,
      message,
      Array.isArray(history) ? history : [],
      repo.path,
      repo.name,
      repo.branch,
      repo.isGitRepo,
    );

    res.json({
      role: 'assistant',
      content: result.response,
      actions: result.actions,
    });
  } catch (err) {
    res.status(500).json({ error: 'Agent error', details: String(err) });
  }
});

export default router;
