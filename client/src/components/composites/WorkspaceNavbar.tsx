import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { pilotFeedbackLinks } from "../../config/pilot-feedback";
import { Button } from "../ui";

type NavbarRole = "student" | "tpo" | "admin";

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

const tpoDesktopLinks: NavLink[] = [
  { href: "/tpo/dashboard", label: "Dashboard" },
  { href: "/tpo/students", label: "Students" },
  { href: "/tpo/drives", label: "Drives" },
  { href: "/tpo/reports", label: "Reports" },
  { href: "/tpo/communication", label: "Communication" },
];

const adminDesktopLinks: NavLink[] = [
  { href: "/admin/hub", label: "Admin Hub" },
];

interface WorkspaceNavbarProps {
  role: NavbarRole;
  title: string;
  userName: string;
  studentProfileCompletionPct?: number | null;
  studentHasAnnouncementDot?: boolean;
  studentCanAccessResources?: boolean | null;
  studentCanAccessMockTests?: boolean | null;
  onLogout: () => void;
}

export function WorkspaceNavbar({
  role,
  title,
  userName,
  studentProfileCompletionPct = null,
  studentHasAnnouncementDot = false,
  studentCanAccessResources = null,
  studentCanAccessMockTests = null,
  onLogout,
}: WorkspaceNavbarProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  const desktopLinks = useMemo(() => {
    if (role === "student") return studentDesktopLinks;
    if (role === "admin") return adminDesktopLinks;
    return tpoDesktopLinks;
  }, [role]);

  useEffect(() => {
    setMenuOpen(false);
    setSupportOpen(false);
  }, [location.pathname]);

  const showFeedbackButton = Boolean(pilotFeedbackLinks.googleFormUrl);
  const showSupportButton = Boolean(pilotFeedbackLinks.whatsappUrl || pilotFeedbackLinks.supportEmailHref);

  const isLinkActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);

  return (
    <nav className={`navbar ${menuOpen ? "menu-open" : ""}`.trim()}>
      <div className="navbar-brand-wrap">
        <div className="navbar-brand">{title}</div>
        <span className="navbar-workspace-label">
          {role === "student" ? "Student workspace" : role === "admin" ? "Admin workspace" : "TPO workspace"}
        </span>
      </div>

      <button
        className="navbar-toggle"
        onClick={() => setMenuOpen((value) => !value)}
        aria-label="Toggle navigation"
      >
        {menuOpen ? "\u2715" : "\u2630"}
      </button>

      {menuOpen ? (
        <button
          type="button"
          className="navbar-drawer-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className={`navbar-nav ${menuOpen ? "open" : ""}`.trim()}>
        {desktopLinks.map((link) => {
          const isResourcesLocked = role === "student" && link.href === "/resources" && studentCanAccessResources === false;
          const isMockTestsLocked = role === "student" && link.href === "/mock-tests" && studentCanAccessMockTests === false;
          const isLockedLink = isResourcesLocked || isMockTestsLocked;
          const lockedModule = isResourcesLocked ? "resources" : isMockTestsLocked ? "mock-tests" : null;
          const targetHref = isLockedLink && lockedModule
            ? `/profile?blocked=${lockedModule}&from=${encodeURIComponent(link.href)}`
            : link.href;
          const isActive = isLinkActive(link.href);
          return (
            <Link
              key={link.href}
              to={targetHref}
              className={`navbar-link ${isActive ? "active" : ""} ${isLockedLink ? "locked" : ""}`.trim()}
              onClick={() => setMenuOpen(false)}
              aria-disabled={isLockedLink}
              title={isLockedLink ? "Complete required profile fields to unlock this section." : undefined}
            >
              <span>{link.label}</span>
              {isLockedLink ? <span className="navbar-link-badge locked">Locked</span> : null}
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
          <div className="navbar-mobile-support">
            {showFeedbackButton ? (
              <a
                className="navbar-utility-link"
                href={pilotFeedbackLinks.googleFormUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
              >
                Feedback Form
              </a>
            ) : null}
            {showSupportButton ? (
              <div className="navbar-mobile-support-menu">
                <button
                  type="button"
                  className="navbar-utility-button"
                  onClick={() => setSupportOpen((value) => !value)}
                >
                  Support
                </button>
                {supportOpen ? (
                  <div className="navbar-support-menu navbar-support-menu-mobile">
                    {pilotFeedbackLinks.whatsappUrl ? (
                      <a href={pilotFeedbackLinks.whatsappUrl} target="_blank" rel="noreferrer">
                        WhatsApp Support
                      </a>
                    ) : null}
                    {pilotFeedbackLinks.supportEmailHref ? (
                      <a href={pilotFeedbackLinks.supportEmailHref}>
                        Email Support
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="navbar-mobile-user">
            <span className="ui-avatar">{userName.charAt(0).toUpperCase()}</span>
            <div>
              <strong>{userName}</strong>
              <p>{role === "student" ? "Student workspace" : role === "admin" ? "Admin workspace" : "TPO workspace"}</p>
            </div>
          </div>
          <Button variant="ghost" onClick={onLogout}>
            Logout
          </Button>
        </div>
      </div>

      <div className="navbar-actions">
        {showFeedbackButton ? (
          <a
            className="navbar-utility-link"
            href={pilotFeedbackLinks.googleFormUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            Feedback Form
          </a>
        ) : null}
        {showSupportButton ? (
          <div className="navbar-support">
            <button
              type="button"
              className="navbar-utility-button"
              onClick={() => setSupportOpen((value) => !value)}
              aria-expanded={supportOpen}
            >
              Support
            </button>
            {supportOpen ? (
              <div className="navbar-support-menu">
                {pilotFeedbackLinks.whatsappUrl ? (
                  <a href={pilotFeedbackLinks.whatsappUrl} target="_blank" rel="noreferrer">
                    WhatsApp Support
                  </a>
                ) : null}
                {pilotFeedbackLinks.supportEmailHref ? (
                  <a href={pilotFeedbackLinks.supportEmailHref}>
                    Email Support
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <span className="ui-avatar">{userName.charAt(0).toUpperCase()}</span>
        <span className="navbar-user">{userName}</span>
        <Button variant="ghost" onClick={onLogout}>
          Logout
        </Button>
      </div>
    </nav>
  );
}
