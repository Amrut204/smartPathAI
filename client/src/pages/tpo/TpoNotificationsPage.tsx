import { NotificationCenter } from "../../components/composites/NotificationCenter";

export default function TpoNotificationsPage() {
  return (
    <NotificationCenter
      role="tpo"
      eyebrow="Notifications"
      title="See operational alerts in one review-first inbox."
      description="Automation drafts, grievance routing, report packs, and other TPO action items show up here as soon as they need attention."
      emptyTitle="No TPO alerts right now"
      emptyMessage="When student grievances, automation drafts, or report packs need review, they will appear here."
    />
  );
}
