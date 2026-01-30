/**
 * Solana Chain Provider
 * Supports Solana mainnet, devnet, and testnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction as SolanaTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
  getMint,
} from '@solana/spl-token';
import { nanoid } from 'nanoid';
import * as bs58 from 'bs58';
import {
  ChainId,
  Wallet,
  TokenBalance,
  Transaction,
  SwapQuote,
} from '@octpus/types';
import { ChainProvider } from '../index';

export interface SolanaConfig {
  rpcUrl?: string;
  cluster?: 'mainnet-beta' | 'devnet' | 'testnet';
}

export class SolanaProvider implements ChainProvider {
  readonly chain: ChainId = 'solana';
  status: 'disconnected' | 'connected' | 'error' = 'disconnected';

  private connection: Connection | null = null;
  private wallets: Map<string, Keypair> = new Map();
  private config: SolanaConfig;

  constructor(config: SolanaConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      const endpoint =
        this.config.rpcUrl ||
        clusterApiUrl(this.config.cluster || 'mainnet-beta');

      this.connection = new Connection(endpoint, 'confirmed');

      // Test connection
      await this.connection.getSlot();
      this.status = 'connected';
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connection = null;
    this.wallets.clear();
    this.status = 'disconnected';
  }

  // ==========================================================================
  // WALLET OPERATIONS
  // ==========================================================================

  async createWallet(name: string): Promise<Wallet> {
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();

    this.wallets.set(address, keypair);

    return {
      id: nanoid(),
      name,
      chain: 'solana',
      address,
      publicKey: address,
      type: 'hot',
      createdAt: new Date(),
    };
  }

  async importWallet(name: string, privateKey: string): Promise<Wallet> {
    let keypair: Keypair;

    try {
      // Try base58 format first
      const decoded = bs58.decode(privateKey);
      keypair = Keypair.fromSecretKey(decoded);
    } catch {
      // Try array format
      const secretKey = JSON.parse(privateKey);
      keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }

    const address = keypair.publicKey.toBase58();
    this.wallets.set(address, keypair);

    return {
      id: nanoid(),
      name,
      chain: 'solana',
      address,
      publicKey: address,
      type: 'hot',
      createdAt: new Date(),
    };
  }

  async getWallet(address: string): Promise<Wallet | null> {
    const keypair = this.wallets.get(address);
    if (!keypair) return null;

    return {
      id: nanoid(),
      name: 'Imported',
      chain: 'solana',
      address,
      publicKey: address,
      type: 'hot',
      createdAt: new Date(),
    };
  }

  async getBalances(address: string): Promise<TokenBalance[]> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const balances: TokenBalance[] = [];
    const pubkey = new PublicKey(address);

    // Get SOL balance
    const solBalance = await this.connection.getBalance(pubkey);
    balances.push({
      chain: 'solana',
      address: 'SOL',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      balance: solBalance.toString(),
    });

    // Get SPL token balances
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        pubkey,
        { programId: TOKEN_PROGRAM_ID }
      );

      for (const { account } of tokenAccounts.value) {
        const parsedInfo = account.data.parsed.info;
        const balance = parsedInfo.tokenAmount.amount;

        if (BigInt(balance) > 0n) {
          balances.push({
            chain: 'solana',
            address: parsedInfo.mint,
            symbol: 'SPL', // Would need token registry for real symbol
            name: 'SPL Token',
            decimals: parsedInfo.tokenAmount.decimals,
            balance,
          });
        }
      }
    } catch (error) {
      console.error('Error fetching token accounts:', error);
    }

    return balances;
  }

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  async sendTransaction(tx: Partial<Transaction>): Promise<Transaction> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const keypair = this.wallets.get(tx.from!);
    if (!keypair) {
      throw new Error(`Wallet not found: ${tx.from}`);
    }

    const lamports = Math.floor(parseFloat(tx.value || '0') * LAMPORTS_PER_SOL);

    const transaction = new SolanaTransaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(tx.to!),
        lamports,
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [keypair]
    );

    return {
      id: nanoid(),
      chain: 'solana',
      hash: signature,
      from: tx.from!,
      to: tx.to!,
      value: tx.value || '0',
      status: 'confirmed',
      timestamp: new Date(),
    };
  }

  async sendToken(
    from: string,
    to: string,
    mintAddress: string,
    amount: string
  ): Promise<Transaction> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const keypair = this.wallets.get(from);
    if (!keypair) {
      throw new Error(`Wallet not found: ${from}`);
    }

    const mint = new PublicKey(mintAddress);
    const fromPubkey = keypair.publicKey;
    const toPubkey = new PublicKey(to);

    // Get mint info for decimals
    const mintInfo = await getMint(this.connection, mint);

    // Get or create associated token accounts
    const fromATA = await getAssociatedTokenAddress(mint, fromPubkey);
    const toATA = await getAssociatedTokenAddress(mint, toPubkey);

    const transaction = new SolanaTransaction();

    // Check if destination ATA exists, create if not
    try {
      await getAccount(this.connection, toATA);
    } catch {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          fromPubkey,
          toATA,
          toPubkey,
          mint
        )
      );
    }

    // Add transfer instruction
    const tokenAmount = BigInt(
      Math.floor(parseFloat(amount) * Math.pow(10, mintInfo.decimals))
    );

    transaction.add(
      createTransferInstruction(fromATA, toATA, fromPubkey, tokenAmount)
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [keypair]
    );

    return {
      id: nanoid(),
      chain: 'solana',
      hash: signature,
      from,
      to,
      value: amount,
      status: 'confirmed',
      timestamp: new Date(),
    };
  }

  async getTransaction(hash: string): Promise<Transaction | null> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    try {
      const tx = await this.connection.getTransaction(hash, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return null;

      return {
        id: nanoid(),
        chain: 'solana',
        hash,
        from: tx.transaction.message.staticAccountKeys[0]?.toBase58() || '',
        to: tx.transaction.message.staticAccountKeys[1]?.toBase58() || '',
        value: '0',
        status: tx.meta?.err ? 'failed' : 'confirmed',
        timestamp: new Date((tx.blockTime || 0) * 1000),
      };
    } catch {
      return null;
    }
  }

  async estimateGas(tx: Partial<Transaction>): Promise<string> {
    // Solana uses a different fee model (priority fees + base fee)
    // Return estimated compute units
    return '200000';
  }

  // ==========================================================================
  // DEFI
  // ==========================================================================

  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<SwapQuote> {
    // Use Jupiter API for Solana swaps
    // This is a simplified implementation
    const quote: SwapQuote = {
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: '0', // Would be filled by Jupiter API
      priceImpact: 0,
      route: [fromToken, toToken],
      estimatedGas: '200000',
      expiresAt: new Date(Date.now() + 60000),
    };

    // In production, call Jupiter API:
    // https://quote-api.jup.ag/v6/quote

    return quote;
  }

  async executeSwap(
    quote: SwapQuote,
    walletAddress: string
  ): Promise<Transaction> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const keypair = this.wallets.get(walletAddress);
    if (!keypair) {
      throw new Error(`Wallet not found: ${walletAddress}`);
    }

    // In production, this would:
    // 1. Get swap transaction from Jupiter API
    // 2. Sign and submit the transaction

    throw new Error('Swap execution requires Jupiter integration');
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Request an airdrop (devnet/testnet only)
   */
  async requestAirdrop(address: string, amount: number = 1): Promise<string> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const signature = await this.connection.requestAirdrop(
      new PublicKey(address),
      amount * LAMPORTS_PER_SOL
    );

    await this.connection.confirmTransaction(signature);
    return signature;
  }

  /**
   * Get recent blockhash
   */
  async getRecentBlockhash(): Promise<string> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const { blockhash } = await this.connection.getLatestBlockhash();
    return blockhash;
  }
}
