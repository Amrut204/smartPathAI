import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { isClientFeatureEnabled } from "../../config/features";
import { Button } from "../ui";

type NavbarRole = "student" | "tpo";

interface NavLink {
  href: string;
  label: string;
}

const studentLinks: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/announcements", label: "Announcements" },
  { href: "/drives", label: "Drives" },
  { href: "/resources", label: "Resources" },
  { href: "/study-guides", label: "Study Guides" },
  { href: "/mock-tests", label: "Mock Tests" },
  { href: "/profile", label: "Profile" },
];

const tpoLinks: NavLink[] = [
  { href: "/tpo/dashboard", label: "Dashboard" },
  { href: "/tpo/students", label: "Students" },
  { href: "/tpo/drives", label: "Drives" },
  { href: "/tpo/reports", label: "Reports" },
  { href: "/tpo/communication", label: "Communication" },
];

const adminLinks: NavLink[] = [
  { href: "/admin/hub", label: "Admin Hub" },
];

interface NavbarProps {
  role: NavbarRole;
  title: string;
  userName: string;
  showAdminLinks?: boolean;
  studentProfileCompletionPct?: number | null;
  studentHasAnnouncementDot?: boolean;
  onLogout: () => void;
}

export function Navbar({
  role,
  title,
  userName,
  showAdminLinks = false,
  studentProfileCompletionPct = null,
  studentHasAnnouncementDot = false,
  onLogout,
}: NavbarProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = useMemo(() => {
    const baseLinks =
      role === "student"
        ? studentLinks
        : showAdminLinks
          ? adminLinks
          : tpoLinks;

    return baseLinks.filter((link) => {
      if (link.href === "/ai-assistant") return isClientFeatureEnabled("aiAssistant");
      if (link.href === "/career-lab") return isClientFeatureEnabled("careerLab");
      if (link.href === "/mastery") return isClientFeatureEnabled("mastery");
      if (link.href === "/vault") return isClientFeatureEnabled("vault");
      if (link.href === "/mentorship") return isClientFeatureEnabled("mentorship");
      if (link.href === "/wallet") return isClientFeatureEnabled("wallet");
      if (link.href === "/tpo/ops-hub") return isClientFeatureEnabled("opsHub");
      if (link.href === "/study-guides") return isClientFeatureEnabled("studyGuides");
      return true;
    });
  }, [role, showAdminLinks]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
              <span>{link.label}</span>
              {role === "student" && link.href === "/announcements" && studentHasAnnouncementDot ? (
                <span className="navbar-link-dot" aria-label="New announcements" />
              ) : null}
              {role === "student" && link.href === "/profile" && typeof studentProfileCompletionPct === "number" ? (
                <span className={`navbar-link-badge ${studentProfileCompletionPct >= 100 ? "complete" : ""}`.trim()}>
                  {studentProfileCompletionPct >= 100 ? "100%" : `${studentProfileCompletionPct}%`}
                </span>
              ) : null}
            </Link>
          );
        })}
        <div className="navbar-mobile-panel">
          <div className="navbar-mobile-user">
            <span className="ui-avatar">
              {userName.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{userName}</strong>
              <p>
                {role === "student"
                  ? "Student workspace"
                  : showAdminLinks
                    ? "Admin workspace"
                    : "TPO workspace"}
              </p>
            </div>
          </div>
          <Button variant="ghost" onClick={onLogout}>
            Logout
          </Button>
        </div>
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
