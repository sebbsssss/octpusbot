/**
 * Octpus Daemon
 *
 * Background service that runs the autonomy engine continuously.
 * Manages objectives, schedules tasks, and persists state.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AutonomyEngine, Objective, ObjectiveStatus } from './index';

export interface DaemonConfig {
  anthropicApiKey: string;
  dataDir?: string;
  pidFile?: string;
  logFile?: string;
}

export class OctpusDaemon {
  private engine: AutonomyEngine;
  private config: DaemonConfig;
  private dataDir: string;
  private pidFile: string;
  private logFile: string;
  private logStream?: fs.WriteStream;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.dataDir = config.dataDir || path.join(os.homedir(), '.octpus', 'data');
    this.pidFile = config.pidFile || path.join(os.homedir(), '.octpus', 'octpus.pid');
    this.logFile = config.logFile || path.join(os.homedir(), '.octpus', 'octpus.log');

    // Ensure directories exist
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.pidFile), { recursive: true });

    this.engine = new AutonomyEngine({
      anthropicApiKey: config.anthropicApiKey,
    });

    this.setupEventLogging();
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    // Check if already running
    if (this.isRunning()) {
      throw new Error('Octpus daemon is already running');
    }

    // Write PID file
    fs.writeFileSync(this.pidFile, process.pid.toString());

    // Open log file
    this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });

    this.log('Daemon starting...');

    // Load persisted objectives
    await this.loadState();

    // Handle signals
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());

    // Start the engine
    await this.engine.start();

    this.log('Daemon started');
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    this.log('Daemon stopping...');

    // Save state
    await this.saveState();

    // Stop engine
    this.engine.stop();

    // Remove PID file
    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }

    // Close log
    this.logStream?.end();

    this.log('Daemon stopped');
    process.exit(0);
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    if (!fs.existsSync(this.pidFile)) {
      return false;
    }

    const pid = parseInt(fs.readFileSync(this.pidFile, 'utf-8').trim());

    try {
      process.kill(pid, 0);
      return true;
    } catch {
      // Process not running, clean up stale PID file
      fs.unlinkSync(this.pidFile);
      return false;
    }
  }

  /**
   * Add an objective
   */
  async addObjective(goal: string, options?: any): Promise<Objective> {
    const objective = await this.engine.addObjective(goal, options);
    await this.saveState();
    return objective;
  }

  /**
   * Get all objectives
   */
  getObjectives(): Objective[] {
    return this.engine.getAllObjectives();
  }

  /**
   * Get engine instance
   */
  getEngine(): AutonomyEngine {
    return this.engine;
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  private async saveState(): Promise<void> {
    const state = {
      objectives: this.engine.getAllObjectives(),
      savedAt: new Date().toISOString(),
    };

    const statePath = path.join(this.dataDir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  private async loadState(): Promise<void> {
    const statePath = path.join(this.dataDir, 'state.json');

    if (!fs.existsSync(statePath)) {
      return;
    }

    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

      for (const obj of state.objectives) {
        if (['pending', 'planning', 'executing'].includes(obj.status)) {
          // Re-add incomplete objectives
          await this.engine.addObjective(obj.goal, {
            context: obj.context,
            successCriteria: obj.successCriteria,
            constraints: obj.constraints,
            priority: obj.priority,
            schedule: obj.schedule,
          });
        }
      }

      this.log(`Loaded ${state.objectives.length} objectives from state`);
    } catch (error: any) {
      this.log(`Error loading state: ${error.message}`);
    }
  }

  // ===========================================================================
  // LOGGING
  // ===========================================================================

  private setupEventLogging(): void {
    this.engine.on('objective:added', (obj) => {
      this.log(`Objective added: ${obj.goal}`);
    });

    this.engine.on('objective:planning', (obj) => {
      this.log(`Planning objective: ${obj.goal}`);
    });

    this.engine.on('objective:planned', ({ objective, plan }) => {
      this.log(`Planned ${plan.tasks.length} tasks for: ${objective.goal}`);
    });

    this.engine.on('task:started', ({ objective, task }) => {
      this.log(`Task started: ${task.description}`);
    });

    this.engine.on('task:completed', ({ objective, task }) => {
      this.log(`Task completed: ${task.description}`);
    });

    this.engine.on('task:failed', ({ objective, task, error }) => {
      this.log(`Task failed: ${task.description} - ${error?.message || task.result?.error}`);
    });

    this.engine.on('objective:completed', (obj) => {
      this.log(`Objective completed: ${obj.goal}`);
    });

    this.engine.on('objective:failed', ({ objective, reason }) => {
      this.log(`Objective failed: ${objective.goal} - ${reason}`);
    });

    this.engine.on('engine:error', (error) => {
      this.log(`Engine error: ${error.message}`);
    });
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    if (this.logStream) {
      this.logStream.write(logLine);
    }

    // Also log to console if not daemonized
    if (process.stdout.isTTY) {
      process.stdout.write(logLine);
    }
  }
}

// =============================================================================
// CLI for daemon control
// =============================================================================

export async function daemonCLI(args: string[]): Promise<void> {
  const command = args[0];
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicApiKey && command !== 'status') {
    console.error('ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const daemon = new OctpusDaemon({ anthropicApiKey: anthropicApiKey! });

  switch (command) {
    case 'start':
      if (daemon.isRunning()) {
        console.log('Daemon is already running');
      } else {
        console.log('Starting daemon...');
        await daemon.start();
      }
      break;

    case 'stop':
      if (!daemon.isRunning()) {
        console.log('Daemon is not running');
      } else {
        const pidFile = path.join(os.homedir(), '.octpus', 'octpus.pid');
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
        process.kill(pid, 'SIGTERM');
        console.log('Daemon stopped');
      }
      break;

    case 'status':
      if (daemon.isRunning()) {
        console.log('Daemon is running');
      } else {
        console.log('Daemon is not running');
      }
      break;

    case 'logs':
      const logFile = path.join(os.homedir(), '.octpus', 'octpus.log');
      if (fs.existsSync(logFile)) {
        const { spawn } = await import('child_process');
        spawn('tail', ['-f', logFile], { stdio: 'inherit' });
      } else {
        console.log('No log file found');
      }
      break;

    case 'objective':
      const goal = args.slice(1).join(' ');
      if (!goal) {
        console.error('Usage: octpus daemon objective <goal>');
        process.exit(1);
      }
      const objective = await daemon.addObjective(goal);
      console.log(`Added objective: ${objective.id}`);
      break;

    default:
      console.log(`
Octpus Daemon

Usage: octpus daemon <command>

Commands:
  start              Start the daemon
  stop               Stop the daemon
  status             Check if daemon is running
  logs               Tail the daemon logs
  objective <goal>   Add an objective for the daemon to achieve
`);
  }
}

export default OctpusDaemon;
