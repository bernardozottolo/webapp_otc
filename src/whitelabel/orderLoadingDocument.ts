import type { BrandConfig, ThemeVariableName } from "./config";
import { normalizeThemeVariableValue } from "./runtimeConfig";

const backgroundVariableDefaults: Partial<Record<ThemeVariableName, string>> = {
  "--page-shell-background": "#f3f4f6",
  "--page-background-start": "#fafafa",
  "--page-background-end": "#eef2f7",
  "--page-background-image": "none",
  "--page-background-image-opacity": "1",
  "--page-background-overlay-color": "transparent",
  "--page-background-overlay-opacity": "0",
  "--text-primary": "#111827",
  "--text-secondary": "#4b5563",
  "--card-background": "#ffffff",
  "--card-shadow": "0 20px 60px rgba(15, 23, 42, 0.12)",
  "--nav-border-color": "rgba(15, 23, 42, 0.08)"
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeTextForHtml(value: string): string {
  return escapeHtml(value);
}

function cssVarValue(brand: BrandConfig, variableName: ThemeVariableName): string {
  const raw = brand.theme?.cssVariables?.[variableName] ?? backgroundVariableDefaults[variableName] ?? "";
  return normalizeThemeVariableValue(variableName, raw);
}

export function createOrderLoadingDocument(brand: BrandConfig): string {
  const message = escapeTextForHtml(brand.orderLoading.message);
  const spinnerColor = cssVarValue(brand, "--brand-color") || brand.orderLoading.spinnerColor;
  const textColor = brand.orderLoading.textColor;
  const shellBg = cssVarValue(brand, "--page-shell-background");
  const bgStart = cssVarValue(brand, "--page-background-start");
  const bgEnd = cssVarValue(brand, "--page-background-end");
  const bgImage = cssVarValue(brand, "--page-background-image");
  const bgImageOpacity = cssVarValue(brand, "--page-background-image-opacity");
  const bgOverlayColor = cssVarValue(brand, "--page-background-overlay-color");
  const bgOverlayOpacity = cssVarValue(brand, "--page-background-overlay-opacity");
  const spinnerTrackColor = "rgba(255, 255, 255, 0.22)";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${message}</title>
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        height: 100%;
        margin: 0;
      }

      body {
        position: relative;
        isolation: isolate;
        width: 100%;
        height: 100dvh;
        overflow: hidden;
        font-family: Inter, Arial, sans-serif;

        background-color: ${shellBg};
        background-image: linear-gradient(180deg, ${bgStart} 0%, ${bgEnd} 100%);
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;

        color: ${textColor};
      }

      body::before,
      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      body::before {
        z-index: 0;
        background-image: ${bgImage};
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;
        opacity: ${bgImageOpacity};
      }

      body::after {
        z-index: 1;
        background: ${bgOverlayColor};
        opacity: ${bgOverlayOpacity};
      }

      .loading-shell {
        position: relative;
        z-index: 2;

        height: 100%;
        width: 100%;

        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;

        gap: 16px;
        padding: 24px;
        text-align: center;
      }

      .loading-spinner {
        width: 76px;
        height: 76px;
        border-radius: 50%;

        border: 5px solid ${spinnerTrackColor};
        border-top-color: ${spinnerColor};

        animation: order-spin 0.9s linear infinite;

        box-shadow: 0 0 28px rgba(0, 0, 0, 0.08);
      }

      .loading-message {
        margin: 0;
        color: ${textColor};
        font-size: clamp(1.05rem, 2vw, 1.3rem);
        font-weight: 600;
        letter-spacing: 0.01em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
        white-space: pre-line;
      }

      @keyframes order-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
  </head>

  <body>
    <main class="loading-shell">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p class="loading-message">${message}</p>
    </main>
  </body>
</html>`;
}

export function createOrderStatusMessageDocument(
  brand: BrandConfig,
  input: {
    title: string;
    message: string;
  }
): string {
  const title = escapeTextForHtml(input.title);
  const message = escapeTextForHtml(input.message);
  const titleColor = brand.orderPage.statusMessageTitleColor;
  const textColor = brand.orderPage.statusMessageTextColor;
  const shellBg = cssVarValue(brand, "--page-shell-background");
  const bgStart = cssVarValue(brand, "--page-background-start");
  const bgEnd = cssVarValue(brand, "--page-background-end");
  const bgImage = cssVarValue(brand, "--page-background-image");
  const bgImageOpacity = cssVarValue(brand, "--page-background-image-opacity");
  const bgOverlayColor = cssVarValue(brand, "--page-background-overlay-color");
  const bgOverlayOpacity = cssVarValue(brand, "--page-background-overlay-opacity");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        height: 100%;
        margin: 0;
      }

      body {
        position: relative;
        isolation: isolate;
        width: 100%;
        height: 100dvh;
        overflow: hidden;
        font-family: Inter, Arial, sans-serif;
        background-color: ${shellBg};
        background-image: linear-gradient(180deg, ${bgStart} 0%, ${bgEnd} 100%);
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;
      }

      body::before,
      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      body::before {
        z-index: 0;
        background-image: ${bgImage};
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;
        opacity: ${bgImageOpacity};
      }

      body::after {
        z-index: 1;
        background: ${bgOverlayColor};
        opacity: ${bgOverlayOpacity};
      }

      .message-shell {
        position: relative;
        z-index: 2;
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 24px;
        text-align: center;
      }

      .message-title {
        margin: 0;
        color: ${titleColor};
        font-size: clamp(1.55rem, 3vw, 2.35rem);
        line-height: 1.08;
      }

      .message-text {
        margin: 0;
        max-width: 680px;
        color: ${textColor};
        font-size: clamp(1rem, 1.8vw, 1.15rem);
        line-height: 1.6;
        white-space: pre-line;
      }
    </style>
  </head>
  <body>
    <main class="message-shell">
      <h1 class="message-title">${title}</h1>
      <p class="message-text">${message}</p>
    </main>
  </body>
</html>`;
}
