// offline-mode.test.ts
//
// Tests for the offline-first behaviour introduced in the offline-fallback series.
// These tests verify:
//   1. CLAUDE_FLOW_OFFLINE env var causes callMCPTool to throw MCPClientError.
//   2. The global --offline flag is registered in the parser.
//   3. The hooks route keyword matcher returns the expected agent for known task types.
//
// Tests are pure-unit: no filesystem I/O, no sql.js, no spawned processes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// 1. callMCPTool offline guard
// ---------------------------------------------------------------------------

describe('callMCPTool offline guard', () => {
  const originalEnv = process.env.CLAUDE_FLOW_OFFLINE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_FLOW_OFFLINE;
    } else {
      process.env.CLAUDE_FLOW_OFFLINE = originalEnv;
    }
    vi.resetModules();
  });

  it('throws MCPClientError when CLAUDE_FLOW_OFFLINE=true', async () => {
    process.env.CLAUDE_FLOW_OFFLINE = 'true';
    // Dynamic import so the env var is visible at module evaluation time
    const { callMCPTool, MCPClientError } = await import('../src/mcp-client.js');
    await expect(callMCPTool('hooks_list', {})).rejects.toBeInstanceOf(MCPClientError);
  });

  it('includes tool name in the error message when offline', async () => {
    process.env.CLAUDE_FLOW_OFFLINE = 'true';
    const { callMCPTool, MCPClientError } = await import('../src/mcp-client.js');
    const err = await callMCPTool('hooks_metrics', {}).catch(e => e);
    expect(err).toBeInstanceOf(MCPClientError);
    expect(err.message).toContain('hooks_metrics');
  });

  it('does NOT throw for offline guard when CLAUDE_FLOW_OFFLINE is unset', async () => {
    delete process.env.CLAUDE_FLOW_OFFLINE;
    const { callMCPTool } = await import('../src/mcp-client.js');
    // Tool doesn't exist → throws MCPClientError but for a different reason
    const err = await callMCPTool('nonexistent_tool_xyz', {}).catch(e => e);
    // Should fail with "not found", not "Offline mode"
    expect(err.message).not.toMatch(/[Oo]ffline mode/);
  });
});

// ---------------------------------------------------------------------------
// 2. Parser: --offline flag is registered as a global option
// ---------------------------------------------------------------------------

describe('Parser global --offline flag', () => {
  it('registers offline as a global option', async () => {
    vi.resetModules();
    const { CommandParser } = await import('../src/parser.js');
    const parser = new CommandParser();
    const globalOpts = parser.getGlobalOptions();
    const offlineOpt = globalOpts.find(o => o.name === 'offline');
    expect(offlineOpt).toBeDefined();
    expect(offlineOpt?.type).toBe('boolean');
    expect(offlineOpt?.default).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Keyword router used by hooks route offline fallback
// ---------------------------------------------------------------------------

// Mirror the routing rules from hooks.ts so we can unit-test them without
// importing the full command module (which pulls in all MCP tools).

type RouteRule = { keywords: string[]; agent: string };

function keywordRoute(task: string, rules: RouteRule[]): string {
  const t = task.toLowerCase();
  const matched = rules.find(r => r.keywords.some(k => t.includes(k)));
  return matched?.agent ?? 'coder';
}

const RULES: RouteRule[] = [
  { keywords: ['security', 'auth', 'vuln', 'cve', 'threat', 'injection', 'xss', 'csrf'], agent: 'security-auditor' },
  { keywords: ['test', 'spec', 'coverage', 'tdd', 'mock', 'jest', 'vitest'], agent: 'tester' },
  { keywords: ['architect', 'design', 'schema', 'structure', 'pattern', 'api', 'interface'], agent: 'system-architect' },
  { keywords: ['perf', 'optim', 'speed', 'latency', 'benchmark', 'slow', 'memory'], agent: 'performance-optimizer' },
  { keywords: ['refactor', 'clean', 'debt', 'rewrite', 'migrate', 'legacy'], agent: 'coder' },
  { keywords: ['bug', 'fix', 'error', 'crash', 'fail', 'broken', 'issue'], agent: 'coder' },
  { keywords: ['doc', 'readme', 'comment', 'jsdoc', 'api doc'], agent: 'api-docs' },
];

describe('hooks route keyword matcher', () => {
  it('routes security tasks to security-auditor', () => {
    expect(keywordRoute('Fix XSS vulnerability in auth module', RULES)).toBe('security-auditor');
    expect(keywordRoute('CVE-2024-1234 remediation', RULES)).toBe('security-auditor');
    expect(keywordRoute('SQL injection in login endpoint', RULES)).toBe('security-auditor');
  });

  it('routes test tasks to tester', () => {
    expect(keywordRoute('Write vitest unit tests for database module', RULES)).toBe('tester');
    expect(keywordRoute('Improve test coverage to 90%', RULES)).toBe('tester');
    expect(keywordRoute('Add jest mocks for database calls', RULES)).toBe('tester');
  });

  it('routes architecture tasks to system-architect', () => {
    expect(keywordRoute('Design the database schema for users', RULES)).toBe('system-architect');
    expect(keywordRoute('Define API interface for payments service', RULES)).toBe('system-architect');
  });

  it('routes performance tasks to performance-optimizer', () => {
    expect(keywordRoute('Optimize slow database queries', RULES)).toBe('performance-optimizer');
    expect(keywordRoute('Reduce memory usage in workers', RULES)).toBe('performance-optimizer');
    expect(keywordRoute('Run benchmark suite for HNSW search', RULES)).toBe('performance-optimizer');
  });

  it('routes documentation tasks to api-docs', () => {
    expect(keywordRoute('Write JSDoc comments for all exports', RULES)).toBe('api-docs');
    expect(keywordRoute('Update README with new CLI flags', RULES)).toBe('api-docs');
  });

  it('routes bug fixes to coder', () => {
    expect(keywordRoute('Fix the broken session restore command', RULES)).toBe('coder');
    expect(keywordRoute('Error thrown when no sessions exist', RULES)).toBe('coder');
  });

  it('defaults to coder for unmatched tasks', () => {
    expect(keywordRoute('Do something completely new', RULES)).toBe('coder');
    expect(keywordRoute('', RULES)).toBe('coder');
  });

  it('is case-insensitive', () => {
    expect(keywordRoute('SECURITY AUDIT of production API', RULES)).toBe('security-auditor');
    expect(keywordRoute('TDD for new payment flow', RULES)).toBe('tester');
  });
});
