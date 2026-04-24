import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge, Button, Card, Spinner, Tabs } from "../ui";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
  type NotificationView,
  useNotifications,
} from "../../hooks/use-notifications";
import { markAnnouncementRead } from "../../hooks/use-announcements";

const tabItems: Array<{ id: NotificationView; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "announcements", label: "Announcements" },
  { id: "actions", label: "Actions" },
];

type NotificationCenterProps = {
  role: "student" | "tpo" | "hod";
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyMessage: string;
};

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function priorityVariant(priority: NotificationItem["priority"]) {
  if (priority === "urgent") return "danger" as const;
  if (priority === "important") return "warning" as const;
  return "default" as const;
}

function priorityLabel(priority: NotificationItem["priority"]) {
  if (priority === "urgent") return "Urgent";
  if (priority === "important") return "Important";
  return "Normal";
}

function kindLabel(kind: NotificationItem["kind"]) {
  return kind === "announcement" ? "Announcement" : "Action";
}

export function NotificationCenter(props: NotificationCenterProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<NotificationView>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const { data, error, isLoading } = useNotifications({ view: activeTab, limit: 50 });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = useMemo(() => data?.items ?? [], [data]);

  const openNotification = async (item: NotificationItem) => {
    setBusyId(item.id);
    try {
      if (!item.readAt) {
        if (props.role === "student" && item.sourceType === "announcement" && item.sourceId) {
          await markAnnouncementRead(item.sourceId);
        } else {
          await markNotificationRead(item.id);
        }
      }
      if (item.targetPath) {
        navigate(item.targetPath);
      }
    } catch (actionError) {
      window.alert(actionError instanceof Error ? actionError.message : "Unable to open this notification right now.");
    } finally {
      setBusyId(null);
    }
  };

  const markAll = async () => {
    setMarkAllBusy(true);
    try {
      await markAllNotificationsRead();
    } catch (actionError) {
      window.alert(actionError instanceof Error ? actionError.message : "Unable to mark notifications as read right now.");
    } finally {
      setMarkAllBusy(false);
    }
  };

  return (
    <section className="student-workspace-shell">
      <header className="student-workspace-header">
        <div>
          <p className="resources-kicker">{props.eyebrow}</p>
          <h1>{props.title}</h1>
          <p>{props.description}</p>
        </div>
      </header>

      <Tabs tabs={tabItems} activeId={activeTab} onChange={(tabId) => setActiveTab(tabId as NotificationView)} />

      <Card className="notification-center-panel">
        <div className="notification-center-head">
          <div>
            <h2>Inbox</h2>
            <p className="muted-text">{unreadCount} unread item(s) across announcements and action updates.</p>
          </div>
          <Button variant="secondary" disabled={markAllBusy || unreadCount === 0} onClick={() => void markAll()}>
            {markAllBusy ? "Marking..." : "Mark all as read"}
          </Button>
        </div>

        {isLoading ? (
          <div className="app-state-card">
            <Spinner />
            <p className="muted-text">Loading notifications...</p>
          </div>
        ) : error ? (
          <div className="app-state-card app-state-card-error">
            <h3>Unable to load notifications</h3>
            <p>{error instanceof Error ? error.message : "Unknown error"}</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="app-state-card">
            <h3>{props.emptyTitle}</h3>
            <p className="muted-text">{props.emptyMessage}</p>
          </div>
        ) : (
          <div className="student-workspace-list notification-center-list">
            {notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`student-workspace-row notification-center-row ${item.readAt ? "is-read" : "is-unread"}`.trim()}
                onClick={() => void openNotification(item)}
                disabled={busyId === item.id}
              >
                <div className="notification-center-copy">
                  <div className="notification-center-row-head">
                    <strong>{item.title}</strong>
                    <div className="notification-center-badges">
                      <Badge variant={priorityVariant(item.priority)}>{priorityLabel(item.priority)}</Badge>
                      <Badge variant="default">{kindLabel(item.kind)}</Badge>
                      {!item.readAt ? <Badge variant="success">Unread</Badge> : null}
                    </div>
                  </div>
                  <p>{item.message}</p>
                  <span className="muted-text">{formatDateTime(item.createdAt)}</span>
                </div>
                <span className="notification-center-action muted-text">
                  {busyId === item.id ? "Opening..." : item.targetPath ? "Open" : "View"}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
