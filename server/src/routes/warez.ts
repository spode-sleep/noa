import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const router = Router();

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
      if (!fs.existsSync(gitDir)) continue;

      const info = getGitInfo(fullPath);
      repos.push({
        name: entry.name,
        path: fullPath,
        description: info.description || '',
        lastCommitDate: info.lastCommitDate || '',
        lastCommitMessage: info.lastCommitMessage || '',
        branch: info.branch || 'main',
        commitCount: info.commitCount || 0,
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

export default router;
