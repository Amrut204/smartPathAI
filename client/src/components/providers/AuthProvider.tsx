import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export interface UserProfile {
  id: string;
  tenant_id: string;
  email: string;
  role: "student" | "tpo" | "admin";
  full_name: string;
  is_active: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { message: string; details?: Array<{ message: string }> };
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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function parseApiResponse<T>(response: Response): Promise<T> {
  let payload: ApiResponse<T> | null = null;

  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error("Unexpected response from server");
  }

  if (!response.ok || !payload.success) {
    const message =
      payload && !payload.success && payload.error?.message
        ? payload.error.message
        : `Request failed with status ${response.status}`;
    const detailMessage =
      payload && !payload.success && payload.error?.details?.length
        ? payload.error.details.map((detail) => detail.message).join(", ")
        : "";

    throw new Error(detailMessage ? `${message}: ${detailMessage}` : message);
  }

  return payload.data;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Authentication request timed out. Verify backend/network and try again.");
    }
    throw new Error("Unable to reach authentication service. Check your internet/server connection.");
  } finally {
    clearTimeout(timeoutId);
  }

  return parseApiResponse<T>(response);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (!response.ok) {
        setProfile(null);
        return;
      }

      const userProfile = await parseApiResponse<UserProfile>(response);
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
    const result = await postJson<{ profile: UserProfile; redirectTo: string }>(
      "/api/v1/auth/login",
      { email, password },
    );
    setProfile(result.profile);
    setSession({ userId: result.profile.id, email: result.profile.email });
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
      const result = await postJson<{ profile: UserProfile; redirectTo: string }>(
        "/api/v1/auth/signup",
        input,
      );
      setProfile(result.profile);
      setSession({ userId: result.profile.id, email: result.profile.email });
      return result.redirectTo;
    },
    [],
  );

  const logout = useCallback(async () => {
    const response = await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    await parseApiResponse<{ message: string }>(response);
    setProfile(null);
    setSession(null);
  }, []);

  const refreshSession = useCallback(async () => {
    await postJson<{ message: string }>("/api/v1/auth/refresh", {});
    await loadProfile();
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, isLoading, login, signup, logout, refreshSession }),
    [isLoading, login, logout, profile, refreshSession, session, signup],
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
