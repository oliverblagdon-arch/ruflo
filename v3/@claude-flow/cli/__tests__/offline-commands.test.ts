/**
 * Command-level offline fallback tests.
 *
 * Verifies that commands which call callMCPTool return success:true (not
 * success:false / exitCode:1) when MCP is unavailable, by mocking the
 * MCP client to throw MCPClientError on every call.
 *
 * We focus on commands whose offline catch block uses only static data
 * (no sql.js / filesystem), so no additional mocking is needed.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { CommandContext } from '../src/types.js';

// ── Silence output so test logs stay clean ───────────────────────────────────

vi.mock('../src/output.js', () => {
  const noop = () => {};
  const str = (s: unknown) => String(s ?? '');
  const output = {
    writeln: noop,
    printInfo: noop,
    printSuccess: noop,
    printWarning: noop,
    printError: noop,
    printTable: noop,
    printList: noop,
    printBox: noop,
    printJson: noop,
    bold: str,
    dim: str,
    highlight: str,
    success: str,
    warning: str,
    error: str,
    createSpinner: () => ({ start: noop, succeed: noop, fail: noop, stop: noop }),
  };
  return { output };
});

// ── Mock prompt so interactive paths don't hang ───────────────────────────────

vi.mock('../src/prompt.js', () => ({
  select: vi.fn().mockResolvedValue(''),
  confirm: vi.fn().mockResolvedValue(false),
  input: vi.fn().mockResolvedValue(''),
}));

// ── Mock transfer-store (imported by hooks.ts at module level) ─────────────────

vi.mock('../src/commands/transfer-store.js', () => ({
  storeCommand: { name: 'store', description: '', options: [], action: async () => ({ success: true }) },
}));

// ── Force callMCPTool to always throw MCPClientError ─────────────────────────

vi.mock('../src/mcp-client.js', () => {
  class MCPClientError extends Error {
    toolName: string;
    constructor(message: string, toolName: string) {
      super(message);
      this.name = 'MCPClientError';
      this.toolName = toolName;
    }
  }
  const callMCPTool = vi.fn().mockImplementation((toolName: string) => {
    throw new MCPClientError(`Offline mode — MCP tool '${toolName}' skipped`, toolName);
  });
  return { callMCPTool, MCPClientError };
});

// ── Minimal fake CommandContext ───────────────────────────────────────────────

function fakeCtx(flags: Record<string, unknown> = {}, args: string[] = []): CommandContext {
  return {
    flags: { format: 'text', ...flags },
    args,
    interactive: false,
    command: { name: 'test', description: '', options: [], action: async () => ({ success: true }) },
  } as unknown as CommandContext;
}

// ── Load hooksCommand once (heavy module, shared across tests) ───────────────

let hooksSubcommands: Map<string, import('../src/types.js').Command>;

beforeAll(async () => {
  const mod = await import('../src/commands/hooks.js');
  hooksSubcommands = new Map(
    (mod.hooksCommand.subcommands ?? []).map(sc => [sc.name, sc])
  );
  // Also index worker subcommands nested under 'worker'
  const workerCmd = hooksSubcommands.get('worker');
  if (workerCmd?.subcommands) {
    for (const wsc of workerCmd.subcommands) {
      hooksSubcommands.set(`worker:${wsc.name}`, wsc);
    }
  }
}, 20000);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('hooks list — offline fallback (static BUILTIN_HOOKS)', () => {
  it('returns success:true with all 27 built-in hooks', async () => {
    const cmd = hooksSubcommands.get('list');
    expect(cmd).toBeDefined();
    const result = await cmd!.action!(fakeCtx());
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
    const data = result.data as { hooks: unknown[]; total: number };
    expect(data.hooks.length).toBeGreaterThanOrEqual(20);
    expect(data.total).toBeGreaterThanOrEqual(20);
  });

  it('returns success:true in json format', async () => {
    const cmd = hooksSubcommands.get('list');
    const result = await cmd!.action!(fakeCtx({ format: 'json' }));
    expect(result.success).toBe(true);
  });

  it('filters by type when --type is passed', async () => {
    const cmd = hooksSubcommands.get('list');
    const result = await cmd!.action!(fakeCtx({ type: 'core' }));
    expect(result.success).toBe(true);
    const data = result.data as { hooks: Array<{ type: string }>; total: number };
    // All returned hooks should be core type
    expect(data.hooks.every(h => h.type === 'core')).toBe(true);
  });
});

describe('hooks worker list — offline fallback (static BUILTIN_WORKERS)', () => {
  it('returns success:true with all 12 built-in workers', async () => {
    const cmd = hooksSubcommands.get('worker:list');
    expect(cmd).toBeDefined();
    const result = await cmd!.action!(fakeCtx());
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
    const data = result.data as { workers: unknown[]; total: number };
    expect(data.total).toBe(12);
    expect(data.workers.length).toBe(12);
  });

  it('returns success:true in json format', async () => {
    const cmd = hooksSubcommands.get('worker:list');
    const result = await cmd!.action!(fakeCtx({ format: 'json' }));
    expect(result.success).toBe(true);
  });
});
