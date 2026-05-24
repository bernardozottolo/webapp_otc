import * as mockApi from "./mockApi";
import type { BrandConfig } from "../../whitelabel/config";
import {
  defaultBrandConfig,
  effectiveOrderBaseUrl,
  effectiveOtcQuoteBaseUrl
} from "../../whitelabel/config";
import type { OtcApi } from "./contracts";
import { configureDiditProxy } from "./diditProxy";
import type { PaymentContext, PaymentData } from "../types";
import {
  finalizeApprovedCustomerOnboardingHttp,
  getPaymentDataHttp,
  getProfileAndLimitsHttp,
  lookupCustomerByEmailHttp,
  savePaymentDataHttp,
  sendOtpEmailHttp,
  syncApprovedBiometricHttp,
  syncCounterpartyKycHttp,
  verifyOtpEmailHttp,
  type ClientsDatabaseConfig
} from "./clientsDatabase";
import { getNegotiationAssetsHttp, getQuoteHttp, type PricingConfig } from "./pricing";
import { cacheOrder, configureOrderPersistence, getCachedOrder } from "./orderCache";
import { getOrderRecordHttp, type OrderUpdatesConfig } from "./orderUpdates";
import {
  checkWalletRiskHttp,
  createOrderHttp,
  getAvailableWithdrawNetworksHttp,
  preOrderValidationHttp,
  submitCounterpartyKycHttp
} from "./otcBuy";
import { getTransactionalAllowanceHttp } from "./transactionalLimits";

let clientsDatabaseConfig: ClientsDatabaseConfig = {
  companyKey: defaultBrandConfig.backend.companyKey,
  platform: defaultBrandConfig.backend.platform,
  localPaymentAssetByCountry: defaultBrandConfig.backend.localPaymentAssetByCountry
};

let pricingConfig: PricingConfig = {
  quoteBaseUrl: effectiveOtcQuoteBaseUrl(defaultBrandConfig.endpoints)
};

let orderUpdatesConfig: OrderUpdatesConfig = {
  orderBaseUrl: effectiveOrderBaseUrl(defaultBrandConfig.endpoints.orderBaseUrl)
};

let documentTypesByCountry = defaultBrandConfig.documentTypesByCountry;

configureDiditProxy(defaultBrandConfig);

function useMockClientsDatabase() {
  return false;
}

function mapSellAssetForStorage(country: PaymentContext["country"], asset: string, tradeSide: PaymentContext["tradeSide"]) {
  if (tradeSide === "buy") {
    return asset;
  }
  return clientsDatabaseConfig.localPaymentAssetByCountry[country] ?? asset;
}

function toMockPaymentContext(context: PaymentContext): PaymentContext {
  return {
    ...context,
    asset: mapSellAssetForStorage(context.country, context.asset, context.tradeSide)
  };
}

function toMockPaymentData(paymentData: PaymentData): PaymentData {
  return {
    ...paymentData,
    asset: mapSellAssetForStorage(paymentData.country, paymentData.asset, paymentData.tradeSide)
  };
}

function fromStoredPaymentData(paymentData: PaymentData | null, context: PaymentContext): PaymentData | null {
  if (!paymentData) {
    return null;
  }

  return {
    ...paymentData,
    asset: context.asset,
    country: context.country,
    email: context.email,
    storageAsset: paymentData.asset
  };
}

export function configureOtcApi(brand: BrandConfig) {
  clientsDatabaseConfig = {
    companyKey: brand.backend.companyKey,
    platform: brand.backend.platform,
    localPaymentAssetByCountry: brand.backend.localPaymentAssetByCountry
  };
  pricingConfig = {
    quoteBaseUrl: effectiveOtcQuoteBaseUrl(brand.endpoints)
  };
  orderUpdatesConfig = {
    orderBaseUrl: effectiveOrderBaseUrl(brand.endpoints.orderBaseUrl)
  };
  documentTypesByCountry = brand.documentTypesByCountry;
  configureOrderPersistence(brand.orderPersistence);
  configureDiditProxy(brand);
}

function useMockPricing() {
  return pricingConfig.quoteBaseUrl.startsWith("mock://");
}

function useMockOrderUpdates() {
  return orderUpdatesConfig.orderBaseUrl.startsWith("mock://");
}

export const otcApiClient: OtcApi = {
  getQuote: (req) => (useMockPricing() ? mockApi.getQuote(req) : getQuoteHttp(pricingConfig, req)),
  getNegotiationAssets: (input) => getNegotiationAssetsHttp(pricingConfig, input),
  getTransactionalAllowance: (input) =>
    useMockPricing()
      ? mockApi.getTransactionalAllowance(input)
      : getTransactionalAllowanceHttp(pricingConfig, {
          fiat: input.fiatCurrency,
          first_name: input.firstName,
          document: input.document,
          kyc_result: input.kycResult
        }),
  lookupCustomerByEmail: (email) =>
    useMockClientsDatabase() ? mockApi.lookupCustomerByEmail(email) : lookupCustomerByEmailHttp(clientsDatabaseConfig, email),
  sendOtp: (email, timestamp) =>
    useMockClientsDatabase() ? mockApi.sendOtp(email, timestamp) : sendOtpEmailHttp(clientsDatabaseConfig, email, timestamp),
  verifyOtp: (email, code) => (useMockClientsDatabase() ? mockApi.verifyOtp(email, code) : verifyOtpEmailHttp(email, code)),
  getDocumentTypes: (country) =>
    Promise.resolve((documentTypesByCountry[country] ?? []).map((item) => item.type)),
  submitKyc: (payload) => (useMockPricing() ? mockApi.submitKyc(payload) : submitCounterpartyKycHttp(pricingConfig, payload)),
  runBiometric: mockApi.runBiometric,
  finalizeApprovedCustomerOnboarding: (payload) =>
    useMockClientsDatabase()
      ? mockApi.finalizeApprovedCustomerOnboarding(payload)
      : finalizeApprovedCustomerOnboardingHttp(clientsDatabaseConfig, payload),
  syncApprovedBiometric: (email, biometricTimestamp) =>
    useMockClientsDatabase()
      ? mockApi.syncApprovedBiometric(email, biometricTimestamp)
      : syncApprovedBiometricHttp(clientsDatabaseConfig, email, biometricTimestamp),
  syncCounterpartyKyc: (email, payload) =>
    useMockClientsDatabase()
      ? mockApi.syncCounterpartyKyc(email, payload)
      : syncCounterpartyKycHttp(clientsDatabaseConfig, email, payload),
  getProfileAndLimits: (email) =>
    useMockClientsDatabase() ? mockApi.getProfileAndLimits(email) : getProfileAndLimitsHttp(clientsDatabaseConfig, email),
  getPaymentData: (context) =>
    useMockClientsDatabase()
      ? mockApi.getPaymentData(toMockPaymentContext(context)).then((paymentData) => fromStoredPaymentData(paymentData, context))
      : getPaymentDataHttp(clientsDatabaseConfig, context),
  getNetworksAndFees: (country, asset) =>
    useMockPricing() ? mockApi.getNetworksAndFees(country, asset) : getAvailableWithdrawNetworksHttp(pricingConfig, asset),
  walletKytCheck: (walletAddress, network) =>
    useMockPricing() ? mockApi.walletKytCheck(walletAddress, network) : checkWalletRiskHttp(pricingConfig, walletAddress, network),
  bankKeyOwnerCheck: mockApi.bankKeyOwnerCheck,
  savePaymentData: (paymentData) =>
    useMockClientsDatabase() ? mockApi.savePaymentData(toMockPaymentData(paymentData)) : savePaymentDataHttp(clientsDatabaseConfig, paymentData),
  preValidateOrder: (input) => (useMockPricing() ? mockApi.preValidateOrder(input) : preOrderValidationHttp(pricingConfig, input)),
  createOrder: (input) =>
    (useMockPricing() ? mockApi.createOrder(input) : createOrderHttp(pricingConfig, input)).then((order) => {
      cacheOrder(order);
      return order;
    }),
  getOrderStatus: (id) => (useMockPricing() ? mockApi.getOrderStatus(id) : Promise.resolve(getCachedOrder(id))),
  getOrderRecord: (id) => (useMockOrderUpdates() ? Promise.resolve(null) : getOrderRecordHttp(orderUpdatesConfig, id))
};
