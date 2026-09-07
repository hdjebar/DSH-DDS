// config/worktree-staging.mjs
/**
 * 🌲 Transactional Workspace Staging via Ephemeral Git Worktrees
 * Enforces Invariant 5: Transactional Snapshots & Zero-Diff Rollback
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function sanitizeTaskId(taskId) {
  const clean = String(taskId || 'task').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean.slice(0, 64) || 'default';
}

export class TransactionalWorktree {
  constructor(baseRepoPath) {
    this.baseRepoPath = baseRepoPath;
    this.stagePath = null;
    this.branchName = null;
    this.active = false;
  }

  assertGitRepo() {
    try {
      const out = execFileSync('git', ['-C', this.baseRepoPath, 'rev-parse', '--is-inside-work-tree'], {
        stdio: 'pipe',
        encoding: 'utf8'
      }).trim();
      if (out !== 'true') {
        throw new Error(`Path '${this.baseRepoPath}' is not inside a git work tree`);
      }
    } catch (err) {
      throw new Error(`Git repository validation failed for '${this.baseRepoPath}': ${err.message}`);
    }
  }

  begin(taskId = 'generic') {
    this.assertGitRepo();

    const safeId = sanitizeTaskId(taskId);
    this.branchName = `dsh-task-${safeId}-${Date.now()}`;
    this.stagePath = mkdtempSync(join(tmpdir(), 'dsh-worktree-'));

    try {
      execFileSync('git', [
        '-C', this.baseRepoPath,
        'worktree', 'add', '-b', this.branchName, this.stagePath, 'HEAD'
      ], { stdio: 'pipe' });
      this.active = true;
      return this.stagePath;
    } catch (err) {
      this.cleanup();
      throw new Error(`Failed to create transactional git worktree: ${err.message}`);
    }
  }

  commit(commitMessage = 'apply transactional agent patch') {
    if (!this.active || !this.stagePath) {
      throw new Error('Cannot commit: no active transactional worktree session');
    }

    try {
      execFileSync('git', ['-C', this.stagePath, 'add', '-A'], { stdio: 'pipe' });

      // Check if there are any changes to commit
      const status = execFileSync('git', ['-C', this.stagePath, 'status', '--porcelain'], {
        stdio: 'pipe',
        encoding: 'utf8'
      }).trim();

      if (status.length > 0) {
        execFileSync('git', ['-C', this.stagePath, 'commit', '-m', commitMessage], { stdio: 'pipe' });
      }

      // Fast-forward merge into base repository
      execFileSync('git', ['-C', this.baseRepoPath, 'merge', '--ff-only', this.branchName], { stdio: 'pipe' });
      return { success: true, merged: true, branch: this.branchName };
    } finally {
      this.cleanup();
    }
  }

  rollback() {
    this.cleanup();
    return { success: true, rolled_back: true };
  }

  cleanup() {
    if (this.stagePath) {
      if (this.baseRepoPath && existsSync(this.baseRepoPath)) {
        try {
          execFileSync('git', ['-C', this.baseRepoPath, 'worktree', 'remove', '--force', this.stagePath], {
            stdio: 'pipe'
          });
        } catch (_) {}

        if (this.branchName) {
          try {
            execFileSync('git', ['-C', this.baseRepoPath, 'branch', '-D', this.branchName], {
              stdio: 'pipe'
            });
          } catch (_) {}
        }
      }

      if (existsSync(this.stagePath)) {
        try {
          rmSync(this.stagePath, { recursive: true, force: true });
        } catch (_) {}
      }

      this.stagePath = null;
      this.branchName = null;
      this.active = false;
    }
  }
}

/**
 * Executes workFn inside an ephemeral worktree.
 * Automatically merges on success or rolls back with zero diff on failure.
 */
export async function withTransactionalWorktree(baseRepoPath, taskId, workFn, options = {}) {
  const worktree = new TransactionalWorktree(baseRepoPath);
  const stagePath = worktree.begin(taskId);

  try {
    const result = await workFn(stagePath);

    // Optional verification command (e.g. test runner)
    if (options.testCommand) {
      const [cmd, ...args] = Array.isArray(options.testCommand)
        ? options.testCommand
        : options.testCommand.split(' ');
      execFileSync(cmd, args, {
        cwd: stagePath,
        stdio: 'pipe'
      });
    }

    const commitMsg = options.commitMessage || `chore(dsh): apply changes for ${taskId}`;
    worktree.commit(commitMsg);
    return {
      success: true,
      result,
      rolled_back: false
    };
  } catch (err) {
    worktree.rollback();
    return {
      success: false,
      error: err.message,
      rolled_back: true
    };
  }
}
