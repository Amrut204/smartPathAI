import { Button } from "./Button";
import { Modal } from "./Modal";

type ConfirmActionModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  details?: string[];
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmActionModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  details,
  onClose,
  onConfirm,
}: ConfirmActionModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="confirm-action-modal">
        <p>{message}</p>
        {details && details.length > 0 ? (
          <ul className="confirm-action-details">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <div className="hero-actions">
          <Button
            type="button"
            variant={tone === "danger" ? "primary" : "secondary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working..." : confirmLabel}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
