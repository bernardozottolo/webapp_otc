import fs from "node:fs";
import path from "node:path";
var LEGAL_PAGES_DIR = "public/legal-pages";
var VIRTUAL_MODULE_ID = "virtual:legal-pages";
var RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID;
var SLUG_PATTERN = /^[a-z0-9_]+$/;
function scanLegalPageSlugs(root) {
    var dir = path.join(root, LEGAL_PAGES_DIR);
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs
        .readdirSync(dir)
        .filter(function (name) { return name.endsWith(".html"); })
        .map(function (name) { return name.slice(0, -".html".length); })
        .filter(function (slug) { return SLUG_PATTERN.test(slug); })
        .sort();
}
function generateModuleCode(slugs) {
    var slugList = JSON.stringify(slugs);
    return "export const LEGAL_PAGE_SLUGS = Object.freeze(".concat(slugList, ");\nconst LEGAL_PAGE_SLUG_SET = new Set(LEGAL_PAGE_SLUGS);\nexport function isLegalPageSlug(slug) {\n  return typeof slug === \"string\" && LEGAL_PAGE_SLUG_SET.has(slug);\n}\n");
}
function shouldRefreshLegalPages(file) {
    return file.replace(/\\/g, "/").includes("/legal-pages/") && file.endsWith(".html");
}
export function legalPagesPlugin() {
    var root = process.cwd();
    var slugs = [];
    var refreshSlugs = function () {
        slugs = scanLegalPageSlugs(root);
    };
    var invalidate = function (server) {
        if (!server)
            return;
        var mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
        if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: "full-reload" });
        }
    };
    return {
        name: "legal-pages",
        configResolved: function (config) {
            root = config.root;
            refreshSlugs();
        },
        resolveId: function (id) {
            if (id === VIRTUAL_MODULE_ID) {
                return RESOLVED_VIRTUAL_MODULE_ID;
            }
            return undefined;
        },
        load: function (id) {
            if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
                return undefined;
            }
            refreshSlugs();
            return generateModuleCode(slugs);
        },
        configureServer: function (server) {
            var watchDir = path.join(root, LEGAL_PAGES_DIR);
            if (!fs.existsSync(watchDir)) {
                fs.mkdirSync(watchDir, { recursive: true });
            }
            server.watcher.add(watchDir);
            var onChange = function (file) {
                if (shouldRefreshLegalPages(file)) {
                    invalidate(server);
                }
            };
            server.watcher.on("add", onChange);
            server.watcher.on("unlink", onChange);
        },
        buildStart: function () {
            refreshSlugs();
        }
    };
}
