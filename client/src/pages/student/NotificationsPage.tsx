import { NotificationCenter } from "../../components/composites/NotificationCenter";

export default function NotificationsPage() {
  return (
    <NotificationCenter
      role="student"
      eyebrow="Notifications"
      title="Keep every announcement and action item in one inbox."
      description="Drive updates, grievance changes, feedback requests, and formal announcements all land here so nothing important gets missed."
      emptyTitle="No notifications right now"
      emptyMessage="New drive alerts, announcements, grievance updates, and feedback requests will appear here automatically."
    />
  );
}
