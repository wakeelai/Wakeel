import { afterEach, describe, expect, it, vi } from "vitest";
import { BSC_USDT_CONTRACT, scanBscUsdtTransfers, verifyBscUsdtTransfer } from "../src/payments/bscUsdt";
import type { Env } from "../src/types";

const HASH = `0x${"a".repeat(64)}`;
const RECIPIENT = "0x8575DB82A480428Ef0d9eB9b9a62de3453303Fc9";
const FROM_TOPIC = `0x${"0".repeat(24)}${"1234567890abcdef1234567890abcdef12345678"}`;
const RECIPIENT_TOPIC = `0x${"0".repeat(24)}${RECIPIENT.slice(2).toLowerCase()}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const FIVE_USDT = `0x${(5n * (10n ** 18n)).toString(16).padStart(64, "0")}`;

function mockRpc(options: { block?: string; receipt?: unknown; chainId?: string; logs?: unknown[] } = {}) {
  const receipt = options.receipt ?? {
    transactionHash: HASH,
    blockNumber: "0x64", // 100
    status: "0x1",
    logs: [{
      address: BSC_USDT_CONTRACT,
      topics: [TRANSFER_TOPIC, FROM_TOPIC, RECIPIENT_TOPIC],
      data: FIVE_USDT,
    }],
  };
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { method: string };
    const result = req.method === "eth_chainId" ? (options.chainId ?? "0x38")
      : req.method === "eth_getTransactionReceipt" ? receipt
      : req.method === "eth_blockNumber" ? (options.block ?? "0x72")
      : req.method === "eth_getLogs" ? (options.logs ?? [])
      : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("BSC USDT on-chain payment verification", () => {
  const env = { BSC_RPC_URL: "https://mock-bsc.invalid" } as unknown as Env;

  it("accepts a transfer of the accepted token to the configured recipient after enough confirmations", async () => {
    mockRpc({ block: "0x72" }); // 114 - 100 + 1 = 15 confirmations
    const result = await verifyBscUsdtTransfer(env, HASH, RECIPIENT, 5);
    expect(result).toEqual({ valid: true, confirmations: 15, receivedAmount: "5", requiredConfirmations: 15, blockNumber: 100 });
  });

  it("does not credit a matching transfer until the confirmation threshold is reached", async () => {
    mockRpc({ block: "0x6f" }); // 12 confirmations
    const result = await verifyBscUsdtTransfer(env, HASH, RECIPIENT, 5);
    expect(result).toMatchObject({ valid: true, confirmations: 12, requiredConfirmations: 15, blockNumber: 100 });
  });


  it("scans confirmed Transfer logs to the configured wallet and decodes six-decimal invoice amounts", async () => {
    const amountMicros = 5_003_421n;
    mockRpc({ logs: [{
      address: BSC_USDT_CONTRACT,
      topics: [TRANSFER_TOPIC, FROM_TOPIC, RECIPIENT_TOPIC],
      data: `0x${(amountMicros * (10n ** 12n)).toString(16).padStart(64, "0")}`,
      transactionHash: HASH,
      blockNumber: "0x70",
      logIndex: "0x2",
    }] });
    const transfers = await scanBscUsdtTransfers(env, RECIPIENT, 100, 120);
    expect(transfers).toEqual([{ transactionHash: HASH, blockNumber: 112, logIndex: 2, amountMicros: "5003421" }]);
  });

  it("rejects a transfer to a different recipient", async () => {
    const receipt = {
      transactionHash: HASH,
      blockNumber: "0x64",
      status: "0x1",
      logs: [{ address: BSC_USDT_CONTRACT, topics: [TRANSFER_TOPIC, FROM_TOPIC, `0x${"0".repeat(24)}${"b".repeat(40)}`], data: FIVE_USDT }],
    };
    mockRpc({ receipt });
    expect(await verifyBscUsdtTransfer(env, HASH, RECIPIENT, 5)).toEqual({ valid: false, reason: "no_matching_transfer" });
  });

  it("rejects a transfer below the plan amount", async () => {
    const receipt = {
      transactionHash: HASH,
      blockNumber: "0x64",
      status: "0x1",
      logs: [{ address: BSC_USDT_CONTRACT, topics: [TRANSFER_TOPIC, FROM_TOPIC, RECIPIENT_TOPIC], data: `0x${(4n * (10n ** 18n)).toString(16).padStart(64, "0")}` }],
    };
    mockRpc({ receipt });
    expect(await verifyBscUsdtTransfer(env, HASH, RECIPIENT, 5)).toEqual({ valid: false, reason: "amount_mismatch" });
  });

  it("rejects RPC responses from any chain other than BSC mainnet", async () => {
    mockRpc({ chainId: "0x1" });
    await expect(verifyBscUsdtTransfer(env, HASH, RECIPIENT, 5)).rejects.toThrow("not BNB Smart Chain mainnet");
  });
});
