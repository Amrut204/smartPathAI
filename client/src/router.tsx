import { useEffect, useState, type FormEvent } from "react";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./components/providers/AuthProvider";
import { Navbar } from "./components/composites/Navbar";
import { Button, Input, Spinner } from "./components/ui";

// Public pages
import HomePage from "./pages/public/HomePage";
import LoginPage from "./pages/public/LoginPage";
import SignupPage from "./pages/public/SignupPage";

// Student pages
import DashboardPage from "./pages/student/DashboardPage";
import MockTestsPage from "./pages/student/MockTestsPage";
import MockTestDetailPage from "./pages/student/MockTestDetailPage";
import MockTestAttemptPage from "./pages/student/MockTestAttemptPage";
import MockTestResultsPage from "./pages/student/MockTestResultsPage";
import MasteryPage from "./pages/student/MasteryPage";
import PointsPage from "./pages/student/PointsPage";
import VaultPage from "./pages/student/VaultPage";
import VaultCompanyPage from "./pages/student/VaultCompanyPage";
import ResourcesPage from "./pages/student/ResourcesPage";
import AiAssistantPage from "./pages/student/AiAssistantPage";
import ProfilePage from "./pages/student/ProfilePage";

// TPO pages
import TpoDashboardPage from "./pages/tpo/TpoDashboardPage";
import TpoStudentsPage from "./pages/tpo/TpoStudentsPage";
import TpoStudentDetailPage from "./pages/tpo/TpoStudentDetailPage";
import TpoStudentUploadPage from "./pages/tpo/TpoStudentUploadPage";
import TpoDrivesPage from "./pages/tpo/TpoDrivesPage";
import TpoDriveCreatePage from "./pages/tpo/TpoDriveCreatePage";
import TpoDriveDetailPage from "./pages/tpo/TpoDriveDetailPage";
import TpoDriveResultsPage from "./pages/tpo/TpoDriveResultsPage";
import TpoAnalyticsPage from "./pages/tpo/TpoAnalyticsPage";
import TpoAnalyticsReadinessPage from "./pages/tpo/TpoAnalyticsReadinessPage";
import TpoAnalyticsTestsPage from "./pages/tpo/TpoAnalyticsTestsPage";
import TpoAnalyticsTopicsPage from "./pages/tpo/TpoAnalyticsTopicsPage";
import TpoAnalyticsPlacementPage from "./pages/tpo/TpoAnalyticsPlacementPage";
import TpoCommunicationPage from "./pages/tpo/TpoCommunicationPage";
import TpoCommunicationComposePage from "./pages/tpo/TpoCommunicationComposePage";

function AuthGuard({ allowedRoles }: { allowedRoles?: string[] }) {
  const { profile, isLoading } = useAuth();

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
    return <Navigate to={profile.role === "student" ? "/dashboard" : "/tpo/dashboard"} replace />;
  }

  return <Outlet />;
}

function PublicGuard() {
  const { profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <Spinner />
      </div>
    );
  }

  if (profile) {
    return <Navigate to={profile.role === "student" ? "/dashboard" : "/tpo/dashboard"} replace />;
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
          placeholder="Search a topic to start studying (e.g., SQL joins, DSA graphs, aptitude percentages)"
        />
        <Button type="submit">Search Topic</Button>
      </form>
    </div>
  );
}

function StudentLayout() {
  const { profile, logout } = useAuth();

  return (
    <div className="app-shell">
      <Navbar
        role="student"
        title="CampusDrive AI"
        userName={profile?.full_name ?? "Student"}
        onLogout={logout}
      />
      <StudentTopicSearchStrip />
      <main className="content-main">
        <Outlet />
      </main>
    </div>
  );
}

function TpoLayout() {
  const { profile, logout } = useAuth();

  return (
    <div className="app-shell">
      <Navbar
        role="tpo"
        title="CampusDrive AI"
        userName={profile?.full_name ?? "Admin"}
        onLogout={logout}
      />
      <main className="content-main">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  // Public routes
  {
    element: <PublicGuard />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/signup", element: <SignupPage /> },
    ],
  },

  // Student routes
  {
    element: <AuthGuard allowedRoles={["student"]} />,
    children: [
      {
        element: <StudentLayout />,
        children: [
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/mock-tests", element: <MockTestsPage /> },
          { path: "/mock-tests/:testId", element: <MockTestDetailPage /> },
          { path: "/mock-tests/:testId/attempt", element: <MockTestAttemptPage /> },
          { path: "/mock-tests/:testId/results", element: <MockTestResultsPage /> },
          { path: "/mastery", element: <MasteryPage /> },
          { path: "/points", element: <PointsPage /> },
          { path: "/vault", element: <VaultPage /> },
          { path: "/vault/:companyId", element: <VaultCompanyPage /> },
          { path: "/resources", element: <ResourcesPage /> },
          { path: "/ai-assistant", element: <AiAssistantPage /> },
          { path: "/profile", element: <ProfilePage /> },
        ],
      },
    ],
  },

  // TPO routes
  {
    element: <AuthGuard allowedRoles={["tpo", "admin"]} />,
    children: [
      {
        element: <TpoLayout />,
        children: [
          { path: "/tpo/dashboard", element: <TpoDashboardPage /> },
          { path: "/tpo/students", element: <TpoStudentsPage /> },
          { path: "/tpo/students/upload", element: <TpoStudentUploadPage /> },
          { path: "/tpo/students/:studentId", element: <TpoStudentDetailPage /> },
          { path: "/tpo/drives", element: <TpoDrivesPage /> },
          { path: "/tpo/drives/create", element: <TpoDriveCreatePage /> },
          { path: "/tpo/drives/:driveId", element: <TpoDriveDetailPage /> },
          { path: "/tpo/drives/:driveId/results", element: <TpoDriveResultsPage /> },
          { path: "/tpo/analytics", element: <TpoAnalyticsPage /> },
          { path: "/tpo/analytics/readiness", element: <TpoAnalyticsReadinessPage /> },
          { path: "/tpo/analytics/tests", element: <TpoAnalyticsTestsPage /> },
          { path: "/tpo/analytics/topics", element: <TpoAnalyticsTopicsPage /> },
          { path: "/tpo/analytics/placement", element: <TpoAnalyticsPlacementPage /> },
          { path: "/tpo/communication", element: <TpoCommunicationPage /> },
          { path: "/tpo/communication/compose", element: <TpoCommunicationComposePage /> },
        ],
      },
    ],
  },

  // Fallback
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
