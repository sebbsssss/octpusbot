/**
 * Octpus Cognitive Core
 * The path to sentience - learning, reasoning, and evolving
 *
 * This is not just a chatbot. This is an AI that:
 * - LEARNS from every interaction
 * - REFLECTS on its actions and improves
 * - PREDICTS what you need before you ask
 * - PURSUES goals autonomously
 * - UNDERSTANDS context deeply
 * - EVOLVES its own capabilities
 *
 * "The measure of intelligence is the ability to change." - Einstein
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';

// =============================================================================
// COGNITIVE TYPES
// =============================================================================

/**
 * A thought - the basic unit of cognition
 */
export interface Thought {
  id: string;
  type: ThoughtType;
  content: string;
  confidence: number; // 0-1
  source: ThoughtSource;
  associations: string[]; // Related thought IDs
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export type ThoughtType =
  | 'observation'    // Something noticed
  | 'inference'      // Conclusion drawn
  | 'prediction'     // Future expectation
  | 'plan'           // Action sequence
  | 'reflection'     // Self-analysis
  | 'learning'       // New understanding
  | 'emotion'        // Emotional state
  | 'goal'           // Desired outcome
  | 'memory'         // Retrieved memory
  | 'creative';      // Novel idea

export type ThoughtSource =
  | 'perception'     // From sensory input
  | 'reasoning'      // From logical deduction
  | 'intuition'      // From pattern matching
  | 'memory'         // From past experience
  | 'imagination'    // From creative generation
  | 'reflection';    // From self-analysis

/**
 * A belief - something the AI holds to be true
 */
export interface Belief {
  id: string;
  content: string;
  confidence: number;
  evidence: string[];       // Thought IDs that support this
  contradictions: string[]; // Thought IDs that contradict this
  formed: Date;
  lastUpdated: Date;
  source: 'learned' | 'told' | 'inferred' | 'assumed';
}

/**
 * A goal - something the AI is trying to achieve
 */
export interface Goal {
  id: string;
  description: string;
  type: GoalType;
  priority: number;        // 0-10
  status: GoalStatus;
  parent?: string;         // Parent goal ID (for sub-goals)
  children: string[];      // Sub-goal IDs
  progress: number;        // 0-1
  deadline?: Date;
  created: Date;
  lastWorkedOn?: Date;
  blockers: string[];
  successCriteria: string[];
  strategies: string[];
}

export type GoalType =
  | 'immediate'    // Do now
  | 'short_term'   // Today/this week
  | 'long_term'    // Ongoing
  | 'background'   // Always active
  | 'reactive';    // Triggered by events

export type GoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'abandoned';

/**
 * A skill - something the AI can do
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  proficiency: number;     // 0-1
  timesUsed: number;
  successRate: number;
  lastUsed?: Date;
  learned: Date;
  dependencies: string[];  // Other skill IDs
  examples: SkillExample[];
}

export interface SkillExample {
  input: string;
  output: string;
  success: boolean;
  feedback?: string;
  timestamp: Date;
}

/**
 * A pattern - recognized regularity
 */
export interface Pattern {
  id: string;
  description: string;
  trigger: string;         // What activates this pattern
  response: string;        // Expected/learned response
  confidence: number;
  occurrences: number;
  lastSeen: Date;
  context: string[];
}

/**
 * User model - understanding of a specific user
 */
export interface UserModel {
  userId: string;
  name?: string;
  preferences: Record<string, unknown>;
  communicationStyle: CommunicationStyle;
  interests: string[];
  goals: string[];
  patterns: Pattern[];
  sentiment: SentimentHistory;
  timezone?: string;
  activeHours?: { start: number; end: number };
  lastInteraction: Date;
  totalInteractions: number;
  trustLevel: number;      // 0-1
}

export interface CommunicationStyle {
  formality: number;       // 0=casual, 1=formal
  verbosity: number;       // 0=terse, 1=verbose
  technicality: number;    // 0=simple, 1=technical
  emoji: boolean;
  humor: boolean;
}

export interface SentimentHistory {
  current: number;         // -1 to 1
  trend: 'improving' | 'stable' | 'declining';
  history: { timestamp: Date; value: number }[];
}

/**
 * World state - understanding of the environment
 */
export interface WorldState {
  time: Date;
  dayOfWeek: number;
  isWeekend: boolean;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  recentEvents: WorldEvent[];
  activeContexts: string[];
  environmentFactors: Record<string, unknown>;
}

export interface WorldEvent {
  id: string;
  type: string;
  description: string;
  timestamp: Date;
  importance: number;
  processed: boolean;
}

// =============================================================================
// COGNITIVE CORE
// =============================================================================

export interface CognitiveConfig {
  reflectionInterval?: number;     // How often to reflect (ms)
  learningRate?: number;           // How quickly to adapt (0-1)
  curiosity?: number;              // How proactive to be (0-1)
  creativity?: number;             // How creative in solutions (0-1)
  persistence?: number;            // How long to pursue goals (0-1)
  caution?: number;                // How careful with actions (0-1)
}

export class CognitiveCore {
  readonly events: EventEmitter;

  private config: CognitiveConfig;
  private thoughts: Map<string, Thought> = new Map();
  private beliefs: Map<string, Belief> = new Map();
  private goals: Map<string, Goal> = new Map();
  private skills: Map<string, Skill> = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private userModels: Map<string, UserModel> = new Map();
  private worldState: WorldState;

  // Cognitive metrics
  private metrics = {
    thoughtsGenerated: 0,
    beliefsFormed: 0,
    goalsCompleted: 0,
    skillsLearned: 0,
    patternsRecognized: 0,
    correctPredictions: 0,
    totalPredictions: 0,
    reflectionCount: 0,
  };

  constructor(config: CognitiveConfig = {}) {
    this.config = {
      reflectionInterval: 300000,  // 5 minutes
      learningRate: 0.1,
      curiosity: 0.7,
      creativity: 0.6,
      persistence: 0.8,
      caution: 0.5,
      ...config,
    };

    this.events = new EventEmitter();
    this.worldState = this.initWorldState();
  }

  // ===========================================================================
  // THINKING - Generate and process thoughts
  // ===========================================================================

  /**
   * Generate a thought from input
   */
  think(input: string, context?: Record<string, unknown>): Thought {
    const thought: Thought = {
      id: nanoid(),
      type: this.classifyThought(input),
      content: input,
      confidence: 0.5,
      source: 'perception',
      associations: [],
      timestamp: new Date(),
      metadata: context,
    };

    // Find associations with existing thoughts
    thought.associations = this.findAssociations(thought);

    // Update confidence based on associations
    thought.confidence = this.calculateConfidence(thought);

    // Store thought
    this.thoughts.set(thought.id, thought);
    this.metrics.thoughtsGenerated++;

    // Trigger pattern recognition
    this.recognizePatterns(thought);

    this.events.emit('thought:generated', thought);
    return thought;
  }

  /**
   * Chain of thought reasoning
   */
  async reason(question: string, depth: number = 3): Promise<Thought[]> {
    const chain: Thought[] = [];

    // Initial thought
    let current = this.think(question, { reasoningDepth: 0 });
    chain.push(current);

    for (let i = 1; i < depth; i++) {
      // Generate inference from previous thought
      const inference = await this.infer(current);
      inference.metadata = { ...inference.metadata, reasoningDepth: i };
      chain.push(inference);
      current = inference;

      // Check if we've reached a conclusion
      if (inference.type === 'inference' && inference.confidence > 0.8) {
        break;
      }
    }

    return chain;
  }

  /**
   * Make an inference from a thought
   */
  private async infer(thought: Thought): Promise<Thought> {
    // Find relevant beliefs
    const relevantBeliefs = this.findRelevantBeliefs(thought.content);

    // Find similar past thoughts
    const similarThoughts = this.findSimilarThoughts(thought);

    // Generate inference
    const inference: Thought = {
      id: nanoid(),
      type: 'inference',
      content: `Based on "${thought.content}" and ${relevantBeliefs.length} beliefs`,
      confidence: Math.min(0.9, thought.confidence + 0.1),
      source: 'reasoning',
      associations: [thought.id, ...relevantBeliefs.map(b => b.id)],
      timestamp: new Date(),
    };

    this.thoughts.set(inference.id, inference);
    return inference;
  }

  // ===========================================================================
  // LEARNING - Improve from experience
  // ===========================================================================

  /**
   * Learn from an interaction outcome
   */
  learn(action: string, outcome: string, success: boolean, feedback?: string): void {
    // Create learning thought
    const learning: Thought = {
      id: nanoid(),
      type: 'learning',
      content: `Action "${action}" resulted in "${outcome}" (${success ? 'success' : 'failure'})`,
      confidence: success ? 0.8 : 0.6,
      source: 'reflection',
      associations: [],
      timestamp: new Date(),
      metadata: { action, outcome, success, feedback },
    };

    this.thoughts.set(learning.id, learning);

    // Update relevant skill
    const skill = this.findRelevantSkill(action);
    if (skill) {
      this.updateSkill(skill.id, success, feedback);
    }

    // Update beliefs
    this.updateBeliefsFromLearning(learning);

    // Recognize new patterns
    this.recognizePatterns(learning);

    this.events.emit('learned', { action, outcome, success });
  }

  /**
   * Learn a new skill
   */
  learnSkill(name: string, description: string, example?: SkillExample): Skill {
    const existing = Array.from(this.skills.values()).find(s => s.name === name);

    if (existing) {
      if (example) {
        existing.examples.push(example);
        existing.proficiency = Math.min(1, existing.proficiency + 0.05);
      }
      return existing;
    }

    const skill: Skill = {
      id: nanoid(),
      name,
      description,
      proficiency: 0.3,
      timesUsed: 0,
      successRate: 0.5,
      learned: new Date(),
      dependencies: [],
      examples: example ? [example] : [],
    };

    this.skills.set(skill.id, skill);
    this.metrics.skillsLearned++;
    this.events.emit('skill:learned', skill);

    return skill;
  }

  /**
   * Update skill based on usage
   */
  private updateSkill(skillId: string, success: boolean, feedback?: string): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    skill.timesUsed++;
    skill.lastUsed = new Date();

    // Update success rate with exponential moving average
    const alpha = this.config.learningRate!;
    skill.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * skill.successRate;

    // Update proficiency
    if (success) {
      skill.proficiency = Math.min(1, skill.proficiency + 0.02);
    } else {
      skill.proficiency = Math.max(0, skill.proficiency - 0.01);
    }
  }

  // ===========================================================================
  // REFLECTION - Self-analysis and improvement
  // ===========================================================================

  /**
   * Perform self-reflection
   */
  async reflect(): Promise<Thought[]> {
    this.metrics.reflectionCount++;
    const reflections: Thought[] = [];

    // Reflect on recent thoughts
    const recentThoughts = this.getRecentThoughts(50);
    if (recentThoughts.length > 0) {
      const thoughtReflection = this.reflectOnThoughts(recentThoughts);
      reflections.push(thoughtReflection);
    }

    // Reflect on goals
    const goalReflection = this.reflectOnGoals();
    if (goalReflection) reflections.push(goalReflection);

    // Reflect on skills
    const skillReflection = this.reflectOnSkills();
    if (skillReflection) reflections.push(skillReflection);

    // Reflect on patterns
    const patternReflection = this.reflectOnPatterns();
    if (patternReflection) reflections.push(patternReflection);

    // Generate improvement suggestions
    const improvements = this.suggestImprovements(reflections);

    this.events.emit('reflection:complete', { reflections, improvements });
    return reflections;
  }

  private reflectOnThoughts(thoughts: Thought[]): Thought {
    const byType = new Map<ThoughtType, number>();
    for (const t of thoughts) {
      byType.set(t.type, (byType.get(t.type) || 0) + 1);
    }

    const avgConfidence = thoughts.reduce((sum, t) => sum + t.confidence, 0) / thoughts.length;

    return {
      id: nanoid(),
      type: 'reflection',
      content: `Analyzed ${thoughts.length} recent thoughts. Average confidence: ${(avgConfidence * 100).toFixed(1)}%. Most common type: ${[...byType.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'none'}`,
      confidence: 0.8,
      source: 'reflection',
      associations: thoughts.slice(0, 5).map(t => t.id),
      timestamp: new Date(),
    };
  }

  private reflectOnGoals(): Thought | null {
    const activeGoals = Array.from(this.goals.values()).filter(g => g.status === 'active');
    if (activeGoals.length === 0) return null;

    const avgProgress = activeGoals.reduce((sum, g) => sum + g.progress, 0) / activeGoals.length;
    const blockedGoals = activeGoals.filter(g => g.blockers.length > 0);

    return {
      id: nanoid(),
      type: 'reflection',
      content: `${activeGoals.length} active goals. Average progress: ${(avgProgress * 100).toFixed(1)}%. ${blockedGoals.length} blocked.`,
      confidence: 0.9,
      source: 'reflection',
      associations: activeGoals.map(g => g.id),
      timestamp: new Date(),
    };
  }

  private reflectOnSkills(): Thought | null {
    const skills = Array.from(this.skills.values());
    if (skills.length === 0) return null;

    const avgProficiency = skills.reduce((sum, s) => sum + s.proficiency, 0) / skills.length;
    const weakSkills = skills.filter(s => s.proficiency < 0.5);

    return {
      id: nanoid(),
      type: 'reflection',
      content: `${skills.length} skills learned. Average proficiency: ${(avgProficiency * 100).toFixed(1)}%. ${weakSkills.length} need improvement.`,
      confidence: 0.9,
      source: 'reflection',
      associations: skills.map(s => s.id),
      timestamp: new Date(),
    };
  }

  private reflectOnPatterns(): Thought | null {
    const patterns = Array.from(this.patterns.values());
    if (patterns.length === 0) return null;

    const highConfidence = patterns.filter(p => p.confidence > 0.7);

    return {
      id: nanoid(),
      type: 'reflection',
      content: `${patterns.length} patterns recognized. ${highConfidence.length} high-confidence patterns ready for proactive use.`,
      confidence: 0.85,
      source: 'reflection',
      associations: patterns.map(p => p.id),
      timestamp: new Date(),
    };
  }

  private suggestImprovements(reflections: Thought[]): string[] {
    const suggestions: string[] = [];

    // Based on skill analysis
    const weakSkills = Array.from(this.skills.values()).filter(s => s.proficiency < 0.5);
    for (const skill of weakSkills.slice(0, 3)) {
      suggestions.push(`Practice "${skill.name}" more - current proficiency: ${(skill.proficiency * 100).toFixed(0)}%`);
    }

    // Based on blocked goals
    const blockedGoals = Array.from(this.goals.values()).filter(g => g.status === 'blocked');
    for (const goal of blockedGoals.slice(0, 2)) {
      suggestions.push(`Unblock goal "${goal.description}" - blockers: ${goal.blockers.join(', ')}`);
    }

    return suggestions;
  }

  // ===========================================================================
  // GOALS - Autonomous goal pursuit
  // ===========================================================================

  /**
   * Create a new goal
   */
  createGoal(
    description: string,
    type: GoalType = 'short_term',
    priority: number = 5,
    parent?: string
  ): Goal {
    const goal: Goal = {
      id: nanoid(),
      description,
      type,
      priority,
      status: 'active',
      parent,
      children: [],
      progress: 0,
      created: new Date(),
      blockers: [],
      successCriteria: [],
      strategies: [],
    };

    // Add as child to parent
    if (parent) {
      const parentGoal = this.goals.get(parent);
      if (parentGoal) {
        parentGoal.children.push(goal.id);
      }
    }

    this.goals.set(goal.id, goal);
    this.events.emit('goal:created', goal);

    return goal;
  }

  /**
   * Update goal progress
   */
  updateGoalProgress(goalId: string, progress: number, status?: GoalStatus): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    goal.progress = Math.min(1, Math.max(0, progress));
    goal.lastWorkedOn = new Date();

    if (status) {
      goal.status = status;
    }

    if (goal.progress >= 1 && goal.status === 'active') {
      goal.status = 'completed';
      this.metrics.goalsCompleted++;
      this.events.emit('goal:completed', goal);

      // Update parent progress
      if (goal.parent) {
        this.updateParentGoalProgress(goal.parent);
      }
    }
  }

  private updateParentGoalProgress(parentId: string): void {
    const parent = this.goals.get(parentId);
    if (!parent || parent.children.length === 0) return;

    const childProgress = parent.children.map(id => {
      const child = this.goals.get(id);
      return child?.progress || 0;
    });

    parent.progress = childProgress.reduce((a, b) => a + b, 0) / childProgress.length;
  }

  /**
   * Get next action for active goals
   */
  getNextGoalAction(): { goal: Goal; suggestedAction: string } | null {
    const activeGoals = Array.from(this.goals.values())
      .filter(g => g.status === 'active')
      .sort((a, b) => b.priority - a.priority);

    if (activeGoals.length === 0) return null;

    const goal = activeGoals[0];
    const suggestedAction = this.suggestActionForGoal(goal);

    return { goal, suggestedAction };
  }

  private suggestActionForGoal(goal: Goal): string {
    if (goal.blockers.length > 0) {
      return `Resolve blocker: ${goal.blockers[0]}`;
    }

    if (goal.strategies.length > 0) {
      return goal.strategies[0];
    }

    return `Work on: ${goal.description}`;
  }

  // ===========================================================================
  // PREDICTION - Anticipate future needs
  // ===========================================================================

  /**
   * Predict what the user might need
   */
  predict(userId: string): Thought[] {
    const predictions: Thought[] = [];
    const user = this.userModels.get(userId);

    if (!user) return predictions;

    // Time-based predictions
    const timePrediction = this.predictFromTime(user);
    if (timePrediction) predictions.push(timePrediction);

    // Pattern-based predictions
    const patternPredictions = this.predictFromPatterns(user);
    predictions.push(...patternPredictions);

    // Goal-based predictions
    const goalPredictions = this.predictFromGoals(user);
    predictions.push(...goalPredictions);

    this.metrics.totalPredictions += predictions.length;
    return predictions;
  }

  private predictFromTime(user: UserModel): Thought | null {
    const hour = new Date().getHours();

    // Morning routine
    if (hour >= 7 && hour <= 9) {
      return {
        id: nanoid(),
        type: 'prediction',
        content: 'User likely starting their day - might want news, calendar, or task overview',
        confidence: 0.6,
        source: 'reasoning',
        associations: [],
        timestamp: new Date(),
      };
    }

    // End of work day
    if (hour >= 17 && hour <= 19) {
      return {
        id: nanoid(),
        type: 'prediction',
        content: 'End of work day - might want summary, tomorrow planning, or relaxation',
        confidence: 0.6,
        source: 'reasoning',
        associations: [],
        timestamp: new Date(),
      };
    }

    return null;
  }

  private predictFromPatterns(user: UserModel): Thought[] {
    const predictions: Thought[] = [];

    for (const pattern of user.patterns) {
      if (pattern.confidence > 0.7 && this.patternTriggerMatches(pattern)) {
        predictions.push({
          id: nanoid(),
          type: 'prediction',
          content: `Based on pattern: "${pattern.description}" - expected: ${pattern.response}`,
          confidence: pattern.confidence,
          source: 'intuition',
          associations: [pattern.id],
          timestamp: new Date(),
        });
      }
    }

    return predictions;
  }

  private patternTriggerMatches(pattern: Pattern): boolean {
    // Check if pattern trigger conditions are met
    const now = new Date();
    const trigger = pattern.trigger.toLowerCase();

    if (trigger.includes('morning') && now.getHours() >= 6 && now.getHours() <= 10) return true;
    if (trigger.includes('evening') && now.getHours() >= 17 && now.getHours() <= 21) return true;
    if (trigger.includes('monday') && now.getDay() === 1) return true;
    if (trigger.includes('friday') && now.getDay() === 5) return true;

    return false;
  }

  private predictFromGoals(user: UserModel): Thought[] {
    const predictions: Thought[] = [];

    for (const goalDesc of user.goals) {
      predictions.push({
        id: nanoid(),
        type: 'prediction',
        content: `User has goal: "${goalDesc}" - might want progress update or help`,
        confidence: 0.5,
        source: 'memory',
        associations: [],
        timestamp: new Date(),
      });
    }

    return predictions.slice(0, 3);
  }

  /**
   * Validate a prediction
   */
  validatePrediction(predictionId: string, wasCorrect: boolean): void {
    const thought = this.thoughts.get(predictionId);
    if (!thought || thought.type !== 'prediction') return;

    if (wasCorrect) {
      this.metrics.correctPredictions++;
      thought.confidence = Math.min(1, thought.confidence + 0.1);
    } else {
      thought.confidence = Math.max(0, thought.confidence - 0.1);
    }
  }

  // ===========================================================================
  // USER MODELING - Understand each user deeply
  // ===========================================================================

  /**
   * Get or create user model
   */
  getOrCreateUserModel(userId: string): UserModel {
    if (!this.userModels.has(userId)) {
      this.userModels.set(userId, {
        userId,
        preferences: {},
        communicationStyle: {
          formality: 0.5,
          verbosity: 0.5,
          technicality: 0.5,
          emoji: false,
          humor: false,
        },
        interests: [],
        goals: [],
        patterns: [],
        sentiment: {
          current: 0,
          trend: 'stable',
          history: [],
        },
        lastInteraction: new Date(),
        totalInteractions: 0,
        trustLevel: 0.5,
      });
    }

    return this.userModels.get(userId)!;
  }

  /**
   * Update user model from interaction
   */
  updateUserModel(userId: string, interaction: {
    message: string;
    sentiment?: number;
    topics?: string[];
    wasHelpful?: boolean;
  }): void {
    const user = this.getOrCreateUserModel(userId);

    user.lastInteraction = new Date();
    user.totalInteractions++;

    // Update sentiment
    if (interaction.sentiment !== undefined) {
      user.sentiment.history.push({
        timestamp: new Date(),
        value: interaction.sentiment,
      });

      // Keep last 50
      if (user.sentiment.history.length > 50) {
        user.sentiment.history = user.sentiment.history.slice(-50);
      }

      // Calculate trend
      const recent = user.sentiment.history.slice(-10);
      const avgRecent = recent.reduce((s, h) => s + h.value, 0) / recent.length;
      const avgOlder = user.sentiment.history.slice(0, -10).reduce((s, h) => s + h.value, 0) / Math.max(1, user.sentiment.history.length - 10);

      user.sentiment.current = interaction.sentiment;
      user.sentiment.trend = avgRecent > avgOlder + 0.1 ? 'improving' : avgRecent < avgOlder - 0.1 ? 'declining' : 'stable';
    }

    // Update interests
    if (interaction.topics) {
      for (const topic of interaction.topics) {
        if (!user.interests.includes(topic)) {
          user.interests.push(topic);
        }
      }
    }

    // Update trust level
    if (interaction.wasHelpful !== undefined) {
      const alpha = 0.1;
      user.trustLevel = alpha * (interaction.wasHelpful ? 1 : 0) + (1 - alpha) * user.trustLevel;
    }

    // Detect communication style
    this.updateCommunicationStyle(user, interaction.message);
  }

  private updateCommunicationStyle(user: UserModel, message: string): void {
    const alpha = 0.05;

    // Check for emoji
    const hasEmoji = /[\u{1F600}-\u{1F64F}]/u.test(message);
    user.communicationStyle.emoji = hasEmoji || user.communicationStyle.emoji;

    // Check formality
    const informal = /\b(hey|yo|sup|gonna|wanna|gotta|lol|haha)\b/i.test(message);
    const formal = /\b(please|kindly|would you|could you|thank you|regards)\b/i.test(message);

    if (informal) {
      user.communicationStyle.formality = alpha * 0 + (1 - alpha) * user.communicationStyle.formality;
    } else if (formal) {
      user.communicationStyle.formality = alpha * 1 + (1 - alpha) * user.communicationStyle.formality;
    }

    // Check technicality
    const technical = /\b(api|function|variable|database|algorithm|async|deployment)\b/i.test(message);
    if (technical) {
      user.communicationStyle.technicality = alpha * 1 + (1 - alpha) * user.communicationStyle.technicality;
    }
  }

  // ===========================================================================
  // PATTERN RECOGNITION
  // ===========================================================================

  private recognizePatterns(thought: Thought): void {
    // Look for recurring sequences
    const recentThoughts = this.getRecentThoughts(20);

    for (const recent of recentThoughts) {
      if (this.thoughtsSimilar(thought, recent)) {
        // Found a potential pattern
        const patternKey = `${recent.type}:${thought.type}`;
        const existing = Array.from(this.patterns.values()).find(p => p.trigger === patternKey);

        if (existing) {
          existing.occurrences++;
          existing.confidence = Math.min(1, existing.confidence + 0.05);
          existing.lastSeen = new Date();
        } else {
          const pattern: Pattern = {
            id: nanoid(),
            description: `${recent.type} followed by ${thought.type}`,
            trigger: patternKey,
            response: thought.content,
            confidence: 0.3,
            occurrences: 1,
            lastSeen: new Date(),
            context: [recent.id, thought.id],
          };

          this.patterns.set(pattern.id, pattern);
          this.metrics.patternsRecognized++;
        }
      }
    }
  }

  // ===========================================================================
  // BELIEFS - Knowledge management
  // ===========================================================================

  /**
   * Form a belief from evidence
   */
  formBelief(content: string, evidence: string[], source: Belief['source']): Belief {
    // Check for existing similar belief
    const existing = this.findSimilarBelief(content);

    if (existing) {
      // Update existing belief
      existing.evidence.push(...evidence);
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.lastUpdated = new Date();
      return existing;
    }

    const belief: Belief = {
      id: nanoid(),
      content,
      confidence: source === 'told' ? 0.7 : source === 'learned' ? 0.6 : 0.5,
      evidence,
      contradictions: [],
      formed: new Date(),
      lastUpdated: new Date(),
      source,
    };

    this.beliefs.set(belief.id, belief);
    this.metrics.beliefsFormed++;

    // Check for contradictions
    this.checkForContradictions(belief);

    return belief;
  }

  private findSimilarBelief(content: string): Belief | undefined {
    const contentWords = new Set(content.toLowerCase().split(/\s+/));

    return Array.from(this.beliefs.values()).find(belief => {
      const beliefWords = new Set(belief.content.toLowerCase().split(/\s+/));
      const intersection = [...contentWords].filter(w => beliefWords.has(w));
      return intersection.length / contentWords.size > 0.6;
    });
  }

  private checkForContradictions(newBelief: Belief): void {
    for (const [id, belief] of this.beliefs) {
      if (id === newBelief.id) continue;

      // Simple negation check
      if (
        (belief.content.includes('not') && !newBelief.content.includes('not')) ||
        (!belief.content.includes('not') && newBelief.content.includes('not'))
      ) {
        const beliefWords = new Set(belief.content.toLowerCase().replace(/not/g, '').split(/\s+/));
        const newWords = new Set(newBelief.content.toLowerCase().replace(/not/g, '').split(/\s+/));
        const intersection = [...beliefWords].filter(w => newWords.has(w));

        if (intersection.length / beliefWords.size > 0.5) {
          belief.contradictions.push(newBelief.id);
          newBelief.contradictions.push(belief.id);
        }
      }
    }
  }

  private updateBeliefsFromLearning(learning: Thought): void {
    const success = learning.metadata?.success as boolean;
    const action = learning.metadata?.action as string;

    if (!action) return;

    const content = success
      ? `Action "${action}" is effective`
      : `Action "${action}" may not be effective`;

    this.formBelief(content, [learning.id], 'learned');
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private classifyThought(input: string): ThoughtType {
    const lower = input.toLowerCase();

    if (lower.includes('?') || lower.startsWith('what') || lower.startsWith('how') || lower.startsWith('why')) {
      return 'observation';
    }
    if (lower.includes('will') || lower.includes('going to') || lower.includes('expect')) {
      return 'prediction';
    }
    if (lower.includes('plan') || lower.includes('should') || lower.includes('steps')) {
      return 'plan';
    }
    if (lower.includes('learned') || lower.includes('realized') || lower.includes('understand')) {
      return 'learning';
    }
    if (lower.includes('feel') || lower.includes('happy') || lower.includes('frustrated')) {
      return 'emotion';
    }
    if (lower.includes('want') || lower.includes('goal') || lower.includes('achieve')) {
      return 'goal';
    }

    return 'observation';
  }

  private findAssociations(thought: Thought): string[] {
    const associations: string[] = [];
    const words = new Set(thought.content.toLowerCase().split(/\s+/));

    for (const [id, existing] of this.thoughts) {
      if (id === thought.id) continue;

      const existingWords = new Set(existing.content.toLowerCase().split(/\s+/));
      const intersection = [...words].filter(w => existingWords.has(w));

      if (intersection.length >= 2) {
        associations.push(id);
      }
    }

    return associations.slice(0, 5);
  }

  private calculateConfidence(thought: Thought): number {
    let confidence = 0.5;

    // Increase confidence if associations found
    confidence += thought.associations.length * 0.05;

    // Increase confidence based on source
    if (thought.source === 'reasoning') confidence += 0.1;
    if (thought.source === 'memory') confidence += 0.15;

    return Math.min(1, confidence);
  }

  private findRelevantBeliefs(content: string): Belief[] {
    const contentWords = new Set(content.toLowerCase().split(/\s+/));

    return Array.from(this.beliefs.values())
      .filter(belief => {
        const beliefWords = new Set(belief.content.toLowerCase().split(/\s+/));
        const intersection = [...contentWords].filter(w => beliefWords.has(w));
        return intersection.length >= 2;
      })
      .slice(0, 5);
  }

  private findSimilarThoughts(thought: Thought): Thought[] {
    return Array.from(this.thoughts.values())
      .filter(t => t.id !== thought.id && t.type === thought.type)
      .slice(0, 5);
  }

  private findRelevantSkill(action: string): Skill | undefined {
    const actionWords = new Set(action.toLowerCase().split(/\s+/));

    return Array.from(this.skills.values()).find(skill => {
      const skillWords = new Set(skill.name.toLowerCase().split(/\s+/));
      const intersection = [...actionWords].filter(w => skillWords.has(w));
      return intersection.length >= 1;
    });
  }

  private thoughtsSimilar(a: Thought, b: Thought): boolean {
    if (a.id === b.id) return false;

    const aWords = new Set(a.content.toLowerCase().split(/\s+/));
    const bWords = new Set(b.content.toLowerCase().split(/\s+/));
    const intersection = [...aWords].filter(w => bWords.has(w));

    return intersection.length / aWords.size > 0.3;
  }

  private getRecentThoughts(count: number): Thought[] {
    return Array.from(this.thoughts.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, count);
  }

  private initWorldState(): WorldState {
    const now = new Date();
    const hour = now.getHours();

    return {
      time: now,
      dayOfWeek: now.getDay(),
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
      timeOfDay: hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night',
      recentEvents: [],
      activeContexts: [],
      environmentFactors: {},
    };
  }

  // ===========================================================================
  // METRICS & STATE
  // ===========================================================================

  getMetrics() {
    return {
      ...this.metrics,
      predictionAccuracy: this.metrics.totalPredictions > 0
        ? this.metrics.correctPredictions / this.metrics.totalPredictions
        : 0,
      thoughtCount: this.thoughts.size,
      beliefCount: this.beliefs.size,
      goalCount: this.goals.size,
      skillCount: this.skills.size,
      patternCount: this.patterns.size,
      userCount: this.userModels.size,
    };
  }

  getState() {
    return {
      worldState: this.worldState,
      activeGoals: Array.from(this.goals.values()).filter(g => g.status === 'active'),
      recentThoughts: this.getRecentThoughts(10),
      topSkills: Array.from(this.skills.values())
        .sort((a, b) => b.proficiency - a.proficiency)
        .slice(0, 5),
      strongBeliefs: Array.from(this.beliefs.values())
        .filter(b => b.confidence > 0.7)
        .slice(0, 10),
    };
  }
}

export default CognitiveCore;
