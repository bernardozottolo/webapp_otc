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

function mergePaymentData(existing: OrderPaymentData | null | undefined, update: OrderUpdatePayload["orderInfo"]["payment_data"]) {
  const base: OrderPaymentData = existing ? { ...existing } : {};
  if (!update) return base;
  if (typeof update.qr_code === "string" && update.qr_code.trim()) {
    base.payload = update.qr_code.trim();
  }
  if (update.tx_hash !== undefined) {
    base.txHash = update.tx_hash ?? null;
  }
  if (update.tx_hash_url !== undefined) {
    base.txHashUrl = update.tx_hash_url ?? null;
  }
  if (typeof update.network === "string" && update.network.trim()) {
    base.network = update.network.trim();
  }
  if (typeof update.wallet_address === "string" && update.wallet_address.trim()) {
    base.walletAddress = update.wallet_address.trim();
  }
  return base;
}

export function mergeOrderUpdate(existingOrder: Order, update: OrderUpdatePayload): Order {
  const next: Order = { ...existingOrder };
  const info = update.orderInfo;
  if (typeof info.status === "string" && info.status.trim()) {
    next.status = info.status.trim();
  }
  if (typeof info.price === "number" && Number.isFinite(info.price)) {
    next.price = info.price;
  }
  if (typeof info.amount_to_pay === "number" && Number.isFinite(info.amount_to_pay)) {
    next.amountToPay = info.amount_to_pay;
    next.quoteTotal = info.amount_to_pay;
  }
  const nextAmount =
    typeof info.final_amount_to_receive === "number" && Number.isFinite(info.final_amount_to_receive)
      ? info.final_amount_to_receive
      : typeof info.total_amount_to_receive === "number" && Number.isFinite(info.total_amount_to_receive)
        ? info.total_amount_to_receive
        : undefined;
  if (nextAmount !== undefined) {
    next.amount = nextAmount;
  }
  if (info.payment_data) {
    next.paymentData = mergePaymentData(existingOrder.paymentData, info.payment_data);
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
  if (latestTemplate === "payment_timeout" || status === "cancelled") {
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

export function replaceOrderRecord(record: StoredOrderRecord): StoredOrderRecord {
  ensureStorageSyncListener();
  const sortedUpdates = [...record.updates].sort((a, b) => a.receivedAt - b.receivedAt);
  const consolidatedOrder = sortedUpdates.reduce((current, update) => mergeOrderUpdate(current, update), record.order);
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
