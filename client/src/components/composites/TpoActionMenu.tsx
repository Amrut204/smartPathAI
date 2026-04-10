import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

type ActionMenuItem = {
  label: string;
  href?: string;
  onSelect?: () => void;
  tone?: "default" | "danger";
};

interface TpoActionMenuProps {
  label?: string;
  items: ActionMenuItem[];
}

export function TpoActionMenu({ label = "More", items }: TpoActionMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  const closeMenu = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  useEffect(() => {
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!detailsRef.current || !target) return;
      if (!detailsRef.current.contains(target)) {
        closeMenu();
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <details ref={detailsRef} className="tpo-action-menu">
      <summary className="tpo-action-menu-trigger">{label}</summary>
      <div className="tpo-action-menu-panel">
        {items.map((item) => (
          item.href ? (
            <Link
              key={`${item.label}-${item.href}`}
              to={item.href}
              className={`tpo-action-menu-item ${item.tone === "danger" ? "danger" : ""}`.trim()}
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ) : (
            <button
              key={item.label}
              type="button"
              className={`tpo-action-menu-item ${item.tone === "danger" ? "danger" : ""}`.trim()}
              onClick={() => {
                item.onSelect?.();
                closeMenu();
              }}
            >
              {item.label}
            </button>
          )
        ))}
      </div>
    </details>
  );
}
