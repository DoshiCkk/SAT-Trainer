/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESMOS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & { readonly BASE_URL: string };
}
