import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { useAuthContext } from "../context/auth-context";
import { ShieldAlert, Sparkles, Navigation } from "lucide-react";
import CityMapBackground from "./CityMapBackground";

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthContext();

  const isDriver = Boolean(user?.roles?.includes("DRIVER"));
  const isRider = Boolean(user?.roles?.includes("RIDER"));

  // Intelligent role-based primary destination
  let primaryRoute = "/login";
  let primaryLabel = "Sign In to UrbanFleet";

  if (isAuthenticated && user) {
    if (isDriver && !isRider) {
      primaryRoute = "/driver-dashboard";
      primaryLabel = "Go to Driver Dashboard";
    } else if (isRider) {
      primaryRoute = "/dashboard";
      primaryLabel = "Go to Passenger Dashboard";
    } else {
      primaryRoute = "/security-devices";
      primaryLabel = "Go to Account Security";
    }
  }

  // Safe back navigation preventing external navigation or dead ends for direct visitors
  const handleGoBack = () => {
    const hasHistory =
      typeof window !== "undefined" &&
      window.history.state &&
      typeof window.history.state.idx === "number" &&
      window.history.state.idx > 0;

    if (hasHistory) {
      navigate(-1);
    } else {
      navigate(primaryRoute, { replace: true });
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5e6c8] font-sans text-[#2e1808] px-6 py-10">
      <CityMapBackground />

      {/* Huge 403 Watermark */}
      <motion.h1
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.05 }}
        transition={{ duration: 1 }}
        className="pointer-events-none absolute text-[16rem] font-black tracking-tight text-[#3a1f0a] select-none"
      >
        403
      </motion.h1>

      <motion.section
        initial={{ opacity: 0, y: 25, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/90 via-[#fff4dc]/85 to-[#f7e2b8]/85 p-10 text-center shadow-[0_40px_100px_-24px_rgba(80,40,10,0.55),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-2xl"
      >
        {/* Perforation ticket-edge dots */}
        <div className="pointer-events-none absolute left-0 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={`pl-${i}`} className="h-2 w-2 rounded-full bg-[#f5e6c8]" />
          ))}
        </div>
        <div className="pointer-events-none absolute right-0 top-1/2 flex translate-x-1/2 -translate-y-1/2 flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={`pr-${i}`} className="h-2 w-2 rounded-full bg-[#f5e6c8]" />
          ))}
        </div>

        {/* Brass top rail */}
        <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

        {/* Badge */}
        <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)]">
          <Sparkles size={12} />
          Unauthorized Access
        </div>

        {/* Icon */}
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ repeat: Infinity, duration: 2.5 }}
          className="relative mx-auto mb-6 flex h-24 w-24 items-center justify-center"
        >
          {/* Ripple */}
          <div className="absolute h-full w-full rounded-full bg-[#b8722c]/30 animate-ping" />

          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-lg border border-[#c58a3a]/40">
            <ShieldAlert className="h-10 w-10 text-[#ffd88a]" />
          </div>
        </motion.div>

        <h2 className="text-3xl font-bold tracking-tight text-[#2e1808]">
          Access Denied
        </h2>

        <p className="mt-4 leading-7 text-[#6b3a12]/90 text-sm font-medium">
          Sorry, you don't have permission to access this page.
          <br />
          If you believe this is a mistake, please contact your administrator
          or sign in with an account that has the required permissions.
        </p>

        {/* Buttons */}
        <div className="mt-8 flex flex-col gap-3">
          <Link
            to={primaryRoute}
            className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-3.5 text-sm font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:translate-y-0"
          >
            <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
            <span className="relative z-10 inline-flex items-center justify-center gap-2">
              <Navigation size={15} className="text-[#ffd88a]" />
              {primaryLabel}
            </span>
          </Link>

          {isAuthenticated && !isDriver && (
            <Link
              to="/driver-registration"
              className="rounded-xl border border-[#c58a3a]/40 bg-[#fffaf0] py-3.5 text-sm font-semibold text-[#3a1f0a] shadow-sm transition-all hover:bg-[#fff4dc]"
            >
              Register as an UrbanFleet Driver
            </Link>
          )}

          {!isAuthenticated && (
            <Link
              to="/signup"
              className="rounded-xl border border-[#c58a3a]/40 bg-[#fffaf0] py-3.5 text-sm font-semibold text-[#3a1f0a] shadow-sm transition-all hover:bg-[#fff4dc]"
            >
              Create an UrbanFleet Account
            </Link>
          )}

          <button
            type="button"
            onClick={handleGoBack}
            className="rounded-xl border border-[#7a4416]/25 bg-[#fffaf0]/90 px-6 py-3.5 text-sm font-semibold text-[#3a1f0a] shadow-sm transition-all hover:bg-[#fff4dc] hover:border-[#b8722c]"
          >
            Go Back
          </button>

          <Link
            to="/"
            className="text-xs font-semibold uppercase tracking-wider text-[#6b3a12]/70 transition-colors hover:text-[#3a1f0a] pt-2"
          >
            Back to Home
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-8 border-t border-[#7a4416]/20 pt-5 text-xs text-[#6b3a12]/80">
          Error Code: <span className="font-semibold text-[#3a1f0a]">403 Forbidden</span>
        </div>

        {/* Brass bottom rail */}
        <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
      </motion.section>
    </main>
  );
}