import type { PropsWithChildren } from "react";
type BadgeVariant = "default" | "success" | "warning" | "danger";
interface BadgeProps extends PropsWithChildren { variant?: BadgeVariant; }
export function Badge({ children, variant = "default" }: BadgeProps) {
  return <span className={`ui-badge ${variant}`}>{children}</span>;
}
