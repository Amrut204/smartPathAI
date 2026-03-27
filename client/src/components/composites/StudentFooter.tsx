import { Link } from "react-router-dom";

import { pilotFeedbackLinks } from "../../config/pilot-feedback";

export function StudentFooter({ showPolicy = true }: { showPolicy?: boolean }) {
  return (
    <footer className="student-footer">
      <div className="student-footer-copy">
        {showPolicy ? (
          <>
            <p>Resource usage is governed by the Smart Path policy for educational use.</p>
            <Link to="/resource-usage-policy">Resource Usage Policy</Link>
          </>
        ) : (
          <p>Need help with Smart Path? Use the support options here.</p>
        )}
      </div>

      {pilotFeedbackLinks.hasAny ? (
        <div className="student-footer-links">
          {pilotFeedbackLinks.googleFormUrl ? (
            <a href={pilotFeedbackLinks.googleFormUrl} target="_blank" rel="noreferrer">Feedback Form</a>
          ) : null}
          {pilotFeedbackLinks.whatsappUrl ? (
            <a href={pilotFeedbackLinks.whatsappUrl} target="_blank" rel="noreferrer">WhatsApp Support</a>
          ) : null}
          {pilotFeedbackLinks.supportEmailHref ? (
            <a href={pilotFeedbackLinks.supportEmailHref}>Email Support</a>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}
