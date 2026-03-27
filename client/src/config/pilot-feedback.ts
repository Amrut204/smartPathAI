type PilotFeedbackLinks = {
  googleFormUrl: string | null;
  whatsappUrl: string | null;
  supportEmail: string | null;
  supportEmailHref: string | null;
  hasAny: boolean;
};

const DEFAULT_GOOGLE_FORM_URL = "https://forms.gle/fkcwkG6SNVAPLWEA9";
const DEFAULT_WHATSAPP_URL = "https://wa.me/9699084141?text=I%20need%20help%20with%20Smart%20Path";
const DEFAULT_SUPPORT_EMAIL = "admin@campusdrive.me";

function normalizeUrl(value: string | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeEmail(value: string | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed;
}

const googleFormUrl = normalizeUrl(import.meta.env.VITE_GOOGLE_FEEDBACK_URL) ?? DEFAULT_GOOGLE_FORM_URL;
const whatsappUrl = normalizeUrl(import.meta.env.VITE_WHATSAPP_SUPPORT_URL) ?? DEFAULT_WHATSAPP_URL;
const supportEmail = normalizeEmail(import.meta.env.VITE_SUPPORT_EMAIL) ?? DEFAULT_SUPPORT_EMAIL;

export const pilotFeedbackLinks: PilotFeedbackLinks = {
  googleFormUrl,
  whatsappUrl,
  supportEmail,
  supportEmailHref: supportEmail ? `mailto:${supportEmail}` : null,
  hasAny: Boolean(googleFormUrl || whatsappUrl || supportEmail),
};
