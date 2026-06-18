import "./shared/installFetchLogging";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import "./app/styles.css";
import { I18nProvider } from "./shared/i18n";
import { configureOtcApi } from "./shared/api/client";
import { loadRuntimeBrandConfig } from "./whitelabel/runtimeConfig";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found.");
}

const root = ReactDOM.createRoot(rootElement);

function renderStartupError(message: string) {
  root.render(
    <React.StrictMode>
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          fontFamily: "Inter, Arial, sans-serif",
          background: "#f3f4f6",
          color: "#111827",
          textAlign: "center"
        }}
      >
        <div>
          <h1>Falha ao carregar a configuração</h1>
          <p>{message}</p>
        </div>
      </div>
    </React.StrictMode>
  );
}

async function bootstrap() {
  try {
    const brand = await loadRuntimeBrandConfig();
    document.title = brand.companyName;
    configureOtcApi(brand);
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <I18nProvider>
            <App brand={brand} />
          </I18nProvider>
        </BrowserRouter>
      </React.StrictMode>
    );
  } catch (error) {
    renderStartupError(error instanceof Error ? error.message : "Erro desconhecido ao carregar a configuração.");
  }
}

void bootstrap();
