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

/** Substitui `{chave}`; valores dinâmicos são escapados (o HTML do config não é alterado). */
export function interpolateOrderStatusHtml(html: string, vars: OrderStatusHtmlVars) {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{${key}\\}`, "g"), escapeHtml(value ?? "")),
    html
  );
}
