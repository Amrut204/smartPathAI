import type { PropsWithChildren } from "react";

type CardProps = PropsWithChildren<{
  className?: string;
}>;

export function Card({ children, className }: CardProps) {
  const classes = className ? `ui-card ${className}` : "ui-card";
  return <section className={classes}>{children}</section>;
}
