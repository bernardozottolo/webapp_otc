/** Mínimo de casas decimais em campos de exibição (não se aplica a inputs editáveis). */
export const DISPLAY_MIN_FRACTION_DIGITS = 2;

export function displayFractionDigits(configuredMaxFractionDigits: number) {
  const max = Math.max(DISPLAY_MIN_FRACTION_DIGITS, Math.max(0, configuredMaxFractionDigits));
  return { min: DISPLAY_MIN_FRACTION_DIGITS, max };
}

export function formatDisplayNumber(
  locale: string,
  amount: number,
  configuredMaxFractionDigits = 8
): string {
  if (!Number.isFinite(amount)) {
    return "0";
  }
  const { min, max } = displayFractionDigits(configuredMaxFractionDigits);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max
  }).format(amount);
}

export function formatDisplayFiatAmount(
  locale: string,
  currencyCode: string,
  amount: number,
  configuredMaxFractionDigits = DISPLAY_MIN_FRACTION_DIGITS
): string {
  if (!Number.isFinite(amount)) {
    return currencyCode;
  }
  const { min, max } = displayFractionDigits(configuredMaxFractionDigits);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: min,
      maximumFractionDigits: max
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(max)}`;
  }
}

export function formatDisplayAmountWithAsset(
  locale: string,
  fiatCurrency: string,
  amount: number,
  asset: string | undefined,
  fallbackAsset?: string,
  configuredMaxFractionDigits = 8
): string {
  const resolvedAsset = asset?.trim() || fallbackAsset?.trim() || "";
  if (resolvedAsset && resolvedAsset === fiatCurrency) {
    return formatDisplayFiatAmount(locale, fiatCurrency, amount, configuredMaxFractionDigits);
  }
  const formatted = formatDisplayNumber(locale, amount, configuredMaxFractionDigits);
  return resolvedAsset ? `${formatted} ${resolvedAsset}` : formatted;
}
