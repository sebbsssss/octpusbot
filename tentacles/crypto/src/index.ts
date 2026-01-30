/**
 * Crypto Tentacle
 * The wealth management arm of the Octpus
 *
 * Capabilities:
 * - Multi-chain wallet management (EVM, Solana, Bitcoin)
 * - DeFi operations (swaps, liquidity, yield farming)
 * - Portfolio tracking and analytics
 * - NFT management
 * - On-chain transaction signing
 *
 * This is what OpenClaw DOESN'T have. 🐙 > 🦞
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import {
  TentacleRegistration,
  TentacleCapability,
  TentacleStatus,
  PermissionLevel,
  ChainId,
  Wallet,
  TokenBalance,
  Transaction,
  SwapQuote,
} from '@octpus/types';

import { EVMProvider } from './providers/evm';
import { SolanaProvider } from './providers/solana';
import { PriceService } from './services/price';
import { PortfolioService } from './services/portfolio';

// =============================================================================
// CHAIN PROVIDER INTERFACE
// =============================================================================

export interface ChainProvider {
  chain: ChainId;
  status: 'disconnected' | 'connected' | 'error';

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Wallet operations
  createWallet(name: string): Promise<Wallet>;
  importWallet(name: string, privateKey: string): Promise<Wallet>;
  getWallet(address: string): Promise<Wallet | null>;
  getBalances(address: string): Promise<TokenBalance[]>;

  // Transactions
  sendTransaction(tx: Partial<Transaction>): Promise<Transaction>;
  getTransaction(hash: string): Promise<Transaction | null>;
  estimateGas(tx: Partial<Transaction>): Promise<string>;

  // DeFi
  getSwapQuote(fromToken: string, toToken: string, amount: string): Promise<SwapQuote>;
  executeSwap(quote: SwapQuote, walletAddress: string): Promise<Transaction>;
}

// =============================================================================
// CRYPTO TENTACLE CONFIG
// =============================================================================

export interface CryptoConfig {
  // RPC endpoints
  ethereum?: {
    rpcUrl: string;
    chainId?: number;
  };
  polygon?: {
    rpcUrl: string;
  };
  arbitrum?: {
    rpcUrl: string;
  };
  optimism?: {
    rpcUrl: string;
  };
  base?: {
    rpcUrl: string;
  };
  solana?: {
    rpcUrl: string;
    cluster?: 'mainnet-beta' | 'devnet' | 'testnet';
  };

  // API keys for price data
  coingeckoApiKey?: string;
  defillamaEnabled?: boolean;

  // Security
  encryptionKey?: string;
  requireApprovalAbove?: number; // USD value threshold
}

// =============================================================================
// CRYPTO TENTACLE
// =============================================================================

export class CryptoTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private providers: Map<ChainId, ChainProvider> = new Map();
  private wallets: Map<string, Wallet> = new Map();
  private priceService: PriceService;
  private portfolioService: PortfolioService;
  private config: CryptoConfig;

  constructor(config: CryptoConfig) {
    this.config = config;
    this.events = new EventEmitter();
    this.priceService = new PriceService(config.coingeckoApiKey);
    this.portfolioService = new PortfolioService(this.priceService);

    this.registration = {
      id: 'crypto',
      type: 'crypto',
      name: 'Crypto Tentacle',
      description: 'Multi-chain wallet management, DeFi operations, and portfolio tracking',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: false,
    };
  }

  /**
   * Initialize all configured chains
   */
  async initialize(): Promise<void> {
    console.log('🐙 Crypto Tentacle initializing...');

    // Initialize EVM chains
    const evmChains: { chain: ChainId; config: any }[] = [];

    if (this.config.ethereum) {
      evmChains.push({ chain: 'ethereum', config: this.config.ethereum });
    }
    if (this.config.polygon) {
      evmChains.push({ chain: 'polygon', config: this.config.polygon });
    }
    if (this.config.arbitrum) {
      evmChains.push({ chain: 'arbitrum', config: this.config.arbitrum });
    }
    if (this.config.optimism) {
      evmChains.push({ chain: 'optimism', config: this.config.optimism });
    }
    if (this.config.base) {
      evmChains.push({ chain: 'base', config: this.config.base });
    }

    for (const { chain, config } of evmChains) {
      const provider = new EVMProvider(chain, config);
      this.providers.set(chain, provider);
      await provider.connect();
      console.log(`🐙 Connected to ${chain}`);
    }

    // Initialize Solana
    if (this.config.solana) {
      const solana = new SolanaProvider(this.config.solana);
      this.providers.set('solana', solana);
      await solana.connect();
      console.log('🐙 Connected to Solana');
    }

    // Initialize price service
    await this.priceService.initialize();

    this.registration.status = 'ready';
    console.log('🐙 Crypto Tentacle ready!');
  }

  // ==========================================================================
  // WALLET OPERATIONS
  // ==========================================================================

  /**
   * Create a new wallet on a specific chain
   */
  async createWallet(chain: ChainId, name: string): Promise<Wallet> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    const wallet = await provider.createWallet(name);
    this.wallets.set(wallet.address, wallet);
    this.events.emit('wallet:created', wallet);

    return wallet;
  }

  /**
   * Import an existing wallet
   */
  async importWallet(
    chain: ChainId,
    name: string,
    privateKey: string
  ): Promise<Wallet> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    const wallet = await provider.importWallet(name, privateKey);
    this.wallets.set(wallet.address, wallet);
    this.events.emit('wallet:imported', wallet);

    return wallet;
  }

  /**
   * Get all wallets
   */
  getWallets(): Wallet[] {
    return Array.from(this.wallets.values());
  }

  /**
   * Get wallet by address
   */
  getWallet(address: string): Wallet | undefined {
    return this.wallets.get(address);
  }

  // ==========================================================================
  // BALANCE & PORTFOLIO
  // ==========================================================================

  /**
   * Get token balances for a wallet
   */
  async getBalances(chain: ChainId, address: string): Promise<TokenBalance[]> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    const balances = await provider.getBalances(address);

    // Enrich with USD values
    for (const balance of balances) {
      const price = await this.priceService.getPrice(balance.symbol);
      if (price) {
        balance.price = price;
        balance.balanceUsd =
          parseFloat(balance.balance) / Math.pow(10, balance.decimals) * price;
      }
    }

    return balances;
  }

  /**
   * Get total portfolio value across all chains
   */
  async getPortfolioValue(address: string): Promise<{
    totalUsd: number;
    byChain: Record<ChainId, number>;
    byToken: Record<string, number>;
  }> {
    const result = {
      totalUsd: 0,
      byChain: {} as Record<ChainId, number>,
      byToken: {} as Record<string, number>,
    };

    for (const [chain, provider] of this.providers) {
      try {
        const balances = await this.getBalances(chain, address);

        let chainTotal = 0;
        for (const balance of balances) {
          if (balance.balanceUsd) {
            chainTotal += balance.balanceUsd;
            result.byToken[balance.symbol] =
              (result.byToken[balance.symbol] || 0) + balance.balanceUsd;
          }
        }

        result.byChain[chain] = chainTotal;
        result.totalUsd += chainTotal;
      } catch (error) {
        console.error(`Error fetching balances for ${chain}:`, error);
      }
    }

    return result;
  }

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  /**
   * Send native token (ETH, SOL, etc.)
   */
  async sendNative(
    chain: ChainId,
    from: string,
    to: string,
    amount: string
  ): Promise<Transaction> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    // Check value for approval threshold
    const price = await this.priceService.getNativePrice(chain);
    const usdValue = parseFloat(amount) * (price || 0);

    if (
      this.config.requireApprovalAbove &&
      usdValue > this.config.requireApprovalAbove
    ) {
      this.events.emit('transaction:approval_required', {
        chain,
        from,
        to,
        amount,
        usdValue,
      });
      // The approval will be handled by the permission system
    }

    const tx = await provider.sendTransaction({
      chain,
      from,
      to,
      value: amount,
    });

    this.events.emit('transaction:sent', tx);
    return tx;
  }

  /**
   * Send ERC20/SPL token
   */
  async sendToken(
    chain: ChainId,
    from: string,
    to: string,
    tokenAddress: string,
    amount: string
  ): Promise<Transaction> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    // For EVM chains, we need to encode the transfer data
    if (provider instanceof EVMProvider) {
      return provider.sendToken(from, to, tokenAddress, amount);
    }

    // For Solana
    if (provider instanceof SolanaProvider) {
      return provider.sendToken(from, to, tokenAddress, amount);
    }

    throw new Error(`Token transfers not supported on ${chain}`);
  }

  /**
   * Get transaction status
   */
  async getTransaction(chain: ChainId, hash: string): Promise<Transaction | null> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    return provider.getTransaction(hash);
  }

  // ==========================================================================
  // DEFI OPERATIONS
  // ==========================================================================

  /**
   * Get a swap quote
   */
  async getSwapQuote(
    chain: ChainId,
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<SwapQuote> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    return provider.getSwapQuote(fromToken, toToken, amount);
  }

  /**
   * Execute a swap
   */
  async executeSwap(
    chain: ChainId,
    quote: SwapQuote,
    walletAddress: string
  ): Promise<Transaction> {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Chain not configured: ${chain}`);
    }

    const tx = await provider.executeSwap(quote, walletAddress);
    this.events.emit('swap:executed', { chain, quote, tx });

    return tx;
  }

  /**
   * Get DeFi positions (staking, LP, etc.)
   */
  async getDefiPositions(address: string): Promise<DefiPosition[]> {
    return this.portfolioService.getDefiPositions(address);
  }

  // ==========================================================================
  // PRICE DATA
  // ==========================================================================

  /**
   * Get current price for a token
   */
  async getPrice(symbol: string): Promise<number | null> {
    return this.priceService.getPrice(symbol);
  }

  /**
   * Get price history
   */
  async getPriceHistory(
    symbol: string,
    days: number
  ): Promise<{ timestamp: number; price: number }[]> {
    return this.priceService.getPriceHistory(symbol, days);
  }

  // ==========================================================================
  // SHUTDOWN
  // ==========================================================================

  async shutdown(): Promise<void> {
    console.log('🐙 Crypto Tentacle shutting down...');

    for (const provider of this.providers.values()) {
      await provider.disconnect();
    }

    this.registration.status = 'disabled';
    console.log('🐙 Crypto Tentacle offline');
  }

  // ==========================================================================
  // CAPABILITIES
  // ==========================================================================

  private buildCapabilities(): TentacleCapability[] {
    return [
      // Wallet operations
      {
        name: 'create_wallet',
        description: 'Create a new wallet on a specific blockchain',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          chain: {
            type: 'string',
            description: 'The blockchain (ethereum, polygon, solana, etc.)',
            required: true,
            enum: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'solana'],
          },
          name: {
            type: 'string',
            description: 'A name for the wallet',
            required: true,
          },
        },
        handler: async (params) => {
          return this.createWallet(
            params.chain as ChainId,
            params.name as string
          );
        },
      },
      {
        name: 'get_balances',
        description: 'Get token balances for a wallet address',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          chain: {
            type: 'string',
            description: 'The blockchain',
            required: true,
          },
          address: {
            type: 'string',
            description: 'The wallet address',
            required: true,
          },
        },
        handler: async (params) => {
          return this.getBalances(
            params.chain as ChainId,
            params.address as string
          );
        },
      },
      {
        name: 'get_portfolio',
        description: 'Get total portfolio value across all chains',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          address: {
            type: 'string',
            description: 'The wallet address',
            required: true,
          },
        },
        handler: async (params) => {
          return this.getPortfolioValue(params.address as string);
        },
      },

      // Transactions
      {
        name: 'send_native',
        description: 'Send native token (ETH, SOL, etc.) to an address',
        permissionLevel: PermissionLevel.L3_FINANCIAL,
        parameters: {
          chain: {
            type: 'string',
            description: 'The blockchain',
            required: true,
          },
          from: {
            type: 'string',
            description: 'The sender wallet address',
            required: true,
          },
          to: {
            type: 'string',
            description: 'The recipient address',
            required: true,
          },
          amount: {
            type: 'string',
            description: 'The amount to send (in native units)',
            required: true,
          },
        },
        handler: async (params) => {
          return this.sendNative(
            params.chain as ChainId,
            params.from as string,
            params.to as string,
            params.amount as string
          );
        },
      },
      {
        name: 'send_token',
        description: 'Send ERC20/SPL token to an address',
        permissionLevel: PermissionLevel.L3_FINANCIAL,
        parameters: {
          chain: {
            type: 'string',
            description: 'The blockchain',
            required: true,
          },
          from: {
            type: 'string',
            description: 'The sender wallet address',
            required: true,
          },
          to: {
            type: 'string',
            description: 'The recipient address',
            required: true,
          },
          tokenAddress: {
            type: 'string',
            description: 'The token contract address',
            required: true,
          },
          amount: {
            type: 'string',
            description: 'The amount to send',
            required: true,
          },
        },
        handler: async (params) => {
          return this.sendToken(
            params.chain as ChainId,
            params.from as string,
            params.to as string,
            params.tokenAddress as string,
            params.amount as string
          );
        },
      },

      // DeFi
      {
        name: 'get_swap_quote',
        description: 'Get a quote for swapping tokens',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          chain: {
            type: 'string',
            description: 'The blockchain',
            required: true,
          },
          fromToken: {
            type: 'string',
            description: 'The token to swap from (address or symbol)',
            required: true,
          },
          toToken: {
            type: 'string',
            description: 'The token to swap to (address or symbol)',
            required: true,
          },
          amount: {
            type: 'string',
            description: 'The amount to swap',
            required: true,
          },
        },
        handler: async (params) => {
          return this.getSwapQuote(
            params.chain as ChainId,
            params.fromToken as string,
            params.toToken as string,
            params.amount as string
          );
        },
      },
      {
        name: 'execute_swap',
        description: 'Execute a token swap',
        permissionLevel: PermissionLevel.L3_FINANCIAL,
        parameters: {
          chain: {
            type: 'string',
            description: 'The blockchain',
            required: true,
          },
          fromToken: {
            type: 'string',
            description: 'The token to swap from',
            required: true,
          },
          toToken: {
            type: 'string',
            description: 'The token to swap to',
            required: true,
          },
          amount: {
            type: 'string',
            description: 'The amount to swap',
            required: true,
          },
          walletAddress: {
            type: 'string',
            description: 'The wallet to use',
            required: true,
          },
        },
        handler: async (params) => {
          const quote = await this.getSwapQuote(
            params.chain as ChainId,
            params.fromToken as string,
            params.toToken as string,
            params.amount as string
          );
          return this.executeSwap(
            params.chain as ChainId,
            quote,
            params.walletAddress as string
          );
        },
      },

      // Price data
      {
        name: 'get_price',
        description: 'Get current price for a token',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          symbol: {
            type: 'string',
            description: 'The token symbol (e.g., ETH, BTC, SOL)',
            required: true,
          },
        },
        handler: async (params) => {
          return this.getPrice(params.symbol as string);
        },
      },
      {
        name: 'get_price_history',
        description: 'Get price history for a token',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          symbol: {
            type: 'string',
            description: 'The token symbol',
            required: true,
          },
          days: {
            type: 'number',
            description: 'Number of days of history',
            required: false,
            default: 7,
          },
        },
        handler: async (params) => {
          return this.getPriceHistory(
            params.symbol as string,
            (params.days as number) || 7
          );
        },
      },

      // DeFi positions
      {
        name: 'get_defi_positions',
        description: 'Get DeFi positions (staking, LP, lending)',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          address: {
            type: 'string',
            description: 'The wallet address',
            required: true,
          },
        },
        handler: async (params) => {
          return this.getDefiPositions(params.address as string);
        },
      },
    ];
  }
}

// =============================================================================
// TYPES
// =============================================================================

export interface DefiPosition {
  protocol: string;
  type: 'staking' | 'liquidity' | 'lending' | 'borrowing' | 'farming';
  chain: ChainId;
  tokens: string[];
  valueUsd: number;
  apy?: number;
  rewards?: {
    token: string;
    amount: string;
    valueUsd: number;
  }[];
}

// Re-export providers and services
export { EVMProvider } from './providers/evm';
export { SolanaProvider } from './providers/solana';
export { PriceService } from './services/price';
export { PortfolioService } from './services/portfolio';
