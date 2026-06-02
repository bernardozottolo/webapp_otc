import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import {
  cacheOrder,
  getOrderDisplayVariant,
  getOrderPersistenceConfig,
  getOrderRecord,
  getWindowOrderPayload,
  isKnownOrderStatus,
  removeExpiredOrders,
  replaceOrderRecord,
  subscribeToOrder
} from "../../shared/api/orderCache";
import { otcApiClient } from "../../shared/api/client";
import { Modal } from "../../shared/ui/Modal";
import type { StoredOrderRecord } from "../../shared/types";
import type { BrandConfig, OrderPageTextsConfig } from "../../whitelabel/config";

interface OrderStatusPageProps {
  brand: BrandConfig;
}

function maskBankKey(value: string | undefined | null) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

function maskMiddle(value: string | undefined | null, visibleStart = 6, visibleEnd = 6) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.length <= visibleStart + visibleEnd + 3) {
    return trimmed;
  }
  return `${trimmed.slice(0, visibleStart)}...${trimmed.slice(-visibleEnd)}`;
}

function formatCountdown(totalSeconds: number) {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatFiatAmount(locale: string, currencyCode: string, amount: number, fractionDigits = 2) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(fractionDigits)}`;
  }
}

function formatAssetAmount(
  locale: string,
  amount: number,
  asset: string | undefined,
  minimumFractionDigits = 0,
  maximumFractionDigits = 8
) {
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(amount);
  return asset ? `${formatted} ${asset}` : formatted;
}

function formatPriceAmount(locale: string, currencyCode: string, amount: number) {
  return formatFiatAmount(locale, currencyCode, amount, 3);
}

function formatLegAmount(
  locale: string,
  fiatCurrency: string,
  amount: number,
  asset: string | undefined,
  fallbackAsset?: string
) {
  const resolvedAsset = asset?.trim() || fallbackAsset?.trim() || "";
  if (resolvedAsset === fiatCurrency) {
    return formatFiatAmount(locale, fiatCurrency, amount);
  }
  return formatAssetAmount(locale, amount, resolvedAsset);
}

function interpolateSupportEmail(message: string, supportEmail: string) {
  return message.replace(/\{supportEmail\}/g, supportEmail);
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function SellPayNetworkWarningIcon({
  ariaLabel,
  bullets
}: {
  ariaLabel: string;
  bullets: string[];
}) {
  if (bullets.length === 0) {
    return null;
  }
  return (
    <span className="order-pay-network-warning">
      <button type="button" className="order-pay-network-warning__trigger" aria-label={ariaLabel}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 2 1.5 20h21L12 2zm0 13.25a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zm.15-8.4a1.15 1.15 0 0 0-1.15 1.15v4.2a1.15 1.15 0 0 0 2.3 0v-4.2A1.15 1.15 0 0 0 12.15 6.85z"
          />
        </svg>
      </button>
      <div className="order-pay-network-warning__popover" role="tooltip">
        <ul className="order-pay-network-warning__list">
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </span>
  );
}

async function copyTextToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "true");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

function resolveStatusLabel(status: string | undefined, texts: OrderPageTextsConfig) {
  switch (status) {
    case "created":
      return texts.statusLabels.created;
    case "processing":
      return texts.statusLabels.processing;
    case "completed":
      return texts.statusLabels.completed;
    case "waiting_for_payment":
      return texts.statusLabels.waitingForPayment;
    case "payment_confirmed":
      return texts.statusLabels.paymentConfirmed;
    case "concluded":
      return texts.statusLabels.concluded;
    case "cancelled":
      return texts.statusLabels.cancelled;
    case "reproved":
      return texts.statusLabels.reproved;
    default:
      return "";
  }
}

function resolveVariantContent(variant: ReturnType<typeof getOrderDisplayVariant>, texts: OrderPageTextsConfig) {
  switch (variant) {
    case "payment_timeout":
      return texts.paymentTimeout;
    case "payment_update_timeout":
      return texts.paymentUpdateTimeout;
    case "payment_recognized":
      return texts.paymentRecognized;
    case "order_update_timeout":
      return texts.orderUpdateTimeout;
    case "order_concluded":
      return texts.orderConcluded;
    case "payment_reproved":
      return texts.paymentReproved;
    default:
      return null;
  }
}

function resolveDisplayStatusLabel(
  variant: ReturnType<typeof getOrderDisplayVariant>,
  status: string | undefined,
  texts: OrderPageTextsConfig
) {
  const variantContent = resolveVariantContent(variant, texts);
  if (variantContent?.title) {
    return variantContent.title;
  }
  return resolveStatusLabel(status, texts);
}

export function OrderStatusPage({ brand }: OrderStatusPageProps) {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<StoredOrderRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [initialRefreshComplete, setInitialRefreshComplete] = useState(false);
  const [firstPollComplete, setFirstPollComplete] = useState(false);
  const [payloadCopied, setPayloadCopied] = useState(false);
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);
  const [txHashCopied, setTxHashCopied] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const orderPage = brand.orderPage;
  const texts = orderPage.texts;
  const firstPollMarkedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    removeExpiredOrders();
    setInitialRefreshComplete(false);
    setFirstPollComplete(false);
    firstPollMarkedRef.current = false;

    const hydrateFromLocal = () => {
      const openerOrder = getWindowOrderPayload(id);
      if (openerOrder) {
        cacheOrder(openerOrder);
      }
      const localRecord = getOrderRecord(id);
      if (!mounted) return;
      setRecord(localRecord);
      setNotFound(localRecord == null);
    };

    const refresh = async (source: "initial" | "poll" = "initial") => {
      try {
        const remoteRecord = await otcApiClient.getOrderRecord(id);
        if (!mounted) return;
        if (remoteRecord) {
          const next = replaceOrderRecord(remoteRecord);
          setRecord(next);
          setNotFound(false);
          setInitialRefreshComplete(true);
          if (source === "poll" && !firstPollMarkedRef.current) {
            firstPollMarkedRef.current = true;
            setFirstPollComplete(true);
          }
          return;
        }
      } catch {
        // Keep the latest local snapshot when polling fails.
      }
      const localRecord = getOrderRecord(id);
      if (!mounted) return;
      setRecord(localRecord);
      setNotFound(localRecord == null);
      setInitialRefreshComplete(true);
      if (source === "poll" && !firstPollMarkedRef.current) {
        firstPollMarkedRef.current = true;
        setFirstPollComplete(true);
      }
    };
    hydrateFromLocal();
    const unsubscribe = subscribeToOrder(id, (nextRecord) => {
      if (!mounted) return;
      setRecord(nextRecord);
      setNotFound(nextRecord == null);
    });
    void refresh("initial");
    const timer = window.setInterval(() => {
      void refresh("poll");
      removeExpiredOrders();
    }, getOrderPersistenceConfig().pollIntervalMs);
    return () => {
      mounted = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [id]);

  const order = record?.order ?? null;
  const createSummary = record?.createSummary ?? null;
  const paymentUpdateTimeoutMs = useMemo(
    () => Math.round(orderPage.timer.durationSeconds * 1000 * 1.1),
    [orderPage.timer.durationSeconds]
  );
  const orderUpdateTimeoutMs = useMemo(
    () => Math.max(0, orderPage.orderUpdateTimeoutMinutes) * 60 * 1000,
    [orderPage.orderUpdateTimeoutMinutes]
  );
  const displayVariant = useMemo(
    () =>
      getOrderDisplayVariant(record, {
        paymentTimeoutMs: paymentUpdateTimeoutMs,
        orderUpdateTimeoutMs
      }),
    [record, paymentUpdateTimeoutMs, orderUpdateTimeoutMs]
  );
  const variantContent = resolveVariantContent(displayVariant, texts);
  const statusLabel = resolveDisplayStatusLabel(
    displayVariant,
    isKnownOrderStatus(order?.status) ? order?.status : undefined,
    texts
  );
  const shouldShowPaymentCard = displayVariant === "default";
  const deadlineMs = order ? order.createdAt + orderPage.timer.durationSeconds * 1000 : null;
  const timerExpired = remainingSeconds <= 0;
  const timerInWarning =
    shouldShowPaymentCard &&
    remainingSeconds > 0 &&
    remainingSeconds <= orderPage.timer.warningThresholdSeconds;
  const timerUsesWarningColors = shouldShowPaymentCard && (timerInWarning || timerExpired);
  const timerColors = timerUsesWarningColors ? orderPage.timer.warning : orderPage.timer.normal;
  const txHashRawValue = order?.paymentData?.txHash?.trim() ?? "";
  const txHashUrlRawValue = order?.paymentData?.txHashUrl?.trim() ?? "";
  const txHashValue = isHttpUrl(txHashRawValue) && !txHashUrlRawValue ? "" : txHashRawValue;
  const txHashMaskedValue = maskMiddle(txHashValue, 6, 6);
  const txHashHrefCandidate = txHashUrlRawValue || (isHttpUrl(txHashRawValue) ? txHashRawValue : "");
  const txHashHref = isHttpUrl(txHashHrefCandidate) ? txHashHrefCandidate : "";
  const hasTxHashValue = Boolean(txHashValue);
  const hasTxHashLink = Boolean(txHashHref);
  const isSellOrder = (createSummary?.tradeSide ?? order?.tradeSide) === "sell";
  const bankLabel = brand.bankLabelByCountry[brand.defaultCountry] ?? "PIX";
  const summaryCustomerPayment = createSummary?.customerPayment;
  const walletMasked = maskMiddle(summaryCustomerPayment?.walletAddress ?? order?.paymentData?.walletAddress, 6, 6);
  const maskedPixKey = maskBankKey(summaryCustomerPayment?.pixKey ?? order?.paymentData?.pixKey);
  const depositWalletAddress =
    order?.paymentData?.walletAddress?.trim() || order?.paymentData?.payload?.trim() || "";
  const depositNetworkLabel = order?.paymentData?.network?.trim() ?? "";
  const copyAddressLabel = isSellOrder ? texts.sellCopyWalletAddressButtonLabel : texts.copyPixButtonLabel;
  const copiedAddressLabel = isSellOrder ? texts.sellCopiedWalletAddressButtonLabel : texts.copiedPixButtonLabel;
  const addressFieldLabel = isSellOrder ? texts.sellWalletAddressLabel : texts.payloadLabel;
  const beneficiaryName = order?.paymentData?.BeneficiaryName?.trim() || brand.companyName;
  const beneficiaryBankName = order?.paymentData?.BeneficiaryBankName?.trim() ?? "";
  const beneficiaryTaxId = order?.paymentData?.BeneficiaryTaxId?.trim() ?? "";
  const formattedPrice = order?.price != null ? formatPriceAmount(brand.defaultLocale, brand.fiatCurrency, order.price) : "";
  const orderNumberLabel = `#${order?.id ?? id}`;
  const summaryTradeSide = createSummary?.tradeSide ?? order?.tradeSide;
  const summaryKicker = summaryTradeSide === "sell" ? texts.summarySellTitle : texts.summaryBuyTitle;
  const summaryAsset = createSummary?.asset ?? order?.asset;
  const inputAssetFallback = summaryTradeSide === "buy" ? brand.fiatCurrency : summaryAsset;
  const outputAssetFallback = summaryTradeSide === "buy" ? summaryAsset : brand.fiatCurrency;
  const summaryAmountToPay = createSummary?.amountToPay ?? order?.amountToPay ?? order?.quoteTotal;
  const summaryReceiveAmount = createSummary?.amount ?? order?.amount;
  const summaryInputAsset = createSummary?.inputAsset ?? order?.inputAsset;
  const summaryOutputAsset = createSummary?.outputAsset ?? order?.outputAsset;
  const sellPayViaNetwork =
    createSummary?.payViaNetwork?.trim() || (isSellOrder ? depositNetworkLabel : "");
  const payValueBase =
    order && summaryAmountToPay != null
      ? formatLegAmount(brand.defaultLocale, brand.fiatCurrency, summaryAmountToPay, summaryInputAsset, inputAssetFallback)
      : "";
  const payValue =
    isSellOrder && sellPayViaNetwork && payValueBase
      ? `${payValueBase} via ${sellPayViaNetwork}`
      : payValueBase;
  const showSellPayNetworkWarning =
    isSellOrder && Boolean(sellPayViaNetwork && payValueBase && texts.sellPayNetworkWarning.bullets.length > 0);
  const sellPayNetworkWarning = texts.sellPayNetworkWarning;
  const receiveValue =
    order && summaryReceiveAmount != null
      ? formatLegAmount(brand.defaultLocale, brand.fiatCurrency, summaryReceiveAmount, summaryOutputAsset, outputAssetFallback)
      : "";
  const receivingDataValue = isSellOrder
    ? [bankLabel, maskedPixKey].filter(Boolean).join(" - ")
    : [summaryCustomerPayment?.network?.trim() ?? order?.paymentData?.network?.trim() ?? "", walletMasked]
        .filter(Boolean)
        .join(" - ");

  useEffect(() => {
    if (!deadlineMs || !shouldShowPaymentCard) {
      setRemainingSeconds(0);
      return;
    }
    const updateRemaining = () => {
      setRemainingSeconds(Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)));
    };
    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [deadlineMs, shouldShowPaymentCard]);

  const pageVars = useMemo(
    () =>
      ({
        "--order-page-background": orderPage.backgroundColor,
        "--order-page-background-image": orderPage.backgroundImage,
        "--order-page-background-image-opacity": orderPage.backgroundImageOpacity,
        "--order-page-background-overlay-color": orderPage.backgroundOverlayColor,
        "--order-page-background-overlay-opacity": orderPage.backgroundOverlayOpacity,
        "--order-page-card-background": orderPage.cardBackgroundColor,
        "--order-page-card-border": orderPage.cardBorderColor,
        "--order-page-title-color": orderPage.titleColor,
        "--order-page-text-color": orderPage.textColor,
        "--order-page-muted-color": orderPage.mutedTextColor,
        "--order-page-accent-color": orderPage.accentColor,
        "--order-page-success-color": orderPage.successColor,
        "--order-page-warning-color": orderPage.warningColor,
        "--order-page-danger-color": orderPage.dangerColor,
        "--order-timer-background": timerColors.backgroundColor,
        "--order-timer-border": timerColors.borderColor,
        "--order-timer-text": timerColors.textColor
      }) as CSSProperties,
    [orderPage, timerColors]
  );
  const notFoundTitleStyle = useMemo(
    () => ({ color: orderPage.statusMessageTitleColor }),
    [orderPage.statusMessageTitleColor]
  );
  const notFoundTextStyle = useMemo(
    () => ({ color: orderPage.statusMessageTextColor }),
    [orderPage.statusMessageTextColor]
  );
  const orderLoadingSpinnerColor = (brand.theme?.cssVariables?.["--brand-color"] ?? "").trim() || brand.orderLoading.spinnerColor;
  const orderLoadingStyle = useMemo(
    () =>
      ({
        "--order-loading-spinner-color": orderLoadingSpinnerColor,
        "--order-loading-text-color": brand.orderLoading.textColor
      }) as CSSProperties,
    [brand.orderLoading.textColor, orderLoadingSpinnerColor]
  );

  const handleCopyDepositAddress = async () => {
    const address = isSellOrder
      ? depositWalletAddress
      : order?.paymentData?.payload?.trim() ?? "";
    if (!address) return;
    await copyTextToClipboard(address);
    setPayloadCopied(true);
    window.setTimeout(() => setPayloadCopied(false), 1800);
  };

  const handleCopyTxHash = async () => {
    if (!txHashValue) return;
    await copyTextToClipboard(txHashValue);
    setTxHashCopied(true);
    window.setTimeout(() => setTxHashCopied(false), 1800);
  };

  if (!initialRefreshComplete || (!order && !firstPollComplete)) {
    return (
      <section className="order-page-shell order-page-shell--loading" style={pageVars}>
        <div
          className="order-page-creation-loading"
          style={orderLoadingStyle}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="order-page-creation-loading__spinner" />
          <p className="order-page-creation-loading__message">{brand.orderLoading.message}</p>
        </div>
      </section>
    );
  }

  if (notFound && initialRefreshComplete) {
    return (
      <section className="order-page-shell" style={pageVars}>
        <div className="order-page">
          <h1 className="order-page-title" style={notFoundTitleStyle}>{texts.title}</h1>
          <p className="order-page-empty" style={notFoundTextStyle}>{texts.notFound}</p>
        </div>
      </section>
    );
  }

  const qrCodeBase64 = order?.paymentData?.imagemQRCodeInBase64?.trim() ?? "";
  const qrCodeSrc = qrCodeBase64 ? `data:image/png;base64,${qrCodeBase64}` : null;

  return (
    <section className="order-page-shell" style={pageVars}>
      <div className="order-page">
        <header className={`order-hero order-hero--${displayVariant}`}>
          <div className="order-hero__content">
            <span className="order-hero__eyebrow">{orderNumberLabel}</span>
            <h1 className="order-page-title">{texts.title}</h1>
            {!variantContent ? <p className="order-hero__message">{texts.waitingMessage}</p> : null}
          </div>
          <div className="order-hero__meta">
            {statusLabel ? <span className={`order-status-badge order-status-badge--${displayVariant}`}>{statusLabel}</span> : null}
            {shouldShowPaymentCard ? (
              <div className={`order-timer ${timerUsesWarningColors ? "order-timer--warning" : ""}`}>
                <span className="order-timer__label">{timerExpired ? texts.timerExpiredLabel : texts.timerLabel}</span>
                <strong className="order-timer__value">{formatCountdown(remainingSeconds)}</strong>
              </div>
            ) : null}
          </div>
        </header>

        {!order ? (
          <p className="order-page-empty">{texts.loading}</p>
        ) : (
          <div className="order-layout">
            <article className="card order-summary-card">
              <div className="order-card-header">
                <p className="order-card-kicker">{summaryKicker}</p>
              </div>

              <div className="order-summary-stats">
                <div className="order-summary-stat">
                  <span>{texts.payTitle}</span>
                  <strong>
                    {payValue}
                    {showSellPayNetworkWarning ? (
                      <SellPayNetworkWarningIcon
                        ariaLabel={sellPayNetworkWarning.ariaLabel}
                        bullets={sellPayNetworkWarning.bullets}
                      />
                    ) : null}
                  </strong>
                </div>
                <div className="order-summary-stat">
                  <span>{texts.receiveTitle}</span>
                  <strong>{receiveValue}</strong>
                </div>
              </div>

              <div className="order-summary-receiving-card">
                <span>{texts.customerPaymentTitle}</span>
                <strong>{receivingDataValue || "-"}</strong>
              </div>
            </article>

            {shouldShowPaymentCard ? (
              <article className="card order-payment-card">
                <div className="order-card-header">
                  <p className="order-card-kicker">{texts.paymentTitle}</p>
                  <button
                    type="button"
                    className="order-payment-info-button"
                    onClick={() => setPaymentDetailsOpen(true)}
                    title={texts.paymentInfoTooltip}
                    aria-label={texts.paymentInfoTooltip}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2Z" />
                    </svg>
                  </button>
                </div>
                {qrCodeSrc ? (
                  <img className="order-qr-code" src={qrCodeSrc} alt={texts.qrCodeAltLabel} />
                ) : (
                  <p className="order-page-empty">{texts.qrUnavailableMessage}</p>
                )}
                <div className="order-payment-actions">
                  <button
                    type="button"
                    className="order-copy-button"
                    onClick={handleCopyDepositAddress}
                    disabled={isSellOrder ? !depositWalletAddress : !order.paymentData?.payload}
                  >
                    {payloadCopied ? copiedAddressLabel : copyAddressLabel}
                  </button>
                </div>
              </article>
            ) : (
              <article className={`card order-status-card order-status-card--${displayVariant}`}>
                {variantContent ? (
                  <div className={`order-highlight-banner order-highlight-banner--${displayVariant}`}>
                    <span className="order-highlight-banner__emoji" aria-hidden="true">
                      {variantContent.emoji}
                    </span>
                    <div>
                      <strong>{variantContent.title}</strong>
                      <p>{interpolateSupportEmail(variantContent.message, brand.supportEmail)}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="order-status-card__emoji" aria-hidden="true">
                      •
                    </div>
                    <h2>{statusLabel}</h2>
                    <p>{texts.waitingMessage}</p>
                  </>
                )}
                {(displayVariant === "order_concluded" || displayVariant === "payment_reproved") &&
                (hasTxHashValue || hasTxHashLink) ? (
                  <div className="order-transaction-panel order-transaction-panel--inline">
                    {hasTxHashValue ? (
                      <div className="order-txhash-box">
                        <span>{texts.txHashLabel}</span>
                        <div className="order-txhash-box__content">
                          <strong className="order-txhash-value">{txHashMaskedValue}</strong>
                          <button
                            type="button"
                            className="order-copy-icon-button"
                            onClick={handleCopyTxHash}
                            aria-label={txHashCopied ? texts.copiedTxHashLabel : texts.copyTxHashLabel}
                            title={txHashCopied ? texts.copiedTxHashLabel : texts.copyTxHashLabel}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {hasTxHashLink ? (
                      <div className="order-transaction-panel__actions">
                        <a className="order-link-button order-link-button--compact" href={txHashHref} target="_blank" rel="noreferrer">
                          {texts.txHashLinkLabel}
                        </a>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )}
          </div>
        )}
      </div>
      <Modal open={paymentDetailsOpen} title={texts.paymentInfoModalTitle} onClose={() => setPaymentDetailsOpen(false)}>
        <div className="modal-body order-payment-modal">
          <div className="order-payment-modal__content">
            <div className="order-payment-modal__qr">
              {qrCodeSrc ? (
                <img className="order-qr-code order-qr-code--modal" src={qrCodeSrc} alt={texts.qrCodeAltLabel} />
              ) : (
                <p className="order-page-empty">{texts.qrUnavailableMessage}</p>
              )}
            </div>
            <div className="order-payment-modal__payload">
              <p className="order-payment-label">
                <strong>{addressFieldLabel}</strong>
              </p>
              <textarea
                className="order-payload"
                readOnly
                value={isSellOrder ? depositWalletAddress : order?.paymentData?.payload ?? ""}
              />
              <div className="order-payment-actions order-payment-actions--start">
                <button
                  type="button"
                  className="order-copy-button"
                  onClick={handleCopyDepositAddress}
                  disabled={isSellOrder ? !depositWalletAddress : !order?.paymentData?.payload}
                >
                  {payloadCopied ? copiedAddressLabel : copyAddressLabel}
                </button>
              </div>
            </div>
          </div>
          <div className="order-beneficiary-card">
            <div className="order-beneficiary-row">
              <span>{texts.beneficiaryLabel}</span>
              <strong>{beneficiaryName}</strong>
            </div>
            {isSellOrder && depositNetworkLabel ? (
              <div className="order-beneficiary-row">
                <span>{texts.networkLabel}</span>
                <strong>{depositNetworkLabel}</strong>
              </div>
            ) : null}
            {beneficiaryBankName ? (
              <div className="order-beneficiary-row">
                <span>{texts.bankLabel}</span>
                <strong>{beneficiaryBankName}</strong>
              </div>
            ) : null}
            {beneficiaryTaxId ? (
              <div className="order-beneficiary-row">
                <span>{texts.taxIdLabel}</span>
                <strong>{beneficiaryTaxId}</strong>
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
    </section>
  );
}
