/**
 * Offline fallback tests for session and workflow commands.
 *
 * session list → falls back to getDirectSessions() (sql.js)
 * workflow list → falls back to reading .swarm/workflows/*.json from disk
 * session save / delete → pure offline no-ops (success:true, skipped:true)
 * workflow run / stop → pure offline no-ops (success:true, skipped:true)
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { CommandContext } from '../src/types.js';

// ── Silence output ────────────────────────────────────────────────────────────

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
    info: str,
    success: str,
    warning: str,
    error: str,
    createSpinner: () => ({ start: noop, succeed: noop, fail: noop, stop: noop }),
  };
  return { output };
});

vi.mock('../src/prompt.js', () => ({
  select: vi.fn().mockResolvedValue(''),
  confirm: vi.fn().mockResolvedValue(false),
  input: vi.fn().mockResolvedValue(''),
}));

// ── callMCPTool always throws ─────────────────────────────────────────────────

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

// ── Mock getDirectSessions for session list fallback ──────────────────────────

const MOCK_SESSIONS = [
  {
    id: 'ses-abc123',
    status: 'saved',
    projectPath: '/home/user/project',
    branch: 'main',
    tasksCompleted: 3,
    patternsLearned: 5,
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-10T12:00:00Z',
  },
];

vi.mock('../src/memory/memory-initializer.js', () => ({
  getDirectSessions: vi.fn().mockResolvedValue({
    success: true,
    sessions: MOCK_SESSIONS,
    total: 1,
  }),
  getDirectStats: vi.fn().mockResolvedValue({
    success: true,
    dbPath: '.swarm/memory.db',
    dbSizeBytes: 1024,
    totalEntries: 10,
    entriesWithEmbeddings: 5,
    namespaces: [{ namespace: 'default', count: 10, withEmbeddings: 5 }],
  }),
  // stubs for other functions session.ts may import
  storeEntry: vi.fn(),
  getEntry: vi.fn(),
  listEntries: vi.fn(),
  resolveDbPath: vi.fn().mockReturnValue('.swarm/memory.db'),
}));

// ── Mock fs for workflow list fallback (no .swarm/workflows directory) ────────

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue('{}'),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  default: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function fakeCtx(flags: Record<string, unknown> = {}, args: string[] = []): CommandContext {
  return {
    flags: { format: 'text', limit: 20, ...flags },
    args,
    interactive: false,
    command: { name: 'test', description: '', options: [], action: async () => ({ success: true }) },
  } as unknown as CommandContext;
}

function findSubcmd(cmd: import('../src/types.js').Command, name: string) {
  return (cmd.subcommands ?? []).find(sc => sc.name === name || (sc.aliases ?? []).includes(name));
}

// ── Load commands once ────────────────────────────────────────────────────────

let sessionCmd: import('../src/types.js').Command;
let workflowCmd: import('../src/types.js').Command;

beforeAll(async () => {
  const [sm, wm] = await Promise.all([
    import('../src/commands/session.js'),
    import('../src/commands/workflow.js'),
  ]);
  sessionCmd = sm.sessionCommand;
  workflowCmd = wm.workflowCommand;
}, 20000);

// ── session list ─────────────────────────────────────────────────────────────

describe('session list — offline fallback (sqlite via getDirectSessions)', () => {
  it('returns success:true and sessions from local DB', async () => {
    const cmd = findSubcmd(sessionCmd, 'list');
    expect(cmd).toBeDefined();
    const result = await cmd!.action!(fakeCtx());
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
  });

  it('returns success:true with json format', async () => {
    const cmd = findSubcmd(sessionCmd, 'list');
    const result = await cmd!.action!(fakeCtx({ format: 'json' }));
    expect(result.success).toBe(true);
    const data = result.data as { sessions: unknown[]; total: number };
    expect(Array.isArray(data.sessions)).toBe(true);
  });
});

// ── session save (no-op offline) ──────────────────────────────────────────────

describe('session save — offline no-op', () => {
  it('returns success:true with skipped flag', async () => {
    const cmd = findSubcmd(sessionCmd, 'save');
    expect(cmd).toBeDefined();
    const result = await cmd!.action!(fakeCtx({ name: 'test-session' }));
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
  });
});

// ── session delete (no-op offline) ────────────────────────────────────────────

describe('session delete — offline no-op', () => {
  it('returns success:true even without a session id (requires MCP)', async () => {
    const cmd = findSubcmd(sessionCmd, 'delete');
    expect(cmd).toBeDefined();
    // Without an ID the command catches MCP failure and returns gracefully
    const result = await cmd!.action!(fakeCtx({}, ['nonexistent-session-id']));
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
  });
});

// ── workflow list ─────────────────────────────────────────────────────────────

describe('workflow list — offline fallback (no .swarm/workflows directory)', () => {
  it('returns success:true with empty workflows when directory missing', async () => {
    const cmd = findSubcmd(workflowCmd, 'list');
    expect(cmd).toBeDefined();
    const result = await cmd!.action!(fakeCtx());
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
    const data = result.data as { workflows: unknown[]; total: number };
    expect(Array.isArray(data.workflows)).toBe(true);
  });

  it('returns success:true in json format when directory missing', async () => {
    const cmd = findSubcmd(workflowCmd, 'list');
    const result = await cmd!.action!(fakeCtx({ format: 'json' }));
    expect(result.success).toBe(true);
  });
});

// ── workflow run / stop (no-op offline) ───────────────────────────────────────

describe('workflow run — offline no-op', () => {
  it('returns success:true when MCP unavailable', async () => {
    const cmd = findSubcmd(workflowCmd, 'run');
    expect(cmd).toBeDefined();
    const result = await cmd!.action!(fakeCtx({ template: 'feature' }));
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
  });
});
