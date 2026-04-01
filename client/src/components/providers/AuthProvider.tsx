import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { withCsrfHeader } from "../../utils/csrf";
import { parseApiResponse, requestJson } from "../../utils/api";

export interface UserProfile {
  id: string;
  tenant_id: string;
  email: string;
  role: "student" | "tpo" | "admin";
  full_name: string;
  is_active: boolean;
  must_change_password: boolean;
}

interface LocalSession {
  userId: string;
  email: string;
}

interface AuthContextValue {
  session: LocalSession | null;
  profile: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<string>;
  signup: (input: {
    email: string;
    password: string;
    fullName: string;
    tenantSlug: string;
    branch: string;
    batch: string;
    rollNumber: string;
  }) => Promise<string>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  initialPasswordReset: (newPassword: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function warmBackend() {
  void fetch("/api/v1/health", {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
  }).catch(() => {
    // Best-effort only.
  });
}

function prefetchForRole(role: UserProfile["role"]) {
  const run = () => {
    const routeImports: Array<Promise<unknown>> = [];
    const apiWarmups: string[] = ["/api/v1/auth/me"];

    if (role === "student") {
      routeImports.push(
        import("../../pages/student/DashboardPage"),
        import("../../pages/student/ResourcesPage"),
        import("../../pages/student/ProfilePage"),
      );
      apiWarmups.push(
        "/api/v1/students/me",
        "/api/v1/students/me/pilot-dashboard",
        "/api/v1/students/me/announcements?limit=5",
      );
    } else if (role === "tpo") {
      routeImports.push(
        import("../../pages/tpo/TpoDashboardPage"),
        import("../../pages/tpo/TpoStudentsPage"),
        import("../../pages/tpo/TpoDrivesPage"),
      );
      apiWarmups.push(
        "/api/v1/tpo/dashboard/control-center",
        "/api/v1/students?limit=25",
      );
    } else {
      routeImports.push(
        import("../../pages/admin/AdminHubPage"),
      );
      apiWarmups.push(
        "/api/v1/internal/admin-ops/tenants",
      );
    }

    void Promise.allSettled(routeImports);
    apiWarmups.forEach((url) => {
      void fetch(url, {
        credentials: "include",
        cache: "no-store",
      }).catch(() => {
        // Best-effort only.
      });
    });
  };

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (callback: () => void) => number }).requestIdleCallback(run);
    return;
  }

  setTimeout(run, 0);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    return await requestJson<T>(url, {
      method: "POST",
      headers: withCsrfHeader({ "Content-Type": "application/json" }),
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify(body),
    }, "Authentication API");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Authentication request timed out. Verify backend/network and try again.");
    }
    throw error instanceof Error ? error : new Error("Unable to reach authentication service. Check your internet/server connection.");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 4_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      credentials: "include",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/v1/auth/me");
      if (!response.ok) {
        setProfile(null);
        setSession(null);
        return;
      }

      const userProfile = await parseApiResponse<UserProfile>(response, "Authentication API");
      setProfile(userProfile);
      setSession({ userId: userProfile.id, email: userProfile.email });
    } catch {
      setProfile(null);
      setSession(null);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      await loadProfile();
      setIsLoading(false);
    };
    void bootstrap();
  }, [loadProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await postJson<{ profile: UserProfile; redirectTo: string; mustChangePassword: boolean }>(
      "/api/v1/auth/login",
      { email, password },
    );
    setProfile(result.profile);
    setSession({ userId: result.profile.id, email: result.profile.email });
    warmBackend();
    prefetchForRole(result.profile.role);
    return result.redirectTo;
  }, []);

  const signup = useCallback(
    async (input: {
      email: string;
      password: string;
      fullName: string;
      tenantSlug: string;
      branch: string;
      batch: string;
      rollNumber: string;
    }) => {
      const result = await postJson<{ profile: UserProfile; redirectTo: string; mustChangePassword: boolean }>(
        "/api/v1/auth/signup",
        input,
      );
      setProfile(result.profile);
      setSession({ userId: result.profile.id, email: result.profile.email });
      warmBackend();
      prefetchForRole(result.profile.role);
      return result.redirectTo;
    },
    [],
  );

  const logout = useCallback(async () => {
    const response = await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: withCsrfHeader(undefined),
      credentials: "include",
    });
    await parseApiResponse<{ message: string }>(response, "Authentication API");
    setProfile(null);
    setSession(null);
  }, []);

  const refreshSession = useCallback(async () => {
    await postJson<{ message: string }>("/api/v1/auth/refresh", {});
    await loadProfile();
  }, [loadProfile]);

  const initialPasswordReset = useCallback(async (newPassword: string) => {
    const result = await postJson<{ profile: UserProfile; redirectTo: string }>(
      "/api/v1/auth/password/initial-reset",
      { newPassword },
    );
    setProfile(result.profile);
    setSession({ userId: result.profile.id, email: result.profile.email });
    warmBackend();
    prefetchForRole(result.profile.role);
    return result.redirectTo;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, isLoading, login, signup, logout, refreshSession, initialPasswordReset }),
    [initialPasswordReset, isLoading, login, logout, profile, refreshSession, session, signup],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
