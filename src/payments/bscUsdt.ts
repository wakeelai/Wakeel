import type { Env } from "../types";

/**
 * The commonly-used BSC BEP-20 representation exposed as USDT by many wallets.
 * BscScan labels this contract "Binance-Peg BSC-USD"; it is not the same as
 * native Tether-issued USD₮ on other chains. The checkout UI and docs must say
 * BSC/BEP-20 explicitly so users do not send another network/token by mistake.
 */
export const BSC_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
export const BSC_CHAIN_ID = 56;
export const BSC_MIN_CONFIRMATIONS = 15;
export const BSC_DEFAULT_RPC_URL = "https://bsc-dataseed.bnbchain.org";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

interface RpcLog {
  address?: string;
  topics?: string[];
  data?: string;
  transactionHash?: string;
  blockNumber?: string;
  logIndex?: string;
}

export interface BscUsdtTransferLog {
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  amountMicros: string;
}

interface RpcReceipt {
  transactionHash?: string;
  blockNumber?: string;
  status?: string;
  logs?: RpcLog[];
}

export type BscUsdtCheck =
  | { valid: false; reason: "not_found" | "transaction_failed" | "no_matching_transfer" | "amount_mismatch" }
  | { valid: true; confirmations: number; receivedAmount: string; requiredConfirmations: number; blockNumber: number };

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function padToWord(value: string): string {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** Converts a plan's USD price (treated as a USDT amount) to 18-decimal units without float math. */
function usdToTokenUnits(amountUsd: number): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("Invalid payment amount");
  const [whole = "0", fractional = ""] = amountUsd.toFixed(6).split(".");
  return BigInt(whole) * (10n ** 18n) + BigInt(fractional.padEnd(6, "0")) * (10n ** 12n);
}

function tokenUnitsToDecimal(units: bigint): string {
  const whole = units / (10n ** 18n);
  const fraction = (units % (10n ** 18n)).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function rpc<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  const endpoints = [
    env.BSC_RPC_URL?.trim(),
    BSC_DEFAULT_RPC_URL,
    "https://bsc-dataseed-public.bnbchain.org",
  ].filter((url, i, all): url is string => Boolean(url) && all.indexOf(url) === i);
  let lastError: unknown = new Error("No BSC RPC endpoint configured");

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const payload = await response.json() as JsonRpcEnvelope<T>;
      if (payload.error) throw new Error(payload.error.message || "RPC returned an error");
      if (payload.result === undefined) throw new Error("RPC response had no result");
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`BSC RPC unavailable: ${String(lastError).slice(0, 180)}`);
}


/** Return the latest BSC mainnet block after validating the RPC chain ID. */
export async function getBscLatestBlockNumber(env: Env): Promise<number> {
  const chainId = await rpc<string>(env, "eth_chainId", []);
  if (Number.parseInt(chainId, 16) !== BSC_CHAIN_ID) {
    throw new Error("The configured RPC endpoint is not BNB Smart Chain mainnet");
  }
  const blockHex = await rpc<string>(env, "eth_blockNumber", []);
  const block = Number.parseInt(blockHex, 16);
  if (!Number.isSafeInteger(block) || block < 0) throw new Error("BSC RPC returned invalid block information");
  return block;
}

/**
 * Scan a bounded range for Transfer events from the accepted token to our wallet.
 * The scanner only processes sufficiently confirmed blocks and persists a cursor in D1.
 */
export async function scanBscUsdtTransfers(
  env: Env,
  recipient: string,
  fromBlock: number,
  toBlock: number,
): Promise<BscUsdtTransferLog[]> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) throw new Error("Invalid receiving wallet address configuration");
  if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock) || fromBlock < 0 || toBlock < fromBlock) {
    return [];
  }
  const chainId = await rpc<string>(env, "eth_chainId", []);
  if (Number.parseInt(chainId, 16) !== BSC_CHAIN_ID) {
    throw new Error("The configured RPC endpoint is not BNB Smart Chain mainnet");
  }
  const logs = await rpc<RpcLog[]>(env, "eth_getLogs", [{
    address: BSC_USDT_CONTRACT,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics: [TRANSFER_TOPIC, null, `0x${padToWord(recipient)}`],
  }]);

  const target = padToWord(recipient);
  const result: BscUsdtTransferLog[] = [];
  for (const log of logs) {
    const topics = log.topics ?? [];
    if (normalizeAddress(log.address ?? "") !== normalizeAddress(BSC_USDT_CONTRACT)) continue;
    if (normalizeAddress(topics[0] ?? "") !== TRANSFER_TOPIC || normalizeAddress((topics[2] ?? "").replace(/^0x/, "")) !== target) continue;
    const hash = log.transactionHash ?? "";
    const blockNumber = Number.parseInt(log.blockNumber ?? "", 16);
    const logIndex = Number.parseInt(log.logIndex ?? "0x0", 16);
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash) || !Number.isSafeInteger(blockNumber) || !Number.isSafeInteger(logIndex)) continue;
    if (!log.data || !/^0x[0-9a-fA-F]+$/.test(log.data)) continue;
    const units = BigInt(log.data);
    const microUnit = 10n ** 12n;
    // Invoices are issued to six decimals. Do not round a transfer with extra precision.
    if (units === 0n || units % microUnit !== 0n) continue;
    result.push({
      transactionHash: hash.toLowerCase(),
      blockNumber,
      logIndex,
      amountMicros: (units / microUnit).toString(),
    });
  }
  return result.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

/**
 * Verifies the submitted hash from BSC itself. A client assertion, screenshot,
 * wallet address or explorer URL is never sufficient to grant credits.
 */
export async function verifyBscUsdtTransfer(
  env: Env,
  txHash: string,
  recipient: string,
  amountUsd: number,
): Promise<BscUsdtCheck> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("Invalid transaction hash format");
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) throw new Error("Invalid receiving wallet address configuration");

  const chainId = await rpc<string>(env, "eth_chainId", []);
  if (Number.parseInt(chainId, 16) !== BSC_CHAIN_ID) {
    throw new Error("The configured RPC endpoint is not BNB Smart Chain mainnet");
  }

  const [receipt, blockHex] = await Promise.all([
    rpc<RpcReceipt | null>(env, "eth_getTransactionReceipt", [txHash]),
    rpc<string>(env, "eth_blockNumber", []),
  ]);

  if (!receipt) return { valid: false, reason: "not_found" };
  if ((receipt.transactionHash ?? "").toLowerCase() !== txHash.toLowerCase()) {
    return { valid: false, reason: "no_matching_transfer" };
  }
  if (receipt.status?.toLowerCase() !== "0x1") {
    return { valid: false, reason: "transaction_failed" };
  }

  const contract = normalizeAddress(BSC_USDT_CONTRACT);
  const recipientWord = padToWord(recipient);
  let receivedUnits = 0n;

  for (const log of receipt.logs ?? []) {
    const topics = log.topics ?? [];
    if (normalizeAddress(log.address ?? "") !== contract) continue;
    if (normalizeAddress(topics[0] ?? "") !== TRANSFER_TOPIC) continue;
    const toTopic = topics[2];
    if (!toTopic || normalizeAddress(toTopic).replace(/^0x/, "") !== recipientWord) continue;
    const data = log.data;
    if (!data || !/^0x[0-9a-fA-F]+$/.test(data)) continue;
    receivedUnits += BigInt(data);
  }

  if (receivedUnits === 0n) return { valid: false, reason: "no_matching_transfer" };
  // Exact invoice amounts are required. Accepting >= would let a larger payment be
  // attached to a cheaper order, and makes invoice matching ambiguous on a shared wallet.
  if (receivedUnits !== usdToTokenUnits(amountUsd)) return { valid: false, reason: "amount_mismatch" };

  const blockNumber = Number.parseInt(receipt.blockNumber ?? "0x0", 16);
  const currentBlock = Number.parseInt(blockHex, 16);
  if (!Number.isFinite(blockNumber) || !Number.isFinite(currentBlock) || currentBlock < blockNumber) {
    throw new Error("BSC RPC returned invalid block information");
  }
  const confirmations = currentBlock - blockNumber + 1;

  return {
    valid: true,
    confirmations,
    receivedAmount: tokenUnitsToDecimal(receivedUnits),
    requiredConfirmations: BSC_MIN_CONFIRMATIONS,
    blockNumber,
  };
}
