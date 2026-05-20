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
const MAX_GRADLE_TIMEOUT = 600000; // 10 minutes — gradle downloads deps on first run
const MAX_TREE_ENTRIES_PER_DIR = 30;
const MAX_ERROR_PREVIEW_LENGTH = 4096;
const ALLOWED_COMMANDS = ['npm', 'npx', 'node', 'python', 'python3', 'pip', 'pip3', 'make', 'cargo', 'go', 'gcc', 'g++', 'javac', 'java', 'ruby', 'perl', 'cat', 'head', 'tail', 'wc', 'sort', 'grep', 'find', 'ls', 'pwd', 'echo', 'test', 'diff', 'patch'];
const SHELL_METACHARACTERS = /[;|&`$(){}><\n\r]/;
const EXCLUDED_TREE_DIRS = ['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build', '.next'];
const AGENT_GIT_AUTHOR = 'AI Librarian <ai-librarian@box.local>';
const AGENT_GIT_NAME = 'AI Librarian';
const AGENT_GIT_EMAIL = 'ai-librarian@box.local';
const GIT_RETRY_COUNT = 3;
const GIT_RETRY_DELAY_MS = 500;
const GIT_LOCK_WAIT_MS = 5000;
const GIT_LOCK_POLL_MS = 200;

const MAX_REPEAT_COUNT = 3;
// Tracks (tool, primary-arg) pairs; window of 6 is enough to detect 3 consecutive hits on same target
const MAX_RECENT_TOOL_TARGETS = 6;

const KNOWN_TOOL_NAMES = new Set([
  'read_file', 'write_file', 'edit_file', 'list_files', 'search_files',
  'run_command', 'git_status', 'git_diff', 'git_commit', 'git_revert', 'git_log',
  'delete_file', 'move_file', 'outline_file', 'gradle_build',
]);

// --- Git stability helpers ---

/** Synchronous sleep using execFileSync (avoids shell injection) */
function sleepMs(ms: number): void {
  const seconds = String(ms / 1000);
  try { execFileSync('sleep', [seconds], { timeout: ms + 1000 }); } catch { /* ignore */ }
}

/** Wait for a git lock file to be released before proceeding */
function waitForGitLock(repoPath: string): void {
  const lockFile = path.join(repoPath, '.git', 'index.lock');
  const start = Date.now();
  while (fs.existsSync(lockFile) && Date.now() - start < GIT_LOCK_WAIT_MS) {
    const elapsed = Date.now() - start;
    if (elapsed > 0 && elapsed % 1000 < GIT_LOCK_POLL_MS) {
      console.log(`[agent] Waiting for git lock: ${lockFile}`);
    }
    sleepMs(GIT_LOCK_POLL_MS);
  }
  // Remove stale lock if it persists beyond the wait period
  if (fs.existsSync(lockFile)) {
    console.warn(`[agent] Removing stale git lock file: ${lockFile}`);
    try { fs.unlinkSync(lockFile); } catch (e: any) {
      console.error(`[agent] Failed to remove lock file: ${e.message}`);
    }
  }
}

/** Retry a git operation with exponential backoff on transient failures */
function retryGit<T>(fn: () => T, description: string, retries = GIT_RETRY_COUNT): T {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return fn();
    } catch (err: any) {
      const msg = err.message || String(err);
      const isTransient = msg.includes('index.lock') ||
        msg.includes('Unable to create') ||
        msg.includes('cannot lock ref') ||
        msg.includes('Connection refused') ||
        msg.includes('could not read') ||
        msg.includes('bad object');
      if (isTransient && attempt < retries) {
        const delay = GIT_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[agent] Retrying "${description}" (attempt ${attempt}/${retries}): ${msg}`);
        sleepMs(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`retryGit: maximum retries (${retries}) exceeded for "${description}"`);
}

/** Configure git user identity in a repository to prevent commit failures */
function configureGitIdentity(repoPath: string): void {
  try {
    execFileSync('git', ['config', 'user.name', AGENT_GIT_NAME],
      { cwd: repoPath, encoding: 'utf-8', timeout: 5000 });
    execFileSync('git', ['config', 'user.email', AGENT_GIT_EMAIL],
      { cwd: repoPath, encoding: 'utf-8', timeout: 5000 });
  } catch (err: any) {
    console.warn(`[agent] Failed to configure git identity: ${err.message}`);
  }
}

/** Check if a git commit hash exists in the repository */
function commitExists(repoPath: string, hash: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-t', hash],
      { cwd: repoPath, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Safely clean up interrupted git operations (rebase, merge, cherry-pick) */
function cleanupInterruptedGitOps(repoPath: string): void {
  const gitDir = path.join(repoPath, '.git');
  const ops = [
    { marker: 'rebase-merge', abort: ['rebase', '--abort'] },
    { marker: 'rebase-apply', abort: ['rebase', '--abort'] },
    { marker: 'MERGE_HEAD', abort: ['merge', '--abort'] },
    { marker: 'CHERRY_PICK_HEAD', abort: ['cherry-pick', '--abort'] },
  ];
  for (const op of ops) {
    if (fs.existsSync(path.join(gitDir, op.marker))) {
      console.log(`[agent] Cleaning up interrupted git operation: ${op.marker}`);
      try {
        execFileSync('git', op.abort, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
      } catch (err: any) {
        console.warn(`[agent] Failed to abort ${op.marker}: ${err.message}`);
      }
    }
  }
}

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
      description: 'Read the contents of a file in the repository. For large files, use outline_file first to find relevant line numbers, then pass start_line/end_line to read only the needed section.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path to the file from repository root' },
          start_line: { type: 'number', description: 'Optional: first line to read (1-based, inclusive). Add ~5 lines of padding before the target so edit_file has enough context to form a unique old_text.' },
          end_line: { type: 'number', description: 'Optional: last line to read (1-based, inclusive). Add ~5 lines of padding after the target for the same reason.' },
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
      name: 'git_status',
      description: 'Show the status of the working tree (changed, staged, and untracked files)',
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
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the repository. Use when removing files during refactoring or cleanup.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path to the file to delete' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: 'Move or rename a file in the repository. Preserves file content. Use for renaming or restructuring.',
      parameters: {
        type: 'object',
        properties: {
          src_path: { type: 'string', description: 'Current relative path of the file' },
          dst_path: { type: 'string', description: 'New relative path for the file (including new name)' },
        },
        required: ['src_path', 'dst_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'outline_file',
      description: 'Show the structure of a file (classes, methods, functions, fields) with line numbers using ctags. Use BEFORE read_file on large files to understand what is in the file and decide which parts to read.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path to the file to outline' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gradle_build',
      description: 'Run a Gradle task (build, jar, clean, test, etc.) using the project\'s gradlew wrapper. Returns filtered output: compilation errors, warnings, and build status. Use this instead of run_command for all Gradle operations.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Gradle task to run, e.g. "build", "jar", "clean", "test", "classes". Defaults to "build".',
          },
          properties: {
            type: 'string',
            description: 'Optional space-separated Gradle -P flags without the -P prefix, e.g. "include_create=true offline=true". Each key=value pair becomes -Pkey=value.',
          },
        },
      },
    },
  },
];

// --- Gradle output filter ---
// Gradle produces verbose output — download progress, task names, deprecation noise.
// We extract only what the agent needs: compilation errors/warnings, test failures,
// the final build result line, and any exception stacktraces.

function filterGradleOutput(raw: string): string {
  const lines = raw.split('\n');
  const kept: string[] = [];

  // Patterns that indicate a relevant line
  const relevant = [
    /^.*error:/i,                          // Java compilation errors
    /^.*warning:/i,                        // Java compilation warnings
    /^.*\d+ error/i,                       // "N errors" summary line
    /^.*\d+ warning/i,                     // "N warnings" summary line
    /^FAILURE:/,                           // Gradle failure header
    /^> Task /,                            // Task execution lines (shows what ran)
    /^> Could not/,                        // Dependency / config errors
    /^\s+> /,                              // Nested cause lines
    /^.*Exception.*:/,                     // Exception class lines
    /^\s+at .+\(.*\.java:\d+\)/,          // Java stacktrace frames (src files only)
    /^BUILD (SUCCESSFUL|FAILED)/,          // Final status
    /^\d+ tests? completed/i,             // Test summary
    /^.*FAILED$/,                          // Failed test names
    /^.*MethodSource/,                     // JUnit test method source
  ];

  // Patterns to always skip regardless
  const noise = [
    /^Download /,
    /^Generating /,
    /^\s*$/,
    /^To honour the JVM settings/,
    /^Daemon will be stopped/,
    /^Deprecated Gradle/,
    /^All deprecated usages/,
    /^Configure project/,
    /^\s+file:\/\//,                       // Local file URL lines in stacktraces
    /^> Transform /,
    /^Calculating task graph/,
    /^Task ':.*' is not up-to-date/,
  ];

  let inStacktrace = false;

  for (const line of lines) {
    if (noise.some(p => p.test(line))) continue;

    // Detect start of stacktrace block — keep until blank line after it
    if (/^.*Exception.*:/.test(line) || /^\s+at .+\(.*\.java:\d+\)/.test(line)) {
      inStacktrace = true;
    }
    if (inStacktrace) {
      kept.push(line);
      // End stacktrace on blank line or BUILD line
      if (/^BUILD/.test(line) || line.trim() === '') inStacktrace = false;
      continue;
    }

    if (relevant.some(p => p.test(line))) {
      kept.push(line);
    }
  }

  if (kept.length === 0) return '(no errors or warnings — see build status above)';

  // Truncate if still too long (unlikely after filtering but safety net)
  const result = kept.join('\n');
  if (result.length > MAX_TOOL_RESULT_CHARS) {
    const half = Math.floor(MAX_TOOL_RESULT_CHARS / 2);
    return result.slice(0, half) + '\n... (truncated) ...\n' + result.slice(-half);
  }
  return result;
}

// --- Tool execution ---

interface ToolResult {
  text: string;
  diff?: { before: string; after: string };
}

/** Force git to re-read file mtimes and detect changes made within the same second (racy git fix) */
function refreshGitIndex(repoPath: string) {
  waitForGitLock(repoPath);
  try {
    retryGit(
      () => execFileSync('git', ['update-index', '--refresh'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }),
      'update-index --refresh',
    );
  } catch (err: any) {
    console.warn(`[agent] git update-index --refresh failed: ${err.message}`);
  }
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
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const startLine = args.start_line ? parseInt(args.start_line, 10) : null;
        const endLine = args.end_line ? parseInt(args.end_line, 10) : null;
        if (startLine !== null || endLine !== null) {
          const lines = raw.split('\n');
          const from = Math.max(1, startLine ?? 1) - 1;
          const to = Math.min(lines.length, endLine ?? lines.length);
          const slice = lines.slice(from, to).join('\n');
          const header = `[${rel} lines ${from + 1}–${to} of ${lines.length}]\n`;
          return { text: header + slice };
        }
        return { text: raw };
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
        if (idx === -1) {
          const preview = content.length > MAX_ERROR_PREVIEW_LENGTH ? content.slice(0, MAX_ERROR_PREVIEW_LENGTH) + '\n... (truncated)' : content;
          return { text: `Error: old_text not found in ${rel}. The file may have been modified by a previous tool call. Current content:\n${preview}` };
        }
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
        const grepArgs = ['grep', '-n', '-I', '--untracked', `--max-count=${MAX_SEARCH_RESULTS}`, '-e', pattern];
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
        return { text: retryGit(
          () => execFileSync('git', ['status', '--short'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(working tree clean)',
          'status',
        ) };
      case 'git_diff':
        refreshGitIndex(repoPath);
        return { text: retryGit(
          () => execFileSync('git', ['diff'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(no changes)',
          'diff',
        ) };
      case 'git_commit': {
        const message = args.message || 'Agent commit';
        waitForGitLock(repoPath);
        refreshGitIndex(repoPath);
        retryGit(
          () => execFileSync('git', ['add', '-A'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }),
          'add -A',
        );
        const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
        if (!status) return { text: 'Nothing to commit -- working tree is clean. No action needed.' };
        retryGit(
          () => execFileSync('git', ['commit', `--author=${AGENT_GIT_AUTHOR}`, '-m', message],
            { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }),
          'commit',
        );
        return { text: `Changes committed: ${message}` };
      }
      case 'git_log': {
        const count = parseInt(args.count || '10', 10);
        const safeCount = Math.min(Math.max(1, count), MAX_GIT_LOG_COUNT);
        return { text: retryGit(
          () => execFileSync('git', ['log', '--oneline', '-n', String(safeCount)],
            { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim() || '(no commits)',
          'log',
        ) };
      }
      case 'git_revert': {
        const hash = args.commit_hash || '';
        if (!hash || !/^[a-f0-9]{7,40}$/i.test(hash)) return { text: 'Error: invalid commit hash (must be at least 7 hex characters)' };
        if (!commitExists(repoPath, hash)) return { text: `Error: commit ${hash} not found in repository. Use git_log to find valid commits.` };
        waitForGitLock(repoPath);
        execFileSync('git', ['reset', '--hard', hash], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
        return { text: `Repository reverted to commit: ${hash}` };
      }
      case 'delete_file': {
        const rel = sanitizeRelativePath(args.file_path || '');
        if (!rel) return { text: 'Error: invalid file path' };
        const fullPath = path.join(repoPath, rel);
        if (!fs.existsSync(fullPath)) return { text: `Error: file not found: ${rel}` };
        const before = fs.readFileSync(fullPath, 'utf-8');
        fs.unlinkSync(fullPath);
        return { text: `File deleted: ${rel}`, diff: { before, after: '' } };
      }
      case 'move_file': {
        const srcRel = sanitizeRelativePath(args.src_path || '');
        const dstRel = sanitizeRelativePath(args.dst_path || '');
        if (!srcRel) return { text: 'Error: invalid src_path' };
        if (!dstRel) return { text: 'Error: invalid dst_path' };
        const srcFull = path.join(repoPath, srcRel);
        const dstFull = path.join(repoPath, dstRel);
        if (!fs.existsSync(srcFull)) return { text: `Error: source file not found: ${srcRel}` };
        if (fs.existsSync(dstFull)) return { text: `Error: destination already exists: ${dstRel}. Delete it first if you want to overwrite.` };
        const dstDir = path.dirname(dstFull);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.renameSync(srcFull, dstFull);
        return { text: `File moved: ${srcRel} → ${dstRel}` };
      }
      case 'outline_file': {
        const rel = sanitizeRelativePath(args.file_path || '');
        if (!rel) return { text: 'Error: invalid file path' };
        const fullPath = path.join(repoPath, rel);
        if (!fs.existsSync(fullPath)) return { text: `Error: file not found: ${rel}` };
        try {
          const raw = execFileSync(
            'ctags',
            ['-f', '-', '--output-format=json', '--fields=+nS', fullPath],
            { encoding: 'utf-8', timeout: 10000 },
          );
          const tags = raw
            .split('\n')
            .filter(Boolean)
            .map(line => { try { return JSON.parse(line); } catch { return null; } })
            .filter(Boolean)
            .filter((t: any) => t._type === 'tag' && t.kind !== 'package')
            .sort((a: any, b: any) => (a.line || 0) - (b.line || 0));

          if (tags.length === 0) return { text: '(no symbols found — file may be empty or language not supported by ctags)' };

          const lines = tags.map((t: any) => {
            const indent = t.scopeKind ? '  ' : '';
            const visibility = t.file ? '[private] ' : '';
            const signature = t.signature ? t.signature : '';
            return `${indent}${t.kind.padEnd(8)} ${visibility}${t.name}${signature}  (line ${t.line})`;
          });

          return { text: `${rel}\n${lines.join('\n')}` };
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            return { text: 'Error: ctags not found. Install with: sudo apt install universal-ctags' };
          }
          return { text: `Error running ctags: ${err.message}` };
        }
      }
      case 'gradle_build': {
        // Verify gradlew exists in the repo
        const gradlew = path.join(repoPath, 'gradlew');
        if (!fs.existsSync(gradlew)) {
          return { text: 'Error: gradlew not found in repository root. Is this a Gradle project?' };
        }

        // Ensure gradlew is executable
        try {
          fs.chmodSync(gradlew, 0o755);
        } catch { /* ignore */ }

        const task = (args.task || 'build').trim();

        // Validate task name — only alphanumeric, hyphens, colons (e.g. "compileJava", "clean build", "fabric:build")
        if (!/^[a-zA-Z0-9:_\-\s]+$/.test(task)) {
          return { text: `Error: invalid Gradle task name: "${task}"` };
        }

        // Parse -P properties from "key=value key2=value2" string
        const propFlags: string[] = [];
        if (args.properties) {
          for (const pair of args.properties.trim().split(/\s+/)) {
            if (!pair) continue;
            // Validate: only word chars, dots, hyphens, equals, and simple values
            if (!/^[\w.\-]+=[\w.\-]*$/.test(pair)) {
              return { text: `Error: invalid property format: "${pair}". Use key=value format, e.g. "include_create=true"` };
            }
            propFlags.push(`-P${pair}`);
          }
        }

        const gradleArgs = [...task.trim().split(/\s+/), ...propFlags, '--console=plain', '--stacktrace'];

        let rawOutput = '';
        let exitCode = 0;
        try {
          rawOutput = execFileSync('./gradlew', gradleArgs, {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: MAX_GRADLE_TIMEOUT,
            env: { ...process.env, TERM: 'dumb' }, // suppress ANSI colour codes
          });
        } catch (err: any) {
          rawOutput = [err.stdout, err.stderr].filter(Boolean).join('\n');
          exitCode = err.status ?? 1;
        }

        const filtered = filterGradleOutput(rawOutput);
        const status = exitCode === 0 ? 'BUILD SUCCESSFUL' : 'BUILD FAILED';
        return { text: `${status}\n\n${filtered}` };
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
    cleanupInterruptedGitOps(workdir);
    waitForGitLock(workdir);
    try {
      retryGit(
        () => execFileSync('git', ['fetch', 'origin'], { cwd: workdir, encoding: 'utf-8', timeout: 30000 }),
        'fetch origin',
      );
    } catch (err: any) {
      // Fetch failure may indicate corrupted workdir — re-clone
      console.warn(`[agent] Fetch failed, re-cloning workdir: ${err.message}`);
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch (rmErr: any) {
        console.error(`[agent] Failed to remove corrupted workdir: ${rmErr.message}`);
        return '';
      }
      // Fall through to clone logic below
      return cloneWorkdir(warezPath, workdir, repoName, actions);
    }
    return workdir;
  }

  // If directory exists but is not a git clone (corrupted), remove and re-clone
  if (fs.existsSync(workdir)) {
    console.log(`[agent] Workdir exists but no .git — removing and re-cloning: ${workdir}`);
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  return cloneWorkdir(warezPath, workdir, repoName, actions);
}

function cloneWorkdir(warezPath: string, workdir: string, repoName: string, actions: AgentStep[]): string {
  // Create workdir base
  if (!fs.existsSync(WORKDIR_BASE)) {
    fs.mkdirSync(WORKDIR_BASE, { recursive: true });
  }

  // Clone from warez repo
  console.log(`[agent] Cloning from warez: ${warezPath} → ${workdir}`);
  try {
    retryGit(
      () => execFileSync('git', ['clone', warezPath, workdir],
        { encoding: 'utf-8', timeout: 60000 }),
      'clone',
    );
    configureGitIdentity(workdir);
    console.log(`[agent] Cloned successfully`);
    actions.push({ type: 'tool', tool: 'git_clone', args: { source: repoName }, result: 'Cloned from warez' });
  } catch (err: any) {
    console.error(`[agent] Clone failed: ${err.message}`);
    actions.push({ type: 'tool', tool: 'git_clone', args: { source: repoName }, result: `Clone error: ${err.message}` });
    // Clean up partial clone
    if (fs.existsSync(workdir)) {
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return ''; // empty string signals failure — caller checks with `if (!workdir)`
  }

  return workdir;
}

// Auto-init git for non-git directories and enable push support
function autoInitGit(repoPath: string, actions: AgentStep[]) {
  if (fs.existsSync(path.join(repoPath, '.git'))) return;
  console.log(`[agent] Initializing git in: ${repoPath}`);
  try {
    execFileSync('git', ['init'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    configureGitIdentity(repoPath);
    execFileSync('git', ['add', '-A'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    execFileSync('git', ['commit', `--author=${AGENT_GIT_AUTHOR}`, '-m', 'Initial commit', '--allow-empty'],
      { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    ensureReceivePush(repoPath);
    actions.push({ type: 'tool', tool: 'git_init', args: {}, result: 'Git initialized with initial commit' });
  } catch (err: any) {
    console.error(`[agent] Git init error: ${err.message}`);
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
  aborted?: boolean;
}

// --- Abort support ---
// Tracks running agent sessions so they can be cancelled externally.

interface RunningAgent {
  abortController: AbortController;
  workdir: string;
  snapshotCommit: string; // HEAD commit before agent started making changes
}

const runningAgents = new Map<string, RunningAgent>();

/** Abort a running agent for a given conversation. Resets workdir to pre-message state. */
export function abortAgent(conversationId: string): { aborted: boolean; message: string } {
  const entry = runningAgents.get(conversationId);
  if (!entry) {
    return { aborted: false, message: 'No running agent found for this conversation.' };
  }

  console.log(`[agent] Aborting agent for conversation: ${conversationId}`);
  entry.abortController.abort();

  // Reset workdir to the snapshot commit (state before this message)
  if (entry.workdir && entry.snapshotCommit && fs.existsSync(path.join(entry.workdir, '.git'))) {
    try {
      waitForGitLock(entry.workdir);
      cleanupInterruptedGitOps(entry.workdir);
      execFileSync('git', ['reset', '--hard', entry.snapshotCommit],
        { cwd: entry.workdir, encoding: 'utf-8', timeout: 10000 });
      // Clean up any untracked files the agent may have created
      execFileSync('git', ['clean', '-fd'],
        { cwd: entry.workdir, encoding: 'utf-8', timeout: 10000 });
      console.log(`[agent] Workdir reset to ${entry.snapshotCommit}`);
    } catch (err: any) {
      console.error(`[agent] Failed to reset workdir on abort: ${err.message}`);
    }
  }

  runningAgents.delete(conversationId);
  return { aborted: true, message: 'Agent aborted and workdir reverted.' };
}

/** Check if an agent is currently running for a conversation */
export function isAgentRunning(conversationId: string): boolean {
  return runningAgents.has(conversationId);
}

// --- Main agent runner using official Ollama client ---

const AGENT_REQUEST_TIMEOUT = 300000; // 5 minutes per Ollama request

const FILE_EXTENSION_LANGUAGES = '.py=Python, .ts=TypeScript, .js=JavaScript, .jsx/.tsx=React, .rs=Rust, .go=Go, .java=Java, .cpp/.cc/.c/.h/.hpp=C/C++, .rb=Ruby, .lua=Lua, .php=PHP, .swift=Swift, .kt=Kotlin, .cs=C#, .sh/.bash=Shell, .json=JSON, .yaml/.yml=YAML, .toml=TOML, .xml=XML, .html/.htm=HTML, .css=CSS, .scss/.sass=SCSS/Sass, .sql=SQL, .md=Markdown, .fth/.fs/.4th=Forth, .hs=Haskell, .ex/.exs=Elixir, .erl=Erlang, .clj=Clojure, .scala=Scala, .r/.R=R, .jl=Julia, .pl/.pm=Perl, .zig=Zig, .nim=Nim, .dart=Dart, .v=V, .ml/.mli=OCaml, .lisp/.cl=Common Lisp, .scm=Scheme, .asm/.s=Assembly, .ps1=PowerShell, .bat/.cmd=Batch, .dockerfile/Dockerfile=Dockerfile, .tf=Terraform, .proto=Protobuf, .graphql/.gql=GraphQL, .vue=Vue, .svelte=Svelte';

function getCurrentBranch(repoPath: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function hasUncommittedChanges(repoPath: string): boolean {
  try {
    refreshGitIndex(repoPath);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
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
    waitForGitLock(repoPath);
    refreshGitIndex(repoPath);
    retryGit(
      () => execFileSync('git', ['add', '-A'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }),
      'auto-commit add',
    );
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).trim();
    if (!status) return;
    console.log(`[agent] Auto-committing uncommitted changes`);
    retryGit(
      () => execFileSync('git', ['commit', `--author=${AGENT_GIT_AUTHOR}`, '-m', 'Agent: auto-commit changes'],
        { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }),
      'auto-commit',
    );
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
      const log = execFileSync('git', ['log', `origin/${branch}..HEAD`, '--oneline'],
        { cwd: workdir, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
      hasUnpushed = log.length > 0;
    } catch {
      // No upstream tracking branch yet — means everything is unpushed
      hasUnpushed = true;
    }
    if (!hasUnpushed) return;
    console.log(`[agent] Pushing branch ${branch} to warez`);
    waitForGitLock(workdir);
    try {
      retryGit(
        () => execFileSync('git', ['push', '-u', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 }),
        'push',
      );
    } catch {
      // Push rejected (non-fast-forward) — pull --rebase and retry once
      console.log(`[agent] Push rejected, attempting pull --rebase and retry`);
      try {
        execFileSync('git', ['pull', '--rebase', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
        execFileSync('git', ['push', '-u', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      } catch (rebaseErr: any) {
        // Rebase conflict — abort and force push as last resort
        cleanupInterruptedGitOps(workdir);
        console.warn(`[agent] Rebase failed (${rebaseErr.message}), force pushing`);
        execFileSync('git', ['push', '--force-with-lease', '-u', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
      }
    }
    actions.push({ type: 'tool', tool: 'git_push', args: { branch }, result: `Pushed ${branch} to hub` });
  } catch (err: any) {
    console.error(`[agent] Push failed: ${err.message}`);
    actions.push({ type: 'tool', tool: 'git_push', args: {}, result: `Push error: ${err.message}` });
  }
}

// [CHANGE 5] Reset workdir to snapshot commit and clean untracked files
function rollbackToSnapshot(workdir: string, snapshotCommit: string): void {
  if (!snapshotCommit || !fs.existsSync(path.join(workdir, '.git'))) return;
  try {
    waitForGitLock(workdir);
    cleanupInterruptedGitOps(workdir);
    execFileSync('git', ['reset', '--hard', snapshotCommit],
      { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
    execFileSync('git', ['clean', '-fd'],
      { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
    console.log(`[agent] Workdir rolled back to snapshot: ${snapshotCommit}`);
  } catch (err: any) {
    console.error(`[agent] Rollback failed: ${err.message}`);
  }
}

// Returns the argument that identifies *what* a tool is operating on,
// ignoring content arguments like `content` or `new_text`.
// This lets us detect loops based on the target rather than the payload.
function getPrimaryArg(toolName: string, args: Record<string, string>): string {
  switch (toolName) {
    case 'read_file':
      // Include line range so reading different sections of the same file is not flagged as a loop
      return `${args.file_path || ''}:${args.start_line || ''}:${args.end_line || ''}`;
    case 'write_file':
    case 'edit_file':
      return args.file_path || '';
    case 'list_files':
      return args.dir_path || '.';
    case 'search_files':
      return `${args.pattern || ''}@${args.dir_path || '.'}`;
    case 'run_command':
      return (args.command || '').trim().toLowerCase().replace(/\s+/g, ' ');
    case 'git_commit':
      // commits on the same message are suspicious but not the key loop indicator;
      // use a fixed token so any two consecutive git_commits count
      return '__commit__';
    case 'delete_file':
      return args.file_path || '';
    case 'move_file':
      return `${args.src_path || ''}→${args.dst_path || ''}`;
    case 'outline_file':
      return args.file_path || '';
    case 'gradle_build':
      return `${args.task || 'build'}:${args.properties || ''}`;
    case 'git_revert':
      return args.commit_hash || '';
    default:
      // For argument-free tools (git_status, git_diff, git_log) use the tool name
      // so three consecutive calls to git_diff count as a loop
      return toolName;
  }
}

// Core agent loop extracted so runAgent can retry it on loop failure
async function runAgentLoop(
  client: Ollama,
  model: string,
  messages: Message[],
  workdir: string,
  actions: AgentStep[],
  abortSignal: AbortSignal,
  isRetry: boolean,
): Promise<{ response: string; loopDetected: boolean }> {
  let lastResponse = '';
  // Tracks (tool:primaryArg) for consecutive repeat detection
  const recentToolTargets: string[] = [];
  const WRAP_UP_THRESHOLD = Math.floor(MAX_TOOL_ITERATIONS * 0.75);

  // [CHANGE 4] Track consecutive failures per (tool, args) signature
  const toolFailCounts: Record<string, number> = {};

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    if (abortSignal.aborted) {
      lastResponse = 'Agent execution was aborted.';
      break;
    }

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

    if (toolCalls.length === 0) {
      break;
    }

    // Capture inner monologue between tool calls
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

    // Detect repeated tool calls on the same primary target (file path, pattern, etc.)
    // We only care about the argument that identifies *what* is being operated on,
    // not the full content — so write_file(a,"hi1") and write_file(a,"hi2") both
    // count as targeting "a". Consecutive repeats on the same target signal a loop.
    for (const tc of toolCalls) {
      const primaryArg = getPrimaryArg(tc.function.name, (tc.function.arguments || {}) as Record<string, string>);
      const target = `${tc.function.name}:${primaryArg}`;
      recentToolTargets.push(target);
    }
    while (recentToolTargets.length > MAX_RECENT_TOOL_TARGETS) recentToolTargets.shift();

    // Count consecutive tail hits for the most recent target
    const lastTarget = recentToolTargets[recentToolTargets.length - 1];
    let consecutiveCount = 0;
    for (let k = recentToolTargets.length - 1; k >= 0; k--) {
      if (recentToolTargets[k] === lastTarget) consecutiveCount++;
      else break;
    }
    if (consecutiveCount >= MAX_REPEAT_COUNT) {
      console.log(`[agent] Loop detected: "${lastTarget}" repeated ${consecutiveCount} times consecutively`);
      return { response: lastResponse, loopDetected: true };
    }

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

      // [CHANGE 4] Track tool failures and inject a system message after 2 consecutive failures
      if (result.text.startsWith('Error:')) {
        const failKey = `${toolName}:${JSON.stringify(toolArgs)}`;
        toolFailCounts[failKey] = (toolFailCounts[failKey] || 0) + 1;
        if (toolFailCounts[failKey] >= 2) {
          console.log(`[agent] Tool ${toolName} failed twice with same args — injecting redirect hint`);
          messages.push({
            role: 'system',
            content: `${toolName} has failed twice with the same arguments. You MUST try a completely different approach now — do not repeat the same call again.`,
          });
        }
      }

      const resultRole = parsedFromText ? 'user' : 'tool';
      const resultContent = parsedFromText
        ? `[Tool result for ${toolName}]: ${truncateToolResult(result.text)}`
        : truncateToolResult(result.text);
      messages.push({ role: resultRole, content: resultContent });
    }
  }

  return { response: lastResponse, loopDetected: false };
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

  const abortController = new AbortController();
  const abortSignal = abortController.signal;

  const ollamaHost = process.env.LLM_API_URL || 'http://localhost:11434';
  const client = new Ollama({
    host: ollamaHost,
    fetch: (url: RequestInfo | URL, init?: RequestInit) => {
      const timeoutSignal = AbortSignal.timeout(AGENT_REQUEST_TIMEOUT);
      const combinedSignal = AbortSignal.any([abortSignal, timeoutSignal]);
      return fetch(url, { ...init, signal: combinedSignal });
    },
  });

  // Ensure warez repo is git-initialized and accepts pushes
  if (!isBareRepo(repoPath)) {
    if (fs.existsSync(path.join(repoPath, '.git'))) {
      ensureReceivePush(repoPath);
    } else {
      autoInitGit(repoPath, actions);
    }
  }

  const workdir = ensureAgentWorkdir(repoPath, repoName, conversationId, actions);
  if (!workdir) {
    return { response: 'Error: could not create agent workspace.', actions, currentBranch: '' };
  }

  cleanupInterruptedGitOps(workdir);

  if (branch && /^[\w.\-/]+$/.test(branch)) {
    try {
      waitForGitLock(workdir);
      const currentBranch = getCurrentBranch(workdir);
      if (currentBranch !== branch) {
        console.log(`[agent] Checking out branch: ${branch}`);
        try {
          const status = execFileSync('git', ['status', '--porcelain'], { cwd: workdir, encoding: 'utf-8', timeout: 10000 }).trim();
          if (status) {
            execFileSync('git', ['stash', '--include-untracked'], { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
          }
        } catch { /* ignore stash failures */ }
        try {
          execFileSync('git', ['checkout', branch], { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
        } catch {
          execFileSync('git', ['checkout', '-b', branch, `origin/${branch}`], { cwd: workdir, encoding: 'utf-8', timeout: 10000 });
        }
        actions.push({ type: 'tool', tool: 'git_checkout', args: { branch }, result: `Switched to branch: ${branch}` });
      }
      try {
        console.log(`[agent] Pulling latest changes for branch: ${branch}`);
        const pullOutput = execFileSync('git', ['pull', '--rebase', 'origin', branch],
          { cwd: workdir, encoding: 'utf-8', timeout: 30000 });
        actions.push({ type: 'tool', tool: 'git_pull', args: { branch }, result: pullOutput.trim() || 'Already up to date' });
      } catch {
        cleanupInterruptedGitOps(workdir);
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
        waitForGitLock(workdir);
        const existingBranches = execFileSync('git', ['branch', '--list'], { cwd: workdir, encoding: 'utf-8', timeout: 10000 })
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
- outline_file: ALWAYS use this first on any file over ~100 lines to see its structure before reading
- read_file: To read file contents — use after outline_file to target only the relevant section via start_line/end_line. Always add ~5 lines of padding on both sides of the target range so edit_file has enough context to form a unique old_text.
- edit_file: For modifying EXISTING files — replaces a specific text block (search/replace). More precise than write_file. When you read only part of a file, make sure old_text includes at least 2-3 lines of surrounding context above and below the change to ensure it is unique in the full file.
- write_file: For CREATING new files or when the entire file needs rewriting
- delete_file: To remove a file entirely during refactoring or cleanup
- move_file: To rename or relocate a file — preserves content, use instead of read+write+delete
- search_files: To find where functions/variables/patterns are used across the codebase
- gradle_build: To compile or build Gradle/Minecraft mod projects — use instead of run_command for all Gradle tasks. Supports -P flags via the properties parameter (e.g. properties: "include_create=true offline=true")
- run_command: To execute non-Gradle builds, tests, linters (e.g. "npm test", "python -m pytest", "make build")
- list_files: To explore directory structure

PROGRESS TRACKING (follow for every tool call):
Before each tool call, write one line:
  DOING: [tool_name] — [one sentence why, it must justify this call based on your previous thinking and tool results]
If you are about to make a tool call you cannot justify, or you notice you are creating an endless cycle of calls, write instead:
  ABORT: [why] — then change strategy.
After getting the tool result, write one line:
  LEARNED: [what the result of the tool call tells you and what you have achieved with it]

IMPORTANT RULES:
- Do NOT create new branches. The branch has already been created for you.
- After completing changes, describe exactly what you changed: which files were modified/created, what was added/removed.${createdBranch ? `\n- Mention that changes were made on branch "${createdBranch}".` : ''}
- When working with files, ALWAYS determine the programming language FIRST by file extension (${FILE_EXTENSION_LANGUAGES}), and only if the extension is ambiguous or missing, then by content (shebangs, syntax patterns). Write code in the same programming language as the file.
- When writing entire files, include ALL the content — do not use placeholders like "// rest of the code".
- Prefer edit_file over write_file for existing files — it is safer and preserves unchanged parts.
- When using edit_file after reading only part of a file, old_text MUST include at least 2-3 lines of surrounding context above and below the actual change to ensure it matches exactly once in the full file. If you are not confident old_text is unique, read more context first.
- If a tool returns an error, explain what went wrong and try a different approach. If edit_file fails twice, switch to write_file.
- Do NOT re-read a file right after editing it — the edit_file/write_file result already confirms the change. Move on to the next task.
- Do NOT read the same file more than once in a row — you already have its content from the first read. Use the content you received immediately.
- AVOID loops of tool calls: if you find yourself calling the same tools repeatedly, STOP and either try a different approach or finish up.
- Every tool call MUST make concrete progress toward completing the task. If a tool call wouldn't change anything, don't make it.
- You can revert to a previous commit using git_revert if needed (use git_log to find the commit hash).
- ALWAYS commit your changes with git_commit before finishing. If there is any diff (git_diff shows changes), you MUST commit. Never leave uncommitted changes. Push happens automatically after you finish.
- Make small, focused, atomic changes. Avoid mixing unrelated changes in one edit.
- If you made ANY file changes, you MUST call git_commit as your final action. Check with git_status first. Absolutely no uncommitted changes may remain. Push is handled automatically.

Answer in the language the user writes in. Be concise about tool usage but explain what you're doing.`;

  const buildMessages = (): Message[] => [
    { role: 'system', content: systemPrompt },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  // Capture snapshot commit for rollback support
  let snapshotCommit = '';
  try {
    snapshotCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workdir, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch (err: any) {
    console.warn(`[agent] Could not capture snapshot commit: ${err.message || String(err)}`);
  }

  runningAgents.set(conversationId, { abortController, workdir, snapshotCommit });

  try {
    // [CHANGE 5] First attempt
    const firstAttempt = await runAgentLoop(client, model, buildMessages(), workdir, actions, abortSignal, false);

    if (abortSignal.aborted) {
      runningAgents.delete(conversationId);
      return {
        response: firstAttempt.response || 'Agent execution was aborted.',
        actions,
        currentBranch: getCurrentBranch(workdir),
        aborted: true,
      };
    }

    // [CHANGE 5] If loop detected: rollback, notify the model, retry once
    if (firstAttempt.loopDetected) {
      console.log(`[agent] Loop detected on first attempt — rolling back and retrying`);
      rollbackToSnapshot(workdir, snapshotCommit);
      actions.push({
        type: 'thinking',
        content: 'Loop detected: the agent got stuck repeating tool calls. Rolling back changes and retrying the task with a fresh approach.',
      });

      // Inject self-notification into the message history for the retry
      const retryMessages = buildMessages();
      retryMessages.push({
        role: 'system',
        content: `RETRY NOTICE: Your previous attempt at this task got stuck in a tool call loop and was automatically rolled back. The codebase is now back to its original state. Please approach the task differently this time — avoid repeating the same sequence of tool calls. Think carefully about the minimal set of steps needed.`,
      });

      const secondAttempt = await runAgentLoop(client, model, retryMessages, workdir, actions, abortSignal, true);

      if (secondAttempt.loopDetected) {
        console.log(`[agent] Loop detected on retry — giving up`);
        rollbackToSnapshot(workdir, snapshotCommit);
        runningAgents.delete(conversationId);
        return {
          response: 'I was unable to complete this task — I got stuck in a loop on both attempts. Please try rephrasing the request or breaking it into smaller steps.',
          actions,
          currentBranch: getCurrentBranch(workdir),
        };
      }

      autoCommitChanges(workdir, actions);
      pushToWarez(workdir, actions);
      console.log(`[agent] Done (retry). Branch: ${getCurrentBranch(workdir)}, actions: ${actions.length}`);
      runningAgents.delete(conversationId);
      return {
        response: secondAttempt.response || 'Done.',
        actions,
        currentBranch: getCurrentBranch(workdir),
      };
    }

    autoCommitChanges(workdir, actions);
    pushToWarez(workdir, actions);
    console.log(`[agent] Done. Branch: ${getCurrentBranch(workdir)}, actions: ${actions.length}`);
    runningAgents.delete(conversationId);
    return {
      response: firstAttempt.response || 'Done.',
      actions,
      currentBranch: getCurrentBranch(workdir),
    };

  } catch (err: any) {
    if (abortSignal.aborted) {
      console.log(`[agent] Agent aborted for conversation: ${conversationId}`);
      runningAgents.delete(conversationId);
      return {
        response: 'Agent execution was aborted.',
        actions,
        currentBranch: getCurrentBranch(workdir),
        aborted: true,
      };
    }

    console.error(`[agent] Error: ${err.message || String(err)}`);
    autoCommitChanges(workdir, actions);
    pushToWarez(workdir, actions);

    runningAgents.delete(conversationId);
    return {
      response: `Agent error: ${err.message || String(err)}`,
      actions,
      currentBranch: getCurrentBranch(workdir),
    };
  }
}