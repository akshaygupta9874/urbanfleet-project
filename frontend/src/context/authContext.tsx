import {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import api, { clearAccessToken, setAccessToken } from "../apiInterceptor";
import { AuthContext } from "./auth-context";

type UserRole = "RIDER" | "DRIVER" | "ADMIN";

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: UserRole[];
}

export interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  loading: boolean;
  checkAuthentication: () => Promise<void>;
  establishSession: (accessToken: string, user: User) => void;
  logout: () => Promise<void>;
}

async function requestAuthentication(): Promise<{ accessToken: string; user: User } | null> {
  try {
    const response = await api.post<{ accessToken?: unknown; user?: Partial<User> & Record<string, unknown> }>("/refresh");
    const accessToken = response.data.accessToken;
    const rawUser = response.data.user;
    if (typeof accessToken !== "string" || !rawUser || typeof rawUser !== "object") {
      return null;
    }
    const roles: UserRole[] = Array.isArray(rawUser.roles)
      ? (rawUser.roles as UserRole[])
      : ["RIDER"];
    const firstName = (rawUser.firstName as string) || "";
    const lastName = (rawUser.lastName as string) || "";
    const id = (rawUser.id as string) || "";
    const email = (rawUser.email as string) || "";
    const normalizedUser: User = {
      id,
      email,
      firstName,
      lastName,
      roles,
    };
    return { accessToken, user: normalizedUser };
  } catch {
    return null;
  }
}

export const AuthContextProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuthentication = useCallback(async () => {
    setLoading(true);

    const session = await requestAuthentication();
    if (session) {
      setAccessToken(session.accessToken);
      setUser(session.user);
      setIsAuthenticated(true);
    } else {
      clearAccessToken();
      setUser(null);
      setIsAuthenticated(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestAuthentication().then((session) => {
      if (cancelled) return;
      if (session) {
        setAccessToken(session.accessToken);
        setUser(session.user);
        setIsAuthenticated(true);
      } else {
        clearAccessToken();
        setUser(null);
        setIsAuthenticated(false);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const establishSession = useCallback((accessToken: string, authenticatedUser: User) => {
    const roles: UserRole[] = Array.isArray(authenticatedUser.roles)
      ? authenticatedUser.roles
      : ["RIDER"];
    const firstName = authenticatedUser.firstName || "";
    const lastName = authenticatedUser.lastName || "";
    const id = authenticatedUser.id || "";
    const email = authenticatedUser.email || "";
    const normalizedUser: User = {
      id,
      email,
      firstName,
      lastName,
      roles,
    };
    setAccessToken(accessToken);
    setUser(normalizedUser);
    setIsAuthenticated(true);
    setLoading(false);
  }, []);

  const logout = async () => {
    setLoading(true);

    try {
      await api.post("/logout");
    } catch {
      // A stale CSRF cookie should not leave a server session alive. Refresh
      // once to receive a new CSRF cookie, then retry the authenticated logout.
      try {
        await api.post("/refresh");
        await api.post("/logout");
      } catch {
        // Client credentials are still cleared below. The next protected API
        // response cannot restore this client-side auth state.
      }
    } finally {
      clearAccessToken();
      setUser(null);
      setIsAuthenticated(false);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        loading,
        checkAuthentication,
        establishSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
