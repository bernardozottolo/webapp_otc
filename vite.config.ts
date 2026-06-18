import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { legalPagesPlugin } from "./vite/plugins/legalPages";
import { brandHtmlMetaPlugin } from "./vite/plugins/brandHtmlMeta";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendOrigin = (env.VITE_APP_BACKEND_ORIGIN || "").trim();
  const upstream = backendOrigin.replace(/\/+$/, "");
  const proxy =
    backendOrigin.length > 0
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

  return {
    plugins: [react(), legalPagesPlugin(), brandHtmlMetaPlugin()],
    ...(proxy
      ? {
          server: { proxy },
          preview: { proxy }
        }
      : {})
  };
});
