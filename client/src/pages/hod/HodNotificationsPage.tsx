import { NotificationCenter } from "../../components/composites/NotificationCenter";

export default function HodNotificationsPage() {
  return (
    <NotificationCenter
      role="hod"
      eyebrow="Notifications"
      title="Review department feedback and grievance alerts in one place."
      description="Published feedback activity, new grievance routing, and department follow-up reminders land here for quick action."
      emptyTitle="No HOD alerts right now"
      emptyMessage="New feedback responses and department-routed grievances will appear here automatically."
    />
  );
}
