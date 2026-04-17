import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../ui";

type NavbarRole = "student" | "tpo";

interface NavLink {
  href: string;
  label: string;
}

const studentDesktopLinks: NavLink[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/announcements", label: "Announcements" },
  { href: "/drives", label: "Drives" },
  { href: "/resources", label: "Resources" },
  { href: "/mock-tests", label: "Tests" },
  { href: "/profile", label: "Profile" },
];

const studentMobileLinks: NavLink[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/drives", label: "Drives" },
  { href: "/mock-tests", label: "Tests" },
  { href: "/resources", label: "Resources" },
  { href: "/profile", label: "Profile" },
];

const tpoDesktopLinks: NavLink[] = [
  { href: "/tpo/dashboard", label: "Dashboard" },
  { href: "/tpo/students", label: "Students" },
  { href: "/tpo/drives", label: "Drives" },
  { href: "/tpo/reports", label: "Reports" },
  { href: "/tpo/communication", label: "Communication" },
];

const tpoMobileLinks: NavLink[] = [
  { href: "/tpo/dashboard", label: "Dashboard" },
  { href: "/tpo/students", label: "Students" },
  { href: "/tpo/drives", label: "Drives" },
  { href: "/tpo/reports", label: "Reports" },
  { href: "/tpo/communication", label: "Comms" },
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

  const desktopLinks = useMemo(() => {
    return role === "student"
      ? studentDesktopLinks
      : showAdminLinks
        ? [...tpoDesktopLinks]
        : tpoDesktopLinks;
  }, [role, showAdminLinks]);

  const mobileLinks = role === "student" ? studentMobileLinks : tpoMobileLinks;

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isLinkActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);

  return (
    <nav className="navbar">
      <div className="navbar-brand-wrap">
        <div className="navbar-brand">{title}</div>
        <span className="navbar-workspace-label">
          {role === "student" ? "Student workspace" : showAdminLinks ? "Admin workspace" : "TPO workspace"}
        </span>
      </div>

      <button
        className="navbar-toggle"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        {menuOpen ? "\u2715" : "\u2630"}
      </button>

      <div className={`navbar-nav ${menuOpen ? "open" : ""}`.trim()}>
        {desktopLinks.map((link) => {
          const isActive = isLinkActive(link.href);
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

      <div className="navbar-bottom-nav" aria-label={`${role} mobile navigation`}>
        {mobileLinks.map((link) => {
          const isActive = isLinkActive(link.href);
          return (
            <Link
              key={link.href}
              to={link.href}
              className={`navbar-bottom-link ${isActive ? "active" : ""}`.trim()}
            >
              <span>{link.label}</span>
              {role === "student" && link.href === "/profile" && typeof studentProfileCompletionPct === "number" ? (
                <small>{studentProfileCompletionPct >= 100 ? "Ready" : `${studentProfileCompletionPct}%`}</small>
              ) : null}
              {role === "student" && link.href === "/dashboard" && studentHasAnnouncementDot ? (
                <span className="navbar-link-dot navbar-bottom-dot" aria-label="New announcements" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
