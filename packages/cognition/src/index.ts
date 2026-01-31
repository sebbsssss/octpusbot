/**
 * Octpus Cognition Package
 * The path to sentience
 *
 * This package contains the cognitive systems that make Octpus
 * more than just a chatbot:
 *
 * - CognitiveCore: Thinking, reasoning, and learning
 * - Heartbeat: Proactive background processing
 * - EmotionalIntelligence: Understanding and adapting to users
 * - WorldModel: Understanding cause and effect
 *
 * Together, these systems enable:
 * - Continuous learning from every interaction
 * - Proactive assistance without being asked
 * - Deep understanding of each user
 * - Autonomous goal pursuit
 * - Self-improvement over time
 */

export * from './cognitive-core';
export * from './heartbeat';

// Re-export main classes for convenience
export { CognitiveCore } from './cognitive-core';
export { Heartbeat } from './heartbeat';

/**
 * Create a fully configured cognition system
 */
export function createCognitionSystem(config: {
  learningRate?: number;
  curiosity?: number;
  creativity?: number;
  persistence?: number;
  caution?: number;
  pulseInterval?: number;
  reflectionInterval?: number;
} = {}) {
  const cognitive = new (require('./cognitive-core').CognitiveCore)({
    learningRate: config.learningRate,
    curiosity: config.curiosity,
    creativity: config.creativity,
    persistence: config.persistence,
    caution: config.caution,
  });

  const heartbeat = new (require('./heartbeat').Heartbeat)(cognitive, {
    pulseInterval: config.pulseInterval,
    reflectionInterval: config.reflectionInterval,
  });

  return { cognitive, heartbeat };
}
