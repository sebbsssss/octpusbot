/**
 * Permission Manager
 * Enforces the 6-level permission system that makes Octpus safer than Moltbot
 */

import {
  PermissionLevel,
  PermissionConfig,
  DEFAULT_PERMISSION_CONFIG,
  Action,
  ActionApproval,
  ApprovalMethod,
  TentacleType,
} from '@octpus/types';

export interface PermissionCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  requires2FA: boolean;
  cooldownSeconds?: number;
  reason?: string;
}

export interface PendingApproval {
  action: Action;
  expiresAt: Date;
  resolve: (approval: ActionApproval) => void;
  reject: (reason: string) => void;
}

export class PermissionManager {
  private config: Record<PermissionLevel, PermissionConfig>;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private cooldowns: Map<string, Date> = new Map();
  private approvalTimeoutMs: number = 5 * 60 * 1000; // 5 minutes

  constructor(overrides?: Partial<Record<PermissionLevel, PermissionConfig>>) {
    this.config = { ...DEFAULT_PERMISSION_CONFIG };
    if (overrides) {
      for (const [level, config] of Object.entries(overrides)) {
        this.config[level as unknown as PermissionLevel] = {
          ...this.config[level as unknown as PermissionLevel],
          ...config,
        };
      }
    }
  }

  /**
   * Check if an action is allowed and what approvals are needed
   */
  check(action: Action, userId: string): PermissionCheckResult {
    const level = action.permissionLevel;
    const config = this.config[level];

    // Check cooldown
    const cooldownKey = `${userId}:${action.tentacle}:${action.capability}`;
    const cooldownUntil = this.cooldowns.get(cooldownKey);
    if (cooldownUntil && cooldownUntil > new Date()) {
      const remainingSeconds = Math.ceil(
        (cooldownUntil.getTime() - Date.now()) / 1000
      );
      return {
        allowed: false,
        requiresApproval: false,
        requires2FA: false,
        reason: `Action on cooldown. Please wait ${remainingSeconds} seconds.`,
      };
    }

    // Auto-approve if configured
    if (config.autoApprove) {
      return {
        allowed: true,
        requiresApproval: false,
        requires2FA: false,
      };
    }

    return {
      allowed: true,
      requiresApproval: config.requireConfirmation,
      requires2FA: config.require2FA,
      cooldownSeconds: config.cooldownSeconds,
    };
  }

  /**
   * Request approval for an action
   */
  async requestApproval(
    action: Action,
    method: ApprovalMethod
  ): Promise<ActionApproval> {
    return new Promise((resolve, reject) => {
      const expiresAt = new Date(Date.now() + this.approvalTimeoutMs);

      const pending: PendingApproval = {
        action,
        expiresAt,
        resolve,
        reject,
      };

      this.pendingApprovals.set(action.id, pending);

      // Auto-reject after timeout
      setTimeout(() => {
        if (this.pendingApprovals.has(action.id)) {
          this.pendingApprovals.delete(action.id);
          reject(new Error('Approval request timed out'));
        }
      }, this.approvalTimeoutMs);
    });
  }

  /**
   * Approve a pending action
   */
  approve(
    actionId: string,
    userId: string,
    method: ApprovalMethod
  ): boolean {
    const pending = this.pendingApprovals.get(actionId);
    if (!pending) {
      return false;
    }

    const approval: ActionApproval = {
      approved: true,
      method,
      userId,
      timestamp: new Date(),
    };

    // Set cooldown if required
    const config = this.config[pending.action.permissionLevel];
    if (config.cooldownSeconds) {
      const cooldownKey = `${userId}:${pending.action.tentacle}:${pending.action.capability}`;
      this.cooldowns.set(
        cooldownKey,
        new Date(Date.now() + config.cooldownSeconds * 1000)
      );
    }

    pending.resolve(approval);
    this.pendingApprovals.delete(actionId);
    return true;
  }

  /**
   * Reject a pending action
   */
  reject(actionId: string, userId: string, reason?: string): boolean {
    const pending = this.pendingApprovals.get(actionId);
    if (!pending) {
      return false;
    }

    const approval: ActionApproval = {
      approved: false,
      method: 'cli_confirm',
      userId,
      timestamp: new Date(),
      reason,
    };

    pending.resolve(approval);
    this.pendingApprovals.delete(actionId);
    return true;
  }

  /**
   * Get all pending approvals
   */
  getPendingApprovals(): Action[] {
    return Array.from(this.pendingApprovals.values()).map((p) => p.action);
  }

  /**
   * Clear expired approvals
   */
  clearExpired(): number {
    const now = new Date();
    let cleared = 0;

    for (const [id, pending] of this.pendingApprovals) {
      if (pending.expiresAt < now) {
        pending.reject('Approval request expired');
        this.pendingApprovals.delete(id);
        cleared++;
      }
    }

    // Also clear old cooldowns
    for (const [key, until] of this.cooldowns) {
      if (until < now) {
        this.cooldowns.delete(key);
      }
    }

    return cleared;
  }

  /**
   * Get human-readable description of a permission level
   */
  static describe(level: PermissionLevel): string {
    switch (level) {
      case PermissionLevel.L0_READ:
        return 'Read-only (search, fetch, read files)';
      case PermissionLevel.L1_WRITE_LOCAL:
        return 'Write local (create files, notes)';
      case PermissionLevel.L2_WRITE_EXTERNAL:
        return 'Write external (send messages, emails)';
      case PermissionLevel.L3_FINANCIAL:
        return 'Financial (transactions, swaps)';
      case PermissionLevel.L4_DESTRUCTIVE:
        return 'Destructive (delete, overwrite)';
      case PermissionLevel.L5_IRREVERSIBLE:
        return 'Irreversible (on-chain, public posts)';
    }
  }
}
