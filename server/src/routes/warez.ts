import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { isBareRepo } from '../services/agent';

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
  isGitRepo: boolean;
  isBare: boolean;
}

function getGitInfo(repoPath: string, bare: boolean): Partial<RepoInfo> {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const lastCommitDate = execSync('git log -1 --format=%ci', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const lastCommitMessage = execSync('git log -1 --format=%s', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const commitCount = parseInt(execSync('git rev-list --count HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim(), 10) || 0;

    let description = '';
    const descFile = bare
      ? path.join(repoPath, 'description')
      : path.join(repoPath, '.git', 'description');
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
      const hasGitDir = fs.existsSync(path.join(fullPath, '.git'));
      const bare = isBareRepo(fullPath);
      const isGitRepo = hasGitDir || bare;

      const info = isGitRepo ? getGitInfo(fullPath, bare) : {};
      repos.push({
        name: entry.name,
        path: fullPath,
        description: info.description || '',
        lastCommitDate: info.lastCommitDate || '',
        lastCommitMessage: info.lastCommitMessage || '',
        branch: info.branch || '',
        commitCount: info.commitCount || 0,
        isGitRepo,
        isBare: bare,
      });
    }
  }

  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

// Read README from bare repo using git show
function readReadmeBare(repoPath: string): string {
  const readmeNames = ['README.md', 'README.MD', 'readme.md', 'README', 'README.txt', 'README.rst'];
  for (const rname of readmeNames) {
    try {
      return execSync(`git show HEAD:${rname}`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    } catch {
      // file doesn't exist at HEAD, try next
    }
  }
  return '';
}

// List files at root from bare repo using git ls-tree
function listFilesBare(repoPath: string): { name: string; type: string }[] {
  try {
    const output = execSync('git ls-tree HEAD', { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
    if (!output) return [];
    return output.split('\n').map(line => {
      // Format: <mode> <type> <hash>\t<name>
      const tabIdx = line.indexOf('\t');
      const meta = line.slice(0, tabIdx).split(/\s+/);
      const name = line.slice(tabIdx + 1);
      return { name, type: meta[1] === 'tree' ? 'directory' : 'file' };
    });
  } catch {
    return [];
  }
}

// GET /api/warez/repos - List all repositories
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

    let readme = '';
    let files: { name: string; type: string }[] = [];

    if (repo.isBare) {
      // Bare repo: use git commands
      readme = readReadmeBare(repo.path);
      files = listFilesBare(repo.path);
    } else {
      // Non-bare: use filesystem
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

      const entries = fs.readdirSync(repo.path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git') continue;
        files.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        });
      }
    }

    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Clone URL for bare repos
    const cloneUrl = repo.isBare ? repo.path : undefined;

    res.json({ ...repo, readme, files, cloneUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get repo details', details: String(err) });
  }
});

export default router;
