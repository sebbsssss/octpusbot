/**
 * Price Service
 * Fetches and caches token prices from multiple sources
 */

import { ChainId } from '@octpus/types';

interface PriceData {
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  lastUpdated: Date;
}

interface CoinGeckoPrice {
  [id: string]: {
    usd: number;
    usd_24h_change: number;
    usd_market_cap: number;
    usd_24h_vol: number;
  };
}

// Symbol to CoinGecko ID mapping
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  MATIC: 'matic-network',
  ARB: 'arbitrum',
  OP: 'optimism',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
  LINK: 'chainlink',
  UNI: 'uniswap',
  AAVE: 'aave',
  MKR: 'maker',
  CRV: 'curve-dao-token',
  LDO: 'lido-dao',
  RPL: 'rocket-pool',
  GMX: 'gmx',
  DYDX: 'dydx',
  SNX: 'synthetix-network-token',
};

// Native token by chain
const NATIVE_TOKENS: Record<ChainId, string> = {
  ethereum: 'ETH',
  polygon: 'MATIC',
  arbitrum: 'ETH',
  optimism: 'ETH',
  base: 'ETH',
  solana: 'SOL',
  bitcoin: 'BTC',
};

export class PriceService {
  private cache: Map<string, PriceData> = new Map();
  private cacheTimeout: number = 60000; // 1 minute
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async initialize(): Promise<void> {
    // Pre-fetch major token prices
    await this.fetchPrices(['BTC', 'ETH', 'SOL', 'USDC', 'USDT']);
  }

  /**
   * Get current price for a token
   */
  async getPrice(symbol: string): Promise<number | null> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache
    const cached = this.cache.get(upperSymbol);
    if (cached && Date.now() - cached.lastUpdated.getTime() < this.cacheTimeout) {
      return cached.price;
    }

    // Fetch fresh data
    const data = await this.fetchPrice(upperSymbol);
    return data?.price || null;
  }

  /**
   * Get native token price for a chain
   */
  async getNativePrice(chain: ChainId): Promise<number | null> {
    const symbol = NATIVE_TOKENS[chain];
    if (!symbol) return null;
    return this.getPrice(symbol);
  }

  /**
   * Get price history
   */
  async getPriceHistory(
    symbol: string,
    days: number
  ): Promise<{ timestamp: number; price: number }[]> {
    const id = COINGECKO_IDS[symbol.toUpperCase()];
    if (!id) return [];

    try {
      const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
      const response = await fetch(url, {
        headers: this.apiKey ? { 'x-cg-pro-api-key': this.apiKey } : {},
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.prices.map(([timestamp, price]: [number, number]) => ({
        timestamp,
        price,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get multiple prices at once
   */
  async getPrices(symbols: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    // Filter symbols that have CoinGecko IDs
    const validSymbols = symbols.filter(
      (s) => COINGECKO_IDS[s.toUpperCase()]
    );

    await this.fetchPrices(validSymbols);

    for (const symbol of symbols) {
      const cached = this.cache.get(symbol.toUpperCase());
      if (cached) {
        result[symbol] = cached.price;
      }
    }

    return result;
  }

  /**
   * Get full price data including market cap, volume, etc.
   */
  async getPriceData(symbol: string): Promise<PriceData | null> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache
    const cached = this.cache.get(upperSymbol);
    if (cached && Date.now() - cached.lastUpdated.getTime() < this.cacheTimeout) {
      return cached;
    }

    return this.fetchPrice(upperSymbol);
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private async fetchPrice(symbol: string): Promise<PriceData | null> {
    const id = COINGECKO_IDS[symbol];
    if (!id) return null;

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
      const response = await fetch(url, {
        headers: this.apiKey ? { 'x-cg-pro-api-key': this.apiKey } : {},
      });

      if (!response.ok) return null;

      const data: CoinGeckoPrice = await response.json();
      const tokenData = data[id];

      if (!tokenData) return null;

      const priceData: PriceData = {
        price: tokenData.usd,
        change24h: tokenData.usd_24h_change,
        marketCap: tokenData.usd_market_cap,
        volume24h: tokenData.usd_24h_vol,
        lastUpdated: new Date(),
      };

      this.cache.set(symbol, priceData);
      return priceData;
    } catch {
      return null;
    }
  }

  private async fetchPrices(symbols: string[]): Promise<void> {
    const ids = symbols
      .map((s) => COINGECKO_IDS[s.toUpperCase()])
      .filter(Boolean)
      .join(',');

    if (!ids) return;

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
      const response = await fetch(url, {
        headers: this.apiKey ? { 'x-cg-pro-api-key': this.apiKey } : {},
      });

      if (!response.ok) return;

      const data: CoinGeckoPrice = await response.json();

      // Update cache
      for (const symbol of symbols) {
        const id = COINGECKO_IDS[symbol.toUpperCase()];
        const tokenData = data[id];

        if (tokenData) {
          const priceData: PriceData = {
            price: tokenData.usd,
            change24h: tokenData.usd_24h_change,
            marketCap: tokenData.usd_market_cap,
            volume24h: tokenData.usd_24h_vol,
            lastUpdated: new Date(),
          };

          this.cache.set(symbol.toUpperCase(), priceData);
        }
      }
    } catch (error) {
      console.error('Error fetching prices:', error);
    }
  }

  /**
   * Clear the price cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get all cached prices
   */
  getCachedPrices(): Record<string, PriceData> {
    const result: Record<string, PriceData> = {};
    for (const [symbol, data] of this.cache) {
      result[symbol] = data;
    }
    return result;
  }
}
