/**
 * Bring-Your-Own-Key (BYOK) Encrypted Vault for @dsh-dds/core
 *
 * Provides AES-256-GCM encrypted storage for user-specific API keys:
 * - Gemini, OpenRouter, Tavily, GitHub tokens
 * - Ephemeral in-memory resolution during user execution turns
 * - Zero plaintext disk exposure
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeUserId } from './iam.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

export function deriveKey(masterSecret, salt) {
  if (!masterSecret) {
    throw new Error('Master secret is required for key derivation');
  }
  return crypto.scryptSync(masterSecret, salt, 32);
}

export function encryptSecret(plaintext, masterSecret) {
  if (typeof plaintext !== 'string') {
    throw new Error('Plaintext secret must be a string');
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterSecret, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64'),
    version: 2
  };
}

export function decryptSecret(payload, masterSecret) {
  if (!payload || !payload.ciphertext || !payload.iv || !payload.tag || !payload.salt) {
    throw new Error('Invalid encrypted secret payload structure');
  }
  if (payload.version && payload.version < 2) {
    throw new Error('DEPRECATED_VAULT_PAYLOAD: Legacy v1 vault payload format is no longer accepted.');
  }
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const key = deriveKey(masterSecret, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export class ByokVault {
  constructor(options = {}) {
    this.masterSecret = options.masterSecret || process.env.DSH_VAULT_MASTER_KEY;
    if (!this.masterSecret || this.masterSecret.length < 32) {
      throw new Error(
        'VAULT_MASTER_KEY_MISSING: set DSH_VAULT_MASTER_KEY (>=32 chars) before using the BYOK vault.'
      );
    }
    this.userStateBase = options.userStateBase || process.env.DSH_USER_STATE_BASE || '/var/lib/dsh/users';
  }

  getVaultPath(userId) {
    const cleanId = sanitizeUserId(userId);
    return path.join(this.userStateBase, cleanId, 'storages', 'vault.enc.json');
  }

  loadVault(userId) {
    const vaultPath = this.getVaultPath(userId);
    if (!fs.existsSync(vaultPath)) {
      return {};
    }
    try {
      const data = fs.readFileSync(vaultPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  saveVault(userId, vaultData) {
    const vaultPath = this.getVaultPath(userId);
    const dir = path.dirname(vaultPath);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
    }
    fs.writeFileSync(vaultPath, JSON.stringify(vaultData, null, 2), { mode: 0o600 });
  }

  setApiKey(userId, provider, apiKey) {
    if (!provider || !apiKey) {
      throw new Error('Provider and apiKey are required');
    }
    const cleanProvider = provider.trim().toLowerCase();
    const encrypted = encryptSecret(apiKey, this.masterSecret);

    const vault = this.loadVault(userId);
    vault[cleanProvider] = {
      ...encrypted,
      updatedAt: new Date().toISOString()
    };
    this.saveVault(userId, vault);
    return true;
  }

  getApiKey(userId, provider) {
    if (!provider) return null;
    const cleanProvider = provider.trim().toLowerCase();
    const vault = this.loadVault(userId);
    const entry = vault[cleanProvider];
    if (!entry) return null;

    try {
      return decryptSecret(entry, this.masterSecret);
    } catch (err) {
      console.error(`Failed to decrypt API key for provider ${provider}:`, err.message);
      return null;
    }
  }

  listConfiguredProviders(userId) {
    const vault = this.loadVault(userId);
    return Object.keys(vault);
  }

  deleteApiKey(userId, provider) {
    if (!provider) return false;
    const cleanProvider = provider.trim().toLowerCase();
    const vault = this.loadVault(userId);
    if (vault[cleanProvider]) {
      delete vault[cleanProvider];
      this.saveVault(userId, vault);
      return true;
    }
    return false;
  }
}

export async function handleVaultApiRequest(req, res, vault, user = { id: 'default' }) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const providers = vault.listConfiguredProviders(user.id);
    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      userId: user.id,
      configuredProviders: providers,
      count: providers.length
    }));
    return;
  }

  const parseJsonBody = () => new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    const MAX_BYTES = 65536; // 64 KB limit
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE: Request body exceeded 64 KB limit'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

  if (req.method === 'POST') {
    try {
      const payload = await parseJsonBody();
      const { provider, apiKey } = payload;
      if (!provider || typeof provider !== 'string' || !apiKey || typeof apiKey !== 'string') {
        res.statusCode = 400;
        res.end(JSON.stringify({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Both provider and apiKey are required and must be non-empty strings'
        }));
        return;
      }
      vault.setApiKey(user.id, provider, apiKey);
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        userId: user.id,
        provider: provider.trim().toLowerCase(),
        message: 'API key encrypted and saved successfully'
      }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'BAD_JSON', message: err.message }));
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const payload = await parseJsonBody();
      const provider = payload.provider || (req.url && new URL(req.url, 'http://localhost').searchParams.get('provider'));
      if (!provider) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'BAD_REQUEST', message: 'Provider is required' }));
        return;
      }
      const deleted = vault.deleteApiKey(user.id, provider);
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        userId: user.id,
        provider: provider.trim().toLowerCase(),
        deleted
      }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'BAD_JSON', message: err.message }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'Supported methods: GET, POST, DELETE' }));
}
