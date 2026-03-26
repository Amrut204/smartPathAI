type PilotFeedbackLinks = {
  googleFormUrl: string | null;
  whatsappUrl: string | null;
  supportEmail: string | null;
  supportEmailHref: string | null;
  hasAny: boolean;
};

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

const googleFormUrl = normalizeUrl(import.meta.env.VITE_GOOGLE_FEEDBACK_URL);
const whatsappUrl = normalizeUrl(import.meta.env.VITE_WHATSAPP_SUPPORT_URL);
const supportEmail = normalizeEmail(import.meta.env.VITE_SUPPORT_EMAIL);

export const pilotFeedbackLinks: PilotFeedbackLinks = {
  googleFormUrl,
  whatsappUrl,
  supportEmail,
  supportEmailHref: supportEmail ? `mailto:${supportEmail}` : null,
  hasAny: Boolean(googleFormUrl || whatsappUrl || supportEmail),
};
