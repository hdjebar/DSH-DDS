/**
 * @dsh-dds/core — First-Class Native Cordis Plugin
 *
 * Provides:
 * 1. WebServer Gateway Adapter & Loopback Peer Normalizer
 * 2. Dedicated Authenticated Lifecycle Restart Route (/dsh-dds/lifecycle/restart)
 * 3. In-Process Event-Driven ModelCatalogService
 * 4. Runtime Web UI Localization Tap (webServer.tapIndex)
 * 5. In-Line Zero-Trust RBAC Policy Enforcement Point (PEP)
 */

import fs from 'node:fs';
import { registerGatewayMiddleware } from './gateway.js';
import { ModelCatalogService } from './model-catalog.js';
import { registerLocalizationTap } from './localization.js';
import { registerRbacInterceptor, TOOL_ACTION_MAP, KNOWN_POLICY_VERBS } from './rbac-interceptor.js';
import { registerLlmGateway, LlmSemanticGateway } from './llm-gateway.js';
import { registerWebSearchFallback, resilientSearch, parseDuckDuckGoHtml, fetchSearchUrl, executeDuckDuckGoSearch } from './web-search.js';
import { registerIamMiddleware, IamService, extractUserFromHeaders, verifyBearerToken, DEFAULT_OPERATOR } from './iam.js';
import { UserPartitionManager } from './user-partition.js';
import { ByokVault, encryptSecret, decryptSecret, handleVaultApiRequest } from './byok-vault.js';

export const name = '@dsh-dds/core';

// Cordis service injection declarations (activate immediately, hook webServer dynamically)
export const inject = [];

export function apply(ctx, config = {}) {
  // 1. Identity & Access Management (IAM)
  const iam = registerIamMiddleware(ctx, config);

  // 2. User Filesystem Partitioning & BYOK Vault
  const userPartition = new UserPartitionManager(config);
  let byokVaultInstance = null;
  const getByokVault = () => {
    if (!byokVaultInstance) {
      byokVaultInstance = new ByokVault(config);
    }
    return byokVaultInstance;
  };

  if (typeof ctx.provide === 'function') {
    try { ctx.provide('userPartition', userPartition); } catch {}
    try {
      const vaultProxy = new Proxy({}, {
        get(target, prop) {
          const vault = getByokVault();
          const val = vault[prop];
          return typeof val === 'function' ? val.bind(vault) : val;
        }
      });
      ctx.provide('byokVault', vaultProxy);
    } catch {}
  }

  // 3. WebServer Gateway & Lifecycle Supervisor
  const setupWebServer = (c) => {
    registerGatewayMiddleware(c, config);
    registerLocalizationTap(c);
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => setupWebServer(webCtx));
  } else {
    try {
      if (ctx.webServer) setupWebServer(ctx);
    } catch {}
  }

  // 2. In-Process ModelCatalogService
  const modelCatalog = new ModelCatalogService(ctx, config);
  if (typeof ctx.provide === 'function') {
    ctx.provide('modelCatalog', modelCatalog);
  }
  modelCatalog.start();

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      modelCatalog.stop();
    });
  }

  // 3. In-Line Zero-Trust RBAC Policy Enforcement Point (PEP)
  registerRbacInterceptor(ctx, config);

  // 4. Universal LLM Semantic Protocol Gateway
  registerLlmGateway(ctx, config);

  // 5. In-Memory Session Events Prototype Shim
  registerSessionEventsShim();

  // 6. In-Memory Bash Workdir Auto-Creation & Safe Fallback Shim
  registerBashWorkdirShim();

  // 7. Resilient Zero-Key Web Search Fallback Engine
  registerWebSearchFallback(ctx);

  console.log('✅ [@dsh-dds/core] Native Cordis core plugin initialized successfully.');
}

/**
 * Dynamic Session.prototype.events accessor shim for dsh-mnemon / dsh-session-reader.
 * Bridges upstream @deepseek-ai/dsh-session to expose events as an iterable Array.
 */
export function registerSessionEventsShim(targetClass) {
  try {
    const Session = targetClass || (typeof globalThis !== 'undefined' && globalThis.__DSH_SESSION_CLASS__);
    if (Session?.prototype && !Object.getOwnPropertyDescriptor(Session.prototype, 'events')) {
      Object.defineProperty(Session.prototype, 'events', {
        get() {
          return typeof this.snapshotEvents === 'function' ? this.snapshotEvents() : [];
        },
        enumerable: true,
        configurable: true
      });
    }
  } catch {}
}

/**
 * Dynamic LocalBashExecutor.prototype.spawnSpec shim to ensure spec.workdir exists
 * and falls back safely to /workspaces/cases or /home/dsh if creation fails.
 */
export function registerBashWorkdirShim(targetClass) {
  try {
    const Executor = targetClass || (typeof globalThis !== 'undefined' && globalThis.__DSH_BASH_EXECUTOR_CLASS__);
    if (Executor?.prototype && !Executor.prototype.__workdirShimApplied) {
      const origSpawnSpec = Executor.prototype.spawnSpec;
      if (typeof origSpawnSpec === 'function') {
        Executor.prototype.spawnSpec = function(spec, argv, stdoutMaxBytes, signal) {
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
        Executor.prototype.__workdirShimApplied = true;
      }
    }
  } catch {}
}

// Attempt immediate dynamic resolution for in-process session and bash modules
if (typeof process !== 'undefined' && process.versions?.node) {
  import('@deepseek-ai/dsh-session').then(({ Session }) => {
    registerSessionEventsShim(Session);
  }).catch(() => {});

  import('@deepseek-ai/dsh-bash-local').then(({ LocalBashExecutor }) => {
    registerBashWorkdirShim(LocalBashExecutor);
  }).catch(() => {});
}

export {
  registerGatewayMiddleware,
  ModelCatalogService,
  registerLocalizationTap,
  registerRbacInterceptor,
  TOOL_ACTION_MAP,
  KNOWN_POLICY_VERBS,
  registerLlmGateway,
  LlmSemanticGateway,
  registerWebSearchFallback,
  resilientSearch,
  parseDuckDuckGoHtml,
  fetchSearchUrl,
  executeDuckDuckGoSearch,
  registerIamMiddleware,
  IamService,
  extractUserFromHeaders,
  verifyBearerToken,
  DEFAULT_OPERATOR,
  UserPartitionManager,
  ByokVault,
  encryptSecret,
  decryptSecret,
  handleVaultApiRequest
};


