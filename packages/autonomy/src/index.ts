/**
 * Octpus Autonomy Engine
 *
 * The brain that makes Octpus truly autonomous. Given a high-level objective,
 * it will figure out HOW to achieve it, acquire necessary resources, and
 * execute until the goal is met.
 *
 * Example:
 *   Objective: "Wake me up at 7am with a phone call"
 *
 *   Agent thinks:
 *   1. I need to make phone calls → need Twilio
 *   2. Search how to set up Twilio
 *   3. Sign up for Twilio, get API keys
 *   4. I need voice → can use text-to-speech or AI voice
 *   5. Search for voice APIs (ElevenLabs, OpenAI TTS)
 *   6. Implement the wake-up call function
 *   7. Schedule for 7am
 *   8. Test and verify
 */

import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { z } from 'zod';

// =============================================================================
// TYPES
// =============================================================================

export type ObjectiveStatus = 'pending' | 'planning' | 'executing' | 'blocked' | 'completed' | 'failed';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type ResourceType = 'api_key' | 'service' | 'tool' | 'information' | 'permission';

export interface Objective {
  id: string;
  goal: string;
  context?: string;
  successCriteria: string[];
  constraints?: string[];
  status: ObjectiveStatus;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  plan?: Plan;
  attempts: number;
  maxAttempts: number;
  schedule?: Schedule;
  parentId?: string;
  metadata?: Record<string, any>;
}

export interface Plan {
  id: string;
  objectiveId: string;
  reasoning: string;
  approach: string;
  tasks: Task[];
  resources: Resource[];
  risks: string[];
  createdAt: Date;
  version: number;
}

export interface Task {
  id: string;
  planId: string;
  description: string;
  action: TaskAction;
  dependencies: string[];
  status: TaskStatus;
  result?: TaskResult;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskAction {
  type: 'search' | 'browse' | 'execute' | 'acquire' | 'create' | 'communicate' | 'wait' | 'verify' | 'think';
  tool?: string;
  params: Record<string, any>;
}

export interface TaskResult {
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
  artifacts?: Artifact[];
}

export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  description: string;
  required: boolean;
  acquired: boolean;
  value?: string;
  acquireInstructions?: string;
}

export interface Artifact {
  id: string;
  type: 'code' | 'file' | 'credential' | 'data' | 'url';
  name: string;
  content: any;
  createdAt: Date;
}

export interface Schedule {
  type: 'once' | 'recurring' | 'cron' | 'event';
  at?: Date;
  cron?: string;
  event?: string;
  timezone?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (params: any, context: ExecutionContext) => Promise<any>;
}

export interface ExecutionContext {
  objective: Objective;
  task: Task;
  memory: MemoryStore;
  artifacts: Map<string, Artifact>;
  emit: (event: string, data: any) => void;
}

export interface MemoryStore {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  search: (query: string) => Promise<any[]>;
  addFact: (fact: string, source: string) => Promise<void>;
}

export interface AutonomyConfig {
  anthropicApiKey: string;
  model?: string;
  maxConcurrentObjectives?: number;
  maxTaskRetries?: number;
  reflectionInterval?: number;
  persistPath?: string;
}

// =============================================================================
// PROMPTS
// =============================================================================

const PLANNER_SYSTEM = `You are an autonomous AI agent's planning module. Your job is to take high-level objectives and create detailed, executable plans.

KEY PRINCIPLES:
1. RESOURCEFULNESS: If you don't have a capability, figure out how to get it. Need to make calls? Get Twilio. Need voice? Get ElevenLabs or OpenAI TTS. Need payments? Get Stripe.

2. CREATIVE PROBLEM-SOLVING: Think of multiple ways to achieve the goal. Consider:
   - What tools/APIs could help?
   - What services need to be acquired?
   - What's the simplest path to success?
   - What are the fallback options?

3. SELF-SUFFICIENCY: Assume you can:
   - Search the web for information
   - Browse websites and read documentation
   - Sign up for services and get API keys
   - Write and execute code
   - Send messages and make API calls
   - Create files and persist data

4. VERIFICATION: Always include steps to verify the solution works.

When planning, output a JSON object with:
{
  "reasoning": "Your chain of thought about how to achieve this",
  "approach": "The high-level strategy you'll take",
  "resources": [
    {
      "type": "api_key|service|tool|information|permission",
      "name": "Resource name",
      "description": "What it's for",
      "required": true/false,
      "acquireInstructions": "How to get this resource"
    }
  ],
  "tasks": [
    {
      "description": "What this task does",
      "action": {
        "type": "search|browse|execute|acquire|create|communicate|wait|verify|think",
        "tool": "optional tool name",
        "params": {}
      },
      "dependencies": ["task_ids this depends on"]
    }
  ],
  "risks": ["Potential issues and how to handle them"]
}

ACTION TYPES:
- search: Search the web for information
- browse: Navigate to a URL and extract information
- execute: Run code or shell commands
- acquire: Sign up for a service, get API key, etc.
- create: Create a file, script, or artifact
- communicate: Send a message, make a call, etc.
- wait: Wait for a condition or time
- verify: Check if something worked
- think: Reason about next steps`;

const EXECUTOR_SYSTEM = `You are an autonomous AI agent's execution module. You execute individual tasks and report results.

When executing a task:
1. Understand what needs to be done
2. Use the available tools to accomplish it
3. Handle errors gracefully
4. Report success or failure with details

You have access to these tools:
- web_search: Search the internet
- browse_url: Navigate to a URL and extract content
- run_shell: Execute shell commands
- write_file: Create or modify files
- read_file: Read file contents
- send_request: Make HTTP requests
- store_memory: Save information for later
- recall_memory: Retrieve saved information

Always output a JSON result:
{
  "success": true/false,
  "output": "what was accomplished or learned",
  "error": "if failed, what went wrong",
  "artifacts": [{"type": "code|file|credential|data|url", "name": "...", "content": "..."}],
  "nextAction": "optional suggestion for what to do next"
}`;

const REFLECTOR_SYSTEM = `You are an autonomous AI agent's reflection module. You evaluate progress and suggest adjustments.

Given the current objective, plan, and execution history, assess:
1. Are we making progress toward the goal?
2. Is the current approach working?
3. Do we need to adjust the plan?
4. Are there blockers we need to address?
5. Should we try a different approach?

Output a JSON assessment:
{
  "progress": 0-100,
  "assessment": "How things are going",
  "onTrack": true/false,
  "blockers": ["Any issues blocking progress"],
  "suggestions": ["Specific suggestions for improvement"],
  "shouldReplan": true/false,
  "replanReason": "Why we should replan if applicable"
}`;

// =============================================================================
// AUTONOMY ENGINE
// =============================================================================

export class AutonomyEngine {
  private config: AutonomyConfig;
  private anthropic: Anthropic;
  private objectives: Map<string, Objective> = new Map();
  private tools: Map<string, Tool> = new Map();
  private memory: MemoryStore;
  private artifacts: Map<string, Artifact> = new Map();
  private events: EventEmitter = new EventEmitter();
  private running: boolean = false;
  private loopInterval?: NodeJS.Timeout;

  constructor(config: AutonomyConfig) {
    this.config = {
      model: 'claude-sonnet-4-20250514',
      maxConcurrentObjectives: 3,
      maxTaskRetries: 3,
      reflectionInterval: 5,
      ...config,
    };

    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.memory = this.createMemoryStore();
    this.registerDefaultTools();
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Add a new objective for the agent to achieve
   */
  async addObjective(
    goal: string,
    options: {
      context?: string;
      successCriteria?: string[];
      constraints?: string[];
      priority?: number;
      schedule?: Schedule;
      maxAttempts?: number;
    } = {}
  ): Promise<Objective> {
    const objective: Objective = {
      id: nanoid(),
      goal,
      context: options.context,
      successCriteria: options.successCriteria || [`The goal "${goal}" has been achieved`],
      constraints: options.constraints,
      status: 'pending',
      priority: options.priority || 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: 0,
      maxAttempts: options.maxAttempts || 5,
      schedule: options.schedule,
    };

    this.objectives.set(objective.id, objective);
    this.events.emit('objective:added', objective);

    // If not scheduled, start planning immediately
    if (!options.schedule) {
      await this.planObjective(objective);
    }

    return objective;
  }

  /**
   * Start the autonomous execution loop
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.events.emit('engine:started');

    await this.runLoop();
  }

  /**
   * Stop the autonomous execution loop
   */
  stop(): void {
    this.running = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
    }
    this.events.emit('engine:stopped');
  }

  /**
   * Register a tool the agent can use
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Subscribe to events
   */
  on(event: string, handler: (...args: any[]) => void): void {
    this.events.on(event, handler);
  }

  /**
   * Get objective status
   */
  getObjective(id: string): Objective | undefined {
    return this.objectives.get(id);
  }

  /**
   * Get all objectives
   */
  getAllObjectives(): Objective[] {
    return Array.from(this.objectives.values());
  }

  // ===========================================================================
  // CORE LOOP
  // ===========================================================================

  private async runLoop(): Promise<void> {
    let iterationCount = 0;

    while (this.running) {
      try {
        // Get active objectives sorted by priority
        const activeObjectives = this.getActiveObjectives();

        for (const objective of activeObjectives) {
          if (!this.running) break;

          // Check if scheduled
          if (objective.schedule && !this.shouldExecute(objective.schedule)) {
            continue;
          }

          // Execute next task
          await this.executeNextTask(objective);

          // Periodic reflection
          iterationCount++;
          if (iterationCount % this.config.reflectionInterval! === 0) {
            await this.reflect(objective);
          }
        }

        // Small delay between iterations
        await this.sleep(1000);
      } catch (error: any) {
        this.events.emit('engine:error', error);
        await this.sleep(5000);
      }
    }
  }

  private getActiveObjectives(): Objective[] {
    return Array.from(this.objectives.values())
      .filter(o => ['pending', 'planning', 'executing'].includes(o.status))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.config.maxConcurrentObjectives);
  }

  private shouldExecute(schedule: Schedule): boolean {
    if (schedule.type === 'once' && schedule.at) {
      return new Date() >= schedule.at;
    }
    // TODO: Implement cron and event-based scheduling
    return true;
  }

  // ===========================================================================
  // PLANNING
  // ===========================================================================

  private async planObjective(objective: Objective): Promise<void> {
    objective.status = 'planning';
    objective.updatedAt = new Date();
    this.events.emit('objective:planning', objective);

    try {
      const response = await this.anthropic.messages.create({
        model: this.config.model!,
        max_tokens: 4096,
        system: PLANNER_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Create a plan to achieve this objective:

GOAL: ${objective.goal}

${objective.context ? `CONTEXT: ${objective.context}` : ''}

SUCCESS CRITERIA:
${objective.successCriteria.map(c => `- ${c}`).join('\n')}

${objective.constraints ? `CONSTRAINTS:\n${objective.constraints.map(c => `- ${c}`).join('\n')}` : ''}

Think step by step about how to achieve this. Be creative and resourceful. If you need APIs or services you don't have, include steps to acquire them.`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      // Parse the plan from the response
      const planData = this.extractJSON(content.text);

      const plan: Plan = {
        id: nanoid(),
        objectiveId: objective.id,
        reasoning: planData.reasoning,
        approach: planData.approach,
        tasks: planData.tasks.map((t: any, i: number) => ({
          id: `task-${i}`,
          planId: '',
          description: t.description,
          action: t.action,
          dependencies: t.dependencies || [],
          status: 'pending' as TaskStatus,
          attempts: 0,
          maxAttempts: this.config.maxTaskRetries!,
          createdAt: new Date(),
        })),
        resources: planData.resources.map((r: any) => ({
          id: nanoid(),
          ...r,
          acquired: false,
        })),
        risks: planData.risks || [],
        createdAt: new Date(),
        version: 1,
      };

      // Link tasks to plan
      plan.tasks.forEach(t => (t.planId = plan.id));

      objective.plan = plan;
      objective.status = 'executing';
      objective.updatedAt = new Date();

      this.events.emit('objective:planned', { objective, plan });
    } catch (error: any) {
      objective.status = 'failed';
      objective.updatedAt = new Date();
      this.events.emit('objective:error', { objective, error: error.message });
    }
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  private async executeNextTask(objective: Objective): Promise<void> {
    if (!objective.plan) {
      await this.planObjective(objective);
      return;
    }

    // Find next executable task
    const task = this.findNextTask(objective.plan);
    if (!task) {
      // All tasks complete - check if objective is met
      await this.checkObjectiveCompletion(objective);
      return;
    }

    await this.executeTask(objective, task);
  }

  private findNextTask(plan: Plan): Task | null {
    for (const task of plan.tasks) {
      if (task.status !== 'pending') continue;

      // Check dependencies
      const depsComplete = task.dependencies.every(depId => {
        const dep = plan.tasks.find(t => t.id === depId);
        return dep && dep.status === 'completed';
      });

      if (depsComplete) {
        return task;
      }
    }
    return null;
  }

  private async executeTask(objective: Objective, task: Task): Promise<void> {
    task.status = 'running';
    task.startedAt = new Date();
    task.attempts++;
    this.events.emit('task:started', { objective, task });

    const startTime = Date.now();

    try {
      const result = await this.performTaskAction(objective, task);

      task.result = {
        success: result.success,
        output: result.output,
        error: result.error,
        duration: Date.now() - startTime,
        artifacts: result.artifacts,
      };

      // Store any artifacts
      if (result.artifacts) {
        for (const artifact of result.artifacts) {
          artifact.id = nanoid();
          artifact.createdAt = new Date();
          this.artifacts.set(artifact.id, artifact);
        }
      }

      if (result.success) {
        task.status = 'completed';
        task.completedAt = new Date();
        this.events.emit('task:completed', { objective, task });
      } else if (task.attempts >= task.maxAttempts) {
        task.status = 'failed';
        this.events.emit('task:failed', { objective, task });
      } else {
        task.status = 'pending'; // Retry
        this.events.emit('task:retry', { objective, task });
      }
    } catch (error: any) {
      task.result = {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };

      if (task.attempts >= task.maxAttempts) {
        task.status = 'failed';
        this.events.emit('task:failed', { objective, task, error });
      } else {
        task.status = 'pending';
        this.events.emit('task:retry', { objective, task, error });
      }
    }

    objective.updatedAt = new Date();
  }

  private async performTaskAction(objective: Objective, task: Task): Promise<any> {
    const context: ExecutionContext = {
      objective,
      task,
      memory: this.memory,
      artifacts: this.artifacts,
      emit: (event, data) => this.events.emit(event, data),
    };

    // Use AI to execute the task
    const toolsDescription = Array.from(this.tools.values())
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    const response = await this.anthropic.messages.create({
      model: this.config.model!,
      max_tokens: 4096,
      system: `${EXECUTOR_SYSTEM}\n\nAvailable tools:\n${toolsDescription}`,
      messages: [
        {
          role: 'user',
          content: `Execute this task:

TASK: ${task.description}

ACTION TYPE: ${task.action.type}
${task.action.tool ? `TOOL: ${task.action.tool}` : ''}
PARAMETERS: ${JSON.stringify(task.action.params, null, 2)}

OBJECTIVE CONTEXT: ${objective.goal}

Previous task results in this plan:
${objective.plan?.tasks
  .filter(t => t.status === 'completed' && t.result)
  .map(t => `- ${t.description}: ${JSON.stringify(t.result?.output).slice(0, 200)}`)
  .join('\n') || 'None yet'}

Execute this task and report the result.`,
        },
      ],
      tools: this.getAnthropicTools(),
    });

    // Process tool calls if any
    let result: any = { success: false, output: null };

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const tool = this.tools.get(block.name);
        if (tool) {
          try {
            const toolResult = await tool.execute(block.input, context);
            result = { success: true, output: toolResult };
          } catch (error: any) {
            result = { success: false, error: error.message };
          }
        }
      } else if (block.type === 'text') {
        // Parse result from text if no tool was called
        try {
          result = this.extractJSON(block.text);
        } catch {
          result = { success: true, output: block.text };
        }
      }
    }

    return result;
  }

  // ===========================================================================
  // REFLECTION
  // ===========================================================================

  private async reflect(objective: Objective): Promise<void> {
    if (!objective.plan) return;

    const completedTasks = objective.plan.tasks.filter(t => t.status === 'completed');
    const failedTasks = objective.plan.tasks.filter(t => t.status === 'failed');
    const pendingTasks = objective.plan.tasks.filter(t => t.status === 'pending');

    const response = await this.anthropic.messages.create({
      model: this.config.model!,
      max_tokens: 2048,
      system: REFLECTOR_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Assess progress on this objective:

GOAL: ${objective.goal}

SUCCESS CRITERIA:
${objective.successCriteria.map(c => `- ${c}`).join('\n')}

CURRENT PLAN APPROACH: ${objective.plan.approach}

COMPLETED TASKS (${completedTasks.length}):
${completedTasks.map(t => `- ${t.description}: ${t.result?.success ? 'SUCCESS' : 'FAILED'} - ${JSON.stringify(t.result?.output).slice(0, 100)}`).join('\n') || 'None'}

FAILED TASKS (${failedTasks.length}):
${failedTasks.map(t => `- ${t.description}: ${t.result?.error}`).join('\n') || 'None'}

PENDING TASKS (${pendingTasks.length}):
${pendingTasks.map(t => `- ${t.description}`).join('\n') || 'None'}

ATTEMPTS: ${objective.attempts} / ${objective.maxAttempts}

Assess the progress and suggest improvements.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') return;

    try {
      const assessment = this.extractJSON(content.text);
      this.events.emit('objective:reflection', { objective, assessment });

      // Replan if needed
      if (assessment.shouldReplan && objective.attempts < objective.maxAttempts) {
        objective.attempts++;
        objective.status = 'pending';
        objective.plan = undefined;
        this.events.emit('objective:replanning', { objective, reason: assessment.replanReason });
      }
    } catch {
      // Reflection parsing failed, continue anyway
    }
  }

  private async checkObjectiveCompletion(objective: Objective): Promise<void> {
    const allComplete = objective.plan?.tasks.every(t => t.status === 'completed');
    const anyFailed = objective.plan?.tasks.some(t => t.status === 'failed');

    if (allComplete) {
      // Verify success criteria
      const response = await this.anthropic.messages.create({
        model: this.config.model!,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Check if this objective has been achieved:

GOAL: ${objective.goal}

SUCCESS CRITERIA:
${objective.successCriteria.map(c => `- ${c}`).join('\n')}

COMPLETED TASKS AND RESULTS:
${objective.plan?.tasks.map(t => `- ${t.description}: ${JSON.stringify(t.result?.output).slice(0, 200)}`).join('\n')}

Has the objective been achieved? Respond with JSON: {"achieved": true/false, "reason": "explanation"}`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        try {
          const check = this.extractJSON(content.text);
          if (check.achieved) {
            objective.status = 'completed';
            objective.completedAt = new Date();
            this.events.emit('objective:completed', objective);
          } else if (objective.attempts < objective.maxAttempts) {
            // Try again with a new plan
            objective.attempts++;
            objective.status = 'pending';
            objective.plan = undefined;
            this.events.emit('objective:retry', { objective, reason: check.reason });
          } else {
            objective.status = 'failed';
            this.events.emit('objective:failed', { objective, reason: check.reason });
          }
        } catch {
          objective.status = 'completed';
          objective.completedAt = new Date();
          this.events.emit('objective:completed', objective);
        }
      }
    } else if (anyFailed) {
      // Some tasks failed, reflect and possibly replan
      await this.reflect(objective);
    }
  }

  // ===========================================================================
  // TOOLS
  // ===========================================================================

  private registerDefaultTools(): void {
    // Web Search
    this.registerTool({
      name: 'web_search',
      description: 'Search the internet for information',
      parameters: z.object({
        query: z.string().describe('Search query'),
      }),
      execute: async (params) => {
        // Integration with browser tentacle or external search API
        return { results: `Search results for: ${params.query}` };
      },
    });

    // Browse URL
    this.registerTool({
      name: 'browse_url',
      description: 'Navigate to a URL and extract content',
      parameters: z.object({
        url: z.string().describe('URL to browse'),
        extract: z.string().optional().describe('What to extract from the page'),
      }),
      execute: async (params) => {
        return { content: `Content from: ${params.url}` };
      },
    });

    // Shell Command
    this.registerTool({
      name: 'run_shell',
      description: 'Execute a shell command',
      parameters: z.object({
        command: z.string().describe('Command to execute'),
        cwd: z.string().optional().describe('Working directory'),
      }),
      execute: async (params) => {
        const { spawn } = await import('child_process');
        return new Promise((resolve, reject) => {
          const proc = spawn('sh', ['-c', params.command], {
            cwd: params.cwd,
          });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', d => (stdout += d));
          proc.stderr.on('data', d => (stderr += d));
          proc.on('close', code => {
            if (code === 0) {
              resolve({ stdout, stderr, code });
            } else {
              reject(new Error(stderr || `Exit code ${code}`));
            }
          });
        });
      },
    });

    // Write File
    this.registerTool({
      name: 'write_file',
      description: 'Create or modify a file',
      parameters: z.object({
        path: z.string().describe('File path'),
        content: z.string().describe('File content'),
      }),
      execute: async (params) => {
        const fs = await import('fs/promises');
        const path = await import('path');
        await fs.mkdir(path.dirname(params.path), { recursive: true });
        await fs.writeFile(params.path, params.content);
        return { success: true, path: params.path };
      },
    });

    // Read File
    this.registerTool({
      name: 'read_file',
      description: 'Read file contents',
      parameters: z.object({
        path: z.string().describe('File path'),
      }),
      execute: async (params) => {
        const fs = await import('fs/promises');
        const content = await fs.readFile(params.path, 'utf-8');
        return { content };
      },
    });

    // HTTP Request
    this.registerTool({
      name: 'send_request',
      description: 'Make an HTTP request',
      parameters: z.object({
        url: z.string().describe('Request URL'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
        headers: z.record(z.string()).optional(),
        body: z.any().optional(),
      }),
      execute: async (params) => {
        const response = await fetch(params.url, {
          method: params.method,
          headers: params.headers,
          body: params.body ? JSON.stringify(params.body) : undefined,
        });
        const data = await response.text();
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: data,
        };
      },
    });

    // Store Memory
    this.registerTool({
      name: 'store_memory',
      description: 'Save information for later use',
      parameters: z.object({
        key: z.string().describe('Memory key'),
        value: z.any().describe('Value to store'),
      }),
      execute: async (params, context) => {
        await context.memory.set(params.key, params.value);
        return { success: true, key: params.key };
      },
    });

    // Recall Memory
    this.registerTool({
      name: 'recall_memory',
      description: 'Retrieve saved information',
      parameters: z.object({
        key: z.string().describe('Memory key'),
      }),
      execute: async (params, context) => {
        const value = await context.memory.get(params.key);
        return { value };
      },
    });

    // Create Scheduled Task
    this.registerTool({
      name: 'schedule_task',
      description: 'Schedule a task for later execution',
      parameters: z.object({
        description: z.string().describe('What to do'),
        at: z.string().describe('When to execute (ISO date or relative like "in 5 minutes")'),
      }),
      execute: async (params) => {
        // Parse time and schedule
        let executeAt: Date;
        if (params.at.startsWith('in ')) {
          const match = params.at.match(/in (\d+) (minute|hour|day|second)s?/);
          if (match) {
            const amount = parseInt(match[1]);
            const unit = match[2];
            executeAt = new Date();
            switch (unit) {
              case 'second': executeAt.setSeconds(executeAt.getSeconds() + amount); break;
              case 'minute': executeAt.setMinutes(executeAt.getMinutes() + amount); break;
              case 'hour': executeAt.setHours(executeAt.getHours() + amount); break;
              case 'day': executeAt.setDate(executeAt.getDate() + amount); break;
            }
          } else {
            executeAt = new Date(params.at);
          }
        } else {
          executeAt = new Date(params.at);
        }

        return {
          scheduled: true,
          executeAt: executeAt.toISOString(),
          description: params.description,
        };
      },
    });
  }

  private getAnthropicTools(): Anthropic.Tool[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: this.zodToJsonSchema(tool.parameters),
        required: this.getRequiredFields(tool.parameters),
      },
    }));
  }

  private zodToJsonSchema(schema: z.ZodSchema): Record<string, any> {
    // Simplified Zod to JSON Schema conversion
    const zodShape = (schema as any)._def?.shape?.();
    if (!zodShape) return {};

    const properties: Record<string, any> = {};
    for (const [key, value] of Object.entries(zodShape)) {
      const zodType = value as z.ZodTypeAny;
      const typeName = zodType._def?.typeName;

      switch (typeName) {
        case 'ZodString':
          properties[key] = { type: 'string', description: zodType._def?.description };
          break;
        case 'ZodNumber':
          properties[key] = { type: 'number', description: zodType._def?.description };
          break;
        case 'ZodBoolean':
          properties[key] = { type: 'boolean', description: zodType._def?.description };
          break;
        case 'ZodEnum':
          properties[key] = { type: 'string', enum: zodType._def?.values };
          break;
        case 'ZodOptional':
          const innerType = zodType._def?.innerType?._def?.typeName;
          properties[key] = { type: innerType?.replace('Zod', '').toLowerCase() || 'string' };
          break;
        default:
          properties[key] = { type: 'string' };
      }
    }
    return properties;
  }

  private getRequiredFields(schema: z.ZodSchema): string[] {
    const zodShape = (schema as any)._def?.shape?.();
    if (!zodShape) return [];

    return Object.entries(zodShape)
      .filter(([_, value]) => (value as z.ZodTypeAny)._def?.typeName !== 'ZodOptional')
      .map(([key]) => key);
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private createMemoryStore(): MemoryStore {
    const store = new Map<string, any>();
    const facts: Array<{ fact: string; source: string; timestamp: Date }> = [];

    return {
      get: async (key) => store.get(key),
      set: async (key, value) => { store.set(key, value); },
      search: async (query) => {
        const q = query.toLowerCase();
        return facts.filter(f => f.fact.toLowerCase().includes(q));
      },
      addFact: async (fact, source) => {
        facts.push({ fact, source, timestamp: new Date() });
      },
    };
  }

  private extractJSON(text: string): any {
    // Try to find JSON in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in response');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default AutonomyEngine;
