import type { CreateOrderInput } from "./contracts";
import type { OrderCreateSummary } from "../types";

/** Monta o resumo exibido na página de pedido a partir do body enviado em `create_order`. */
export function buildCreateOrderSummaryFromInput(input: CreateOrderInput): OrderCreateSummary {
  if (input.tradeType === "SELL") {
    return {
      tradeSide: "sell",
      asset: input.asset,
      amount: input.preOrder.outputAmountNet,
      amountToPay: input.preOrder.inputAmount,
      inputAsset: input.preOrder.inputAsset || input.asset,
      outputAsset: input.preOrder.outputAsset,
      price: input.preOrder.price,
      customerPayment: {
        pixKey: input.paymentInfo.pixKey.trim()
      }
    };
  }
  return {
    tradeSide: "buy",
    asset: input.asset,
    amount: input.preOrder.outputAmountNet,
    amountToPay: input.preOrder.inputAmount,
    inputAsset: input.preOrder.inputAsset,
    outputAsset: input.preOrder.outputAsset || input.asset,
    price: input.preOrder.price,
    customerPayment: {
      network: input.paymentInfo.network.trim(),
      walletAddress: input.paymentInfo.wallet.trim()
    }
  };
}
