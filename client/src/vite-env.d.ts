declare module "*.css" {}
declare module "*?url" {
  const value: string;
  export default value;
}

interface ImportMetaEnv {
  readonly VITE_GOOGLE_FEEDBACK_URL?: string;
  readonly VITE_WHATSAPP_SUPPORT_URL?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
