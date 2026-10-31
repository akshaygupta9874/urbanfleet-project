import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import LoadingScreen from "./LoadingScreen";
import { useAuthContext } from "../context/auth-context";
import UnauthorizedPage from "./UnauthorizedPage";
import { appApi } from "../lib/api";
import type { RideDto } from "../types/ride";

export type UserRole = "RIDER" | "DRIVER" | "ADMIN";

export const ProtectedRoutes = ({
  allowedroles,
}: {
  allowedroles: UserRole[];
}) => {
  const { user, isAuthenticated, loading } = useAuthContext();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const isRiderRoute =
      allowedroles.includes("RIDER") && location.pathname !== "/driver-dashboard";
    if (
      !isAuthenticated ||
      !isRiderRoute ||
      location.pathname.startsWith("/ride/")
    ) {
      return;
    }

    let cancelled = false;

    // 1. If user is a driver navigating to rider routes, check if they are actively driving
    if (user?.roles?.includes("DRIVER")) {
      appApi
        .get<{ success: boolean; data: RideDto }>("/ride/driver/current")
        .then((res) => {
          if (cancelled) return;
          const driverRide = res.data?.data;
          if (
            driverRide &&
            ["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "RIDE_STARTED", "ARRIVED_AT_DESTINATION"].includes(
              driverRide.status
            )
          ) {
            navigate("/driver-dashboard", { replace: true });
          }
        })
        .catch(() => {});
    }

    // 2. Check if user is in an active ride as a passenger/rider
    if (user?.roles?.includes("RIDER")) {
      appApi
        .get<{ success: boolean; data: RideDto }>("/ride/current")
        .then((res) => {
          if (cancelled) return;
          const ride = res.data?.data;
          if (
            ride &&
            ride.riderId === user?.id &&
            ride.status !== "COMPLETED" &&
            ride.status !== "CANCELLED"
          ) {
            navigate(`/ride/${ride.id}`, { replace: true });
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [location.pathname, isAuthenticated, user?.id, user?.roles, allowedroles, navigate]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const userRoles: UserRole[] = user?.roles ?? [];

  // Check if user has at least one of the allowed roles for this route
  const hasAllowedRole =
    allowedroles.length === 0 ||
    userRoles.some((role: UserRole) => allowedroles.includes(role));

  if (!hasAllowedRole) {
    if (userRoles.includes("DRIVER") && !userRoles.includes("RIDER")) {
      return <Navigate to="/driver-dashboard" replace />;
    }
    if (userRoles.includes("RIDER") && !userRoles.includes("DRIVER")) {
      return <Navigate to="/dashboard" replace />;
    }
    return <UnauthorizedPage />;
  }

  return <Outlet />;
};
