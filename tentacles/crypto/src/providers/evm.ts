/**
 * EVM Chain Provider
 * Supports Ethereum, Polygon, Arbitrum, Optimism, Base, and other EVM chains
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  Address,
  Hash,
  PublicClient,
  WalletClient,
  Chain,
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { nanoid } from 'nanoid';
import {
  ChainId,
  Wallet,
  TokenBalance,
  Transaction,
  SwapQuote,
} from '@octpus/types';
import { ChainProvider } from '../index';

// Chain configurations
const CHAINS: Record<string, Chain> = {
  ethereum: mainnet,
  polygon: polygon,
  arbitrum: arbitrum,
  optimism: optimism,
  base: base,
};

// Common token addresses
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const WETH_ADDRESSES: Record<string, Address> = {
  ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
  arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  optimism: '0x4200000000000000000000000000000000000006',
  base: '0x4200000000000000000000000000000000000006',
};

// ERC20 ABI (minimal)
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface EVMConfig {
  rpcUrl: string;
  chainId?: number;
}

export class EVMProvider implements ChainProvider {
  readonly chain: ChainId;
  status: 'disconnected' | 'connected' | 'error' = 'disconnected';

  private publicClient: PublicClient | null = null;
  private walletClients: Map<string, WalletClient> = new Map();
  private config: EVMConfig;
  private viemChain: Chain;

  constructor(chain: ChainId, config: EVMConfig) {
    this.chain = chain;
    this.config = config;
    this.viemChain = CHAINS[chain] || mainnet;
  }

  async connect(): Promise<void> {
    try {
      this.publicClient = createPublicClient({
        chain: this.viemChain,
        transport: http(this.config.rpcUrl),
      });

      // Test connection
      await this.publicClient.getBlockNumber();
      this.status = 'connected';
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.publicClient = null;
    this.walletClients.clear();
    this.status = 'disconnected';
  }

  // ==========================================================================
  // WALLET OPERATIONS
  // ==========================================================================

  async createWallet(name: string): Promise<Wallet> {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // Create wallet client
    const walletClient = createWalletClient({
      account,
      chain: this.viemChain,
      transport: http(this.config.rpcUrl),
    });

    this.walletClients.set(account.address, walletClient);

    return {
      id: nanoid(),
      name,
      chain: this.chain,
      address: account.address,
      publicKey: account.publicKey,
      type: 'hot',
      createdAt: new Date(),
    };
  }

  async importWallet(name: string, privateKey: string): Promise<Wallet> {
    // Ensure proper format
    const key = privateKey.startsWith('0x')
      ? (privateKey as `0x${string}`)
      : (`0x${privateKey}` as `0x${string}`);

    const account = privateKeyToAccount(key);

    const walletClient = createWalletClient({
      account,
      chain: this.viemChain,
      transport: http(this.config.rpcUrl),
    });

    this.walletClients.set(account.address, walletClient);

    return {
      id: nanoid(),
      name,
      chain: this.chain,
      address: account.address,
      publicKey: account.publicKey,
      type: 'hot',
      createdAt: new Date(),
    };
  }

  async getWallet(address: string): Promise<Wallet | null> {
    const walletClient = this.walletClients.get(address);
    if (!walletClient) return null;

    return {
      id: nanoid(),
      name: 'Imported',
      chain: this.chain,
      address: address,
      publicKey: '',
      type: 'hot',
      createdAt: new Date(),
    };
  }

  async getBalances(address: string): Promise<TokenBalance[]> {
    if (!this.publicClient) {
      throw new Error('Not connected');
    }

    const balances: TokenBalance[] = [];

    // Get native balance
    const nativeBalance = await this.publicClient.getBalance({
      address: address as Address,
    });

    const nativeSymbol = this.getNativeSymbol();
    balances.push({
      chain: this.chain,
      address: NATIVE_TOKEN,
      symbol: nativeSymbol,
      name: nativeSymbol,
      decimals: 18,
      balance: nativeBalance.toString(),
    });

    // Get common token balances
    const commonTokens = this.getCommonTokens();
    for (const token of commonTokens) {
      try {
        const balance = await this.publicClient.readContract({
          address: token.address as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address as Address],
        });

        if (balance > 0n) {
          balances.push({
            chain: this.chain,
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            balance: balance.toString(),
          });
        }
      } catch {
        // Token might not exist on this chain
      }
    }

    return balances;
  }

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  async sendTransaction(tx: Partial<Transaction>): Promise<Transaction> {
    if (!this.publicClient) {
      throw new Error('Not connected');
    }

    const walletClient = this.walletClients.get(tx.from!);
    if (!walletClient) {
      throw new Error(`Wallet not found: ${tx.from}`);
    }

    const hash = await walletClient.sendTransaction({
      to: tx.to as Address,
      value: parseEther(tx.value || '0'),
      data: tx.data as `0x${string}` | undefined,
    });

    return {
      id: nanoid(),
      chain: this.chain,
      hash,
      from: tx.from!,
      to: tx.to!,
      value: tx.value || '0',
      data: tx.data,
      status: 'submitted',
      timestamp: new Date(),
    };
  }

  async sendToken(
    from: string,
    to: string,
    tokenAddress: string,
    amount: string
  ): Promise<Transaction> {
    if (!this.publicClient) {
      throw new Error('Not connected');
    }

    const walletClient = this.walletClients.get(from);
    if (!walletClient) {
      throw new Error(`Wallet not found: ${from}`);
    }

    // Get token decimals
    const decimals = await this.publicClient.readContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'decimals',
    });

    const value = parseUnits(amount, decimals);

    // Encode transfer data
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to as Address, value],
    });

    const hash = await walletClient.sendTransaction({
      to: tokenAddress as Address,
      data,
    });

    return {
      id: nanoid(),
      chain: this.chain,
      hash,
      from,
      to,
      value: amount,
      data,
      status: 'submitted',
      timestamp: new Date(),
    };
  }

  async getTransaction(hash: string): Promise<Transaction | null> {
    if (!this.publicClient) {
      throw new Error('Not connected');
    }

    try {
      const tx = await this.publicClient.getTransaction({
        hash: hash as Hash,
      });

      const receipt = await this.publicClient.getTransactionReceipt({
        hash: hash as Hash,
      });

      return {
        id: nanoid(),
        chain: this.chain,
        hash,
        from: tx.from,
        to: tx.to || '',
        value: formatEther(tx.value),
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        gasUsed: receipt.gasUsed.toString(),
        timestamp: new Date(),
      };
    } catch {
      return null;
    }
  }

  async estimateGas(tx: Partial<Transaction>): Promise<string> {
    if (!this.publicClient) {
      throw new Error('Not connected');
    }

    const gas = await this.publicClient.estimateGas({
      to: tx.to as Address,
      value: tx.value ? parseEther(tx.value) : undefined,
      data: tx.data as `0x${string}` | undefined,
    });

    return gas.toString();
  }

  // ==========================================================================
  // DEFI
  // ==========================================================================

  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<SwapQuote> {
    // Use 1inch or similar DEX aggregator API
    // This is a simplified implementation
    const quote: SwapQuote = {
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: '0', // Would be filled by DEX API
      priceImpact: 0,
      route: [fromToken, toToken],
      estimatedGas: '200000',
      expiresAt: new Date(Date.now() + 60000), // 1 minute
    };

    // In production, you would call:
    // - 1inch API: https://api.1inch.dev/swap/v6.0/{chainId}/quote
    // - 0x API: https://api.0x.org/swap/v1/quote
    // - Uniswap SDK

    return quote;
  }

  async executeSwap(
    quote: SwapQuote,
    walletAddress: string
  ): Promise<Transaction> {
    if (!this.publicClient) {
      throw new Error('Not connected');
    }

    const walletClient = this.walletClients.get(walletAddress);
    if (!walletClient) {
      throw new Error(`Wallet not found: ${walletAddress}`);
    }

    // In production, this would:
    // 1. Get swap calldata from DEX API
    // 2. Approve token spending if needed
    // 3. Execute the swap transaction

    // Placeholder - would need real DEX integration
    throw new Error('Swap execution requires DEX integration (1inch, 0x, Uniswap)');
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private getNativeSymbol(): string {
    switch (this.chain) {
      case 'ethereum':
        return 'ETH';
      case 'polygon':
        return 'MATIC';
      case 'arbitrum':
        return 'ETH';
      case 'optimism':
        return 'ETH';
      case 'base':
        return 'ETH';
      default:
        return 'ETH';
    }
  }

  private getCommonTokens(): { address: string; symbol: string; name: string; decimals: number }[] {
    // Return common tokens for this chain
    const tokens: Record<string, { address: string; symbol: string; name: string; decimals: number }[]> = {
      ethereum: [
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
        { address: '0x6B175474E89094C44Da98b954EesdfCDC46f2881', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
        { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
      ],
      polygon: [
        { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      ],
      arbitrum: [
        { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      ],
      optimism: [
        { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      ],
      base: [
        { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
      ],
    };

    return tokens[this.chain] || [];
  }
}
