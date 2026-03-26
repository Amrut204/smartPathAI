import type { PropsWithChildren } from "react";
interface TooltipProps extends PropsWithChildren { content: string; }
export function Tooltip({ content, children }: TooltipProps) {
  return (
    <span className="ui-tooltip">
      {children}
      <span className="ui-tooltip-content">{content}</span>
    </span>
  );
}
