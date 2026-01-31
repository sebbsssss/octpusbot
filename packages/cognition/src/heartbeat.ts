/**
 * Octpus Heartbeat
 * The proactive pulse - background processing that never sleeps
 *
 * The Heartbeat makes Octpus truly autonomous:
 * - Monitors the world continuously
 * - Triggers proactive actions
 * - Schedules recurring tasks
 * - Learns from ambient signals
 * - Pursues goals in the background
 *
 * "The best assistant anticipates needs before they're expressed."
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { CognitiveCore, Goal, Thought, UserModel } from './cognitive-core';

// =============================================================================
// TYPES
// =============================================================================

export interface HeartbeatConfig {
  pulseInterval?: number;        // Main heartbeat interval (ms)
  reflectionInterval?: number;   // How often to reflect (ms)
  monitoringInterval?: number;   // How often to check monitors (ms)
  learningInterval?: number;     // How often to consolidate learning (ms)
  goalCheckInterval?: number;    // How often to work on goals (ms)
  enabled?: boolean;
}

export interface ProactiveAction {
  id: string;
  type: ProactiveActionType;
  trigger: string;
  description: string;
  priority: number;
  userId?: string;
  payload?: Record<string, unknown>;
  scheduledFor?: Date;
  recurring?: RecurringSchedule;
  conditions?: ActionCondition[];
  createdAt: Date;
  lastTriggered?: Date;
  triggerCount: number;
}

export type ProactiveActionType =
  | 'reminder'       // Remind user of something
  | 'suggestion'     // Suggest an action
  | 'alert'          // Alert about something important
  | 'update'         // Provide status update
  | 'check_in'       // Check in with user
  | 'goal_progress'  // Work on a goal
  | 'learning'       // Learn from ambient data
  | 'maintenance'    // System maintenance
  | 'custom';

export interface RecurringSchedule {
  type: 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron';
  value: number | string;  // Interval in ms, or cron expression
  startTime?: Date;
  endTime?: Date;
  maxOccurrences?: number;
  occurrences: number;
}

export interface ActionCondition {
  type: 'time' | 'event' | 'state' | 'user';
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'exists';
  field: string;
  value: unknown;
}

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  check: () => Promise<MonitorResult>;
  interval: number;
  lastCheck?: Date;
  lastResult?: MonitorResult;
  enabled: boolean;
}

export type MonitorType =
  | 'price'          // Crypto price alerts
  | 'website'        // Website availability
  | 'file'           // File changes
  | 'api'            // API health
  | 'calendar'       // Calendar events
  | 'email'          // New emails
  | 'social'         // Social mentions
  | 'custom';

export interface MonitorResult {
  success: boolean;
  data?: unknown;
  changed: boolean;
  alert?: string;
  timestamp: Date;
}

export interface ScheduledTask {
  id: string;
  description: string;
  executeAt: Date;
  action: () => Promise<void>;
  recurring?: RecurringSchedule;
  userId?: string;
  completed: boolean;
  result?: unknown;
}

// =============================================================================
// HEARTBEAT
// =============================================================================

export class Heartbeat {
  readonly events: EventEmitter;

  private config: HeartbeatConfig;
  private cognition: CognitiveCore;
  private running: boolean = false;
  private pulseTimer?: NodeJS.Timeout;
  private reflectionTimer?: NodeJS.Timeout;
  private monitorTimer?: NodeJS.Timeout;
  private learningTimer?: NodeJS.Timeout;
  private goalTimer?: NodeJS.Timeout;

  private proactiveActions: Map<string, ProactiveAction> = new Map();
  private monitors: Map<string, Monitor> = new Map();
  private scheduledTasks: Map<string, ScheduledTask> = new Map();

  // Metrics
  private pulseCount: number = 0;
  private actionsTriggered: number = 0;
  private alertsSent: number = 0;

  constructor(cognition: CognitiveCore, config: HeartbeatConfig = {}) {
    this.cognition = cognition;
    this.config = {
      pulseInterval: 60000,        // 1 minute
      reflectionInterval: 300000,  // 5 minutes
      monitoringInterval: 30000,   // 30 seconds
      learningInterval: 600000,    // 10 minutes
      goalCheckInterval: 120000,   // 2 minutes
      enabled: true,
      ...config,
    };

    this.events = new EventEmitter();
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Start the heartbeat
   */
  start(): void {
    if (this.running || !this.config.enabled) return;

    console.log('💓 Heartbeat starting...');
    this.running = true;

    // Start main pulse
    this.pulseTimer = setInterval(() => this.pulse(), this.config.pulseInterval!);

    // Start reflection cycle
    this.reflectionTimer = setInterval(() => this.reflectionCycle(), this.config.reflectionInterval!);

    // Start monitoring
    this.monitorTimer = setInterval(() => this.monitoringCycle(), this.config.monitoringInterval!);

    // Start learning consolidation
    this.learningTimer = setInterval(() => this.learningCycle(), this.config.learningInterval!);

    // Start goal pursuit
    this.goalTimer = setInterval(() => this.goalCycle(), this.config.goalCheckInterval!);

    // Initial pulse
    this.pulse();

    console.log('💓 Heartbeat running');
    this.events.emit('started');
  }

  /**
   * Stop the heartbeat
   */
  stop(): void {
    if (!this.running) return;

    console.log('💓 Heartbeat stopping...');
    this.running = false;

    if (this.pulseTimer) clearInterval(this.pulseTimer);
    if (this.reflectionTimer) clearInterval(this.reflectionTimer);
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.learningTimer) clearInterval(this.learningTimer);
    if (this.goalTimer) clearInterval(this.goalTimer);

    console.log('💓 Heartbeat stopped');
    this.events.emit('stopped');
  }

  // ===========================================================================
  // MAIN PULSE
  // ===========================================================================

  /**
   * Main heartbeat pulse - runs on every interval
   */
  private async pulse(): Promise<void> {
    this.pulseCount++;

    try {
      // Check scheduled tasks
      await this.checkScheduledTasks();

      // Check proactive actions
      await this.checkProactiveActions();

      // Update world state in cognition
      this.updateWorldState();

      this.events.emit('pulse', { count: this.pulseCount });
    } catch (error) {
      console.error('💓 Pulse error:', error);
    }
  }

  private async checkScheduledTasks(): Promise<void> {
    const now = new Date();

    for (const [id, task] of this.scheduledTasks) {
      if (task.completed) continue;
      if (task.executeAt > now) continue;

      try {
        await task.action();
        task.completed = true;

        // Handle recurring
        if (task.recurring) {
          const nextExecution = this.calculateNextExecution(task.recurring, now);
          if (nextExecution) {
            task.executeAt = nextExecution;
            task.completed = false;
            task.recurring.occurrences++;
          }
        }

        this.events.emit('task:executed', task);
      } catch (error) {
        console.error(`Task ${id} failed:`, error);
        task.result = { error: (error as Error).message };
      }
    }
  }

  private async checkProactiveActions(): Promise<void> {
    const now = new Date();

    for (const [id, action] of this.proactiveActions) {
      // Check scheduled time
      if (action.scheduledFor && action.scheduledFor > now) continue;

      // Check conditions
      if (action.conditions && !this.evaluateConditions(action.conditions)) continue;

      // Trigger action
      await this.triggerProactiveAction(action);
    }
  }

  private async triggerProactiveAction(action: ProactiveAction): Promise<void> {
    action.lastTriggered = new Date();
    action.triggerCount++;
    this.actionsTriggered++;

    this.events.emit('proactive:triggered', action);

    // Handle recurring
    if (action.recurring) {
      const next = this.calculateNextExecution(action.recurring, new Date());
      if (next) {
        action.scheduledFor = next;
        action.recurring.occurrences++;
      } else {
        // Max occurrences reached
        this.proactiveActions.delete(action.id);
      }
    } else {
      // One-time action, remove it
      this.proactiveActions.delete(action.id);
    }
  }

  private evaluateConditions(conditions: ActionCondition[]): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition)) {
        return false;
      }
    }
    return true;
  }

  private evaluateCondition(condition: ActionCondition): boolean {
    const now = new Date();

    switch (condition.type) {
      case 'time':
        if (condition.field === 'hour') {
          const hour = now.getHours();
          return this.compareValue(hour, condition.operator, condition.value);
        }
        if (condition.field === 'dayOfWeek') {
          return this.compareValue(now.getDay(), condition.operator, condition.value);
        }
        break;

      case 'state':
        const state = this.cognition.getState();
        const value = this.getNestedValue(state, condition.field);
        return this.compareValue(value, condition.operator, condition.value);
    }

    return true;
  }

  private compareValue(actual: unknown, operator: ActionCondition['operator'], expected: unknown): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'contains':
        return String(actual).includes(String(expected));
      case 'greater':
        return Number(actual) > Number(expected);
      case 'less':
        return Number(actual) < Number(expected);
      case 'exists':
        return actual !== undefined && actual !== null;
      default:
        return false;
    }
  }

  private getNestedValue(obj: any, path: string): unknown {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  private updateWorldState(): void {
    // This would update the cognition's world state with current information
    const now = new Date();
    const hour = now.getHours();

    this.cognition.think(`Current time: ${now.toISOString()}`, {
      source: 'heartbeat',
      timeOfDay: hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night',
    });
  }

  // ===========================================================================
  // REFLECTION CYCLE
  // ===========================================================================

  private async reflectionCycle(): Promise<void> {
    try {
      const reflections = await this.cognition.reflect();

      // Log interesting reflections
      for (const reflection of reflections) {
        if (reflection.confidence > 0.8) {
          console.log(`💭 Reflection: ${reflection.content}`);
        }
      }

      this.events.emit('reflection:complete', reflections);
    } catch (error) {
      console.error('Reflection error:', error);
    }
  }

  // ===========================================================================
  // MONITORING CYCLE
  // ===========================================================================

  private async monitoringCycle(): Promise<void> {
    for (const [id, monitor] of this.monitors) {
      if (!monitor.enabled) continue;

      // Check if it's time to run this monitor
      if (monitor.lastCheck) {
        const elapsed = Date.now() - monitor.lastCheck.getTime();
        if (elapsed < monitor.interval) continue;
      }

      try {
        const result = await monitor.check();
        monitor.lastCheck = new Date();
        monitor.lastResult = result;

        if (result.changed || result.alert) {
          this.events.emit('monitor:alert', { monitor, result });
          this.alertsSent++;

          // Create a thought about this
          this.cognition.think(
            `Monitor "${monitor.name}" triggered: ${result.alert || 'Change detected'}`,
            { monitorId: id, result }
          );
        }
      } catch (error) {
        console.error(`Monitor ${id} error:`, error);
      }
    }
  }

  // ===========================================================================
  // LEARNING CYCLE
  // ===========================================================================

  private async learningCycle(): Promise<void> {
    try {
      // Consolidate recent learning
      const metrics = this.cognition.getMetrics();

      // If prediction accuracy is low, trigger deeper reflection
      if (metrics.predictionAccuracy < 0.5 && metrics.totalPredictions > 10) {
        this.cognition.think(
          'Prediction accuracy is low - need to improve pattern recognition',
          { accuracy: metrics.predictionAccuracy }
        );
      }

      // Check for skills that need practice
      const state = this.cognition.getState();
      for (const skill of state.topSkills) {
        if (skill.proficiency < 0.5) {
          this.cognition.think(
            `Skill "${skill.name}" needs improvement (${(skill.proficiency * 100).toFixed(0)}% proficiency)`,
            { skillId: skill.id }
          );
        }
      }

      this.events.emit('learning:consolidated', metrics);
    } catch (error) {
      console.error('Learning cycle error:', error);
    }
  }

  // ===========================================================================
  // GOAL CYCLE
  // ===========================================================================

  private async goalCycle(): Promise<void> {
    try {
      const nextAction = this.cognition.getNextGoalAction();

      if (nextAction) {
        // Emit event for the goal work
        this.events.emit('goal:work', nextAction);

        // Create a thought about working on the goal
        this.cognition.think(
          `Working on goal: "${nextAction.goal.description}" - ${nextAction.suggestedAction}`,
          { goalId: nextAction.goal.id }
        );
      }
    } catch (error) {
      console.error('Goal cycle error:', error);
    }
  }

  // ===========================================================================
  // PROACTIVE ACTIONS
  // ===========================================================================

  /**
   * Schedule a proactive action
   */
  scheduleProactiveAction(
    type: ProactiveActionType,
    description: string,
    options: {
      trigger?: string;
      priority?: number;
      userId?: string;
      payload?: Record<string, unknown>;
      scheduledFor?: Date;
      recurring?: Partial<RecurringSchedule>;
      conditions?: ActionCondition[];
    } = {}
  ): ProactiveAction {
    const action: ProactiveAction = {
      id: nanoid(),
      type,
      trigger: options.trigger || 'manual',
      description,
      priority: options.priority || 5,
      userId: options.userId,
      payload: options.payload,
      scheduledFor: options.scheduledFor,
      recurring: options.recurring ? {
        type: options.recurring.type || 'interval',
        value: options.recurring.value || 3600000,
        occurrences: 0,
        ...options.recurring,
      } : undefined,
      conditions: options.conditions,
      createdAt: new Date(),
      triggerCount: 0,
    };

    this.proactiveActions.set(action.id, action);
    this.events.emit('proactive:scheduled', action);

    return action;
  }

  /**
   * Schedule a reminder
   */
  scheduleReminder(
    userId: string,
    message: string,
    when: Date | number, // Date or ms from now
    recurring?: Partial<RecurringSchedule>
  ): ProactiveAction {
    const scheduledFor = typeof when === 'number'
      ? new Date(Date.now() + when)
      : when;

    return this.scheduleProactiveAction('reminder', message, {
      userId,
      scheduledFor,
      recurring,
      payload: { message },
    });
  }

  /**
   * Schedule a check-in
   */
  scheduleCheckIn(
    userId: string,
    topic: string,
    conditions?: ActionCondition[]
  ): ProactiveAction {
    return this.scheduleProactiveAction('check_in', `Check in about: ${topic}`, {
      userId,
      conditions,
      payload: { topic },
    });
  }

  // ===========================================================================
  // MONITORS
  // ===========================================================================

  /**
   * Add a monitor
   */
  addMonitor(
    name: string,
    type: MonitorType,
    check: () => Promise<MonitorResult>,
    interval: number = 60000
  ): Monitor {
    const monitor: Monitor = {
      id: nanoid(),
      name,
      type,
      check,
      interval,
      enabled: true,
    };

    this.monitors.set(monitor.id, monitor);
    this.events.emit('monitor:added', monitor);

    return monitor;
  }

  /**
   * Add a price alert monitor
   */
  addPriceAlert(
    symbol: string,
    condition: 'above' | 'below',
    price: number,
    userId?: string
  ): Monitor {
    return this.addMonitor(
      `${symbol} ${condition} $${price}`,
      'price',
      async () => {
        // This would call the crypto tentacle to get price
        // For now, return a placeholder
        const currentPrice = 0; // Would fetch real price

        const triggered = condition === 'above'
          ? currentPrice > price
          : currentPrice < price;

        return {
          success: true,
          data: { currentPrice },
          changed: triggered,
          alert: triggered ? `${symbol} is now ${condition} $${price} (current: $${currentPrice})` : undefined,
          timestamp: new Date(),
        };
      },
      30000 // Check every 30 seconds
    );
  }

  /**
   * Enable/disable a monitor
   */
  toggleMonitor(monitorId: string, enabled: boolean): void {
    const monitor = this.monitors.get(monitorId);
    if (monitor) {
      monitor.enabled = enabled;
    }
  }

  /**
   * Remove a monitor
   */
  removeMonitor(monitorId: string): boolean {
    return this.monitors.delete(monitorId);
  }

  // ===========================================================================
  // SCHEDULED TASKS
  // ===========================================================================

  /**
   * Schedule a task
   */
  scheduleTask(
    description: string,
    executeAt: Date | number,
    action: () => Promise<void>,
    options: {
      userId?: string;
      recurring?: Partial<RecurringSchedule>;
    } = {}
  ): ScheduledTask {
    const task: ScheduledTask = {
      id: nanoid(),
      description,
      executeAt: typeof executeAt === 'number'
        ? new Date(Date.now() + executeAt)
        : executeAt,
      action,
      recurring: options.recurring ? {
        type: options.recurring.type || 'interval',
        value: options.recurring.value || 3600000,
        occurrences: 0,
        ...options.recurring,
      } : undefined,
      userId: options.userId,
      completed: false,
    };

    this.scheduledTasks.set(task.id, task);
    this.events.emit('task:scheduled', task);

    return task;
  }

  /**
   * Cancel a scheduled task
   */
  cancelTask(taskId: string): boolean {
    return this.scheduledTasks.delete(taskId);
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private calculateNextExecution(schedule: RecurringSchedule, from: Date): Date | null {
    // Check max occurrences
    if (schedule.maxOccurrences && schedule.occurrences >= schedule.maxOccurrences) {
      return null;
    }

    // Check end time
    if (schedule.endTime && from >= schedule.endTime) {
      return null;
    }

    switch (schedule.type) {
      case 'interval':
        return new Date(from.getTime() + (schedule.value as number));

      case 'daily':
        const nextDaily = new Date(from);
        nextDaily.setDate(nextDaily.getDate() + 1);
        nextDaily.setHours(schedule.value as number, 0, 0, 0);
        return nextDaily;

      case 'weekly':
        const nextWeekly = new Date(from);
        nextWeekly.setDate(nextWeekly.getDate() + 7);
        return nextWeekly;

      case 'monthly':
        const nextMonthly = new Date(from);
        nextMonthly.setMonth(nextMonthly.getMonth() + 1);
        return nextMonthly;

      default:
        return null;
    }
  }

  // ===========================================================================
  // METRICS
  // ===========================================================================

  getMetrics() {
    return {
      running: this.running,
      pulseCount: this.pulseCount,
      actionsTriggered: this.actionsTriggered,
      alertsSent: this.alertsSent,
      activeProactiveActions: this.proactiveActions.size,
      activeMonitors: Array.from(this.monitors.values()).filter(m => m.enabled).length,
      scheduledTasks: Array.from(this.scheduledTasks.values()).filter(t => !t.completed).length,
    };
  }

  getStatus() {
    return {
      running: this.running,
      proactiveActions: Array.from(this.proactiveActions.values()),
      monitors: Array.from(this.monitors.values()),
      scheduledTasks: Array.from(this.scheduledTasks.values()).filter(t => !t.completed),
    };
  }
}

export default Heartbeat;
