# 📋 Epic: MicroVM (Firecracker) Hardware-Level Sandbox Isolation

* **Status**: To Do / Backlog
* **Target Release**: `v2.3.0`
* **Priority**: Low / Future R&D
* **Category**: Security & Virtualization

---

## 🎯 Objective

Provide an optional **Firecracker MicroVM** runtime layer alongside Docker and gVisor, enabling multi-tenant enterprise environments to execute untrusted third-party code and autonomous scripts inside sub-millisecond hardware-isolated Linux kernels.

---

## 📋 Scope & Requirements

1. **Firecracker / Jailer Integration**:
   * Container runtime shim connecting the `@dsh-dds/core` orchestrator to ephemeral Firecracker microVMs.
   * Boots a minimal Linux guest kernel in $<5\text{ ms}$ with dedicated memory and vCPU boundaries.

2. **Zero-Trust VSock Communication**:
   * All tool execution and telemetry exchange between the host microkernel and microVM occurs over authenticated Linux AF_VSOCK sockets.

3. **Fallback Compatibility**:
   * Preserves standard Docker (`runc`) and gVisor (`runsc`) as default zero-dependency runtimes for macOS and standard cloud instances.
