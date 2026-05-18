const enabled =
  import.meta.env.DEV || String(import.meta.env.VITE_HTTP_LOG || "").toLowerCase() === "true";

/** Max caracteres registados por corpo (pedido/resposta); evita travar consola/redes. */
const MAX_BODY_CHARS = 16_384;

function truncate(s: string, maxChars = MAX_BODY_CHARS): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n… [truncado em ${maxChars} chars]`;
}

/** Ocultar campos óbvios de segredo em previews JSON/strings. */
function redactSecrets(s: string): string {
  const sensitiveKeys = [
    "password",
    "authorization",
    "token",
    "api[_-]?key",
    "x-api-key",
    "secret",
    "client_secret",
    "refresh_token",
    "email",
    "document",
    "document_number",
    "birth_date",
    "date_of_birth",
    "name",
    "full_name",
    "first_name",
    "last_name",
    "portrait_image",
    "payload",
    "qr_code",
    "wallet",
    "wallet_address",
    "tax_id",
    "vendor_data",
    "session_id",
    "order_id"
  ].join("|");
  return s.replace(
    new RegExp(`"(${sensitiveKeys})"\\s*:\\s*"[^"]*"`, "gi"),
    '"$1":"[REDACTED]"'
  );
}

function redactUrl(absUrl: string): string {
  try {
    const url = new URL(absUrl);
    url.searchParams.forEach((value, key) => {
      if (/(password|authorization|token|api[_-]?key|secret|email|document|vendor_data|session_id|order_id)/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
        return;
      }
      if (value.length > 120) {
        url.searchParams.set(key, `${value.slice(0, 40)}...[truncated]`);
      }
    });
    return url.toString();
  } catch {
    return absUrl;
  }
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    try {
      return redactUrl(new URL(input, window.location.href).href);
    } catch {
      return redactSecrets(input);
    }
  }
  if (input instanceof URL) {
    return redactUrl(input.href);
  }
  return redactUrl(input.url);
}

function endpointFromUrl(absUrl: string): string {
  try {
    const u = new URL(absUrl);
    return `${u.pathname}${u.search}`;
  } catch {
    return absUrl;
  }
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method;
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method;
  }
  return "GET";
}

function syncBodyPreview(body: Exclude<BodyInit, ReadableStream>): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return truncate(redactSecrets(body));
  if (body instanceof URLSearchParams) return truncate(redactSecrets(body.toString()));
  if (body instanceof Blob) return `[Blob type=${body.type} size=${body.size}]`;
  if (body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, key) => {
      if (value instanceof File) {
        parts.push(`${key}=[File:${value.name} ${value.size}b]`);
      } else {
        parts.push(`${key}=${truncate(redactSecrets(String(value)), 500)}`);
      }
    });
    return truncate(parts.join("; "));
  }
  if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength} bytes]`;
  if (ArrayBuffer.isView(body)) return `[TypedArray ${body.byteLength} bytes]`;
  return "[corpo não suportado para log]";
}

async function requestBodyPreview(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  try {
    if (init?.body !== undefined && init.body !== null) {
      const b = init.body;
      if (typeof ReadableStream !== "undefined" && b instanceof ReadableStream) {
        return "[ReadableStream — corpo não lido]";
      }
      return syncBodyPreview(b as Exclude<BodyInit, ReadableStream>);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      const clone = input.clone();
      const text = await clone.text();
      if (!text) return null;
      return truncate(redactSecrets(text));
    }
  } catch {
    return "[falha ao ler corpo do pedido]";
  }
  return null;
}

async function responseBodyPreview(response: Response): Promise<string | null> {
  try {
    const clone = response.clone();
    const text = await clone.text();
    if (!text) return null;
    return truncate(redactSecrets(text));
  } catch {
    return "[falha ao ler corpo da resposta]";
  }
}

if (enabled && typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    const endpoint = endpointFromUrl(url);
    const method = resolveMethod(input, init);

    let requestBodyStr: string | null = null;
    try {
      requestBodyStr = await requestBodyPreview(input, init);
    } catch {
      requestBodyStr = "[erro preview pedido]";
    }

    const started = performance.now();

    try {
      const response = await originalFetch(input, init);
      const ms = Math.round(performance.now() - started);
      const requestId = response.headers.get("x-request-id");

      let responseBodyStr: string | null = null;
      try {
        responseBodyStr = await responseBodyPreview(response);
      } catch {
        responseBodyStr = "[erro preview resposta]";
      }

      // eslint-disable-next-line no-console
      console.groupCollapsed(`[HTTP] ${method} ${endpoint} -> ${response.status} (${ms}ms)`);
      // eslint-disable-next-line no-console
      console.debug("URL:", url);
      if (requestId) {
        // eslint-disable-next-line no-console
        console.debug("Request ID:", requestId);
      }
      if (requestBodyStr !== null && requestBodyStr !== "") {
        // eslint-disable-next-line no-console
        console.debug("Request body:", requestBodyStr);
      }
      if (responseBodyStr !== null && responseBodyStr !== "") {
        // eslint-disable-next-line no-console
        console.debug("Response body:", responseBodyStr);
      }
      // eslint-disable-next-line no-console
      console.groupEnd();

      return response;
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.groupCollapsed(`[HTTP] ${method} ${endpoint} -> ERRO (${ms}ms)`);
      // eslint-disable-next-line no-console
      console.debug("URL:", url);
      if (requestBodyStr !== null && requestBodyStr !== "") {
        // eslint-disable-next-line no-console
        console.debug("Request body:", requestBodyStr);
      }
      // eslint-disable-next-line no-console
      console.debug("Erro:", message);
      // eslint-disable-next-line no-console
      console.groupEnd();
      throw error;
    }
  };
}
