import { Link, useLocation } from "react-router-dom";
import { useMemo, useState } from "react";

import { Button } from "../ui";

type SidebarRole = "student" | "tpo";

interface SidebarLink {
  href: string;
  label: string;
}

const studentLinks: SidebarLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ai-assistant", label: "AI Assistant" },
  { href: "/resources", label: "Resources" },
  { href: "/mock-tests", label: "Mock Tests" },
  { href: "/mastery", label: "Topic Mastery" },
  { href: "/vault", label: "Company Specific" },
  { href: "/profile", label: "Profile" },
];

const tpoLinks: SidebarLink[] = [
  { href: "/tpo/dashboard", label: "Dashboard" },
  { href: "/tpo/students", label: "Students" },
  { href: "/tpo/drives", label: "Drives" },
  { href: "/tpo/analytics", label: "Analytics" },
  { href: "/tpo/communication", label: "Communication" },
];

interface SidebarProps {
  role: SidebarRole;
  title: string;
}

export function Sidebar({ role, title }: SidebarProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const links = useMemo(() => (role === "student" ? studentLinks : tpoLinks), [role]);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`.trim()}>
      <div>
        <div className="sidebar-toggle">
          <Button variant="ghost" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? "Open" : "Close"}
          </Button>
        </div>
        <div className="sidebar-brand">{title}</div>
      </div>

      <nav className="sidebar-nav" aria-label={`${role} navigation`}>
        {links.map((link) => {
          const isActive =
            location.pathname === link.href ||
            location.pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              to={link.href}
              className={`sidebar-link ${isActive ? "active" : ""}`.trim()}
            >
              <span className="sidebar-label">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <small>{role === "student" ? "AI Assistant available" : "Ctrl+K command palette"}</small>
      </div>
    </aside>
  );
}
