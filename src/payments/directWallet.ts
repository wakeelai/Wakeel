import type { Env } from "../types";
import { BSC_USDT_CONTRACT } from "./bscUsdt";

export function isDirectWalletEnabled(env: Env): boolean {
  return Boolean(
    env.TRUST_WALLET_ADDRESS && /^0x[a-fA-F0-9]{40}$/.test(env.TRUST_WALLET_ADDRESS) &&
    env.TRUST_WALLET_NETWORK && /bsc|bnb smart chain/i.test(env.TRUST_WALLET_NETWORK) &&
    env.TRUST_WALLET_TOKEN && /usdt/i.test(env.TRUST_WALLET_TOKEN),
  );
}

export function getDirectWalletDetails(env: Env) {
  if (!isDirectWalletEnabled(env)) return null;
  return {
    address: env.TRUST_WALLET_ADDRESS as string,
    network: "BSC Mainnet (BEP20)",
    token: "USDT (BEP20 / Binance-Peg BSC-USD)",
    tokenContract: BSC_USDT_CONTRACT,
    chainId: 56,
  };
}

/** A submitted transaction hash is verified against BSC receipts before credits are granted. */
export interface SubmitTxHashInput {
  paymentId: string;
  txHash: string;
}
