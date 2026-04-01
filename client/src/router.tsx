import { Suspense, lazy, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate } from "react-router-dom";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { Navbar } from "./components/composites/Navbar";
import { StudentFooter } from "./components/composites/StudentFooter";
import { useAuth } from "./components/providers/AuthProvider";
import { useStudentProfile } from "./hooks/use-student-profile";
import { Button, Input, Spinner } from "./components/ui";

const HomePage = lazy(() => import("./pages/public/HomePage"));
const LoginPage = lazy(() => import("./pages/public/LoginPage"));
const InitialPasswordResetPage = lazy(() => import("./pages/public/InitialPasswordResetPage"));
const SignupPage = lazy(() => import("./pages/public/SignupPage"));
const UnsubscribePage = lazy(() => import("./pages/public/UnsubscribePage"));
const ResourceUsagePolicyPage = lazy(() => import("./pages/public/ResourceUsagePolicyPage"));
const DashboardPage = lazy(() => import("./pages/student/DashboardPage"));
const StudentOnboardingDeclarationPage = lazy(() => import("./pages/student/StudentOnboardingDeclarationPage"));
const AnnouncementsPage = lazy(() => import("./pages/student/AnnouncementsPage"));
const DrivesPage = lazy(() => import("./pages/student/DrivesPage"));
const MockTestsPage = lazy(() => import("./pages/student/MockTestsPage"));
const MockTestDetailPage = lazy(() => import("./pages/student/MockTestDetailPage"));
const MockTestAttemptPage = lazy(() => import("./pages/student/MockTestAttemptPage"));
const MockTestResultsPage = lazy(() => import("./pages/student/MockTestResultsPage"));
const ResourcesPage = lazy(() => import("./pages/student/ResourcesPage"));
const ResourceViewerPage = lazy(() => import("./pages/student/ResourceViewerPage"));
const ProfilePage = lazy(() => import("./pages/student/ProfilePage"));
const SupportPage = lazy(() => import("./pages/student/SupportPage"));
const AdminHubPage = lazy(() => import("./pages/admin/AdminHubPage"));
const TpoDashboardPage = lazy(() => import("./pages/tpo/TpoDashboardPage"));
const TpoStudentsPage = lazy(() => import("./pages/tpo/TpoStudentsPage"));
const TpoStudentUploadPage = lazy(() => import("./pages/tpo/TpoStudentUploadPage"));
const TpoStudentDetailPage = lazy(() => import("./pages/tpo/TpoStudentDetailPage"));
const TpoDrivesPage = lazy(() => import("./pages/tpo/TpoDrivesPage"));
const TpoDriveCreatePage = lazy(() => import("./pages/tpo/TpoDriveCreatePage"));
const TpoDriveDetailPage = lazy(() => import("./pages/tpo/TpoDriveDetailPage"));
const TpoDriveResultsPage = lazy(() => import("./pages/tpo/TpoDriveResultsPage"));
const TpoEligibleNotAppliedPage = lazy(() => import("./pages/tpo/TpoEligibleNotAppliedPage"));
const TpoReportsPage = lazy(() => import("./pages/tpo/TpoReportsPage"));
const TpoCommunicationPage = lazy(() => import("./pages/tpo/TpoCommunicationPage"));
const TpoCommunicationComposePage = lazy(() => import("./pages/tpo/TpoCommunicationComposePage"));

function renderRoute(node: ReactNode) {
  return (
    <Suspense
      fallback={
        <div style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
          <Spinner />
        </div>
      }
    >
      {node}
    </Suspense>
  );
}

function resolveHomePath(role: string) {
  if (role === "admin") return "/admin/hub";
  if (role === "tpo") return "/tpo/dashboard";
  return "/dashboard";
}

function AuthGuard({ allowedRoles }: { allowedRoles?: string[] }) {
  const { profile, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <Spinner />
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={resolveHomePath(profile.role)} replace />;
  }

  if (profile.must_change_password && location.pathname !== "/password/setup") {
    return <Navigate to="/password/setup" replace />;
  }

  if (!profile.must_change_password && location.pathname === "/password/setup") {
    return <Navigate to={resolveHomePath(profile.role)} replace />;
  }

  return <Outlet />;
}

function PublicGuard() {
  const { profile, isLoading } = useAuth();

  // Don't block public pages while checking auth — show content immediately.
  // If the user turns out to be logged in, redirect them then.
  if (!isLoading && profile) {
    if (profile.must_change_password) {
      return <Navigate to="/password/setup" replace />;
    }
    return <Navigate to={resolveHomePath(profile.role)} replace />;
  }

  return <Outlet />;
}

function StudentTopicSearchStrip() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (location.pathname !== "/resources") {
      return;
    }
    const params = new URLSearchParams(location.search);
    setQuery(params.get("topic") ?? "");
  }, [location.pathname, location.search]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      navigate("/resources");
      return;
    }
    navigate(`/resources?topic=${encodeURIComponent(value)}`);
  };

  return (
    <div className="student-topic-search">
      <form className="student-topic-search-form" onSubmit={onSubmit}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a topic to start studying"
        />
        <Button type="submit">Search Topic</Button>
      </form>
    </div>
  );
}

function StudentLayout() {
  const { profile, logout } = useAuth();
  const { data: studentProfile } = useStudentProfile();

  return (
    <div className="app-shell app-shell-with-strip">
      <Navbar
        role="student"
        userName={profile?.full_name ?? "Student"}
        studentProfileCompletionPct={studentProfile?.profileCompleteness.pct ?? null}
        studentHasAnnouncementDot={false}
        onLogout={logout}
      />
      <StudentTopicSearchStrip />
      <main className="content-main">
        <ErrorBoundary fallbackTitle="This page encountered an error">
          <Outlet />
        </ErrorBoundary>
      </main>
      <StudentFooter />
    </div>
  );
}

function StudentDeclarationGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useStudentProfile();

  if (isLoading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return children;
  }

  const declarationPath = "/declaration/onboarding";
  const requiresDeclaration = data.declarationStatus.onboarding.required;

  if (requiresDeclaration && location.pathname !== declarationPath) {
    return <Navigate to={declarationPath} replace />;
  }

  if (!requiresDeclaration && location.pathname === declarationPath) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function StudentCompletionGuard({ children, module }: { children: ReactNode; module: "resources" | "mock-tests" }) {
  const location = useLocation();
  const { data, isLoading } = useStudentProfile();

  if (isLoading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return children;
  }

  const canAccess = module === "resources" ? data.canAccessResources : data.canAccessMockTests;
  if (canAccess) {
    return children;
  }

  const params = new URLSearchParams();
  params.set("blocked", module);
  params.set("from", `${location.pathname}${location.search}`);
  return <Navigate to={`/profile?${params.toString()}`} replace />;
}

function TpoLayout() {
  const { profile, logout } = useAuth();

  return (
    <div className="app-shell">
      <Navbar
        role="tpo"
        userName={profile?.full_name ?? "Admin"}
        showAdminLinks={false}
        onLogout={logout}
      />
      <main className="content-main">
        <ErrorBoundary fallbackTitle="This page encountered an error">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

function AdminLayout() {
  const { profile, logout } = useAuth();

  return (
    <div className="app-shell">
      <Navbar
        role="tpo"
        userName={profile?.full_name ?? "Admin"}
        showAdminLinks
        onLogout={logout}
      />
      <main className="content-main">
        <ErrorBoundary fallbackTitle="This page encountered an error">
          <Outlet />
        </ErrorBoundary>
      </main>
      <StudentFooter showPolicy={false} />
    </div>
  );
}

function PasswordResetLayout() {
  return (
    <main className="content-main">
      <ErrorBoundary fallbackTitle="This page encountered an error">
        <Outlet />
      </ErrorBoundary>
    </main>
  );
}

const router = createBrowserRouter([
  {
    element: <PublicGuard />,
    children: [
      { path: "/", element: renderRoute(<HomePage />) },
      { path: "/login", element: renderRoute(<LoginPage />) },
      { path: "/signup", element: renderRoute(<SignupPage />) },
      { path: "/unsubscribe", element: renderRoute(<UnsubscribePage />) },
    ],
  },
  {
    element: <AuthGuard allowedRoles={["student", "tpo", "admin"]} />,
    children: [
      {
        element: <PasswordResetLayout />,
        children: [
          { path: "/password/setup", element: renderRoute(<InitialPasswordResetPage />) },
        ],
      },
    ],
  },
  {
    element: <AuthGuard allowedRoles={["student"]} />,
    children: [
      {
        element: <StudentLayout />,
        children: [
          { path: "/declaration/onboarding", element: renderRoute(<StudentDeclarationGuard><StudentOnboardingDeclarationPage /></StudentDeclarationGuard>) },
          { path: "/dashboard", element: renderRoute(<StudentDeclarationGuard><DashboardPage /></StudentDeclarationGuard>) },
          { path: "/announcements", element: renderRoute(<StudentDeclarationGuard><AnnouncementsPage /></StudentDeclarationGuard>) },
          { path: "/drives", element: renderRoute(<StudentDeclarationGuard><DrivesPage /></StudentDeclarationGuard>) },
          { path: "/mock-tests", element: renderRoute(<StudentDeclarationGuard><StudentCompletionGuard module="mock-tests"><MockTestsPage /></StudentCompletionGuard></StudentDeclarationGuard>) },
          { path: "/mock-tests/:testId", element: renderRoute(<StudentDeclarationGuard><StudentCompletionGuard module="mock-tests"><MockTestDetailPage /></StudentCompletionGuard></StudentDeclarationGuard>) },
          { path: "/mock-tests/:testId/attempt", element: renderRoute(<StudentDeclarationGuard><StudentCompletionGuard module="mock-tests"><MockTestAttemptPage /></StudentCompletionGuard></StudentDeclarationGuard>) },
          { path: "/mock-tests/:testId/results", element: renderRoute(<StudentDeclarationGuard><MockTestResultsPage /></StudentDeclarationGuard>) },
          { path: "/resources", element: renderRoute(<StudentDeclarationGuard><StudentCompletionGuard module="resources"><ResourcesPage /></StudentCompletionGuard></StudentDeclarationGuard>) },
          { path: "/resources/view/:resourceId", element: renderRoute(<StudentDeclarationGuard><StudentCompletionGuard module="resources"><ResourceViewerPage /></StudentCompletionGuard></StudentDeclarationGuard>) },
          { path: "/study-guides", element: <Navigate to="/resources" replace /> },
          { path: "/study-guides/:slug", element: <Navigate to="/resources" replace /> },
          { path: "/profile", element: renderRoute(<StudentDeclarationGuard><ProfilePage /></StudentDeclarationGuard>) },
          { path: "/support", element: renderRoute(<StudentDeclarationGuard><SupportPage /></StudentDeclarationGuard>) },
        ],
      },
    ],
  },
  {
    element: <AuthGuard allowedRoles={["tpo"]} />,
    children: [
      {
        element: <TpoLayout />,
        children: [
          { path: "/tpo/dashboard", element: renderRoute(<TpoDashboardPage />) },
          { path: "/tpo/students", element: renderRoute(<TpoStudentsPage />) },
          { path: "/tpo/students/upload", element: renderRoute(<TpoStudentUploadPage />) },
          { path: "/tpo/students/:studentId", element: renderRoute(<TpoStudentDetailPage />) },
          { path: "/tpo/drives", element: renderRoute(<TpoDrivesPage />) },
          { path: "/tpo/interventions/eligible-not-applied", element: renderRoute(<TpoEligibleNotAppliedPage />) },
          { path: "/tpo/drives/create", element: renderRoute(<TpoDriveCreatePage />) },
          { path: "/tpo/drives/:driveId", element: renderRoute(<TpoDriveDetailPage />) },
          { path: "/tpo/drives/:driveId/results", element: renderRoute(<TpoDriveResultsPage />) },
          { path: "/tpo/analytics", element: <Navigate to="/tpo/reports" replace /> },
          { path: "/tpo/reports", element: renderRoute(<TpoReportsPage />) },
          { path: "/tpo/analytics/readiness", element: <Navigate to="/tpo/reports" replace /> },
          { path: "/tpo/analytics/topics", element: <Navigate to="/tpo/reports" replace /> },
          { path: "/tpo/analytics/tests", element: <Navigate to="/tpo/reports" replace /> },
          { path: "/tpo/analytics/placement", element: <Navigate to="/tpo/reports" replace /> },
          { path: "/tpo/communication", element: renderRoute(<TpoCommunicationPage />) },
          { path: "/tpo/communication/compose", element: renderRoute(<TpoCommunicationComposePage />) },
        ],
      },
    ],
  },
  {
    element: <AuthGuard allowedRoles={["admin"]} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: "/admin/hub", element: renderRoute(<AdminHubPage />) },
        ],
      },
      {
        element: <AdminLayout />,
        children: [
          { path: "/tpo/internal/demo-feedback", element: <Navigate to="/tpo/dashboard" replace /> },
          { path: "/tpo/internal/demo-analytics", element: <Navigate to="/tpo/dashboard" replace /> },
          { path: "/tpo/sales/pipeline", element: <Navigate to="/tpo/dashboard" replace /> },
          { path: "/tpo/sales/analytics", element: <Navigate to="/tpo/dashboard" replace /> },
          { path: "/tpo/sales/pipeline/:pipelineId", element: <Navigate to="/tpo/dashboard" replace /> },
        ],
      },
    ],
  },
  { path: "/resource-usage-policy", element: renderRoute(<ResourceUsagePolicyPage />) },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
