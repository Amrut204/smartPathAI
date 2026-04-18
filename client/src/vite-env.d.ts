declare module "*.css" {}
declare module "*?url" {
  const value: string;
  export default value;
}

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly VITE_GOOGLE_FEEDBACK_URL?: string;
  readonly VITE_WHATSAPP_SUPPORT_URL?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_ENABLE_DEMO_AUTO_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
