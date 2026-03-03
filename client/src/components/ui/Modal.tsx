import type { PropsWithChildren } from "react";
interface ModalProps extends PropsWithChildren { open: boolean; onClose: () => void; title?: string; }
export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="ui-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="ui-modal" role="dialog" aria-modal="true" aria-label={title ?? "Dialog"} onClick={(event) => event.stopPropagation()}>
        {title ? <h3>{title}</h3> : null}
        {children}
      </section>
    </div>
  );
}
