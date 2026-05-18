/** Didit verify pages render a QR + handoff path on wide viewports and inline camera when layout is narrow (~mobile). Inner document width tracks the iframe width, so we cap iframe width while verification runs so desktop behaves like mobile. */

const DIDIT_FRAME_QUERY = 'iframe[src*="didit.me"]:not([src="about:blank"])';
const FALLBACK_WIDTH = "430px";
const DIDIT_MODAL_STYLE_ID = "didit-sdk-layout-overrides";

function resolveDiditIframeMaxWidth(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--didit-verify-iframe-max-width").trim();
  return raw || FALLBACK_WIDTH;
}

function applyIframeMobileWidth() {
  const width = resolveDiditIframeMaxWidth();

  document.querySelectorAll<HTMLIFrameElement>(DIDIT_FRAME_QUERY).forEach((iframe) => {
    const src = iframe.getAttribute("src") ?? "";
    if (!src || src.startsWith("about:") || src.startsWith("blob:")) return;

    iframe.style.setProperty("max-width", width, "important");
    iframe.style.setProperty("width", "100%", "important");
    iframe.style.setProperty("margin-left", "auto", "important");
    iframe.style.setProperty("margin-right", "auto", "important");
    iframe.style.setProperty("display", "block", "important");
    iframe.style.setProperty("min-height", "min(88vh, 900px)", "important");
  });
}

function ensureDiditModalStyle() {
  let style = document.getElementById(DIDIT_MODAL_STYLE_ID) as HTMLStyleElement | null;
  if (style) {
    return style;
  }

  style = document.createElement("style");
  style.id = DIDIT_MODAL_STYLE_ID;
  style.textContent = `
    .didit-modal-container {
      background-color: #fff !important;
    }

    .didit-close-button svg {
      margin: 10px 10px 0 0 !important;
    }
  `;
  document.head.appendChild(style);
  return style;
}

/** Run while verification is visible; dispose when session ends. */
export function attachDiditVerificationIframeMobileLayout(): () => void {
  let disposed = false;
  const modalStyle = ensureDiditModalStyle();

  const run = () => {
    if (disposed) return;
    requestAnimationFrame(() => applyIframeMobileWidth());
  };

  applyIframeMobileWidth();
  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let ticks = 0;
  const poll = window.setInterval(() => {
    run();
    ticks += 1;
    if (ticks > 60) window.clearInterval(poll);
  }, 250);

  return () => {
    disposed = true;
    observer.disconnect();
    window.clearInterval(poll);
    modalStyle.remove();
  };
}
