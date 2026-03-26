import { Card } from "../ui";
import { pilotFeedbackLinks } from "../../config/pilot-feedback";

type PilotFeedbackStripProps = {
  title?: string;
  description?: string;
};

export function PilotFeedbackStrip({
  title = "Need help or found an issue?",
  description = "Use the fastest channel that works for you during the pilot. We review every report.",
}: PilotFeedbackStripProps) {
  if (!pilotFeedbackLinks.hasAny) {
    return null;
  }

  return (
    <Card className="pilot-feedback-strip">
      <div className="pilot-feedback-copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <div className="pilot-feedback-actions">
        {pilotFeedbackLinks.googleFormUrl ? (
          <a
            href={pilotFeedbackLinks.googleFormUrl}
            target="_blank"
            rel="noreferrer"
            className="ui-button primary"
          >
            Open Feedback Form
          </a>
        ) : null}

        {pilotFeedbackLinks.whatsappUrl ? (
          <a
            href={pilotFeedbackLinks.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="ui-button secondary"
          >
            WhatsApp Support
          </a>
        ) : null}

        {pilotFeedbackLinks.supportEmailHref ? (
          <a href={pilotFeedbackLinks.supportEmailHref} className="ui-button ghost">
            Email Support
          </a>
        ) : null}
      </div>
    </Card>
  );
}
