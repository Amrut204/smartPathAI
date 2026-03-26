import type { PropsWithChildren } from "react";
interface ToastProps extends PropsWithChildren { open: boolean; }
export function Toast({ open, children }: ToastProps) {
  if (!open) return null;
  return (
    <div className="ui-toast-stack" aria-live="polite">
      <div className="ui-toast">{children}</div>
    </div>
  );
}
