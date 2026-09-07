/**
 * User Partition Manager for @dsh-dds/core
 *
 * Implements filesystem namespacing and storage isolation for multi-tenant users:
 * - /var/lib/dsh/users/<userId>/sessions
 * - /var/lib/dsh/users/<userId>/storages
 * - /var/lib/dsh/users/<userId>/preferences
 * - /workspaces/users/<userId>
 * - /workspaces/shared
 */

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeUserId } from './iam.js';

export class UserPartitionManager {
  constructor(options = {}) {
    this.userStateBase = options.userStateBase || process.env.DSH_USER_STATE_BASE || '/var/lib/dsh/users';
    this.workspaceBase = options.workspaceBase || process.env.DSH_WORKSPACE_ROOT || '/workspaces';
  }

  getUserPaths(userId) {
    const cleanId = sanitizeUserId(userId);
    const userDir = path.resolve(this.userStateBase, cleanId);
    return {
      userId: cleanId,
      root: userDir,
      sessions: path.join(userDir, 'sessions'),
      storages: path.join(userDir, 'storages'),
      preferences: path.join(userDir, 'preferences'),
      workspace: path.resolve(this.workspaceBase, 'users', cleanId),
      sharedWorkspace: path.resolve(this.workspaceBase, 'shared')
    };
  }

  ensureUserPartition(userId) {
    const paths = this.getUserPaths(userId);
    const dirsToCreate = [
      paths.root,
      paths.sessions,
      paths.storages,
      paths.preferences
    ];

    for (const dir of dirsToCreate) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
        } catch (err) {
          // Gracefully continue in read-only test environments
        }
      }
    }
    return paths;
  }

  /**
   * Evaluates if a target path is permissible for a given user.
   * Admins are unconstrained.
   * Standard users may only access:
   * 1. Their own user state partition: /var/lib/dsh/users/<userId>/...
   * 2. Their own workspace: /workspaces/users/<userId>/...
   * 3. The shared workspace: /workspaces/shared/...
   */
  validatePathAccess(targetPath, user) {
    if (!targetPath || typeof targetPath !== 'string') {
      return { allowed: false, reason: 'Invalid or missing target path' };
    }

    const roles = Array.isArray(user?.roles) ? user.roles : ['user'];
    if (roles.includes('admin')) {
      return { allowed: true, reason: 'Admin role grants unrestricted access' };
    }

    const userId = sanitizeUserId(user?.id);
    const resolvedTarget = path.resolve(targetPath);
    const userPaths = this.getUserPaths(userId);

    const isInside = (target, base) => {
      const rel = path.relative(base, target);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    };

    // Check allowed roots
    const allowedRoots = [
      userPaths.root,
      userPaths.workspace,
      userPaths.sharedWorkspace
    ];

    const isAllowed = allowedRoots.some(root => isInside(resolvedTarget, root) || resolvedTarget === root);
    if (isAllowed) {
      return { allowed: true, reason: 'Target path within authorized user boundaries' };
    }

    // Check if user is attempting to access another user's partition
    const otherUsersRoot = path.resolve(this.userStateBase);
    const otherUsersWorkspace = path.resolve(this.workspaceBase, 'users');

    if (
      (isInside(resolvedTarget, otherUsersRoot) && !isInside(resolvedTarget, userPaths.root)) ||
      (isInside(resolvedTarget, otherUsersWorkspace) && !isInside(resolvedTarget, userPaths.workspace))
    ) {
      return {
        allowed: false,
        reason: `Multi-tenant violation: User '${userId}' attempted to access private partition of another user at '${targetPath}'`
      };
    }

    return {
      allowed: false,
      reason: `Target path '${targetPath}' outside allowed workspace boundaries (/workspaces/users/${userId} or /workspaces/shared)`
    };
  }
}
