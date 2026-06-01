import { defaultBrandConfig, type OrderPersistenceConfig } from "../../whitelabel/config";
import type { Order, OrderPaymentData, OrderUpdatePayload, StoredOrderRecord } from "../types";

const ORDER_CACHE_PREFIX = "otc-order:";
const ORDER_WINDOW_NAME_PREFIX = "otc-order-window:";
const memoryCache = new Map<string, StoredOrderRecord>();
const listeners = new Map<string, Set<(record: StoredOrderRecord | null) => void>>();
let orderPersistenceConfig: OrderPersistenceConfig = defaultBrandConfig.orderPersistence;
let storageListenerAttached = false;
let maintenanceTimerId: number | null = null;

export type OrderDisplayVariant =
  | "default"
  | "payment_timeout"
  | "payment_recognized"
  | "order_concluded"
  | "payment_reproved"
  | "payment_update_timeout"
  | "order_update_timeout";

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStorageKey(id: string) {
  return `${ORDER_CACHE_PREFIX}${id}`;
}

function emitOrderRecord(id: string, record: StoredOrderRecord | null) {
  const callbacks = listeners.get(id);
  if (!callbacks) return;
  callbacks.forEach((callback) => callback(record));
}

function isExpired(record: StoredOrderRecord, now = Date.now()) {
  return record.expiresAt <= now;
}

function coerceStoredOrderRecord(value: unknown): StoredOrderRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<StoredOrderRecord> & Partial<Order>;
  if (candidate.order && typeof candidate.order === "object" && !Array.isArray(candidate.order) && candidate.order.id) {
    return {
      order: candidate.order as Order,
      createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
      expiresAt:
        typeof candidate.expiresAt === "number" ? candidate.expiresAt : Date.now() + orderPersistenceConfig.ttlMs,
      updates: Array.isArray(candidate.updates) ? (candidate.updates as OrderUpdatePayload[]) : [],
      lastUpdatedAt: typeof candidate.lastUpdatedAt === "number" ? candidate.lastUpdatedAt : Date.now()
    };
  }
  if (typeof candidate.id === "string" && candidate.id.trim()) {
    const legacyOrder = candidate as Order;
    const now = Date.now();
    return {
      order: legacyOrder,
      createdAt: typeof legacyOrder.createdAt === "number" ? legacyOrder.createdAt : now,
      expiresAt: now + orderPersistenceConfig.ttlMs,
      updates: [],
      lastUpdatedAt: now
    };
  }
  return null;
}

function readRecordFromStorage(id: string): StoredOrderRecord | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(getStorageKey(id));
    if (!raw) return null;
    return coerceStoredOrderRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeRecordToStorage(record: StoredOrderRecord): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(getStorageKey(record.order.id), JSON.stringify(record));
  } catch {
    // Best effort only.
  }
}

function deleteRecordFromStorage(id: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(getStorageKey(id));
  } catch {
    // Best effort only.
  }
}

function syncRecord(record: StoredOrderRecord | null, id: string) {
  if (!record) {
    memoryCache.delete(id);
    deleteRecordFromStorage(id);
    emitOrderRecord(id, null);
    return;
  }
  memoryCache.set(id, record);
  writeRecordToStorage(record);
  emitOrderRecord(id, record);
}

function ensureStorageSyncListener() {
  if (storageListenerAttached || typeof window === "undefined") {
    return;
  }
  window.addEventListener("storage", (event) => {
    if (!event.key || !event.key.startsWith(ORDER_CACHE_PREFIX)) {
      return;
    }
    const id = event.key.slice(ORDER_CACHE_PREFIX.length);
    if (!id) return;
    if (event.newValue == null) {
      memoryCache.delete(id);
      emitOrderRecord(id, null);
      return;
    }
    try {
      const parsed = coerceStoredOrderRecord(JSON.parse(event.newValue));
      if (!parsed) {
        memoryCache.delete(id);
        emitOrderRecord(id, null);
        return;
      }
      if (isExpired(parsed)) {
        memoryCache.delete(id);
        emitOrderRecord(id, null);
        return;
      }
      memoryCache.set(id, parsed);
      emitOrderRecord(id, parsed);
    } catch {
      memoryCache.delete(id);
      emitOrderRecord(id, null);
    }
  });
  storageListenerAttached = true;
}

function buildRecord(order: Order, previous?: StoredOrderRecord | null): StoredOrderRecord {
  const now = Date.now();
  return {
    order,
    createdAt: previous?.createdAt ?? now,
    expiresAt: now + orderPersistenceConfig.ttlMs,
    updates: previous?.updates ?? [],
    lastUpdatedAt: now
  };
}

function normalizeUpdate(update: Omit<OrderUpdatePayload, "receivedAt"> | OrderUpdatePayload): OrderUpdatePayload {
  return {
    ...update,
    clientId: "clientId" in update ? update.clientId : undefined,
    receivedAt: "receivedAt" in update && typeof update.receivedAt === "number" ? update.receivedAt : Date.now()
  };
}

function mergePaymentInstructions(
  existing: OrderPaymentData | null | undefined,
  update: OrderPaymentData | undefined
): OrderPaymentData {
  const base: OrderPaymentData = existing ? { ...existing } : {};
  if (!update) return base;
  if (update.BeneficiaryBankName) base.BeneficiaryBankName = update.BeneficiaryBankName;
  if (update.BeneficiaryName) base.BeneficiaryName = update.BeneficiaryName;
  if (update.BeneficiaryTaxId) base.BeneficiaryTaxId = update.BeneficiaryTaxId;
  if (update.imagemQRCodeInBase64) base.imagemQRCodeInBase64 = update.imagemQRCodeInBase64;
  if (update.payload) base.payload = update.payload;
  if (update.network) base.network = update.network;
  if (update.walletAddress) base.walletAddress = update.walletAddress;
  if (update.pixKey) base.pixKey = update.pixKey;
  if (update.txHash !== undefined) base.txHash = update.txHash;
  if (update.txHashUrl !== undefined) base.txHashUrl = update.txHashUrl;
  return base;
}

function applyPaymentDataV2(
  paymentData: OrderPaymentData,
  paymentDataV2: OrderUpdatePayload["orderInfo"]["payment_data_v2"],
  template: string
): OrderPaymentData {
  if (!paymentDataV2) return paymentData;
  const next = { ...paymentData };
  const payout = paymentDataV2.payout_identifier?.trim();
  const refund = paymentDataV2.refund_identifier?.trim();
  if (template === "payment_reproved" && refund) {
    next.txHash = refund;
    next.txHashUrl = isHttpUrl(refund) ? refund : next.txHashUrl;
  } else if (payout) {
    next.txHash = payout;
    next.txHashUrl = isHttpUrl(payout) ? payout : next.txHashUrl;
  } else if (refund) {
    next.txHash = refund;
    next.txHashUrl = isHttpUrl(refund) ? refund : next.txHashUrl;
  }
  return next;
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

export function mergeOrderUpdate(existingOrder: Order, update: OrderUpdatePayload): Order {
  const next: Order = { ...existingOrder };
  const info = update.orderInfo;
  if (typeof info.trade_type === "string" && info.trade_type.trim()) {
    next.tradeSide = info.trade_type.trim().toUpperCase() === "SELL" ? "sell" : "buy";
  }
  if (typeof info.asset === "string" && info.asset.trim()) {
    next.asset = info.asset.trim();
  }
  if (typeof info.status === "string" && info.status.trim()) {
    next.status = info.status.trim();
  }
  if (typeof info.price === "number" && Number.isFinite(info.price)) {
    next.price = info.price;
  }
  if (typeof info.input_asset === "string" && info.input_asset.trim()) {
    next.inputAsset = info.input_asset.trim();
  }
  if (typeof info.output_asset === "string" && info.output_asset.trim()) {
    next.outputAsset = info.output_asset.trim();
  }
  const inputAmount =
    typeof info.input_amount === "number" && Number.isFinite(info.input_amount)
      ? info.input_amount
      : typeof info.amount_to_pay === "number" && Number.isFinite(info.amount_to_pay)
        ? info.amount_to_pay
        : null;
  if (inputAmount != null) {
    next.amountToPay = inputAmount;
    next.quoteTotal = inputAmount;
  }
  if (typeof info.output_amount_net === "number" && Number.isFinite(info.output_amount_net)) {
    next.amount = info.output_amount_net;
  }
  if (typeof info.output_amount_gross === "number" && Number.isFinite(info.output_amount_gross)) {
    next.outputAmountGross = info.output_amount_gross;
  }
  if (typeof info.fee_asset === "number" && Number.isFinite(info.fee_asset)) {
    next.feeAsset = info.fee_asset;
  }
  if (typeof info.fee_fiat === "number" && Number.isFinite(info.fee_fiat)) {
    next.feeFiat = info.fee_fiat;
  }
  if (info.payment_instructions) {
    next.paymentData = mergePaymentInstructions(existingOrder.paymentData, info.payment_instructions);
  }
  if (info.payment_data_v2) {
    next.paymentData = applyPaymentDataV2(next.paymentData ?? {}, info.payment_data_v2, update.template.trim());
  }
  return next;
}

export function getLatestOrderUpdate(record: StoredOrderRecord | null): OrderUpdatePayload | null {
  if (!record || record.updates.length === 0) {
    return null;
  }
  return [...record.updates].sort((a, b) => b.receivedAt - a.receivedAt)[0] ?? null;
}

export function getOrderDisplayVariant(
  record: StoredOrderRecord | null,
  options?: {
    paymentTimeoutMs?: number;
    orderUpdateTimeoutMs?: number;
    now?: number;
  }
): OrderDisplayVariant {
  const latestUpdate = getLatestOrderUpdate(record);
  const latestTemplate = latestUpdate?.template?.trim();
  const status = record?.order.status?.trim();
  const now = options?.now ?? Date.now();
  const paymentTimeoutMs = options?.paymentTimeoutMs ?? 0;
  const orderUpdateTimeoutMs = options?.orderUpdateTimeoutMs ?? 0;
  const hasPaymentTimeoutUpdate = record?.updates.some((update) => update.template?.trim() === "payment_timeout");
  if (hasPaymentTimeoutUpdate || latestTemplate === "payment_timeout" || status === "cancelled") {
    return "payment_timeout";
  }
  if (
    status === "waiting_for_payment" &&
    paymentTimeoutMs > 0 &&
    record &&
    record.updates.length === 0 &&
    now - record.createdAt >= paymentTimeoutMs
  ) {
    return "payment_update_timeout";
  }
  if (
    status === "payment_confirmed" &&
    orderUpdateTimeoutMs > 0 &&
    latestUpdate &&
    (latestTemplate === "payment_recognized" || latestUpdate.orderInfo.status?.trim() === "payment_confirmed") &&
    now - latestUpdate.receivedAt >= orderUpdateTimeoutMs
  ) {
    return "order_update_timeout";
  }
  if (latestTemplate === "payment_reproved" || status === "reproved") {
    return "payment_reproved";
  }
  if (latestTemplate === "payment_recognized" || status === "payment_confirmed") {
    return "payment_recognized";
  }
  if (latestTemplate === "order_concluded" || status === "concluded") {
    return "order_concluded";
  }
  return "default";
}

export function hasOrderTxHashLink(record: StoredOrderRecord | null): boolean {
  const txHash = record?.order.paymentData?.txHash?.trim();
  const txHashUrl = record?.order.paymentData?.txHashUrl?.trim();
  return Boolean(txHash || txHashUrl);
}

export function configureOrderPersistence(config: Partial<OrderPersistenceConfig>): void {
  orderPersistenceConfig = {
    ttlMs: config.ttlMs && config.ttlMs > 0 ? config.ttlMs : orderPersistenceConfig.ttlMs,
    pollIntervalMs:
      config.pollIntervalMs && config.pollIntervalMs > 0 ? config.pollIntervalMs : orderPersistenceConfig.pollIntervalMs
  };
  removeExpiredOrders();
  startOrderStoreMaintenance();
}

export function getOrderPersistenceConfig(): OrderPersistenceConfig {
  return orderPersistenceConfig;
}

export function startOrderStoreMaintenance(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (maintenanceTimerId !== null) {
    window.clearInterval(maintenanceTimerId);
  }
  const intervalMs = Math.max(30_000, Math.min(orderPersistenceConfig.ttlMs, orderPersistenceConfig.pollIntervalMs));
  maintenanceTimerId = window.setInterval(() => removeExpiredOrders(), intervalMs);
}

export function saveOrderRecord(order: Order): StoredOrderRecord {
  ensureStorageSyncListener();
  const previous = getOrderRecord(order.id);
  const record = buildRecord(order, previous);
  syncRecord(record, order.id);
  return record;
}

export function cacheOrder(order: Order): void {
  saveOrderRecord(order);
}

export function removeExpiredOrders(now = Date.now()): void {
  const storage = getStorage();
  if (storage) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(ORDER_CACHE_PREFIX)) continue;
      try {
        const raw = storage.getItem(key);
        if (!raw) {
          keysToRemove.push(key);
          continue;
        }
        const parsed = JSON.parse(raw) as StoredOrderRecord;
        if (isExpired(parsed, now)) {
          keysToRemove.push(key);
        }
      } catch {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => {
      const id = key.slice(ORDER_CACHE_PREFIX.length);
      memoryCache.delete(id);
      deleteRecordFromStorage(id);
      emitOrderRecord(id, null);
    });
  }
  Array.from(memoryCache.entries()).forEach(([id, record]) => {
    if (isExpired(record, now)) {
      memoryCache.delete(id);
      emitOrderRecord(id, null);
    }
  });
}

export function getOrderRecord(id: string): StoredOrderRecord | null {
  ensureStorageSyncListener();
  removeExpiredOrders();
  const inMemory = memoryCache.get(id);
  if (inMemory) {
    return inMemory;
  }
  const stored = readRecordFromStorage(id);
  if (!stored) {
    return null;
  }
  if (isExpired(stored)) {
    syncRecord(null, id);
    return null;
  }
  memoryCache.set(id, stored);
  return stored;
}

export function applyOrderUpdate(update: Omit<OrderUpdatePayload, "receivedAt"> | OrderUpdatePayload): StoredOrderRecord | null {
  const normalized = normalizeUpdate(update);
  const orderId = normalized.orderInfo.order_id;
  if (!orderId) {
    return null;
  }
  const current = getOrderRecord(orderId);
  if (!current) {
    return null;
  }
  const next: StoredOrderRecord = {
    ...current,
    order: mergeOrderUpdate(current.order, normalized),
    updates: [...current.updates, normalized],
    expiresAt: Date.now() + orderPersistenceConfig.ttlMs,
    lastUpdatedAt: Date.now()
  };
  syncRecord(next, orderId);
  return next;
}

function orderHasDisplayAmounts(order: Order) {
  return (Number.isFinite(order.amount) && order.amount > 0) || (Number.isFinite(order.quoteTotal) && order.quoteTotal > 0);
}

function preserveDisplayAmounts(remoteOrder: Order, localOrder: Order | null | undefined): Order {
  if (!localOrder || orderHasDisplayAmounts(remoteOrder) || !orderHasDisplayAmounts(localOrder)) {
    return remoteOrder;
  }
  return {
    ...remoteOrder,
    amount: localOrder.amount,
    quoteTotal: localOrder.quoteTotal,
    amountToPay: localOrder.amountToPay ?? localOrder.quoteTotal,
    price: remoteOrder.price ?? localOrder.price,
    inputAsset: remoteOrder.inputAsset ?? localOrder.inputAsset,
    outputAsset: remoteOrder.outputAsset ?? localOrder.outputAsset
  };
}

function preservePaymentDataFields(remoteOrder: Order, localOrder: Order | null | undefined): Order {
  const remotePayment = remoteOrder.paymentData;
  const localPayment = localOrder?.paymentData;
  if (!remotePayment && !localPayment) {
    return remoteOrder;
  }
  const merged: OrderPaymentData = { ...localPayment, ...remotePayment };
  const localPixKey = localPayment?.pixKey?.trim();
  if (!merged.pixKey?.trim() && localPixKey) {
    merged.pixKey = localPixKey;
  }
  if (!merged.walletAddress?.trim()) {
    const wallet =
      remotePayment?.walletAddress?.trim() ||
      remotePayment?.payload?.trim() ||
      localPayment?.walletAddress?.trim() ||
      localPayment?.payload?.trim();
    if (wallet) {
      merged.walletAddress = wallet;
    }
  }
  return { ...remoteOrder, paymentData: merged };
}

export function replaceOrderRecord(record: StoredOrderRecord): StoredOrderRecord {
  ensureStorageSyncListener();
  const existing = getOrderRecord(record.order.id);
  const baseOrder = preservePaymentDataFields(preserveDisplayAmounts(record.order, existing?.order), existing?.order);
  const sortedUpdates = [...record.updates].sort((a, b) => a.receivedAt - b.receivedAt);
  const consolidatedOrder = sortedUpdates.reduce((current, update) => mergeOrderUpdate(current, update), baseOrder);
  const next: StoredOrderRecord = {
    order: consolidatedOrder,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    updates: sortedUpdates,
    lastUpdatedAt: record.lastUpdatedAt
  };
  syncRecord(next, record.order.id);
  return next;
}

export function subscribeToOrder(id: string, callback: (record: StoredOrderRecord | null) => void): () => void {
  ensureStorageSyncListener();
  const bucket = listeners.get(id) ?? new Set<(record: StoredOrderRecord | null) => void>();
  bucket.add(callback);
  listeners.set(id, bucket);
  return () => {
    const existing = listeners.get(id);
    if (!existing) return;
    existing.delete(callback);
    if (existing.size === 0) {
      listeners.delete(id);
    }
  }
}

export function setWindowOrderPayload(targetWindow: Window | null, order: Order): void {
  if (!targetWindow) {
    return;
  }
  try {
    targetWindow.name = `${ORDER_WINDOW_NAME_PREFIX}${JSON.stringify(order)}`;
  } catch {
    // Best effort only; localStorage remains the primary shared cache.
  }
}

export function getWindowOrderPayload(expectedId: string): Order | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.name || "";
  if (!raw.startsWith(ORDER_WINDOW_NAME_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw.slice(ORDER_WINDOW_NAME_PREFIX.length)) as Order;
    return parsed.id === expectedId ? parsed : null;
  } catch {
    return null;
  }
}

export function getCachedOrder(id: string): Order | null {
  return getOrderRecord(id)?.order ?? null;
}

declare global {
  interface Window {
    __OTC_ORDER_UPDATE__?: (payload: Omit<OrderUpdatePayload, "receivedAt"> | OrderUpdatePayload) => StoredOrderRecord | null;
  }
}

if (typeof window !== "undefined") {
  window.__OTC_ORDER_UPDATE__ = (payload) => applyOrderUpdate(payload);
}
