import type { BrandConfig, ThemeVariableName } from "./config";
import { defaultBrandConfig, normalizeRuntimeBrandConfig, supportedThemeVariables } from "./config";

const LOCAL_RUNTIME_CONFIG_PATH = "/runtime-config.local.json";
const DEV_EXAMPLE_CONFIG_PATHS: Record<string, string> = {
  default: "/runtime-config.example.br.json",
  andes: "/runtime-config.example.co.json"
};

function isLocalDevelopmentHost() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function normalizeConfigPath(path: string) {
  if (/^https?:\/\//i.test(path)) {
    throw new Error("External runtime config URLs are not allowed.");
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function resolveConfigPathFromUrl() {
  const query = new URLSearchParams(window.location.search);
  const explicitConfig = query.get("config");
  if (explicitConfig) {
    return normalizeConfigPath(explicitConfig);
  }

  return LOCAL_RUNTIME_CONFIG_PATH;
}

function resolveDevelopmentFallbackPath() {
  const query = new URLSearchParams(window.location.search);
  const legacyBrand = query.get("brand") ?? "default";
  return DEV_EXAMPLE_CONFIG_PATHS[legacyBrand] ?? DEV_EXAMPLE_CONFIG_PATHS.default;
}

async function fetchRuntimeConfig(path: string) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Runtime config request failed for ${path} with status ${response.status}.`);
  }

  return response.json();
}

function applyOtcSameOriginQueryParam(brand: BrandConfig): BrandConfig {
  const params = new URLSearchParams(window.location.search);
  if (params.get("otcViaSameOrigin") === "1" || params.get("otcViaSameOrigin") === "true") {
    return { ...brand, endpoints: { ...brand.endpoints, otcViaSameOrigin: true } };
  }
  return brand;
}

export async function loadRuntimeBrandConfig(): Promise<BrandConfig> {
  const configPath = resolveConfigPathFromUrl();

  try {
    const payload = await fetchRuntimeConfig(configPath);
    return applyOtcSameOriginQueryParam(normalizeRuntimeBrandConfig(payload));
  } catch (error) {
    const shouldTryDevFallback = configPath === LOCAL_RUNTIME_CONFIG_PATH && isLocalDevelopmentHost();
    if (shouldTryDevFallback) {
      const fallbackPath = resolveDevelopmentFallbackPath();
      const fallbackPayload = await fetchRuntimeConfig(fallbackPath);
      return applyOtcSameOriginQueryParam(normalizeRuntimeBrandConfig(fallbackPayload));
    }

    const message = error instanceof Error ? error.message : "Unknown runtime config error.";
    throw new Error(
      `Não foi possível carregar a configuração local em ${configPath}. Preencha esse arquivo antes do deploy ou use ?config=runtime-config.example.br.json para desenvolvimento. Detalhe: ${message}`
    );
  }
}

export function applyRuntimeBrandTheme(brand: BrandConfig) {
  const root = document.documentElement;

  supportedThemeVariables.forEach((variableName) => {
    root.style.removeProperty(variableName);
  });

  root.style.setProperty("--brand-color", brand.primaryColor);

  const cssVariables = brand.theme?.cssVariables ?? {};
  Object.entries(cssVariables).forEach(([variableName, value]) => {
    if (!value || !supportedThemeVariables.includes(variableName as ThemeVariableName)) {
      return;
    }

    root.style.setProperty(variableName, normalizeThemeVariableValue(variableName as ThemeVariableName, value));
  });
}

function normalizeOpacityValue(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  if (parsed > 1) {
    return String(Math.min(Math.max(parsed, 0), 100) / 100);
  }

  return String(Math.min(Math.max(parsed, 0), 1));
}

function normalizeBackgroundImageValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") {
    return trimmed || "none";
  }
  if (!trimmed.startsWith("url(")) {
    return trimmed;
  }

  let inner = trimmed.slice(4).trim();
  if (inner.endsWith(")")) {
    inner = inner.slice(0, -1).trim();
  }

  let quote = "";
  if (inner.startsWith("'") || inner.startsWith("\"")) {
    quote = inner[0];
    inner = inner.slice(1);
    if (inner.endsWith(quote)) {
      inner = inner.slice(0, -1);
    }
  }

  inner = inner.trim();
  if (!inner) {
    return "none";
  }
  return `url(${quote}${inner}${quote})`;
}

export function normalizeThemeVariableValue(variableName: ThemeVariableName, value: string) {
  if (variableName === "--page-background-image-opacity" || variableName === "--page-background-overlay-opacity") {
    return normalizeOpacityValue(value);
  }
  if (variableName === "--page-background-image") {
    return normalizeBackgroundImageValue(value);
  }

  return value;
}

export function getRuntimeConfigPathForDocs() {
  return LOCAL_RUNTIME_CONFIG_PATH;
}
