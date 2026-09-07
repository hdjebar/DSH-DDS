import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { TransactionalWorktree, withTransactionalWorktree } from '../config/worktree-staging.mjs';

function setupMockGitRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-repo-'));
  execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'DSH Test User'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@dsh.local'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDir, stdio: 'pipe' });

  // Create initial commit
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Initial Repository\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: tmpDir, stdio: 'pipe' });

  return tmpDir;
}

test('TransactionalWorktree: rejects paths outside git work tree', () => {
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
  try {
    const worktree = new TransactionalWorktree(nonGitDir);
    assert.throws(
      () => worktree.begin('test-fail'),
      /Git repository validation failed/
    );
  } finally {
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  }
});

test('TransactionalWorktree: creates isolated worktree, commits, and fast-forward merges', () => {
  const repoDir = setupMockGitRepo();
  try {
    const initialSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    const worktree = new TransactionalWorktree(repoDir);
    const stagePath = worktree.begin('feature-1');

    assert.ok(fs.existsSync(stagePath), 'Worktree staging path must exist on disk');
    assert.ok(worktree.branchName.startsWith('dsh-task-feature-1-'), 'Branch name must be properly slugified');

    // Make changes in the staged worktree
    fs.writeFileSync(path.join(stagePath, 'feature.js'), 'console.log("feature active");\n');

    // Commit and merge
    const res = worktree.commit('feat: add feature.js');
    assert.equal(res.success, true);
    assert.equal(res.merged, true);

    // Verify stagePath was wiped
    assert.equal(fs.existsSync(stagePath), false, 'Worktree directory must be removed after commit');

    // Verify base repository received the change
    const newSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.notEqual(newSha, initialSha, 'Base repository HEAD must advance after fast-forward merge');
    assert.ok(fs.existsSync(path.join(repoDir, 'feature.js')), 'feature.js must exist in base repository');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('TransactionalWorktree: rollback discards changes with zero diff on base branch', () => {
  const repoDir = setupMockGitRepo();
  try {
    const initialSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    const worktree = new TransactionalWorktree(repoDir);
    const stagePath = worktree.begin('failed-task');

    // Make breaking changes in staged worktree
    fs.writeFileSync(path.join(stagePath, 'broken.js'), 'malformed syntax {{{');

    // Rollback
    const rollbackRes = worktree.rollback();
    assert.equal(rollbackRes.success, true);
    assert.equal(rollbackRes.rolled_back, true);

    // Verify stagePath was wiped
    assert.equal(fs.existsSync(stagePath), false, 'Worktree directory must be removed after rollback');

    // Verify base repository is completely untouched
    const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.equal(currentSha, initialSha, 'Base repository HEAD must not move on rollback');
    assert.equal(fs.existsSync(path.join(repoDir, 'broken.js')), false, 'broken.js must not exist in base repo');

    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.equal(status, '', 'Base repository must have zero uncommitted changes');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('withTransactionalWorktree: auto-merges on success and auto-rolls back on failure', async () => {
  const repoDir = setupMockGitRepo();
  try {
    // 1. Success execution
    const successRes = await withTransactionalWorktree(repoDir, 'auto-success', async (stagedPath) => {
      fs.writeFileSync(path.join(stagedPath, 'auto.txt'), 'hello world');
      return { created: true };
    });

    assert.equal(successRes.success, true);
    assert.equal(successRes.rolled_back, false);
    assert.ok(fs.existsSync(path.join(repoDir, 'auto.txt')));

    // 2. Failure execution with rollback
    const failRes = await withTransactionalWorktree(repoDir, 'auto-failure', async (stagedPath) => {
      fs.writeFileSync(path.join(stagedPath, 'should_disappear.txt'), 'doomed');
      throw new Error('Simulation failed validation');
    });

    assert.equal(failRes.success, false);
    assert.equal(failRes.rolled_back, true);
    assert.match(failRes.error, /Simulation failed validation/);
    assert.equal(fs.existsSync(path.join(repoDir, 'should_disappear.txt')), false);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
