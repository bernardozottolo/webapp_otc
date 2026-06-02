import { validateAgainstRegexPattern } from "./documentTypes";

export type PixKeyNormalizeMode = "digits" | "lowercase_trim" | "uuid" | "none";
export type PixKeyFormatPreset = "phone_br" | "br_tax_id" | "uuid" | "none";

export interface PixKeyTypeConfig {
  label: string;
  backType: string;
  pattern?: string;
  normalize: PixKeyNormalizeMode;
  format: PixKeyFormatPreset;
  inputMode?: "tel" | "email" | "text";
}

export interface PixKeyCountryDefaults {
  defaultBackType: string;
  phoneDialCode: string;
}

/** Labels legados (bankKeyType antigo) → backType. */
const LEGACY_BANK_KEY_TYPE_ALIASES: Record<string, string> = {
  Telefone: "phone",
  Email: "email",
  Documento: "document",
  Aleatoria: "random_key",
  phone: "phone",
  email: "email",
  document: "document",
  random: "random_key",
  random_key: "random_key"
};

/** Rede persistida no clients_database (legado) → backType. */
const LEGACY_NETWORK_ALIASES: Record<string, string> = {
  phone: "phone",
  email: "email",
  document: "document",
  random: "random_key",
  random_key: "random_key"
};

export type PixKeyValidationError = "required" | "invalid";

export function resolvePixKeyBackType(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return LEGACY_BANK_KEY_TYPE_ALIASES[trimmed] ?? LEGACY_NETWORK_ALIASES[trimmed] ?? trimmed;
}

export function findPixKeyTypeConfig(configs: PixKeyTypeConfig[], backTypeOrLegacy: string) {
  const resolved = resolvePixKeyBackType(backTypeOrLegacy);
  return configs.find((item) => item.backType === resolved);
}

export function getPixKeyTypeLabel(configs: PixKeyTypeConfig[], backTypeOrLegacy: string): string {
  const config = findPixKeyTypeConfig(configs, backTypeOrLegacy);
  return config?.label ?? backTypeOrLegacy.trim();
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhoneBrNational(digits: string) {
  const d = digits.slice(0, 11);
  if (d.length <= 2) {
    return d.length ? `(${d}` : "";
  }
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 0) {
    return `(${ddd}) `;
  }
  if (d.length <= 10) {
    if (rest.length <= 4) {
      return `(${ddd}) ${rest}`;
    }
    return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
  }
  if (rest.length <= 5) {
    return `(${ddd}) ${rest}`;
  }
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

function formatBrTaxId(digits: string) {
  const d = digits.slice(0, 14);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  }
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function formatUuidHex(hex: string) {
  const h = hex.replace(/[^0-9a-f]/gi, "").slice(0, 32).toLowerCase();
  if (h.length <= 8) return h;
  if (h.length <= 12) return `${h.slice(0, 8)}-${h.slice(8)}`;
  if (h.length <= 16) return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12)}`;
  if (h.length <= 20) return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16)}`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function formatPixKeyDisplay(
  config: PixKeyTypeConfig | undefined,
  rawValue: string,
  _defaults?: PixKeyCountryDefaults
): string {
  if (!config) {
    return rawValue;
  }
  switch (config.format) {
    case "phone_br":
      return formatPhoneBrNational(digitsOnly(rawValue));
    case "br_tax_id":
      return formatBrTaxId(digitsOnly(rawValue));
    case "uuid":
      return formatUuidHex(rawValue);
    case "none":
    default:
      return rawValue;
  }
}

function normalizeUuid(value: string) {
  const hex = value.replace(/[^0-9a-f]/gi, "").slice(0, 32).toLowerCase();
  if (hex.length !== 32) {
    return hex;
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizePhoneForStorage(nationalDigits: string, dialCode: string) {
  const code = dialCode.replace(/\D/g, "") || "55";
  const national = nationalDigits.replace(/\D/g, "");
  if (!national) return "";
  return `+${code}${national}`;
}

function extractNationalPhoneDigits(digits: string, dialCode: string) {
  const code = dialCode.replace(/\D/g, "") || "55";
  let d = digits.replace(/\D/g, "");
  if (d.startsWith(code) && d.length > code.length) {
    d = d.slice(code.length);
  }
  if (d.startsWith("0")) {
    d = d.replace(/^0+/, "");
  }
  return d.slice(0, 11);
}

export function normalizePixKeyForStorage(
  config: PixKeyTypeConfig | undefined,
  displayOrRawValue: string,
  defaults?: PixKeyCountryDefaults
): string {
  const trimmed = displayOrRawValue.trim();
  if (!trimmed || !config) {
    return trimmed;
  }

  switch (config.normalize) {
    case "digits": {
      const digits = digitsOnly(trimmed);
      if (config.format === "phone_br" || config.backType === "phone") {
        const dialCode = defaults?.phoneDialCode ?? "55";
        const national = extractNationalPhoneDigits(digits, dialCode);
        return normalizePhoneForStorage(national, dialCode);
      }
      return digits;
    }
    case "lowercase_trim":
      return trimmed.toLowerCase();
    case "uuid":
      return normalizeUuid(trimmed);
    case "none":
    default:
      return trimmed;
  }
}

/** Converte valor persistido (API) para exibição mascarada no input. */
export function formatPixKeyFromStorage(
  config: PixKeyTypeConfig | undefined,
  storedValue: string,
  defaults?: PixKeyCountryDefaults
): string {
  if (!config || !storedValue.trim()) {
    return storedValue;
  }
  if (config.format === "phone_br" || config.backType === "phone") {
    const dialCode = defaults?.phoneDialCode ?? "55";
    let digits = digitsOnly(storedValue);
    const code = dialCode.replace(/\D/g, "");
    if (digits.startsWith(code)) {
      digits = digits.slice(code.length);
    }
    return formatPhoneBrNational(digits);
  }
  if (config.format === "br_tax_id") {
    return formatBrTaxId(digitsOnly(storedValue));
  }
  if (config.format === "uuid") {
    return formatUuidHex(storedValue);
  }
  return storedValue;
}

function valueForPatternValidation(
  config: PixKeyTypeConfig,
  normalized: string,
  defaults?: PixKeyCountryDefaults
): string {
  if (config.backType === "phone" || config.format === "phone_br") {
    const dialCode = (defaults?.phoneDialCode ?? "55").replace(/\D/g, "");
    const digits = normalized.replace(/\D/g, "");
    if (digits.startsWith(dialCode)) {
      return digits.slice(dialCode.length);
    }
    return digits;
  }
  return normalized;
}

export function validatePixKeyValue(
  configs: PixKeyTypeConfig[],
  backTypeOrLegacy: string,
  displayOrStoredValue: string,
  defaults?: PixKeyCountryDefaults
): PixKeyValidationError | null {
  const config = findPixKeyTypeConfig(configs, backTypeOrLegacy);
  if (!config) {
    return backTypeOrLegacy.trim() ? null : "required";
  }
  const normalized = normalizePixKeyForStorage(config, displayOrStoredValue, defaults);
  if (!normalized) {
    return "required";
  }
  const candidate = valueForPatternValidation(config, normalized, defaults);
  if (!validateAgainstRegexPattern(candidate, config.pattern)) {
    return "invalid";
  }
  return null;
}

/** backType → valor de `wallet.network` no clients_database. */
export function pixKeyBackTypeToNetwork(backTypeOrLegacy: string): string {
  const backType = resolvePixKeyBackType(backTypeOrLegacy);
  if (backType === "random_key") {
    return "random_key";
  }
  return backType || "phone";
}

export function networkToPixKeyBackType(network: string | undefined | null, configs: PixKeyTypeConfig[]): string {
  const resolved = resolvePixKeyBackType(network);
  if (findPixKeyTypeConfig(configs, resolved)) {
    return resolved;
  }
  return configs[0]?.backType ?? (resolved || "phone");
}
