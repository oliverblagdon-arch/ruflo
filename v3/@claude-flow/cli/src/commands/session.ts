/**
 * V3 CLI Session Command
 * Session management for Claude Flow
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { confirm, input, select } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as fs from 'fs';
import * as path from 'path';

// Format date for display
function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 24 hours - show relative time
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}h ${minutes}m ago`;
    }
    return `${minutes}m ago`;
  }

  // Otherwise show date
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Format session status
function formatStatus(status: string): string {
  switch (status) {
    case 'active':
      return output.success(status);
    case 'saved':
      return output.info(status);
    case 'archived':
      return output.dim(status);
    default:
      return status;
  }
}

// List subcommand
const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List all sessions',
  options: [
    {
      name: 'active',
      short: 'a',
      description: 'Show only active sessions',
      type: 'boolean',
      default: false
    },
    {
      name: 'all',
      description: 'Include archived sessions',
      type: 'boolean',
      default: false
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum sessions to show',
      type: 'number',
      default: 20
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const activeOnly = ctx.flags.active as boolean;
    const includeArchived = ctx.flags.all as boolean;
    const limit = ctx.flags.limit as number;

    try {
      const result = await callMCPTool<{
        sessions: Array<{
          sessionId?: string;
          id?: string;
          name?: string;
          description?: string;
          status?: 'active' | 'saved' | 'archived';
          savedAt?: string;
          createdAt?: string;
          updatedAt?: string;
          agentCount?: number;
          taskCount?: number;
          memorySize?: number;
          stats?: { agents?: number; tasks?: number; memoryEntries?: number; totalSize?: number };
        }>;
        total: number;
      }>('session_list', {
        status: activeOnly ? 'active' : includeArchived ? 'all' : 'active,saved',
        limit
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Sessions'));
      output.writeln();

      if (result.sessions.length === 0) {
        output.printInfo('No sessions found');
        output.printInfo('Run "claude-flow session save" to create a session');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'name', header: 'Name', width: 20 },
          { key: 'status', header: 'Status', width: 10 },
          { key: 'agents', header: 'Agents', width: 8, align: 'right' },
          { key: 'tasks', header: 'Tasks', width: 8, align: 'right' },
          { key: 'updated', header: 'Last Updated', width: 18 }
        ],
        data: result.sessions.map(s => ({
          id: s.sessionId || s.id || '-',
          name: s.name || '-',
          status: formatStatus(s.status || 'saved'),
          agents: s.agentCount ?? s.stats?.agents ?? 0,
          tasks: s.taskCount ?? s.stats?.tasks ?? 0,
          updated: formatDate(s.updatedAt || s.savedAt || s.createdAt || '')
        }))
      });

      output.writeln();
      output.printInfo(`Showing ${result.sessions.length} of ${result.total} sessions`);

      return { success: true, data: result };
    } catch {
      // MCP unavailable — read sessions directly from sqlite
      output.printInfo('MCP not available — reading sessions from local database...');
      try {
        const { getDirectSessions } = await import('../memory/memory-initializer.js');
        const statusFilter = activeOnly ? 'active' : includeArchived ? 'all' : 'active,saved';
        const direct = await getDirectSessions({ status: statusFilter, limit });
        if (!direct.success) {
          output.printError(direct.error ?? 'Failed to read session database');
          return { success: false, exitCode: 1 };
        }

        if (ctx.flags.format === 'json') {
          output.printJson({ sessions: direct.sessions, total: direct.total });
          return { success: true, data: direct };
        }

        output.writeln();
        output.writeln(output.bold('Sessions'));
        output.writeln();

        if (direct.sessions.length === 0) {
          output.printInfo('No sessions found');
          output.printInfo('Run "claude-flow session save" to create a session');
          return { success: true, data: direct };
        }

        output.printTable({
          columns: [
            { key: 'id', header: 'ID', width: 20 },
            { key: 'status', header: 'Status', width: 10 },
            { key: 'tasks', header: 'Tasks', width: 8, align: 'right' },
            { key: 'patterns', header: 'Patterns', width: 10, align: 'right' },
            { key: 'updated', header: 'Last Updated', width: 18 }
          ],
          data: direct.sessions.map(s => ({
            id: s.id.slice(0, 18),
            status: formatStatus(s.status as 'active' | 'saved' | 'archived'),
            tasks: s.tasksCompleted,
            patterns: s.patternsLearned,
            updated: formatDate(s.updatedAt)
          }))
        });

        output.writeln();
        output.printInfo(`Showing ${direct.sessions.length} of ${direct.total} sessions (direct)`);
        return { success: true, data: direct };
      } catch (directError) {
        output.printError(`Failed to list sessions: ${directError instanceof Error ? directError.message : String(directError)}`);
        return { success: false, exitCode: 1 };
      }
    }
  }
};

// Save subcommand
const saveCommand: Command = {
  name: 'save',
  aliases: ['create', 'checkpoint'],
  description: 'Save current session state',
  options: [
    {
      name: 'name',
      short: 'n',
      description: 'Session name',
      type: 'string'
    },
    {
      name: 'description',
      short: 'd',
      description: 'Session description',
      type: 'string'
    },
    {
      name: 'include-memory',
      description: 'Include memory state in session',
      type: 'boolean',
      default: true
    },
    {
      name: 'include-agents',
      description: 'Include agent state in session',
      type: 'boolean',
      default: true
    },
    {
      name: 'include-tasks',
      description: 'Include task state in session',
      type: 'boolean',
      default: true
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionName = ctx.flags.name as string;
    let description = ctx.flags.description as string;

    // Interactive mode
    if (!sessionName && ctx.interactive) {
      sessionName = await input({
        message: 'Session name:',
        default: `session-${Date.now().toString(36)}`,
        validate: (v) => v.length > 0 || 'Name is required'
      });
    }

    if (!description && ctx.interactive) {
      description = await input({
        message: 'Session description (optional):',
        default: ''
      });
    }

    const spinner = output.createSpinner({ text: 'Saving session...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        sessionId: string;
        name: string;
        description?: string;
        savedAt: string;
        includes?: {
          memory: boolean;
          agents: boolean;
          tasks: boolean;
        };
        stats?: {
          agents?: number;
          agentCount?: number;
          tasks?: number;
          taskCount?: number;
          memoryEntries?: number;
          totalSize?: number;
        };
      }>('session_save', {
        name: sessionName,
        description,
        includeMemory: ctx.flags['include-memory'] !== false,
        includeAgents: ctx.flags['include-agents'] !== false,
        includeTasks: ctx.flags['include-tasks'] !== false
      });

      spinner.succeed('Session saved');
      output.writeln();

      const stats = result.stats || {};
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name },
          { property: 'Description', value: result.description || '-' },
          { property: 'Saved At', value: new Date(result.savedAt).toLocaleString() },
          { property: 'Agents', value: stats.agentCount ?? stats.agents ?? 0 },
          { property: 'Tasks', value: stats.taskCount ?? stats.tasks ?? 0 },
          { property: 'Memory Entries', value: stats.memoryEntries ?? 0 },
          { property: 'Total Size', value: formatSize(stats.totalSize ?? 0) }
        ]
      });

      output.writeln();
      output.printSuccess(`Session saved: ${result.sessionId}`);
      output.printInfo(`Restore with: claude-flow session restore ${result.sessionId}`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to save session');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Restore subcommand
const restoreCommand: Command = {
  name: 'restore',
  aliases: ['load'],
  description: 'Restore a saved session',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite current state without confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'memory-only',
      description: 'Only restore memory state',
      type: 'boolean',
      default: false
    },
    {
      name: 'agents-only',
      description: 'Only restore agent state',
      type: 'boolean',
      default: false
    },
    {
      name: 'tasks-only',
      description: 'Only restore task state',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!sessionId && ctx.interactive) {
      // Show list to select from
      try {
        let sessionChoices: Array<{ id: string; label: string; updatedAt: string }> = [];
        try {
          const sessions = await callMCPTool<{
            sessions: Array<{ id: string; name?: string; status: string; updatedAt: string }>;
          }>('session_list', { status: 'saved', limit: 20 });
          sessionChoices = sessions.sessions.map(s => ({ id: s.id, label: s.name || s.id, updatedAt: s.updatedAt }));
        } catch {
          const { getDirectSessions } = await import('../memory/memory-initializer.js');
          const direct = await getDirectSessions({ status: 'active,saved', limit: 20 });
          sessionChoices = direct.sessions.map(s => ({ id: s.id, label: s.id.slice(0, 24), updatedAt: s.updatedAt }));
        }

        if (sessionChoices.length === 0) {
          output.printWarning('No saved sessions found');
          return { success: false, exitCode: 1 };
        }

        sessionId = await select({
          message: 'Select session to restore:',
          options: sessionChoices.map(s => ({
            value: s.id,
            label: s.label,
            hint: formatDate(s.updatedAt)
          }))
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'User cancelled') {
          output.printInfo('Operation cancelled');
          return { success: true };
        }
        throw error;
      }
    }

    if (!sessionId) {
      output.printError('Session ID is required');
      return { success: false, exitCode: 1 };
    }

    // Confirm unless forced
    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: 'This will overwrite current state. Continue?',
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    const spinner = output.createSpinner({ text: 'Restoring session...' });
    spinner.start();

    try {
      // Determine what to restore
      const restoreMemory = !ctx.flags['agents-only'] && !ctx.flags['tasks-only'];
      const restoreAgents = !ctx.flags['memory-only'] && !ctx.flags['tasks-only'];
      const restoreTasks = !ctx.flags['memory-only'] && !ctx.flags['agents-only'];

      const result = await callMCPTool<{
        sessionId: string;
        restoredAt: string;
        restored: {
          memory: boolean;
          agents: boolean;
          tasks: boolean;
        };
        stats: {
          agentsRestored: number;
          tasksRestored: number;
          memoryEntriesRestored: number;
        };
      }>('session_restore', {
        sessionId,
        restoreMemory,
        restoreAgents,
        restoreTasks
      });

      spinner.succeed('Session restored');
      output.writeln();

      output.printTable({
        columns: [
          { key: 'component', header: 'Component', width: 20 },
          { key: 'status', header: 'Status', width: 15 },
          { key: 'count', header: 'Items', width: 10, align: 'right' }
        ],
        data: [
          {
            component: 'Memory',
            status: result.restored.memory ? output.success('Restored') : output.dim('Skipped'),
            count: result.stats.memoryEntriesRestored
          },
          {
            component: 'Agents',
            status: result.restored.agents ? output.success('Restored') : output.dim('Skipped'),
            count: result.stats.agentsRestored
          },
          {
            component: 'Tasks',
            status: result.restored.tasks ? output.success('Restored') : output.dim('Skipped'),
            count: result.stats.tasksRestored
          }
        ]
      });

      output.writeln();
      output.printSuccess(`Session ${sessionId} restored successfully`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to restore session');

      // MCP unavailable — offer a direct read of session state from the local DB
      output.printInfo('MCP not available — reading session from local database...');
      try {
        const { getDirectSessions } = await import('../memory/memory-initializer.js');
        const direct = await getDirectSessions({ limit: 200 });
        const session = direct.sessions.find(s => s.id === sessionId || s.id.startsWith(sessionId));
        if (!session) {
          output.printError(`Session "${sessionId}" not found in local database`);
          return { success: false, exitCode: 1 };
        }

        output.printSuccess(`Session found in local database (offline mode)`);
        output.printTable({
          columns: [
            { key: 'property', header: 'Property', width: 20 },
            { key: 'value', header: 'Value', width: 40 }
          ],
          data: [
            { property: 'Session ID', value: session.id },
            { property: 'Status', value: session.status },
            { property: 'Project Path', value: session.projectPath ?? '-' },
            { property: 'Branch', value: session.branch ?? '-' },
            { property: 'Tasks Completed', value: String(session.tasksCompleted) },
            { property: 'Patterns Learned', value: String(session.patternsLearned) },
            { property: 'Created', value: formatDate(session.createdAt) },
            { property: 'Updated', value: formatDate(session.updatedAt) }
          ]
        });

        output.writeln();
        output.printWarning('Full session restore (agents, tasks) requires MCP. Start MCP and run again.');
        output.printInfo('Memory entries are always available via: claude-flow memory list');

        if (ctx.flags.format === 'json') {
          output.printJson(session);
        }

        return { success: true, data: session };
      } catch (directError) {
        if (error instanceof MCPClientError) {
          output.printError(`Error: ${error.message}`);
        } else {
          output.printError(`Unexpected error: ${String(error)}`);
        }
        return { success: false, exitCode: 1 };
      }
    }
  }
};

// Delete subcommand
const deleteCommand: Command = {
  name: 'delete',
  aliases: ['rm', 'remove'],
  description: 'Delete a saved session',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Delete without confirmation',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const sessionId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!sessionId) {
      output.printError('Session ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Delete session ${sessionId}? This cannot be undone.`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    try {
      const result = await callMCPTool<{
        sessionId: string;
        deleted: boolean;
        deletedAt: string;
      }>('session_delete', { sessionId });

      output.writeln();
      output.printSuccess(`Session ${sessionId} deleted`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to delete session: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Export subcommand
const exportCommand: Command = {
  name: 'export',
  description: 'Export session to file',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string'
    },
    {
      name: 'format',
      short: 'f',
      description: 'Export format (json, yaml)',
      type: 'string',
      choices: ['json', 'yaml'],
      default: 'json'
    },
    {
      name: 'include-memory',
      description: 'Include memory data',
      type: 'boolean',
      default: true
    },
    {
      name: 'compress',
      description: 'Compress output',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionId = ctx.args[0];
    let outputPath = ctx.flags.output as string;
    const exportFormat = ctx.flags.format as string;
    const compress = ctx.flags.compress as boolean;

    // Get current session if no ID provided
    if (!sessionId) {
      try {
        const current = await callMCPTool<{ sessionId: string }>('session_current', {});
        sessionId = current.sessionId;
      } catch {
        // Fall back to most recently updated session in local DB
        const { getDirectSessions } = await import('../memory/memory-initializer.js');
        const direct = await getDirectSessions({ limit: 1 });
        if (direct.sessions.length === 0) {
          output.printError('No active session. Provide a session ID to export.');
          return { success: false, exitCode: 1 };
        }
        sessionId = direct.sessions[0].id;
        output.printInfo(`Using most recent session: ${sessionId}`);
      }
    }

    // Generate output path if not provided
    if (!outputPath) {
      const ext = compress ? '.gz' : '';
      outputPath = `session-${sessionId}.${exportFormat}${ext}`;
    }

    const spinner = output.createSpinner({ text: 'Exporting session...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        sessionId: string;
        data: unknown;
        stats?: {
          agents?: number;
          agentCount?: number;
          tasks?: number;
          taskCount?: number;
          memoryEntries?: number;
        };
      }>('session_export', {
        sessionId,
        includeMemory: ctx.flags['include-memory'] !== false
      });

      // Format output
      let content: string;
      if (exportFormat === 'yaml') {
        content = toSimpleYaml(result.data);
      } else {
        content = JSON.stringify(result.data, null, 2);
      }

      // Write to file
      const absolutePath = path.isAbsolute(outputPath)
        ? outputPath
        : path.join(ctx.cwd, outputPath);

      fs.writeFileSync(absolutePath, content, 'utf-8');

      spinner.succeed('Session exported');
      output.writeln();

      const exportStats = result.stats || {};
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 40 }
        ],
        data: [
          { property: 'Session ID', value: sessionId },
          { property: 'Output File', value: absolutePath },
          { property: 'Format', value: exportFormat.toUpperCase() },
          { property: 'Agents', value: exportStats.agentCount ?? exportStats.agents ?? 0 },
          { property: 'Tasks', value: exportStats.taskCount ?? exportStats.tasks ?? 0 },
          { property: 'Memory Entries', value: exportStats.memoryEntries ?? 0 },
          { property: 'File Size', value: formatSize(content.length) }
        ]
      });

      output.writeln();
      output.printSuccess(`Session exported to ${outputPath}`);

      return {
        success: true,
        data: { sessionId, outputPath, format: exportFormat, size: content.length }
      };
    } catch (error) {
      spinner.fail('Failed to export session');

      // MCP unavailable — export session metadata directly from local DB
      output.printInfo('MCP not available — exporting session from local database...');
      try {
        const { getDirectSessions } = await import('../memory/memory-initializer.js');
        const direct = await getDirectSessions({ limit: 200 });
        const session = direct.sessions.find(s => s.id === sessionId || s.id.startsWith(sessionId ?? ''));
        if (!session) {
          output.printError(`Session "${sessionId}" not found in local database`);
          return { success: false, exitCode: 1 };
        }

        const exportData = {
          sessionId: session.id,
          exportedAt: new Date().toISOString(),
          exportedBy: 'claude-flow (offline)',
          session: {
            id: session.id,
            status: session.status,
            projectPath: session.projectPath,
            branch: session.branch,
            tasksCompleted: session.tasksCompleted,
            patternsLearned: session.patternsLearned,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          }
        };

        const content = exportFormat === 'yaml'
          ? toSimpleYaml(exportData)
          : JSON.stringify(exportData, null, 2);

        const absolutePath = path.isAbsolute(outputPath)
          ? outputPath
          : path.join(ctx.cwd, outputPath);

        fs.writeFileSync(absolutePath, content, 'utf-8');

        spinner.succeed('Session exported (offline)');
        output.writeln();
        output.printTable({
          columns: [
            { key: 'property', header: 'Property', width: 18 },
            { key: 'value', header: 'Value', width: 40 }
          ],
          data: [
            { property: 'Session ID', value: session.id },
            { property: 'Output File', value: absolutePath },
            { property: 'Format', value: exportFormat.toUpperCase() + ' (direct)' },
            { property: 'Tasks Completed', value: session.tasksCompleted },
            { property: 'Patterns Learned', value: session.patternsLearned },
            { property: 'File Size', value: formatSize(content.length) }
          ]
        });

        output.writeln();
        output.printSuccess(`Session exported to ${outputPath}`);
        output.printWarning('Note: agent and task state requires MCP for full export.');

        return { success: true, data: { sessionId: session.id, outputPath, format: exportFormat, size: content.length } };
      } catch (directError) {
        if (error instanceof MCPClientError) {
          output.printError(`Error: ${error.message}`);
        } else {
          output.printError(`Unexpected error: ${String(error)}`);
        }
        return { success: false, exitCode: 1 };
      }
    }
  }
};

// Import subcommand
const importCommand: Command = {
  name: 'import',
  description: 'Import session from file',
  options: [
    {
      name: 'name',
      short: 'n',
      description: 'Session name for imported session',
      type: 'string'
    },
    {
      name: 'activate',
      description: 'Activate session after import',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const filePath = ctx.args[0];
    const sessionName = ctx.flags.name as string;
    const activate = ctx.flags.activate as boolean;

    if (!filePath) {
      output.printError('File path is required');
      return { success: false, exitCode: 1 };
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(ctx.cwd, filePath);

    if (!fs.existsSync(absolutePath)) {
      output.printError(`File not found: ${absolutePath}`);
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Importing session...' });
    spinner.start();

    let _importedData: unknown;
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');

      // Parse based on extension
      if (absolutePath.endsWith('.yaml') || absolutePath.endsWith('.yml')) {
        // Simple YAML parsing (basic implementation)
        _importedData = JSON.parse(content); // Would need proper YAML parser
      } else {
        _importedData = JSON.parse(content);
      }
      const data = _importedData;

      const result = await callMCPTool<{
        sessionId: string;
        name: string;
        importedAt: string;
        stats: {
          agentsImported: number;
          tasksImported: number;
          memoryEntriesImported: number;
        };
        activated: boolean;
      }>('session_import', {
        data,
        name: sessionName,
        activate
      });

      spinner.succeed('Session imported');
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 20 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name },
          { property: 'Source File', value: path.basename(absolutePath) },
          { property: 'Agents Imported', value: result.stats.agentsImported },
          { property: 'Tasks Imported', value: result.stats.tasksImported },
          { property: 'Memory Entries', value: result.stats.memoryEntriesImported },
          { property: 'Activated', value: result.activated ? 'Yes' : 'No' }
        ]
      });

      output.writeln();
      output.printSuccess(`Session imported: ${result.sessionId}`);

      if (!result.activated) {
        output.printInfo(`Restore with: claude-flow session restore ${result.sessionId}`);
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to import session');

      // MCP unavailable — write session record directly to local sqlite
      if (error instanceof SyntaxError) {
        output.printError('Invalid file format. Expected JSON or YAML.');
        return { success: false, exitCode: 1 };
      }
      output.printInfo('MCP not available — writing session to local database...');
      try {
        const parsedData: any = _importedData;
        // Accept both our own export format and raw session objects
        const sessionData = parsedData?.session ?? parsedData;
        const newId = sessionData?.id ?? `session-imported-${Date.now()}`;
        const stateJson = JSON.stringify(sessionData);

        const { resolveDbPath: _rdbImp } = await import('../memory/memory-initializer.js');
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();
        const dbPath = _rdbImp(undefined);
        const fsSync = await import('fs');

        let db: ReturnType<typeof SQL.Database>;
        if (fsSync.existsSync(dbPath)) {
          const buf = fsSync.readFileSync(dbPath);
          db = new SQL.Database(buf);
        } else {
          db = new SQL.Database();
        }

        const now = Date.now();
        db.run(
          `INSERT OR REPLACE INTO sessions (id, state, status, tasks_completed, patterns_learned, created_at, updated_at)
           VALUES (?, ?, 'active', ?, ?, ?, ?)`,
          [newId, stateJson, sessionData?.tasksCompleted ?? 0, sessionData?.patternsLearned ?? 0, now, now]
        );

        const dbData = db.export();
        fsSync.writeFileSync(dbPath, Buffer.from(dbData));
        db.close();

        spinner.succeed('Session imported (offline)');
        output.writeln();
        output.printTable({
          columns: [
            { key: 'property', header: 'Property', width: 20 },
            { key: 'value', header: 'Value', width: 35 }
          ],
          data: [
            { property: 'Session ID', value: newId },
            { property: 'Name', value: sessionName || '-' },
            { property: 'Source File', value: path.basename(absolutePath) },
            { property: 'Memory Entries', value: 0 },
            { property: 'Activated', value: 'No (requires MCP)' }
          ]
        });

        output.writeln();
        output.printSuccess(`Session written to local DB: ${newId}`);
        output.printWarning('Full activation (agents, tasks) requires MCP. Run: claude-flow session restore ' + newId);

        if (ctx.flags.format === 'json') {
          output.printJson({ sessionId: newId, name: sessionName, activated: false });
        }

        return { success: true, data: { sessionId: newId, activated: false } };
      } catch (directError) {
        output.printError(`Import failed: ${directError instanceof Error ? directError.message : String(directError)}`);
        return { success: false, exitCode: 1 };
      }
    }
  }
};

// Current subcommand
const currentCommand: Command = {
  name: 'current',
  description: 'Show current active session',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const result = await callMCPTool<{
        sessionId: string;
        name?: string;
        status: string;
        startedAt: string;
        stats?: {
          agents?: number;
          agentCount?: number;
          tasks?: number;
          taskCount?: number;
          memoryEntries?: number;
          duration?: number;
        };
      }>('session_current', { includeStats: true });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Current Session'));
      output.writeln();

      const curStats = result.stats || {};
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name || '-' },
          { property: 'Status', value: formatStatus(result.status) },
          { property: 'Started', value: new Date(result.startedAt).toLocaleString() },
          { property: 'Duration', value: formatDuration(curStats.duration ?? 0) },
          { property: 'Agents', value: curStats.agentCount ?? curStats.agents ?? 0 },
          { property: 'Tasks', value: curStats.taskCount ?? curStats.tasks ?? 0 },
          { property: 'Memory Entries', value: curStats.memoryEntries ?? 0 }
        ]
      });

      return { success: true, data: result };
    } catch {
      // MCP unavailable — show most recent session from local DB
      try {
        const { getDirectSessions } = await import('../memory/memory-initializer.js');
        const direct = await getDirectSessions({ status: 'active', limit: 1 });
        if (direct.sessions.length === 0) {
          output.printWarning('No active session (offline)');
          output.printInfo('Start a session with "claude-flow start"');
          return { success: true, data: { active: false } };
        }
        const s = direct.sessions[0];

        if (ctx.flags.format === 'json') {
          output.printJson(s);
          return { success: true, data: s };
        }

        output.writeln();
        output.writeln(output.bold('Current Session') + output.dim(' (offline)'));
        output.writeln();
        output.printTable({
          columns: [
            { key: 'property', header: 'Property', width: 18 },
            { key: 'value', header: 'Value', width: 35 }
          ],
          data: [
            { property: 'Session ID', value: s.id },
            { property: 'Status', value: formatStatus(s.status as 'active' | 'saved' | 'archived') },
            { property: 'Project Path', value: s.projectPath ?? '-' },
            { property: 'Branch', value: s.branch ?? '-' },
            { property: 'Tasks Completed', value: s.tasksCompleted },
            { property: 'Patterns Learned', value: s.patternsLearned },
            { property: 'Last Updated', value: formatDate(s.updatedAt) }
          ]
        });

        return { success: true, data: s };
      } catch (directError) {
        output.printError(`Unexpected error: ${directError instanceof Error ? directError.message : String(directError)}`);
        return { success: false, exitCode: 1 };
      }
    }
  }
};

// Helper functions
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function toSimpleYaml(obj: unknown, indent: number = 0): string {
  // Simple YAML serializer (for basic types)
  if (obj === null) return 'null';
  if (typeof obj === 'boolean') return String(obj);
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'string') return obj.includes(':') ? `"${obj}"` : obj;

  const spaces = '  '.repeat(indent);
  let result = '';

  if (Array.isArray(obj)) {
    for (const item of obj) {
      result += `${spaces}- ${toSimpleYaml(item, indent + 1).trim()}\n`;
    }
    return result;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        result += `${spaces}${key}:\n${toSimpleYaml(value, indent + 1)}`;
      } else {
        result += `${spaces}${key}: ${toSimpleYaml(value, indent)}\n`;
      }
    }
    return result;
  }

  return String(obj);
}

// Main session command
export const sessionCommand: Command = {
  name: 'session',
  description: 'Session management commands',
  subcommands: [
    listCommand,
    saveCommand,
    restoreCommand,
    deleteCommand,
    exportCommand,
    importCommand,
    currentCommand
  ],
  options: [],
  examples: [
    { command: 'claude-flow session list', description: 'List all sessions' },
    { command: 'claude-flow session save -n "checkpoint-1"', description: 'Save current session' },
    { command: 'claude-flow session restore session-123', description: 'Restore a session' },
    { command: 'claude-flow session delete session-123', description: 'Delete a session' },
    { command: 'claude-flow session export -o backup.json', description: 'Export session to file' },
    { command: 'claude-flow session import backup.json', description: 'Import session from file' },
    { command: 'claude-flow session current', description: 'Show current session' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Show help if no subcommand
    output.writeln();
    output.writeln(output.bold('Session Management Commands'));
    output.writeln();
    output.writeln('Usage: claude-flow session <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('list')}    - List all sessions`,
      `${output.highlight('save')}    - Save current session state`,
      `${output.highlight('restore')} - Restore a saved session`,
      `${output.highlight('delete')}  - Delete a saved session`,
      `${output.highlight('export')}  - Export session to file`,
      `${output.highlight('import')}  - Import session from file`,
      `${output.highlight('current')} - Show current active session`
    ]);
    output.writeln();
    output.writeln('Run "claude-flow session <subcommand> --help" for subcommand help');

    return { success: true };
  }
};

export default sessionCommand;
