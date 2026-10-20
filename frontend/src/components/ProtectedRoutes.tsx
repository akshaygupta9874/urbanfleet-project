import { useEffect, useState } from "react";
import LoadingScreen from "./LoadingScreen";
import { useAuthContext } from "../context/auth-context";
import { Navigate, Outlet } from "react-router-dom";
import UnauthorizedPage from "./UnauthorizedPage";
import { fetchDriverProfile } from "../lib/driverApi";

export type UserRole = "RIDER" | "DRIVER" | "ADMIN";

export const ProtectedRoutes = ({
  allowedroles,
}: {
  allowedroles: UserRole[];
}) => {
  const { user, isAuthenticated, loading } = useAuthContext();
  const [isVerifyingDriver, setIsVerifyingDriver] = useState(false);
  const [hasVerifiedDriverProfile, setHasVerifiedDriverProfile] = useState<boolean | null>(() => {
    const cached = sessionStorage.getItem("isDriverVerified");
    return cached === "true" ? true : cached === "false" ? false : null;
  });

  const rawRoles = (user?.roles ?? []) as UserRole[];
  const userRoles: UserRole[] = [...rawRoles];

  // Core Rule: A driver is ALWAYS a rider as well
  if (userRoles.includes("DRIVER") && !userRoles.includes("RIDER")) {
    userRoles.push("RIDER");
  }

  // If driver verification was cached or user already has DRIVER role
  const isDriver = userRoles.includes("DRIVER") || hasVerifiedDriverProfile === true;
  if (isDriver && !userRoles.includes("DRIVER")) {
    userRoles.push("DRIVER");
  }

  // If this route specifically requires DRIVER and user only has RIDER role,
  // do a quick check against driver profile to verify driver registration status.
  useEffect(() => {
    let cancelled = false;
    if (
      isAuthenticated &&
      allowedroles.includes("DRIVER") &&
      !userRoles.includes("DRIVER") &&
      hasVerifiedDriverProfile === null
    ) {
      setIsVerifyingDriver(true);
      fetchDriverProfile()
        .then((profile) => {
          if (cancelled) return;
          const verified =
            Boolean(profile?.isVerified) ||
            profile?.verificationStatus === "APPROVED" ||
            profile?.verificationStatus === "VERIFIED";
          setHasVerifiedDriverProfile(verified);
          sessionStorage.setItem("isDriverVerified", verified ? "true" : "false");
        })
        .catch(() => {
          if (cancelled) return;
          setHasVerifiedDriverProfile(false);
          sessionStorage.setItem("isDriverVerified", "false");
        })
        .finally(() => {
          if (!cancelled) setIsVerifyingDriver(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, allowedroles, userRoles, hasVerifiedDriverProfile]);

  if (loading || isVerifyingDriver) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (
    allowedroles.length > 0 &&
    (!userRoles.length ||
      !userRoles.some((role: UserRole) => allowedroles.includes(role)))
  ) {
    return <UnauthorizedPage />;
  }

  return <Outlet />;
};
