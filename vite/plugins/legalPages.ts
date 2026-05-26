import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

const LEGAL_PAGES_DIR = "public/legal-pages";
const VIRTUAL_MODULE_ID = "virtual:legal-pages";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID;
const SLUG_PATTERN = /^[a-z0-9_]+$/;

function scanLegalPageSlugs(root: string): string[] {
  const dir = path.join(root, LEGAL_PAGES_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .map((name) => name.slice(0, -".html".length))
    .filter((slug) => SLUG_PATTERN.test(slug))
    .sort();
}

function generateModuleCode(slugs: string[]): string {
  const slugList = JSON.stringify(slugs);
  return `export const LEGAL_PAGE_SLUGS = Object.freeze(${slugList});
const LEGAL_PAGE_SLUG_SET = new Set(LEGAL_PAGE_SLUGS);
export function isLegalPageSlug(slug) {
  return typeof slug === "string" && LEGAL_PAGE_SLUG_SET.has(slug);
}
`;
}

function shouldRefreshLegalPages(file: string): boolean {
  return file.replace(/\\/g, "/").includes("/legal-pages/") && file.endsWith(".html");
}

export function legalPagesPlugin(): Plugin {
  let root = process.cwd();
  let slugs: string[] = [];

  const refreshSlugs = () => {
    slugs = scanLegalPageSlugs(root);
  };

  const invalidate = (server?: ViteDevServer) => {
    if (!server) return;
    const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
    if (mod) {
      server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: "full-reload" });
    }
  };

  return {
    name: "legal-pages",
    configResolved(config) {
      root = config.root;
      refreshSlugs();
    },
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
      return undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return undefined;
      }
      refreshSlugs();
      return generateModuleCode(slugs);
    },
    configureServer(server) {
      const watchDir = path.join(root, LEGAL_PAGES_DIR);
      if (!fs.existsSync(watchDir)) {
        fs.mkdirSync(watchDir, { recursive: true });
      }
      server.watcher.add(watchDir);
      const onChange = (file: string) => {
        if (shouldRefreshLegalPages(file)) {
          invalidate(server);
        }
      };
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
    buildStart() {
      refreshSlugs();
    }
  };
}
