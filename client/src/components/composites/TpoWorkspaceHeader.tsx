import type { ReactNode } from "react";

interface TpoWorkspaceHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  greeting?: string | null;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  actionMenu?: ReactNode;
}

export function TpoWorkspaceHeader({
  eyebrow,
  title,
  description,
  greeting,
  primaryAction = null,
  secondaryAction = null,
  actionMenu = null,
}: TpoWorkspaceHeaderProps) {
  return (
    <header className="tpo-workspace-header">
      <div className="tpo-workspace-header-copy">
        <p className="workspace-eyebrow">{eyebrow}</p>
        {greeting ? <p className="tpo-workspace-greeting">{greeting}</p> : null}
        <h1>{title}</h1>
        <p className="muted-text">{description}</p>
      </div>
      {(primaryAction || secondaryAction || actionMenu) ? (
        <div className="tpo-workspace-header-actions">
          {primaryAction}
          {secondaryAction}
          {actionMenu}
        </div>
      ) : null}
    </header>
  );
}
