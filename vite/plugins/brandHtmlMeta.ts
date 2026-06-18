import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

type BrandHtmlMeta = {
  title: string;
  description: string;
  image: string | null;
};

function readBrandHtmlMeta(root: string): BrandHtmlMeta {
  const candidates = [
    path.join(root, "public/runtime-config.local.json"),
    path.join(root, "public/runtime-config.example.br.json")
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      const title = String(raw.companyName ?? "").trim() || "OTC White Label";
      const description =
        String(raw.headline ?? "").trim() || String(raw.subheadline ?? "").trim() || title;
      const image = String(raw.logoUrl ?? "").trim() || null;
      return { title, description, image };
    } catch {
      continue;
    }
  }

  return { title: "OTC White Label", description: "OTC White Label", image: null };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function injectBrandMeta(html: string, meta: BrandHtmlMeta, baseUrl: string): string {
  const safeTitle = escapeHtml(meta.title);
  const safeDescription = escapeAttr(meta.description || meta.title);
  const safeTitleAttr = escapeAttr(meta.title);
  const imageUrl =
    meta.image && (meta.image.startsWith("http://") || meta.image.startsWith("https://"))
      ? meta.image
      : meta.image
        ? `${baseUrl.replace(/\/+$/, "")}/${meta.image.replace(/^\/+/, "")}`
        : null;
  const safeImage = imageUrl ? escapeAttr(imageUrl) : "";

  let updated = html.replace(/<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`);
  updated = updated.replace(
    /\n?\s*<meta\s+(?:property="og:[^"]+"|name="(?:description|twitter:[^"]+)")\s+content="[^"]*"\s*\/>\s*/gi,
    ""
  );

  const metaLines = [
    `    <meta name="description" content="${safeDescription}" />`,
    `    <meta property="og:title" content="${safeTitleAttr}" />`,
    `    <meta property="og:description" content="${safeDescription}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta name="twitter:card" content="summary" />`,
    `    <meta name="twitter:title" content="${safeTitleAttr}" />`,
    `    <meta name="twitter:description" content="${safeDescription}" />`
  ];
  if (safeImage) {
    metaLines.push(`    <meta property="og:image" content="${safeImage}" />`);
    metaLines.push(`    <meta name="twitter:image" content="${safeImage}" />`);
  }

  return updated.replace("</head>", `${metaLines.join("\n")}\n  </head>`);
}

export function brandHtmlMetaPlugin(): Plugin {
  let root = process.cwd();

  return {
    name: "brand-html-meta",
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml(html, ctx) {
      const meta = readBrandHtmlMeta(root);
      const baseUrl = ctx.server?.resolvedUrls?.local[0] ?? "http://localhost:5173";
      return injectBrandMeta(html, meta, baseUrl);
    }
  };
}
