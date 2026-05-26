/// <reference types="vite/client" />

declare module "virtual:legal-pages" {
  export const LEGAL_PAGE_SLUGS: readonly string[];
  export function isLegalPageSlug(slug: string): boolean;
}

interface ImportMetaEnv {
  readonly VITE_HTTP_LOG?: string;
  readonly VITE_APP_BACKEND_ORIGIN?: string;
}