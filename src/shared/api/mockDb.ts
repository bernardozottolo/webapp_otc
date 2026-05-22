import type { Customer, Order, PaymentData } from "../types";

interface OtpRecord {
  code: string;
  timestamp: number;
}

export const db = {
  customers: new Map<string, Customer>(),
  otpByEmail: new Map<string, OtpRecord>(),
  paymentByContext: new Map<string, PaymentData>(),
  orders: new Map<string, Order>()
};

db.customers.set("cliente@exemplo.com", {
  id: "cliente@exemplo.com",
  email: "cliente@exemplo.com",
  fullName: "Cliente Existente",
  documentType: "CPF",
  personType: "CPF",
  documentNumber: "12345678900",
  approvedKycResult: "approved",
  kycApproved: true,
  kycDate: Date.now() - 86400000,
  kycName: "Cliente Existente",
  biometricApproved: true,
  lastSuccessfulBiometric: Date.now() - 3600000,
  emailVerified: true,
  transactionalLimit: {
    daily: 50000,
    monthly: 300000
  }
});

db.paymentByContext.set("cliente@exemplo.com:buy:USDT:BR", {
  email: "cliente@exemplo.com",
  tradeSide: "buy",
  asset: "USDT",
  country: "BR",
  kind: "crypto",
  network: "BSC",
  walletAddress: "abc123wallet987"
});

db.paymentByContext.set("cliente@exemplo.com:sell:PIX:BR", {
  email: "cliente@exemplo.com",
  tradeSide: "sell",
  asset: "PIX",
  country: "BR",
  kind: "bank",
  bankKeyType: "Telefone",
  bankKeyValue: "21999992129"
});
