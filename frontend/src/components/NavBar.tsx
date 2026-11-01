import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import {
  Menu,
  X,
  Car,
  Bike,
  Shield,
  ShieldCheck,
  Navigation,
  Sparkles,
  ChevronDown,
  ArrowRight,
  History,
  LogOut,
  Lock,
  Zap,
  Compass,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthContext } from "../context/auth-context";

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

const FLEET_PREVIEW = [
  {
    name: "Moto / Bike",
    desc: "Beat peak-hour gridlock",
    eta: "2 min ETA",
    price: "From ₹39",
    icon: Bike,
    mode: "bike",
  },
  {
    name: "Auto Rickshaw",
    desc: "Doorstep city transit",
    eta: "4 min ETA",
    price: "From ₹59",
    icon: Sparkles,
    mode: "auto",
  },
  {
    name: "Comfort Sedan",
    desc: "AC prime cabin & top captains",
    eta: "5 min ETA",
    price: "From ₹99",
    icon: Car,
    mode: "car",
  },
];

const SAFETY_PILLARS = [
  {
    title: "4-Digit Boarding PIN",
    desc: "Trips only start after your captain verifies your cryptographic OTP.",
    icon: Lock,
  },
  {
    title: "RFC 6819 Session Guard",
    desc: "Real-time device session tracking with instant remote token revocation.",
    icon: ShieldCheck,
  },
  {
    title: "Live Vector Telemetry",
    desc: "Sub-second WebSocket GPS coordinate streaming from pickup to drop-off.",
    icon: Zap,
  },
];

function NavBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activePopover, setActivePopover] = useState<"fleet" | "safety" | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);

  const navContainerRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuthContext();

  const firstName = user?.firstName ? user.firstName : "Rider";
  const fullName = user?.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : "UrbanFleet Member";
  const userInitial = firstName[0]?.toUpperCase() || "U";

  const isDriver = Boolean(user?.roles?.includes("DRIVER"));
  const isRider = Boolean(user?.roles?.includes("RIDER")) || !isDriver;
  const isOnDriverPage = location.pathname.startsWith("/driver");
  const dashboardPath = isOnDriverPage
    ? "/driver-dashboard"
    : isDriver && !isRider
      ? "/driver-dashboard"
      : "/dashboard";

  // 1. Passive scroll listener for zero-jank glassmorphism transition
  useEffect(() => {
    const handleScroll = () => {
      const isPastThreshold = window.scrollY > 16;
      setScrolled((prev) => (prev !== isPastThreshold ? isPastThreshold : prev));
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 2. Close menus automatically on route change
  useEffect(() => {
    setIsOpen(false);
    setActivePopover(null);
    setIsProfileMenuOpen(false);
  }, [location.pathname]);

  // 3. Safe body scroll lock with guaranteed unmount cleanup
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // 4. Close dropdowns on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
      if (
        navContainerRef.current &&
        !navContainerRef.current.contains(event.target as Node)
      ) {
        setActivePopover(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePopover(null);
        setIsProfileMenuOpen(false);
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleLogout = async () => {
    setIsProfileMenuOpen(false);
    setIsOpen(false);
    try {
      if (logout) await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  return (
    <header
      ref={navContainerRef}
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled ? "py-2.5 px-3 sm:px-6 lg:px-10" : "py-0 px-0"
      }`}
    >
      <nav
        className={`relative mx-auto transition-all duration-300 text-[#2e1808] ${
          scrolled
            ? "max-w-[1540px] rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e1]/92 to-[#f7e2b8]/92 shadow-[0_16px_40px_-12px_rgba(46,24,8,0.22)] backdrop-blur-2xl px-4 sm:px-7 h-16 sm:h-18"
            : "max-w-7xl bg-[#f5e6c8]/85 backdrop-blur-md border-b border-[#7a4416]/15 px-4 sm:px-6 h-20"
        } flex items-center justify-between gap-4`}
      >
        {/* Brass Top Accent Rail (visible when floating) */}
        <div
          className={`pointer-events-none absolute inset-x-10 top-0 h-[2.5px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent transition-opacity duration-300 ${
            scrolled ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* LEFT: Brand Identity & Live Telemetry Badge */}
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="group flex items-center gap-3 text-left focus:outline-none active:scale-95 transition-transform"
          >
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-[0_8px_20px_-6px_rgba(58,31,10,0.65)] ring-1 ring-[#c58a3a]/50 transition-transform duration-300 group-hover:scale-105">
              <Car size={21} className="transition-transform duration-300 group-hover:-rotate-6" />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[#fffaf0] bg-emerald-500" />
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-2xl sm:text-[26px] font-black tracking-tight text-[#2e1808] leading-none"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  UrbanFleet
                </span>
                <span
                  className="hidden xl:inline-flex items-center gap-1 rounded-full border border-[#c58a3a]/40 bg-[#3a1f0a]/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-[#3a1f0a]"
                  style={{ fontFamily: MONO_FONT }}
                >
                  v2.4 LIVE
                </span>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] mt-0.5">
                Secure Urban Transportation
              </p>
            </div>
          </button>
        </div>

        {/* CENTER: Desktop Interactive Segmented Navigation */}
        <div
          className="hidden md:flex items-center gap-1 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/75 p-1 shadow-2xs backdrop-blur-md"
          onMouseLeave={() => setHoveredNav(null)}
        >
          {/* 1. Fleet & Modes Trigger */}
          <button
            type="button"
            onMouseEnter={() => {
              setHoveredNav("fleet");
              setActivePopover("fleet");
            }}
            onClick={() =>
              setActivePopover((prev) => (prev === "fleet" ? null : "fleet"))
            }
            className="relative flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-[#3a1f0a] transition-colors"
          >
            {(hoveredNav === "fleet" || activePopover === "fleet") && (
              <motion.span
                layoutId="navHoverPill"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8]/90 border border-[#c58a3a]/35"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Compass size={14} className="text-[#b8722c]" />
              Fleet & Modes
              <ChevronDown
                size={13}
                className={`text-[#7a4416] transition-transform duration-200 ${
                  activePopover === "fleet" ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>

          {/* 2. Safety Architecture Trigger */}
          <button
            type="button"
            onMouseEnter={() => {
              setHoveredNav("safety");
              setActivePopover("safety");
            }}
            onClick={() =>
              setActivePopover((prev) => (prev === "safety" ? null : "safety"))
            }
            className="relative flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-[#3a1f0a] transition-colors"
          >
            {(hoveredNav === "safety" || activePopover === "safety") && (
              <motion.span
                layoutId="navHoverPill"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8]/90 border border-[#c58a3a]/35"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-[#b8722c]" />
              Safety & Trust
              <ChevronDown
                size={13}
                className={`text-[#7a4416] transition-transform duration-200 ${
                  activePopover === "safety" ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>

          {/* 3. Direct Rider Console Link */}
          <button
            type="button"
            onMouseEnter={() => {
              setHoveredNav("ride");
              setActivePopover(null);
            }}
            onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
            className={`relative flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
              location.pathname === "/dashboard" ? "text-[#2e1808]" : "text-[#3a1f0a]"
            }`}
          >
            {hoveredNav === "ride" && (
              <motion.span
                layoutId="navHoverPill"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8]/90 border border-[#c58a3a]/35"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Navigation size={13} className="text-[#b8722c]" />
              Book a Ride
            </span>
          </button>

          {/* 4. Direct Captain Console Link */}
          <button
            type="button"
            onMouseEnter={() => {
              setHoveredNav("captain");
              setActivePopover(null);
            }}
            onClick={() =>
              navigate(isAuthenticated ? "/driver-dashboard" : "/login")
            }
            className={`relative flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
              isOnDriverPage ? "text-[#2e1808]" : "text-[#3a1f0a]"
            }`}
          >
            {hoveredNav === "captain" && (
              <motion.span
                layoutId="navHoverPill"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8]/90 border border-[#c58a3a]/35"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Car size={14} className="text-[#b8722c]" />
              Captain Hub
            </span>
          </button>
        </div>

        {/* RIGHT: Desktop Auth / Command Controls */}
        <div className="hidden items-center gap-2.5 md:flex">
          {isAuthenticated ? (
            <div className="flex items-center gap-2.5">
              {/* Dual-Portal Quick Switcher Pill */}
              <div className="hidden lg:flex items-center rounded-xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-1 shadow-2xs">
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all ${
                    !isOnDriverPage
                      ? "bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-2xs"
                      : "text-[#6b3a12] hover:text-[#2e1808]"
                  }`}
                >
                  <Navigation size={12} />
                  Rider
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/driver-dashboard")}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all ${
                    isOnDriverPage
                      ? "bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-2xs"
                      : "text-[#6b3a12] hover:text-[#2e1808]"
                  }`}
                >
                  <Car size={12} />
                  Captain
                </button>
              </div>

              {/* Primary Console CTA */}
              <Button
                className="group relative h-10 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-4 text-xs font-bold text-[#ffe9be] shadow-[0_12px_28px_-10px_rgba(58,31,10,0.65)] transition-all hover:-translate-y-0.5 active:scale-95"
                onClick={() => navigate(dashboardPath)}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10 flex items-center gap-1.5">
                  {isOnDriverPage || (isDriver && !isRider)
                    ? "Driver Dashboard"
                    : "Passenger Dashboard"}
                  <ArrowRight
                    size={13}
                    className="text-[#ffd88a] transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Button>

              {/* Interactive Profile & Security Command Menu */}
              <div ref={profileMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                  className="flex items-center gap-2 rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] pl-2 pr-3 py-1.5 shadow-2xs transition-all hover:border-[#b8722c] hover:bg-[#fff4dc] active:scale-95"
                  aria-expanded={isProfileMenuOpen}
                  aria-label="Open account menu"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-xs font-black text-[#ffd88a] shadow-2xs">
                    {userInitial}
                  </div>
                  <span className="text-xs font-bold text-[#2e1808] max-w-[96px] truncate">
                    {firstName}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`text-[#7a4416] transition-transform duration-200 ${
                      isProfileMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {isProfileMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="absolute right-0 mt-2.5 w-68 overflow-hidden rounded-3xl border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9] via-[#fff5e1] to-[#f5dfb5] p-3 shadow-[0_24px_60px_-15px_rgba(46,24,8,0.35)] backdrop-blur-2xl z-50"
                    >
                      <div className="pointer-events-none absolute inset-x-6 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                      {/* User Identity Header */}
                      <div className="flex items-center gap-3 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/90 p-3 mb-2">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-sm font-black text-[#ffd88a] shadow-xs">
                          {userInitial}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-black text-[#2e1808]"
                            style={{ fontFamily: DISPLAY_FONT }}
                          >
                            {fullName}
                          </p>
                          <p className="truncate text-[11px] font-medium text-[#7a4416]">
                            {user?.email || "Verified UrbanFleet Account"}
                          </p>
                        </div>
                      </div>

                      {/* Menu Items */}
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => navigate("/dashboard")}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold text-[#2e1808] hover:bg-[#fffaf0] transition-colors"
                        >
                          <span className="flex items-center gap-2.5">
                            <Navigation size={14} className="text-[#b8722c]" />
                            Passenger Dashboard
                          </span>
                          <ArrowRight size={12} className="text-[#7a4416]" />
                        </button>

                        <button
                          type="button"
                          onClick={() => navigate("/driver-dashboard")}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold text-[#2e1808] hover:bg-[#fffaf0] transition-colors"
                        >
                          <span className="flex items-center gap-2.5">
                            <Car size={14} className="text-[#b8722c]" />
                            Driver Dashboard
                          </span>
                          <ArrowRight size={12} className="text-[#7a4416]" />
                        </button>

                        <button
                          type="button"
                          onClick={() => navigate("/history")}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold text-[#2e1808] hover:bg-[#fffaf0] transition-colors"
                        >
                          <span className="flex items-center gap-2.5">
                            <History size={14} className="text-[#b8722c]" />
                            Ride History & Receipts
                          </span>
                          <ArrowRight size={12} className="text-[#7a4416]" />
                        </button>

                        <button
                          type="button"
                          onClick={() => navigate("/security-devices")}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold text-[#2e1808] hover:bg-[#fffaf0] transition-colors"
                        >
                          <span className="flex items-center gap-2.5">
                            <ShieldCheck size={14} className="text-emerald-700" />
                            Active Devices & Security
                          </span>
                          <span
                            className="rounded-md bg-emerald-950/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-900"
                            style={{ fontFamily: MONO_FONT }}
                          >
                            RFC
                          </span>
                        </button>

                        {user?.roles?.includes("ADMIN") && (
                          <button
                            type="button"
                            onClick={() => navigate("/admin")}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold text-[#2e1808] hover:bg-[#fffaf0] transition-colors"
                          >
                            <span className="flex items-center gap-2.5">
                              <Shield size={14} className="text-[#b8722c]" />
                              Admin Operations
                            </span>
                            <span
                              className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-900 border border-amber-500/30"
                              style={{ fontFamily: MONO_FONT }}
                            >
                              ADMIN
                            </span>
                          </button>
                        )}
                      </div>

                      <div className="my-2 h-px bg-[#7a4416]/15" />

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center justify-between rounded-xl bg-rose-950/10 px-3 py-2 text-xs font-bold text-rose-900 hover:bg-rose-950/20 transition-colors"
                      >
                        <span className="flex items-center gap-2.5">
                          <LogOut size={14} className="text-rose-700" />
                          Sign out of console
                        </span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <Button
                variant="ghost"
                className="h-10 rounded-xl border border-[#7a4416]/20 bg-[#fffaf0]/80 px-4 text-xs font-bold text-[#3a1f0a] transition-all hover:bg-[#fff4dc] hover:text-[#2e1808] active:scale-95"
                onClick={() => navigate("/login")}
              >
                Log in
              </Button>

              <Button
                className="group relative h-10 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-5 text-xs font-bold text-[#ffe9be] shadow-[0_12px_28px_-10px_rgba(58,31,10,0.65)] transition-all hover:-translate-y-0.5 active:scale-95"
                onClick={() => navigate("/signup")}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-[#ffd88a]" />
                  Sign up
                </span>
              </Button>
            </div>
          )}
        </div>

        {/* MOBILE: Quick Console Chip + Menu Toggle Button */}
        <div className="flex items-center gap-2 md:hidden">
          {isAuthenticated && (
            <button
              type="button"
              onClick={() => navigate(dashboardPath)}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] px-3 py-2 text-[11px] font-bold text-[#ffd88a] shadow-xs active:scale-95 transition-transform"
            >
              <span>{isOnDriverPage ? "Captain" : "Console"}</span>
              <ArrowRight size={12} />
            </button>
          )}

          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-2xs transition-all hover:bg-[#fff4dc] active:scale-90"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-label="Toggle navigation menu"
          >
            {isOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* DESKTOP MEGA-POPOVER DRAWER (Fleet & Safety) */}
        <AnimatePresence>
          {activePopover && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onMouseLeave={() => setActivePopover(null)}
              className="hidden md:block absolute left-1/2 top-full mt-2.5 w-full max-w-3xl -translate-x-1/2 overflow-hidden rounded-[2rem] border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9]/98 via-[#fff5e1]/95 to-[#f5dfb5]/95 p-6 shadow-[0_28px_70px_-15px_rgba(46,24,8,0.35)] backdrop-blur-2xl z-50"
            >
              <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

              {activePopover === "fleet" ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7a4416]">
                        UrbanFleet Dispatch Classes
                      </p>
                      <h3
                        className="text-lg font-black text-[#2e1808]"
                        style={{ fontFamily: DISPLAY_FONT }}
                      >
                        Instant proximity-matched vehicles
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#3a1f0a] px-3.5 py-1.5 text-xs font-bold text-[#ffd88a] hover:opacity-95 transition-opacity"
                    >
                      Open Driver Dashboard <ArrowRight size={13} />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3.5">
                    {FLEET_PREVIEW.map((tier) => {
                      const TierIcon = tier.icon;
                      return (
                        <div
                          key={tier.name}
                          onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                          className="group cursor-pointer rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-4 shadow-2xs transition-all hover:-translate-y-0.5 hover:border-[#b8722c] hover:shadow-md"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-xs group-hover:scale-105 transition-transform">
                              <TierIcon size={18} />
                            </div>
                            <span
                              className="rounded-full bg-emerald-950/15 border border-emerald-600/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-900"
                              style={{ fontFamily: MONO_FONT }}
                            >
                              {tier.eta}
                            </span>
                          </div>
                          <h4
                            className="text-sm font-black text-[#2e1808]"
                            style={{ fontFamily: DISPLAY_FONT }}
                          >
                            {tier.name}
                          </h4>
                          <p className="text-[11px] font-medium text-[#6b3a12] mt-0.5">
                            {tier.desc}
                          </p>
                          <p
                            className="mt-2.5 text-xs font-extrabold text-[#3a1f0a]"
                            style={{ fontFamily: MONO_FONT }}
                          >
                            {tier.price}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7a4416]">
                        Security & Telemetry Architecture
                      </p>
                      <h3
                        className="text-lg font-black text-[#2e1808]"
                        style={{ fontFamily: DISPLAY_FONT }}
                      >
                        Engineered for passenger & captain protection
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(isAuthenticated ? "/security-devices" : "/login")
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-[#7a4416]/30 bg-[#fffaf0] px-3.5 py-1.5 text-xs font-bold text-[#3a1f0a] hover:bg-[#fff4dc] transition-colors"
                    >
                      Manage Device Sessions <ArrowRight size={13} />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3.5">
                    {SAFETY_PILLARS.map((pillar) => {
                      const PillarIcon = pillar.icon;
                      return (
                        <div
                          key={pillar.title}
                          className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-4 shadow-2xs"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-950/15 text-emerald-800 border border-emerald-600/25 mb-2.5">
                            <PillarIcon size={17} />
                          </div>
                          <h4 className="text-xs font-black text-[#2e1808]">
                            {pillar.title}
                          </h4>
                          <p className="mt-1 text-[11px] font-medium text-[#6b3a12] leading-relaxed">
                            {pillar.desc}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* MOBILE: GPU-Accelerated Floating Command Drawer (60fps Transform Physics) */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 top-20 z-40 bg-black/45 backdrop-blur-xs md:hidden"
            />

            {/* Floating Sheet */}
            <motion.div
              initial={{ opacity: 0, y: -14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              className="fixed inset-x-3 top-22 z-50 max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-[2.25rem] border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9] via-[#fff4dc] to-[#f5dfb5] p-5 shadow-[0_28px_70px_rgba(28,15,5,0.45)] md:hidden transform-gpu"
            >
              <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

              {/* Authenticated User Banner (Mobile) */}
              {isAuthenticated && (
                <div className="mb-4 flex items-center justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-3.5 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-base font-black text-[#ffd88a] shadow-sm">
                      {userInitial}
                    </div>
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-800">
                        <CheckCircle2 size={11} /> Active Session
                      </span>
                      <p
                        className="truncate text-base font-black text-[#2e1808]"
                        style={{ fontFamily: DISPLAY_FONT }}
                      >
                        {fullName}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Mobile Bento Navigation Grid */}
              <div className="grid grid-cols-2 gap-2.5 mb-5">
                <button
                  type="button"
                  onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a]">
                    <Navigation size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Book a Ride
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">
                      Passenger Dashboard
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    navigate(isAuthenticated ? "/driver-dashboard" : "/login")
                  }
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a]">
                    <Car size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Driver Dashboard
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">
                      Driver Activity
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate(isAuthenticated ? "/history" : "/login")}
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#7a4416]/15 text-[#3a1f0a]">
                    <History size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Ride History
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">
                      Receipts & Rebook
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    navigate(isAuthenticated ? "/security-devices" : "/login")
                  }
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-950/15 text-emerald-800">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Device Security
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">
                      Active Sessions
                    </p>
                  </div>
                </button>
              </div>

              {/* Fleet Quick-Preview Strip inside Mobile Menu */}
              <div className="mb-5 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/80 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] mb-2.5">
                  Live Fleet Availability
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {FLEET_PREVIEW.map((item) => (
                    <div
                      key={item.name}
                      onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                      className="cursor-pointer rounded-xl border border-[#7a4416]/15 bg-[#fffdf9] p-2.5 text-center"
                    >
                      <p className="text-xs font-bold text-[#2e1808] truncate">
                        {item.name.split(" ")[0]}
                      </p>
                      <p
                        className="text-[10px] font-bold text-emerald-800 mt-0.5"
                        style={{ fontFamily: MONO_FONT }}
                      >
                        <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                        {item.eta}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom Auth Actions */}
              <div className="flex flex-col gap-2.5 border-t border-[#7a4416]/15 pt-4">
                {isAuthenticated ? (
                  <>
                    <Button
                      className="w-full h-13 rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-sm font-bold text-[#ffe9be] shadow-lg active:scale-[0.98]"
                      onClick={() => navigate(dashboardPath)}
                    >
                      {isOnDriverPage || (isDriver && !isRider)
                        ? "Open Driver Dashboard"
                        : "Open Passenger Dashboard"}
                      <ArrowRight size={15} className="ml-2 text-[#ffd88a]" />
                    </Button>

                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-950/10 text-xs font-bold text-rose-900 active:scale-[0.98] transition-all"
                    >
                      <LogOut size={14} />
                      Sign out of UrbanFleet
                    </button>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <Button
                      variant="outline"
                      className="h-12 rounded-2xl border-[#7a4416]/30 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] hover:bg-[#fff4dc]"
                      onClick={() => navigate("/login")}
                    >
                      Log in
                    </Button>

                    <Button
                      className="h-12 rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-xs font-bold text-[#ffe9be] shadow-md"
                      onClick={() => navigate("/signup")}
                    >
                      Sign up
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}

export default NavBar;