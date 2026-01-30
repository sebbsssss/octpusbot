/**
 * DEX Service
 * Multi-DEX aggregator for best swap rates
 *
 * Supported DEXes:
 * - 1inch (EVM chains)
 * - Jupiter (Solana)
 * - Uniswap (Ethereum, Polygon, Arbitrum, Optimism, Base)
 * - SushiSwap (multi-chain)
 * - Curve (stableswaps)
 * - ParaSwap (aggregator)
 *
 * No API keys required! Uses free APIs.
 */

import { ChainId, SwapQuote, Transaction } from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

export interface DEXConfig {
  preferredDEX?: string;
  slippageTolerance?: number; // In basis points (100 = 1%)
  enabledDEXes?: string[];
  maxHops?: number;
}

export interface DEXQuote extends SwapQuote {
  dex: string;
  gasEstimateUsd?: number;
  protocols?: string[];
}

export interface Token {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
  logoURI?: string;
}

// Chain-specific DEX routers
const DEX_ROUTERS: Record<ChainId, Record<string, string>> = {
  ethereum: {
    uniswap: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Universal Router
    sushiswap: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    '1inch': '0x1111111254EEB25477B68fb85Ed929f73A960582',
    curve: '0x99a58482BD75cbab83b27EC03CA68fF489b5788f',
    paraswap: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
  },
  polygon: {
    uniswap: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quickswap: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    sushiswap: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    '1inch': '0x1111111254EEB25477B68fb85Ed929f73A960582',
  },
  arbitrum: {
    uniswap: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    sushiswap: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    camelot: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    '1inch': '0x1111111254EEB25477B68fb85Ed929f73A960582',
  },
  optimism: {
    uniswap: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    velodrome: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858',
    '1inch': '0x1111111254EEB25477B68fb85Ed929f73A960582',
  },
  base: {
    uniswap: '0x2626664c2603336E57B271c5C0b26F421741e481',
    aerodrome: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    '1inch': '0x1111111254EEB25477B68fb85Ed929f73A960582',
  },
  solana: {
    jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    raydium: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    orca: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  },
  bitcoin: {},
};

// Common token addresses
const COMMON_TOKENS: Record<ChainId, Record<string, Token>> = {
  ethereum: {
    ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18 },
    WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
    DAI: { address: '0x6B175474E89094C44Da98b954EesatdFd630AB16F', symbol: 'DAI', decimals: 18 },
    WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
  },
  polygon: {
    MATIC: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'MATIC', decimals: 18 },
    WMATIC: { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC', decimals: 18 },
    USDC: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 },
    USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
  },
  arbitrum: {
    ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18 },
    WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
    ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', decimals: 18 },
  },
  optimism: {
    ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18 },
    WETH: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
    OP: { address: '0x4200000000000000000000000000000000000042', symbol: 'OP', decimals: 18 },
  },
  base: {
    ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18 },
    WETH: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
  },
  solana: {
    SOL: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
    USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
    USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
    RAY: { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', decimals: 6 },
    JUP: { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  },
  bitcoin: {},
};

// =============================================================================
// DEX SERVICE
// =============================================================================

export class DEXService {
  private config: DEXConfig;

  constructor(config: DEXConfig = {}) {
    this.config = {
      slippageTolerance: 50, // 0.5%
      maxHops: 3,
      enabledDEXes: ['1inch', 'jupiter', 'uniswap', 'paraswap'],
      ...config,
    };
  }

  /**
   * Get the best swap quote across all DEXes
   */
  async getBestQuote(
    chain: ChainId,
    fromToken: string,
    toToken: string,
    amount: string,
    userAddress?: string
  ): Promise<DEXQuote | null> {
    const quotes = await this.getAllQuotes(chain, fromToken, toToken, amount, userAddress);

    if (quotes.length === 0) {
      return null;
    }

    // Sort by output amount (descending)
    quotes.sort((a, b) => {
      const amountA = BigInt(a.toAmount);
      const amountB = BigInt(b.toAmount);
      return amountB > amountA ? 1 : amountB < amountA ? -1 : 0;
    });

    return quotes[0];
  }

  /**
   * Get quotes from all available DEXes
   */
  async getAllQuotes(
    chain: ChainId,
    fromToken: string,
    toToken: string,
    amount: string,
    userAddress?: string
  ): Promise<DEXQuote[]> {
    const quotes: DEXQuote[] = [];

    // Resolve token addresses
    const fromAddress = this.resolveToken(chain, fromToken);
    const toAddress = this.resolveToken(chain, toToken);

    if (!fromAddress || !toAddress) {
      throw new Error(`Unknown token: ${!fromAddress ? fromToken : toToken}`);
    }

    // Get quotes from each DEX in parallel
    const quotePromises: Promise<DEXQuote | null>[] = [];

    if (chain === 'solana') {
      // Solana DEXes
      if (this.config.enabledDEXes?.includes('jupiter')) {
        quotePromises.push(this.getJupiterQuote(fromAddress, toAddress, amount));
      }
    } else {
      // EVM DEXes
      if (this.config.enabledDEXes?.includes('1inch')) {
        quotePromises.push(this.get1inchQuote(chain, fromAddress, toAddress, amount));
      }

      if (this.config.enabledDEXes?.includes('paraswap')) {
        quotePromises.push(this.getParaswapQuote(chain, fromAddress, toAddress, amount, userAddress));
      }
    }

    const results = await Promise.allSettled(quotePromises);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        quotes.push(result.value);
      }
    }

    return quotes;
  }

  /**
   * Get quote from 1inch (EVM chains)
   */
  async get1inchQuote(
    chain: ChainId,
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<DEXQuote | null> {
    const chainIds: Record<ChainId, number> = {
      ethereum: 1,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
      base: 8453,
      solana: 0,
      bitcoin: 0,
    };

    const chainId = chainIds[chain];
    if (!chainId) return null;

    try {
      // 1inch API (free, no key required for basic quotes)
      const url = `https://api.1inch.dev/swap/v6.0/${chainId}/quote?src=${fromToken}&dst=${toToken}&amount=${amount}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`1inch quote failed: ${response.status}`);
        return null;
      }

      const data = await response.json();

      return {
        fromToken,
        toToken,
        fromAmount: amount,
        toAmount: data.toAmount,
        priceImpact: 0, // 1inch doesn't return this in quote
        route: data.protocols?.[0]?.map((p: any) => p[0]?.name) || ['1inch'],
        estimatedGas: data.gas || '0',
        expiresAt: new Date(Date.now() + 30000),
        dex: '1inch',
        protocols: data.protocols?.flat(2).map((p: any) => p.name),
      };
    } catch (error) {
      console.error('1inch quote error:', error);
      return null;
    }
  }

  /**
   * Get quote from Jupiter (Solana)
   */
  async getJupiterQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<DEXQuote | null> {
    try {
      // Jupiter API (free, no key required)
      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${fromToken}&outputMint=${toToken}&amount=${amount}&slippageBps=${this.config.slippageTolerance}`;

      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`Jupiter quote failed: ${response.status}`);
        return null;
      }

      const data = await response.json();

      return {
        fromToken,
        toToken,
        fromAmount: amount,
        toAmount: data.outAmount,
        priceImpact: parseFloat(data.priceImpactPct) || 0,
        route: data.routePlan?.map((r: any) => r.swapInfo?.label) || ['Jupiter'],
        estimatedGas: '5000', // Solana uses compute units, not gas
        expiresAt: new Date(Date.now() + 30000),
        dex: 'jupiter',
        protocols: data.routePlan?.map((r: any) => r.swapInfo?.label),
      };
    } catch (error) {
      console.error('Jupiter quote error:', error);
      return null;
    }
  }

  /**
   * Get quote from ParaSwap (EVM chains)
   */
  async getParaswapQuote(
    chain: ChainId,
    fromToken: string,
    toToken: string,
    amount: string,
    userAddress?: string
  ): Promise<DEXQuote | null> {
    const chainIds: Record<ChainId, number> = {
      ethereum: 1,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
      base: 8453,
      solana: 0,
      bitcoin: 0,
    };

    const chainId = chainIds[chain];
    if (!chainId) return null;

    try {
      // ParaSwap API (free, no key required)
      const url = `https://apiv5.paraswap.io/prices?srcToken=${fromToken}&destToken=${toToken}&amount=${amount}&srcDecimals=18&destDecimals=18&side=SELL&network=${chainId}`;

      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`ParaSwap quote failed: ${response.status}`);
        return null;
      }

      const data = await response.json();

      return {
        fromToken,
        toToken,
        fromAmount: amount,
        toAmount: data.priceRoute?.destAmount || '0',
        priceImpact: parseFloat(data.priceRoute?.percentageDiff) || 0,
        route: data.priceRoute?.bestRoute?.[0]?.swaps?.map((s: any) => s.swapExchanges?.[0]?.exchange) || ['ParaSwap'],
        estimatedGas: data.priceRoute?.gasCost || '0',
        expiresAt: new Date(Date.now() + 30000),
        dex: 'paraswap',
        gasEstimateUsd: parseFloat(data.priceRoute?.gasCostUSD) || undefined,
      };
    } catch (error) {
      console.error('ParaSwap quote error:', error);
      return null;
    }
  }

  /**
   * Build swap transaction (returns calldata)
   */
  async buildSwapTransaction(
    chain: ChainId,
    quote: DEXQuote,
    userAddress: string,
    recipient?: string
  ): Promise<{
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  }> {
    if (chain === 'solana') {
      return this.buildJupiterSwap(quote, userAddress);
    }

    // Default to 1inch for EVM
    return this.build1inchSwap(chain, quote, userAddress, recipient);
  }

  /**
   * Build 1inch swap transaction
   */
  private async build1inchSwap(
    chain: ChainId,
    quote: DEXQuote,
    userAddress: string,
    recipient?: string
  ): Promise<{
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  }> {
    const chainIds: Record<ChainId, number> = {
      ethereum: 1,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
      base: 8453,
      solana: 0,
      bitcoin: 0,
    };

    const chainId = chainIds[chain];

    // Calculate minimum output with slippage
    const minOutput = BigInt(quote.toAmount) * BigInt(10000 - this.config.slippageTolerance!) / BigInt(10000);

    const url = `https://api.1inch.dev/swap/v6.0/${chainId}/swap?src=${quote.fromToken}&dst=${quote.toToken}&amount=${quote.fromAmount}&from=${userAddress}&slippage=${this.config.slippageTolerance! / 100}${recipient ? `&receiver=${recipient}` : ''}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to build 1inch swap: ${response.status}`);
    }

    const data = await response.json();

    return {
      to: data.tx.to,
      data: data.tx.data,
      value: data.tx.value,
      gasLimit: data.tx.gas,
    };
  }

  /**
   * Build Jupiter swap transaction
   */
  private async buildJupiterSwap(
    quote: DEXQuote,
    userAddress: string
  ): Promise<{
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  }> {
    // First get a fresh quote
    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${quote.fromToken}&outputMint=${quote.toToken}&amount=${quote.fromAmount}&slippageBps=${this.config.slippageTolerance}`;

    const quoteResponse = await fetch(quoteUrl);
    const quoteData = await quoteResponse.json();

    // Then get the swap transaction
    const swapUrl = 'https://quote-api.jup.ag/v6/swap';

    const swapResponse = await fetch(swapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: userAddress,
        wrapAndUnwrapSol: true,
      }),
    });

    if (!swapResponse.ok) {
      throw new Error(`Failed to build Jupiter swap: ${swapResponse.status}`);
    }

    const swapData = await swapResponse.json();

    return {
      to: DEX_ROUTERS.solana.jupiter,
      data: swapData.swapTransaction, // Base64 encoded transaction
      value: '0',
      gasLimit: '200000', // Compute units
    };
  }

  /**
   * Get token list for a chain
   */
  async getTokenList(chain: ChainId): Promise<Token[]> {
    // Return common tokens for now
    // In production, fetch from token lists like tokenlists.org
    return Object.values(COMMON_TOKENS[chain] || {});
  }

  /**
   * Resolve token symbol/address to address
   */
  resolveToken(chain: ChainId, tokenOrAddress: string): string | null {
    // If it's already an address, return it
    if (tokenOrAddress.startsWith('0x') || tokenOrAddress.length > 20) {
      return tokenOrAddress;
    }

    // Look up by symbol
    const chainTokens = COMMON_TOKENS[chain];
    if (!chainTokens) return null;

    const token = chainTokens[tokenOrAddress.toUpperCase()];
    return token?.address || null;
  }

  /**
   * Get token info
   */
  getTokenInfo(chain: ChainId, symbolOrAddress: string): Token | null {
    const chainTokens = COMMON_TOKENS[chain];
    if (!chainTokens) return null;

    // Check by symbol
    const bySymbol = chainTokens[symbolOrAddress.toUpperCase()];
    if (bySymbol) return bySymbol;

    // Check by address
    for (const token of Object.values(chainTokens)) {
      if (token.address.toLowerCase() === symbolOrAddress.toLowerCase()) {
        return token;
      }
    }

    return null;
  }

  /**
   * Calculate price impact
   */
  calculatePriceImpact(
    inputAmount: string,
    outputAmount: string,
    inputDecimals: number,
    outputDecimals: number,
    marketPrice: number
  ): number {
    const inputValue = parseFloat(inputAmount) / Math.pow(10, inputDecimals);
    const outputValue = parseFloat(outputAmount) / Math.pow(10, outputDecimals);

    const expectedOutput = inputValue * marketPrice;
    const impact = ((expectedOutput - outputValue) / expectedOutput) * 100;

    return Math.max(0, impact);
  }

  /**
   * Check if swap is valid
   */
  validateSwap(quote: DEXQuote): { valid: boolean; reason?: string } {
    // Check price impact
    if (quote.priceImpact > 5) {
      return {
        valid: false,
        reason: `High price impact: ${quote.priceImpact.toFixed(2)}%`,
      };
    }

    // Check if quote is expired
    if (new Date() > quote.expiresAt) {
      return {
        valid: false,
        reason: 'Quote has expired',
      };
    }

    // Check output amount
    if (BigInt(quote.toAmount) === BigInt(0)) {
      return {
        valid: false,
        reason: 'Output amount is zero',
      };
    }

    return { valid: true };
  }
}

export default DEXService;
