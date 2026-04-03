export type TpoWhatsNewEntry = {
  id: string;
  date: string;
  title: string;
  workflow: string;
  summary: string;
};

export const tpoWhatsNewEntries: TpoWhatsNewEntry[] = [
  {
    id: "ops-dashboard-upgrade",
    date: "2026-04-02",
    title: "Operations-first TPO dashboard",
    workflow: "Dashboard",
    summary: "The main TPO home now surfaces action queues, drive health, and intervention-first follow-up instead of a flat pilot summary.",
  },
  {
    id: "student-intervention-workspace",
    date: "2026-04-02",
    title: "Students page now supports intervention mode",
    workflow: "Students",
    summary: "Saved operational queues, bulk reminder handoff, and quick triage drawers make it easier to act on student readiness gaps.",
  },
  {
    id: "profile-readiness-upgrade",
    date: "2026-04-01",
    title: "Student profiles now show drive readiness",
    workflow: "Student profile",
    summary: "Students can see readiness states, live eligibility impact, structured preferences, and self-service unlock requests.",
  },
  {
    id: "guided-mock-tests",
    date: "2026-03-31",
    title: "Mock tests now support guided recovery and next steps",
    workflow: "Mock tests",
    summary: "Pending attempts recover more safely and results now push students toward a specific next action instead of a dead end.",
  },
  {
    id: "branch-aware-resources",
    date: "2026-03-30",
    title: "Branch-aware study layers for resources",
    workflow: "Resources",
    summary: "Resources now follow the same branch-first layered model so non-CS students do not land on a sparse or CS-heavy page first.",
  },
];
