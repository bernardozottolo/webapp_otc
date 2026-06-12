/** Variáveis substituíveis em `orderPage.texts.*.html` (formato `{nome}`). */
export interface OrderStatusHtmlVars {
  orderId: string;
  /** Ex.: `#abc-123` */
  orderNumber: string;
  supportEmail: string;
  companyName: string;
  email: string;
  /** Status bruto do pedido (ex.: `waiting_for_payment`). */
  status: string;
  /** Rótulo legível do status (badge). */
  statusLabel: string;
  tradeSide: string;
  tradeSideLabel: string;
  asset: string;
  payValue: string;
  receiveValue: string;
  receivingData: string;
}

/** Variáveis HTML "raw" permitidas em `orderPage.texts.*.html` (sem escape). */
export interface OrderStatusHtmlRawVars {
  undoPaymentSubmittedButton: string;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Monta HTML legado a partir de `emoji` + `message` (compatibilidade com configs antigas). */
export function buildLegacyOrderStatusHtml(emoji: string, message: string) {
  const body = escapeHtml(message).replace(/\n/g, "<br />");
  const emojiTrimmed = emoji.trim();
  if (!emojiTrimmed) {
    return `<div class="order-status-html"><div class="order-status-html__body">${body}</div></div>`;
  }
  return `<div class="order-status-html order-status-html--legacy"><span class="order-status-html__emoji" aria-hidden="true">${escapeHtml(emojiTrimmed)}</span><div class="order-status-html__body">${body}</div></div>`;
}

/** Substitui placeholders; valores dinâmicos são escapados e raw vars entram sem escape. */
export function interpolateOrderStatusHtml(
  html: string,
  vars: OrderStatusHtmlVars,
  rawVars: Partial<OrderStatusHtmlRawVars> = {}
) {
  const htmlWithRawVars = Object.entries(rawVars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{${key}\\}`, "g"), value ?? ""),
    html
  );
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{${key}\\}`, "g"), escapeHtml(value ?? "")),
    htmlWithRawVars
  );
}
