import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { Card } from "../../components/ui";

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
};

export default function UnsubscribePage() {
  const location = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token") ?? "";
    if (!token.trim()) {
      setStatus("error");
      setMessage("Missing unsubscribe token.");
      return;
    }

    const run = async () => {
      try {
        const response = await fetch(`/api/v1/communication/unsubscribe?token=${encodeURIComponent(token)}`);
        const payload = (await response.json()) as ApiResponse<{ message: string }>;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message ?? "Unable to unsubscribe.");
        }
        setStatus("success");
        setMessage(payload.data.message || "You have been unsubscribed.");
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Unable to unsubscribe.");
      }
    };

    void run();
  }, [location.search]);

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Email Preferences</h1>
        {status === "loading" ? <p className="muted-text">Processing your request...</p> : null}
        {status === "success" ? <p>{message}</p> : null}
        {status === "error" ? <p>{message}</p> : null}
        <p className="muted-text">
          If you unsubscribed by mistake, contact your TPO to re-enable notifications.
        </p>
      </Card>
    </section>
  );
}

