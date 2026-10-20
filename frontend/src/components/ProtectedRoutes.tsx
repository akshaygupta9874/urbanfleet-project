import { useEffect, useState } from "react";
import LoadingScreen from "./LoadingScreen";
import { useAuthContext } from "../context/auth-context";
import { Navigate, Outlet } from "react-router-dom";
import UnauthorizedPage from "./UnauthorizedPage";
import { fetchDriverProfile, isDriverApproved } from "../lib/driverApi";
import { refreshAccessToken } from "../apiInterceptor";

export type UserRole = "RIDER" | "DRIVER" | "ADMIN";

export const ProtectedRoutes = ({
  allowedroles,
}: {
  allowedroles: UserRole[];
}) => {
  const { user, isAuthenticated, loading } = useAuthContext();
  const [driverVerification, setDriverVerification] = useState<{
    userId: string;
    approved: boolean;
  } | null>(null);
  const requiresVerifiedDriver =
    allowedroles.length === 1 && allowedroles[0] === "DRIVER";
  const userId = user?.id;
  const hasVerifiedDriverProfile =
    driverVerification && driverVerification.userId === userId
      ? driverVerification.approved
      : null;

  const rawRoles = (user?.roles ?? []) as UserRole[];
  const userRoles: UserRole[] = rawRoles;

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated || !requiresVerifiedDriver || !userId) {
      return () => {
        cancelled = true;
      };
    }

    void fetchDriverProfile()
      .then(async (profile) => {
        if (isDriverApproved(profile)) {
          await refreshAccessToken();
          if (cancelled) return;
          setDriverVerification({
            userId,
            approved: true,
          });
          return;
        }
        if (!cancelled) setDriverVerification({ userId, approved: false });
      })
      .catch(() => {
        if (!cancelled) setDriverVerification({ userId, approved: false });
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, requiresVerifiedDriver, userId]);

  if (
    loading ||
    (isAuthenticated && requiresVerifiedDriver && hasVerifiedDriverProfile === null)
  ) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiresVerifiedDriver && hasVerifiedDriverProfile === false) {
    return <UnauthorizedPage />;
  }

  const hasAllowedRole =
    userRoles.some((role: UserRole) => allowedroles.includes(role)) ||
    (requiresVerifiedDriver && hasVerifiedDriverProfile === true);

  if (
    allowedroles.length > 0 &&
    (!userRoles.length || !hasAllowedRole)
  ) {
    return <UnauthorizedPage />;
  }

  return <Outlet />;
};
