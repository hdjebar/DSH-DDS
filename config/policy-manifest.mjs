const RBAC_KEYS = new Set(['role', 'permissions']);
const PERMISSION_KEYS = new Set(['filesystem', 'mcp', 'tools']);
const FILESYSTEM_KEYS = new Set(['read', 'write', 'deny']);
const MCP_KEYS = new Set(['allowed']);

function policyError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireOwn(object, key, path) {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    throw policyError('RBAC_MANIFEST_MISSING', `required field '${path}.${key}' is missing`);
  }
  return object[key];
}

function rejectUnknown(object, allowed, path) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      throw policyError('RBAC_MANIFEST_INVALID', `unknown field '${path}.${key}'`);
    }
  }
}

function validateStringList(value, path) {
  if (!Array.isArray(value)) {
    throw policyError('RBAC_MANIFEST_INVALID', `'${path}' must be an array`);
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw policyError('RBAC_MANIFEST_INVALID', `'${path}[${index}]' must be a non-empty string`);
    }
  }
}

export function assertPolicyContract(meta) {
  if (!isObject(meta)) {
    throw policyError('RBAC_MANIFEST_INVALID', 'persona manifest must be an object');
  }
  const rbac = requireOwn(meta, 'rbac', 'persona');
  if (!isObject(rbac)) {
    throw policyError('RBAC_MANIFEST_INVALID', "'persona.rbac' must be an object");
  }
  rejectUnknown(rbac, RBAC_KEYS, 'persona.rbac');

  const role = requireOwn(rbac, 'role', 'persona.rbac');
  if (typeof role !== 'string' || !role.trim()) {
    throw policyError('RBAC_MANIFEST_INVALID', "'persona.rbac.role' must be a non-empty string");
  }

  const permissions = requireOwn(rbac, 'permissions', 'persona.rbac');
  if (!isObject(permissions)) {
    throw policyError('RBAC_MANIFEST_INVALID', "'persona.rbac.permissions' must be an object");
  }
  rejectUnknown(permissions, PERMISSION_KEYS, 'persona.rbac.permissions');

  const filesystem = requireOwn(permissions, 'filesystem', 'persona.rbac.permissions');
  if (!isObject(filesystem)) {
    throw policyError('RBAC_MANIFEST_INVALID', "'persona.rbac.permissions.filesystem' must be an object");
  }
  rejectUnknown(filesystem, FILESYSTEM_KEYS, 'persona.rbac.permissions.filesystem');
  for (const key of FILESYSTEM_KEYS) {
    validateStringList(
      requireOwn(filesystem, key, 'persona.rbac.permissions.filesystem'),
      `persona.rbac.permissions.filesystem.${key}`
    );
  }

  if (Object.prototype.hasOwnProperty.call(permissions, 'mcp')) {
    if (!isObject(permissions.mcp)) {
      throw policyError('RBAC_MANIFEST_INVALID', "'persona.rbac.permissions.mcp' must be an object");
    }
    rejectUnknown(permissions.mcp, MCP_KEYS, 'persona.rbac.permissions.mcp');
    validateStringList(
      requireOwn(permissions.mcp, 'allowed', 'persona.rbac.permissions.mcp'),
      'persona.rbac.permissions.mcp.allowed'
    );
  }

  if (Object.prototype.hasOwnProperty.call(permissions, 'tools')) {
    validateStringList(permissions.tools, 'persona.rbac.permissions.tools');
  }
  return meta;
}

export function resolveEffectivePolicy(meta) {
  assertPolicyContract(meta);
  return meta.rbac;
}

export function createDefaultDenyPolicy(role) {
  const normalizedRole = typeof role === 'string' ? role.trim().replace(/-/g, '_') : '';
  if (!normalizedRole) {
    throw policyError('RBAC_MANIFEST_INVALID', 'default-deny policy requires a non-empty role');
  }
  return {
    role: normalizedRole,
    permissions: {
      filesystem: {
        read: [],
        write: [],
        deny: ['/etc', '/root/.ssh', 'config/personas/*', 'config/profiles/*', 'reset.sh', 'install_dsh.sh']
      },
      mcp: { allowed: [] }
    }
  };
}
