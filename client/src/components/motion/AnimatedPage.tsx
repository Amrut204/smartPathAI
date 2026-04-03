import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";

export function AnimatedPage({ children }: PropsWithChildren) {
  const location = useLocation();

  return (
    <div key={location.pathname} className="animated-page">
      {children}
    </div>
  );
}
