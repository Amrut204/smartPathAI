import { Link, useLocation } from "react-router-dom";
import { useMemo, useState } from "react";

import { Button } from "../ui";

type NavbarRole = "student" | "tpo";

interface NavLink {
  href: string;
  label: string;
}

const studentLinks: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ai-assistant", label: "AI Assistant" },
  { href: "/resources", label: "Resources" },
  { href: "/mock-tests", label: "Mock Tests" },
  { href: "/mastery", label: "Topic Mastery" },
  { href: "/vault", label: "Company Specific" },
  { href: "/profile", label: "Profile" },
];

const tpoLinks: NavLink[] = [
  { href: "/tpo/dashboard", label: "Dashboard" },
  { href: "/tpo/students", label: "Students" },
  { href: "/tpo/drives", label: "Drives" },
  { href: "/tpo/analytics", label: "Analytics" },
  { href: "/tpo/communication", label: "Communication" },
];

interface NavbarProps {
  role: NavbarRole;
  title: string;
  userName: string;
  onLogout: () => void;
}

export function Navbar({ role, title, userName, onLogout }: NavbarProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = useMemo(() => (role === "student" ? studentLinks : tpoLinks), [role]);

  return (
    <nav className="navbar">
      <div className="navbar-brand">{title}</div>

      <button
        className="navbar-toggle"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        {menuOpen ? "\u2715" : "\u2630"}
      </button>

      <div className={`navbar-nav ${menuOpen ? "open" : ""}`.trim()}>
        {links.map((link) => {
          const isActive =
            location.pathname === link.href ||
            location.pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              to={link.href}
              className={`navbar-link ${isActive ? "active" : ""}`.trim()}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          );
        })}
      </div>

      <div className="navbar-actions">
        <span className="ui-avatar">
          {userName.charAt(0).toUpperCase()}
        </span>
        <span className="navbar-user">{userName}</span>
        <Button variant="ghost" onClick={onLogout}>
          Logout
        </Button>
      </div>
    </nav>
  );
}
