import { afterEach, describe, expect, it, vi } from "vitest";
import { scanBscPaymentInvoices } from "../src/payments/bscAutoScanner";
import { BSC_USDT_CONTRACT } from "../src/payments/bscUsdt";
import { now } from "../src/lib/db";
import type { Env } from "../src/types";
import { createTestD1 } from "./testDb";

const RECIPIENT = "0x8575DB82A480428Ef0d9eB9b9a62de3453303Fc9";
const HASH = `0x${"a".repeat(64)}`;
const FROM_TOPIC = `0x${"0".repeat(24)}${"1234567890abcdef1234567890abcdef12345678"}`;
const RECIPIENT_TOPIC = `0x${"0".repeat(24)}${RECIPIENT.slice(2).toLowerCase()}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const AMOUNT_MICROS = 5_003_421n;
const AMOUNT_DATA = `0x${(AMOUNT_MICROS * 10n ** 12n).toString(16).padStart(64, "0")}`;

function setup(invoiceBlock: number, transferBlock = 112) {
  const d1 = createTestD1();
  const ts = now();
  d1._seed("users", { id: "user_auto", supabase_uid: "sb_auto", email: "auto@example.test", created_at: ts, updated_at: ts });
  d1._seed("credits", { user_id: "user_auto", balance: 100, updated_at: ts });
  d1._seed("payments", {
    id: "pay_auto", user_id: "user_auto", plan_id: "starter", provider: "direct_wallet",
    amount_usd: 5, pay_amount_usdt: 5.003421, invoice_created_block: invoiceBlock,
    pay_currency: "USDT", network: "BSC Mainnet (BEP20)", wallet_address: RECIPIENT,
    status: "created", credits_awarded: null, tx_hash: null, created_at: ts, updated_at: ts,
  });
  d1._seed("payment_scan_cursors", { chain: "bsc-mainnet", last_scanned_block: 100, updated_at: ts });

  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { method: string };
    let result: unknown;
    if (req.method === "eth_chainId") result = "0x38";
    else if (req.method === "eth_blockNumber") result = "0x200"; // scanner examines through block 498
    else if (req.method === "eth_getLogs") result = [{
      address: BSC_USDT_CONTRACT,
      topics: [TRANSFER_TOPIC, FROM_TOPIC, RECIPIENT_TOPIC],
      data: AMOUNT_DATA,
      transactionHash: HASH,
      blockNumber: `0x${transferBlock.toString(16)}`,
      logIndex: "0x0",
    }];
    else result = null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }));

  const env = {
    DB: d1,
    TRUST_WALLET_ADDRESS: RECIPIENT,
    TRUST_WALLET_NETWORK: "BSC Mainnet (BEP20)",
    TRUST_WALLET_TOKEN: "USDT (BEP20 / Binance-Peg BSC-USD)",
    BSC_RPC_URL: "https://mock-bsc.invalid",
  } as unknown as Env;
  return { d1, env };
}

afterEach(() => vi.unstubAllGlobals());

describe("automatic BSC USDT invoice scanner", () => {
  it("matches a post-invoice transfer and credits its plan exactly once", async () => {
    const { d1, env } = setup(100, 112);
    const result = await scanBscPaymentInvoices(env);

    expect(result).toEqual({ blocksScanned: 398, paymentsCredited: 1 });
    expect(d1._get("payments", { id: "pay_auto" })).toMatchObject({ status: "finished", tx_hash: HASH, credits_awarded: 800 });
    expect(d1._get("credits", { user_id: "user_auto" })).toMatchObject({ balance: 900 });
    expect(d1._get("credit_transactions", { ref_id: "pay_auto", reason: "purchase" })).toMatchObject({ amount: 800 });
  });

  it("does not match an otherwise exact transfer mined before the invoice block", async () => {
    const { d1, env } = setup(120, 112);
    const result = await scanBscPaymentInvoices(env);

    expect(result.paymentsCredited).toBe(0);
    expect(d1._get("payments", { id: "pay_auto" })).toMatchObject({ status: "created", tx_hash: null, credits_awarded: null });
    expect(d1._get("credits", { user_id: "user_auto" })).toMatchObject({ balance: 100 });
  });
});
