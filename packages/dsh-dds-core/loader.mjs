/**
 * @dsh-dds/core — Universal Runtime Compatibility & Sandboxing Loader
 *
 * Executed via NODE_OPTIONS="--import @dsh-dds/core/loader.mjs" before application entry.
 * Completely eliminates per-plugin, per-provider, and per-model disk patching.
 */

import { register } from 'node:module';
import child_process from 'node:child_process';
import fs from 'node:fs';

// 1. Register ESM Module Customization Hooks in-process
try {
  register(new URL('./loader-hooks.mjs', import.meta.url));
} catch (err) {
  // If register is already active or in worker thread, continue
}

// 2. Global Subprocess Working Directory & Landlock Argument Guard
const origSpawn = child_process.spawn;
const origSpawnSync = child_process.spawnSync;

function sanitizeWorkdir(options) {
  if (options && typeof options === 'object' && options.cwd) {
    if (!fs.existsSync(options.cwd)) {
      try {
        fs.mkdirSync(options.cwd, { recursive: true });
      } catch {
        options.cwd = fs.existsSync('/workspaces/cases')
          ? '/workspaces/cases'
          : (fs.existsSync('/home/dsh') ? '/home/dsh' : process.cwd());
      }
    }
  }
}

function sanitizeLandlockArgs(args) {
  if (!Array.isArray(args)) return;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rw' || args[i] === '--ro') {
      const p = args[i + 1];
      if (p && typeof p === 'string') {
        if (!fs.existsSync(p)) {
          try {
            fs.mkdirSync(p, { recursive: true });
          } catch {
            // Remove nonexistent path so landlock-run doesn't exit 125
            args.splice(i, 2);
            i--;
          }
        }
      }
    }
  }
}

function interceptChildProcess(origFn, self, args) {
  const cmd = args[0];
  const procArgs = Array.isArray(args[1]) ? args[1] : [];
  const options = (typeof args[1] === 'object' && !Array.isArray(args[1])) ? args[1] : (args[2] || {});

  sanitizeWorkdir(options);

  if (typeof cmd === 'string' && (cmd.includes('landlock-run') || procArgs.includes('--rw'))) {
    sanitizeLandlockArgs(procArgs);
  }

  return origFn.apply(self, args);
}

child_process.spawn = function(...args) {
  return interceptChildProcess(origSpawn, this, args);
};

child_process.spawnSync = function(...args) {
  return interceptChildProcess(origSpawnSync, this, args);
};

// 3. Dynamic Prototype Augmentations (In-Memory)
function applyPrototypeAugmentations() {
  // Session.prototype.events accessor
  try {
    import('@deepseek-ai/dsh-session').then(({ Session }) => {
      if (Session?.prototype && !Object.getOwnPropertyDescriptor(Session.prototype, 'events')) {
        Object.defineProperty(Session.prototype, 'events', {
          get() {
            return typeof this.snapshotEvents === 'function' ? this.snapshotEvents() : [];
          },
          enumerable: true,
          configurable: true
        });
      }
    }).catch(() => {});
  } catch {}

  // LocalBashExecutor.prototype.spawnSpec safe workdir
  try {
    import('@deepseek-ai/dsh-bash-local').then(({ LocalBashExecutor }) => {
      if (LocalBashExecutor?.prototype && !LocalBashExecutor.prototype.__ddsShimApplied) {
        const origSpawnSpec = LocalBashExecutor.prototype.spawnSpec;
        if (typeof origSpawnSpec === 'function') {
          LocalBashExecutor.prototype.spawnSpec = function(spec, argv, stdoutMaxBytes, signal) {
            if (spec && spec.workdir && !fs.existsSync(spec.workdir)) {
              try {
                fs.mkdirSync(spec.workdir, { recursive: true });
              } catch {
                spec.workdir = fs.existsSync('/workspaces/cases')
                  ? '/workspaces/cases'
                  : (fs.existsSync('/home/dsh') ? '/home/dsh' : process.cwd());
              }
            }
            return origSpawnSpec.call(this, spec, argv, stdoutMaxBytes, signal);
          };
          LocalBashExecutor.prototype.__ddsShimApplied = true;
        }
      }
    }).catch(() => {});
  } catch {}
}

applyPrototypeAugmentations();

// Periodic tick to catch dynamically loaded modules after pnpm updates
setTimeout(applyPrototypeAugmentations, 1000);
setTimeout(applyPrototypeAugmentations, 5000);
