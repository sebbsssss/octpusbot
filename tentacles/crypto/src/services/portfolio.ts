/**
 * Portfolio Service
 * Tracks DeFi positions, calculates portfolio value, and provides analytics
 */

import { ChainId } from '@octpus/types';
import { PriceService } from './price';
import { DefiPosition } from '../index';

// Known DeFi protocols for position tracking
const DEFI_PROTOCOLS: Record<string, { name: string; chains: ChainId[] }> = {
  aave: { name: 'Aave', chains: ['ethereum', 'polygon', 'arbitrum', 'optimism'] },
  compound: { name: 'Compound', chains: ['ethereum'] },
  uniswap: { name: 'Uniswap', chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'] },
  curve: { name: 'Curve', chains: ['ethereum', 'polygon', 'arbitrum'] },
  lido: { name: 'Lido', chains: ['ethereum'] },
  rocketpool: { name: 'Rocket Pool', chains: ['ethereum'] },
  gmx: { name: 'GMX', chains: ['arbitrum'] },
  radiant: { name: 'Radiant', chains: ['arbitrum'] },
  velodrome: { name: 'Velodrome', chains: ['optimism'] },
  aerodrome: { name: 'Aerodrome', chains: ['base'] },
  marinade: { name: 'Marinade', chains: ['solana'] },
  raydium: { name: 'Raydium', chains: ['solana'] },
  orca: { name: 'Orca', chains: ['solana'] },
};

interface PortfolioSummary {
  totalValueUsd: number;
  change24h: number;
  change24hPercent: number;
  byChain: Record<ChainId, number>;
  byToken: Record<string, { amount: string; valueUsd: number }>;
  defiValue: number;
  walletValue: number;
}

interface PortfolioHistory {
  timestamp: number;
  totalValueUsd: number;
}

export class PortfolioService {
  private priceService: PriceService;
  private positionCache: Map<string, DefiPosition[]> = new Map();
  private cacheTimeout: number = 300000; // 5 minutes
  private lastCacheUpdate: Map<string, number> = new Map();

  constructor(priceService: PriceService) {
    this.priceService = priceService;
  }

  /**
   * Get all DeFi positions for an address
   */
  async getDefiPositions(address: string): Promise<DefiPosition[]> {
    // Check cache
    const lastUpdate = this.lastCacheUpdate.get(address);
    if (lastUpdate && Date.now() - lastUpdate < this.cacheTimeout) {
      return this.positionCache.get(address) || [];
    }

    const positions: DefiPosition[] = [];

    // In production, you would query:
    // - Zapper API: https://api.zapper.xyz/v2/balances
    // - DeBank API: https://openapi.debank.com
    // - DeFiLlama: https://api.llama.fi
    // - Individual protocol subgraphs

    // Example positions (would be fetched from APIs)
    positions.push(
      {
        protocol: 'Lido',
        type: 'staking',
        chain: 'ethereum',
        tokens: ['stETH'],
        valueUsd: 0, // Would be calculated
        apy: 3.8,
        rewards: [],
      },
      {
        protocol: 'Aave',
        type: 'lending',
        chain: 'ethereum',
        tokens: ['USDC'],
        valueUsd: 0,
        apy: 4.2,
        rewards: [],
      },
      {
        protocol: 'Uniswap',
        type: 'liquidity',
        chain: 'ethereum',
        tokens: ['ETH', 'USDC'],
        valueUsd: 0,
        rewards: [],
      }
    );

    // Cache results
    this.positionCache.set(address, positions);
    this.lastCacheUpdate.set(address, Date.now());

    return positions;
  }

  /**
   * Get portfolio summary
   */
  async getPortfolioSummary(
    address: string,
    balances: { chain: ChainId; symbol: string; balance: string; decimals: number }[]
  ): Promise<PortfolioSummary> {
    const summary: PortfolioSummary = {
      totalValueUsd: 0,
      change24h: 0,
      change24hPercent: 0,
      byChain: {} as Record<ChainId, number>,
      byToken: {},
      defiValue: 0,
      walletValue: 0,
    };

    // Calculate wallet value
    for (const balance of balances) {
      const price = await this.priceService.getPrice(balance.symbol);
      if (price) {
        const amount = parseFloat(balance.balance) / Math.pow(10, balance.decimals);
        const valueUsd = amount * price;

        summary.walletValue += valueUsd;
        summary.byChain[balance.chain] = (summary.byChain[balance.chain] || 0) + valueUsd;
        summary.byToken[balance.symbol] = {
          amount: amount.toString(),
          valueUsd,
        };
      }
    }

    // Get DeFi positions value
    const positions = await this.getDefiPositions(address);
    for (const position of positions) {
      summary.defiValue += position.valueUsd;
    }

    summary.totalValueUsd = summary.walletValue + summary.defiValue;

    return summary;
  }

  /**
   * Get portfolio allocation
   */
  getPortfolioAllocation(summary: PortfolioSummary): {
    byChain: Record<ChainId, number>;
    byToken: Record<string, number>;
    byType: { wallet: number; defi: number };
  } {
    const total = summary.totalValueUsd || 1; // Avoid division by zero

    return {
      byChain: Object.fromEntries(
        Object.entries(summary.byChain).map(([chain, value]) => [
          chain,
          (value / total) * 100,
        ])
      ) as Record<ChainId, number>,
      byToken: Object.fromEntries(
        Object.entries(summary.byToken).map(([token, data]) => [
          token,
          (data.valueUsd / total) * 100,
        ])
      ),
      byType: {
        wallet: (summary.walletValue / total) * 100,
        defi: (summary.defiValue / total) * 100,
      },
    };
  }

  /**
   * Get yield opportunities
   */
  async getYieldOpportunities(
    chains: ChainId[]
  ): Promise<
    {
      protocol: string;
      chain: ChainId;
      token: string;
      apy: number;
      tvl: number;
      type: string;
    }[]
  > {
    // In production, fetch from DeFiLlama yields API
    // https://yields.llama.fi/pools

    return [
      { protocol: 'Lido', chain: 'ethereum', token: 'ETH', apy: 3.8, tvl: 20000000000, type: 'staking' },
      { protocol: 'Aave', chain: 'ethereum', token: 'USDC', apy: 4.2, tvl: 5000000000, type: 'lending' },
      { protocol: 'Compound', chain: 'ethereum', token: 'USDC', apy: 3.9, tvl: 3000000000, type: 'lending' },
      { protocol: 'GMX', chain: 'arbitrum', token: 'GLP', apy: 15.0, tvl: 500000000, type: 'yield' },
      { protocol: 'Velodrome', chain: 'optimism', token: 'VELO', apy: 25.0, tvl: 200000000, type: 'liquidity' },
      { protocol: 'Marinade', chain: 'solana', token: 'SOL', apy: 6.5, tvl: 1000000000, type: 'staking' },
    ].filter((o) => chains.includes(o.chain));
  }

  /**
   * Get gas tracker
   */
  async getGasTracker(): Promise<
    Record<ChainId, { fast: number; standard: number; slow: number }>
  > {
    // In production, fetch from gas APIs
    return {
      ethereum: { fast: 30, standard: 20, slow: 15 },
      polygon: { fast: 100, standard: 50, slow: 30 },
      arbitrum: { fast: 0.1, standard: 0.1, slow: 0.1 },
      optimism: { fast: 0.001, standard: 0.001, slow: 0.001 },
      base: { fast: 0.001, standard: 0.001, slow: 0.001 },
      solana: { fast: 0.000005, standard: 0.000005, slow: 0.000005 },
      bitcoin: { fast: 20, standard: 10, slow: 5 },
    };
  }

  /**
   * Analyze portfolio risk
   */
  analyzeRisk(summary: PortfolioSummary): {
    score: number; // 0-100
    factors: { name: string; impact: 'low' | 'medium' | 'high'; description: string }[];
    recommendations: string[];
  } {
    const factors: { name: string; impact: 'low' | 'medium' | 'high'; description: string }[] = [];
    const recommendations: string[] = [];
    let riskScore = 50;

    // Check diversification
    const tokenCount = Object.keys(summary.byToken).length;
    if (tokenCount < 3) {
      factors.push({
        name: 'Low Diversification',
        impact: 'high',
        description: 'Portfolio concentrated in few tokens',
      });
      recommendations.push('Consider diversifying into more assets');
      riskScore += 20;
    }

    // Check stablecoin allocation
    const stableTokens = ['USDC', 'USDT', 'DAI'];
    const stableValue = stableTokens.reduce(
      (sum, token) => sum + (summary.byToken[token]?.valueUsd || 0),
      0
    );
    const stablePercent = (stableValue / summary.totalValueUsd) * 100;

    if (stablePercent < 10) {
      factors.push({
        name: 'Low Stablecoin Allocation',
        impact: 'medium',
        description: 'Less than 10% in stablecoins',
      });
      recommendations.push('Consider holding some stablecoins for stability');
      riskScore += 10;
    }

    // Check DeFi exposure
    const defiPercent = (summary.defiValue / summary.totalValueUsd) * 100;
    if (defiPercent > 50) {
      factors.push({
        name: 'High DeFi Exposure',
        impact: 'high',
        description: 'Over 50% of portfolio in DeFi protocols',
      });
      recommendations.push('Consider reducing DeFi exposure for lower smart contract risk');
      riskScore += 15;
    }

    // Check chain concentration
    const chainValues = Object.values(summary.byChain);
    const maxChainPercent = Math.max(...chainValues) / summary.totalValueUsd * 100;
    if (maxChainPercent > 80) {
      factors.push({
        name: 'Single Chain Concentration',
        impact: 'medium',
        description: 'Over 80% of portfolio on one chain',
      });
      recommendations.push('Consider spreading assets across multiple chains');
      riskScore += 10;
    }

    return {
      score: Math.min(100, Math.max(0, riskScore)),
      factors,
      recommendations,
    };
  }

  /**
   * Clear position cache
   */
  clearCache(address?: string): void {
    if (address) {
      this.positionCache.delete(address);
      this.lastCacheUpdate.delete(address);
    } else {
      this.positionCache.clear();
      this.lastCacheUpdate.clear();
    }
  }
}
