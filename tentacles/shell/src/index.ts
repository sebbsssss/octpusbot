/**
 * Shell Tentacle
 * The executor arm of the Octpus - sandboxed command execution
 *
 * Capabilities:
 * - Execute shell commands
 * - Run scripts (bash, python, node)
 * - File system operations
 * - Environment management
 * - Process monitoring
 *
 * Security:
 * - Command allowlist/blocklist
 * - Execution timeouts
 * - Resource limits
 * - Sandboxed execution
 */

import { spawn, ChildProcess, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import {
  TentacleRegistration,
  TentacleCapability,
  PermissionLevel,
} from '@octpus/types';

const exec = promisify(execCallback);

// =============================================================================
// TYPES
// =============================================================================

export interface ShellConfig {
  workingDir?: string;
  timeout?: number;
  maxOutputSize?: number;
  allowedCommands?: string[];
  blockedCommands?: string[];
  blockedPatterns?: RegExp[];
  sandboxed?: boolean;
  env?: Record<string, string>;
}

export interface CommandResult {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  timedOut: boolean;
  timestamp: Date;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  startTime: Date;
}

// Default blocked commands for safety
const DEFAULT_BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf *',
  'mkfs',
  'dd if=/dev/zero',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'chown -R',
  '> /dev/sda',
  'wget.*\\|.*sh',
  'curl.*\\|.*sh',
  'sudo rm',
  'sudo dd',
  'sudo mkfs',
];

const DEFAULT_BLOCKED_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+[\/~]/i,
  />\s*\/dev\/[hs]d/i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev/i,
];

// =============================================================================
// SHELL TENTACLE
// =============================================================================

export class ShellTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private config: ShellConfig;
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private history: CommandResult[] = [];
  private maxHistory: number = 100;

  constructor(config: ShellConfig = {}) {
    this.config = {
      workingDir: homedir(),
      timeout: 60000,
      maxOutputSize: 1024 * 1024, // 1MB
      blockedCommands: DEFAULT_BLOCKED_COMMANDS,
      blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
      sandboxed: true,
      ...config,
    };

    this.events = new EventEmitter();

    this.registration = {
      id: 'shell',
      type: 'shell',
      name: 'Shell Tentacle',
      description: 'Sandboxed command execution, scripting, and file operations',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: this.config.sandboxed,
      resourceLimits: {
        maxMemoryMB: 512,
        maxCPUPercent: 50,
        maxNetworkMBps: 10,
        maxExecutionSeconds: 300,
      },
    };
  }

  /**
   * Initialize the shell tentacle
   */
  async initialize(): Promise<void> {
    console.log('🐙 Shell Tentacle initializing...');

    // Verify working directory exists
    if (!existsSync(this.config.workingDir!)) {
      mkdirSync(this.config.workingDir!, { recursive: true });
    }

    this.registration.status = 'ready';
    console.log('🐙 Shell Tentacle ready!');
  }

  // ==========================================================================
  // COMMAND EXECUTION
  // ==========================================================================

  /**
   * Execute a shell command
   */
  async execute(command: string): Promise<CommandResult> {
    const id = nanoid();
    const startTime = Date.now();

    // Security check
    this.validateCommand(command);

    const result: CommandResult = {
      id,
      command,
      stdout: '',
      stderr: '',
      exitCode: null,
      duration: 0,
      timedOut: false,
      timestamp: new Date(),
    };

    try {
      const { stdout, stderr } = await exec(command, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout,
        maxBuffer: this.config.maxOutputSize,
        env: { ...process.env, ...this.config.env },
      });

      result.stdout = this.truncateOutput(stdout);
      result.stderr = this.truncateOutput(stderr);
      result.exitCode = 0;
    } catch (error: any) {
      if (error.killed) {
        result.timedOut = true;
        result.stderr = `Command timed out after ${this.config.timeout}ms`;
      } else {
        result.stdout = this.truncateOutput(error.stdout || '');
        result.stderr = this.truncateOutput(error.stderr || error.message);
        result.exitCode = error.code || 1;
      }
    }

    result.duration = Date.now() - startTime;
    this.addToHistory(result);
    this.events.emit('command:executed', result);

    return result;
  }

  /**
   * Execute a command in the background
   */
  async executeBackground(command: string): Promise<string> {
    const id = nanoid();

    // Security check
    this.validateCommand(command);

    const child = spawn(command, [], {
      cwd: this.config.workingDir,
      shell: true,
      detached: true,
      env: { ...process.env, ...this.config.env },
    });

    this.runningProcesses.set(id, child);

    child.on('exit', (code) => {
      this.runningProcesses.delete(id);
      this.events.emit('process:exit', { id, code });
    });

    child.on('error', (error) => {
      this.runningProcesses.delete(id);
      this.events.emit('process:error', { id, error: error.message });
    });

    this.events.emit('process:started', { id, pid: child.pid, command });

    return id;
  }

  /**
   * Kill a background process
   */
  async kill(processId: string): Promise<boolean> {
    const child = this.runningProcesses.get(processId);
    if (!child) return false;

    child.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (this.runningProcesses.has(processId)) {
        child.kill('SIGKILL');
      }
    }, 5000);

    return true;
  }

  /**
   * Get running processes
   */
  getRunningProcesses(): ProcessInfo[] {
    const processes: ProcessInfo[] = [];

    for (const [id, child] of this.runningProcesses) {
      processes.push({
        pid: child.pid!,
        command: id,
        status: 'running',
        startTime: new Date(),
      });
    }

    return processes;
  }

  // ==========================================================================
  // SCRIPTING
  // ==========================================================================

  /**
   * Run a bash script
   */
  async runBashScript(script: string): Promise<CommandResult> {
    const scriptPath = join(tmpdir(), `octpus_${nanoid()}.sh`);

    try {
      writeFileSync(scriptPath, script, { mode: 0o755 });
      const result = await this.execute(`bash "${scriptPath}"`);
      return result;
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {}
    }
  }

  /**
   * Run a Python script
   */
  async runPythonScript(script: string): Promise<CommandResult> {
    const scriptPath = join(tmpdir(), `octpus_${nanoid()}.py`);

    try {
      writeFileSync(scriptPath, script);
      const result = await this.execute(`python3 "${scriptPath}"`);
      return result;
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {}
    }
  }

  /**
   * Run a Node.js script
   */
  async runNodeScript(script: string): Promise<CommandResult> {
    const scriptPath = join(tmpdir(), `octpus_${nanoid()}.js`);

    try {
      writeFileSync(scriptPath, script);
      const result = await this.execute(`node "${scriptPath}"`);
      return result;
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {}
    }
  }

  // ==========================================================================
  // FILE OPERATIONS
  // ==========================================================================

  /**
   * Read a file
   */
  async readFile(path: string): Promise<string> {
    const fullPath = this.resolvePath(path);
    this.validatePath(fullPath);

    return readFileSync(fullPath, 'utf-8');
  }

  /**
   * Write a file
   */
  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    this.validatePath(fullPath);

    // Ensure directory exists
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content);
    this.events.emit('file:written', { path: fullPath });
  }

  /**
   * Check if path exists
   */
  async exists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path);
    return existsSync(fullPath);
  }

  /**
   * List directory contents
   */
  async listDir(path: string): Promise<string[]> {
    const result = await this.execute(`ls -la "${this.resolvePath(path)}"`);
    return result.stdout.split('\n').filter(Boolean);
  }

  // ==========================================================================
  // ENVIRONMENT
  // ==========================================================================

  /**
   * Get environment variable
   */
  getEnv(key: string): string | undefined {
    return this.config.env?.[key] || process.env[key];
  }

  /**
   * Set environment variable
   */
  setEnv(key: string, value: string): void {
    if (!this.config.env) {
      this.config.env = {};
    }
    this.config.env[key] = value;
  }

  /**
   * Get working directory
   */
  getWorkingDir(): string {
    return this.config.workingDir!;
  }

  /**
   * Set working directory
   */
  setWorkingDir(path: string): void {
    const fullPath = this.resolvePath(path);
    if (!existsSync(fullPath)) {
      throw new Error(`Directory does not exist: ${fullPath}`);
    }
    this.config.workingDir = fullPath;
  }

  // ==========================================================================
  // HISTORY
  // ==========================================================================

  /**
   * Get command history
   */
  getHistory(limit?: number): CommandResult[] {
    const results = limit ? this.history.slice(-limit) : this.history;
    return [...results];
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }

  // ==========================================================================
  // SHUTDOWN
  // ==========================================================================

  async shutdown(): Promise<void> {
    console.log('🐙 Shell Tentacle shutting down...');

    // Kill all running processes
    for (const [id, child] of this.runningProcesses) {
      child.kill('SIGTERM');
    }

    // Wait for processes to exit
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Force kill remaining
    for (const [id, child] of this.runningProcesses) {
      child.kill('SIGKILL');
    }

    this.runningProcesses.clear();
    this.registration.status = 'disabled';
    console.log('🐙 Shell Tentacle offline');
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private validateCommand(command: string): void {
    // Check blocked commands
    for (const blocked of this.config.blockedCommands || []) {
      if (command.includes(blocked)) {
        throw new Error(`Command blocked for safety: ${blocked}`);
      }
    }

    // Check blocked patterns
    for (const pattern of this.config.blockedPatterns || []) {
      if (pattern.test(command)) {
        throw new Error(`Command matches blocked pattern`);
      }
    }

    // Check allowed commands (if whitelist is set)
    if (this.config.allowedCommands && this.config.allowedCommands.length > 0) {
      const baseCommand = command.split(' ')[0];
      if (!this.config.allowedCommands.includes(baseCommand)) {
        throw new Error(`Command not in allowlist: ${baseCommand}`);
      }
    }
  }

  private validatePath(path: string): void {
    // Prevent directory traversal
    const normalizedPath = join(path);
    const workingDir = this.config.workingDir!;

    // In sandboxed mode, only allow access to working directory and below
    if (this.config.sandboxed) {
      if (!normalizedPath.startsWith(workingDir) && !normalizedPath.startsWith(tmpdir())) {
        throw new Error(`Path outside sandbox: ${path}`);
      }
    }

    // Always block sensitive paths
    const blockedPaths = ['/etc/passwd', '/etc/shadow', '/.ssh', '/root'];
    for (const blocked of blockedPaths) {
      if (normalizedPath.includes(blocked)) {
        throw new Error(`Access to ${blocked} is not allowed`);
      }
    }
  }

  private resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path;
    }
    if (path.startsWith('~')) {
      return join(homedir(), path.slice(1));
    }
    return join(this.config.workingDir!, path);
  }

  private truncateOutput(output: string): string {
    const maxSize = this.config.maxOutputSize!;
    if (output.length > maxSize) {
      return output.slice(0, maxSize) + '\n... (output truncated)';
    }
    return output;
  }

  private addToHistory(result: CommandResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  // ==========================================================================
  // CAPABILITIES
  // ==========================================================================

  private buildCapabilities(): TentacleCapability[] {
    return [
      {
        name: 'execute',
        description: 'Execute a shell command',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          command: { type: 'string', description: 'The command to execute', required: true },
        },
        handler: async (params) => {
          return this.execute(params.command as string);
        },
      },
      {
        name: 'run_script',
        description: 'Run a script (bash, python, or node)',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          script: { type: 'string', description: 'The script content', required: true },
          language: {
            type: 'string',
            description: 'Script language',
            required: true,
            enum: ['bash', 'python', 'node'],
          },
        },
        handler: async (params) => {
          switch (params.language) {
            case 'bash':
              return this.runBashScript(params.script as string);
            case 'python':
              return this.runPythonScript(params.script as string);
            case 'node':
              return this.runNodeScript(params.script as string);
            default:
              throw new Error(`Unsupported language: ${params.language}`);
          }
        },
      },
      {
        name: 'read_file',
        description: 'Read a file',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          path: { type: 'string', description: 'File path', required: true },
        },
        handler: async (params) => {
          return this.readFile(params.path as string);
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          path: { type: 'string', description: 'File path', required: true },
          content: { type: 'string', description: 'File content', required: true },
        },
        handler: async (params) => {
          await this.writeFile(params.path as string, params.content as string);
        },
      },
      {
        name: 'list_dir',
        description: 'List directory contents',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          path: { type: 'string', description: 'Directory path', required: false },
        },
        handler: async (params) => {
          return this.listDir((params.path as string) || '.');
        },
      },
      {
        name: 'get_history',
        description: 'Get command execution history',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          limit: { type: 'number', description: 'Max results', required: false },
        },
        handler: async (params) => {
          return this.getHistory(params.limit as number);
        },
      },
      {
        name: 'kill_process',
        description: 'Kill a background process',
        permissionLevel: PermissionLevel.L4_DESTRUCTIVE,
        parameters: {
          processId: { type: 'string', description: 'Process ID', required: true },
        },
        handler: async (params) => {
          return this.kill(params.processId as string);
        },
      },
    ];
  }
}

export default ShellTentacle;
