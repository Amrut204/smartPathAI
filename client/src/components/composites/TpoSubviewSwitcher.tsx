import { Link } from "react-router-dom";

type TpoSubview = {
  id: string;
  label: string;
  href?: string;
};

interface TpoSubviewSwitcherProps {
  label: string;
  items: TpoSubview[];
  activeId: string;
  onChange?: (id: string) => void;
}

export function TpoSubviewSwitcher({ label, items, activeId, onChange }: TpoSubviewSwitcherProps) {
  return (
    <nav className="workspace-subnav tpo-subview-switcher" aria-label={label}>
      {items.map((item) => (
        item.href ? (
          <Link
            key={item.id}
            to={item.href}
            className={item.id === activeId ? "workspace-subnav-link is-active" : "workspace-subnav-link"}
          >
            {item.label}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            className={item.id === activeId ? "workspace-subnav-link is-active" : "workspace-subnav-link"}
            onClick={() => onChange?.(item.id)}
          >
            {item.label}
          </button>
        )
      ))}
    </nav>
  );
}
