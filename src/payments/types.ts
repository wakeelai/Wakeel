export interface CreatePaymentInput {
  userId: string;
  planId: string;
  amountUsd: number;
}

export interface CreatePaymentResult {
  paymentId: string;
  provider: "nowpayments" | "direct_wallet";
  payAddress?: string;
  payAmount?: number;
  payCurrency?: string;
  network?: string;
  qrPayload?: string;
}
