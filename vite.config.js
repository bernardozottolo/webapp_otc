var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { legalPagesPlugin } from "./vite/plugins/legalPages";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var backendOrigin = (env.VITE_APP_BACKEND_ORIGIN || "").trim();
    var upstream = backendOrigin.replace(/\/+$/, "");
    var proxy = backendOrigin.length > 0
        ? {
            "/otc": {
                target: upstream,
                changeOrigin: true,
                secure: false
            },
            "/webhook": {
                target: upstream,
                changeOrigin: true,
                secure: false
            },
            "/health": {
                target: upstream,
                changeOrigin: true,
                secure: false
            },
            "/api": {
                target: upstream,
                changeOrigin: true,
                secure: false
            }
        }
        : undefined;
    return __assign({ plugins: [react(), legalPagesPlugin()] }, (proxy
        ? {
            server: { proxy: proxy },
            preview: { proxy: proxy }
        }
        : {}));
});
