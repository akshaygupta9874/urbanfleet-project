import { useState, useEffect, useRef, useCallback } from "react";
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
  IndianRupee,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthContext } from "../context/auth-context";

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

const FLEET_PREVIEW = [
  {
    name: "Moto / Bike",
    tag: "FASTEST",
    desc: "Zip through peak-hour city traffic",
    eta: "3 min ETA",
    price: "0.7× Base",
    icon: Bike,
    mode: "bike",
  },
  {
    name: "Auto Rickshaw",
    tag: "POPULAR",
    desc: "Open-air doorstep neighborhood transit",
    eta: "5 min ETA",
    price: "0.9× Base",
    icon: Sparkles,
    mode: "auto",
  },
  {
    name: "Comfort Car",
    tag: "PRIME AC",
    desc: "Spacious air-conditioned sedan & top captains",
    eta: "7 min ETA",
    price: "1.2× Base",
    icon: Car,
    mode: "car",
  },
];

const SAFETY_PILLARS = [
  {
    title: "4-Digit Boarding PIN",
    badge: "OTP VAULT",
    desc: "Every trip requires cryptographic 4-digit PIN verification at pickup before the meter starts.",
    icon: Lock,
  },
  {
    title: "RFC 6819 Session Guard",
    badge: "TOKEN ROTATION",
    desc: "Real-time device session monitoring with one-tap remote token revocation.",
    icon: ShieldCheck,
  },
  {
    title: "Live Vector Telemetry",
    badge: "REDIS GEO",
    desc: "Sub-second WebSocket GPS coordinate streaming and audited Razorpay fare settlement.",
    icon: Zap,
  },
];

function NavBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activePopover, setActivePopover] = useState<"fleet" | "safety" | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);

  const navContainerRef = useRef<HTMLElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const popoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const isAdmin = Boolean(user?.roles?.includes("ADMIN"));
  const isOnDriverPage = location.pathname.startsWith("/driver");
  const isOnRiderPage =
    location.pathname.startsWith("/dashboard") || location.pathname.startsWith("/ride");

  const dashboardPath = isOnDriverPage
    ? "/driver-dashboard"
    : isDriver && !isRider
      ? "/driver-dashboard"
      : "/dashboard";

  // Hover-intent helpers so moving between trigger buttons and mega-popover never flickers
  const clearPopoverTimer = useCallback(() => {
    if (popoverCloseTimerRef.current !== null) {
      clearTimeout(popoverCloseTimerRef.current);
      popoverCloseTimerRef.current = null;
    }
  }, []);

  const openPopover = useCallback(
    (menu: "fleet" | "safety") => {
      clearPopoverTimer();
      setHoveredNav(menu);
      setActivePopover(menu);
      setIsProfileMenuOpen(false);
    },
    [clearPopoverTimer]
  );

  const scheduleClosePopover = useCallback(() => {
    clearPopoverTimer();
    popoverCloseTimerRef.current = setTimeout(() => {
      setActivePopover(null);
      setHoveredNav(null);
    }, 150);
  }, [clearPopoverTimer]);

  useEffect(() => {
    return () => clearPopoverTimer();
  }, [clearPopoverTimer]);

  // 1. Passive scroll listener
  useEffect(() => {
    const handleScroll = () => {
      const isPastThreshold = window.scrollY > 14;
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

  // 3. Safe body scroll lock on mobile drawer open
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
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
      if (navContainerRef.current && !navContainerRef.current.contains(event.target as Node)) {
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
      className="sticky top-0 z-50 flex h-20 w-full items-center px-3 sm:px-6 lg:px-8 transition-all duration-300"
    >
      <nav
        aria-label="Main Navigation"
        className={`relative mx-auto flex w-full max-w-7xl items-center justify-between gap-4 text-[#2e1808] transition-all duration-300 ${
          scrolled
            ? "h-[66px] rounded-[1.75rem] border border-[#fff4dc]/90 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e2]/92 to-[#f6e0b5]/92 px-4 sm:px-6 shadow-[0_18px_42px_-12px_rgba(46,24,8,0.22)] backdrop-blur-2xl"
            : "h-20 border-b border-[#7a4416]/15 bg-[#f5e6c8]/80 px-2 sm:px-4 backdrop-blur-md"
        }`}
      >
        {/* Top Brass Shimmer Rail (visible when floating) */}
        <div
          className={`pointer-events-none absolute inset-x-10 top-0 h-[2.5px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent transition-opacity duration-300 ${
            scrolled ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* =================================================================
            LEFT: Brand Emblem & Logotype
           ================================================================= */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="group flex items-center gap-3 text-left focus:outline-none active:scale-95 transition-transform"
          >
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-[0_10px_22px_-6px_rgba(58,31,10,0.65)] ring-1 ring-[#c58a3a]/50 transition-transform duration-300 group-hover:scale-105">
              <Car size={20} className="transition-transform duration-300 group-hover:-rotate-6" />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[#fffaf0] bg-emerald-500" />
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-xl sm:text-2xl font-black tracking-tight text-[#2e1808] leading-none"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  UrbanFleet
                </span>
                <span
                  className="hidden xl:inline-flex items-center gap-1 rounded-full border border-[#c58a3a]/40 bg-[#fffaf0] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-[#3a1f0a] shadow-2xs"
                  style={{ fontFamily: MONO_FONT }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  LIVE
                </span>
              </div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-[#7a4416] mt-0.5">
                Luxury Urban Transit
              </p>
            </div>
          </button>
        </div>

        {/* =================================================================
            CENTER: Interactive Segmented Navigation Dock (Desktop)
           ================================================================= */}
        <div
          className="hidden md:flex items-center gap-1 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/80 p-1 shadow-inner backdrop-blur-md"
          onMouseLeave={scheduleClosePopover}
        >
          {/* 1. Fleet & Fares Mega-Trigger */}
          <button
            type="button"
            onMouseEnter={() => openPopover("fleet")}
            onClick={() =>
              activePopover === "fleet" ? setActivePopover(null) : openPopover("fleet")
            }
            aria-expanded={activePopover === "fleet"}
            className="relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-[#3a1f0a] transition-colors"
          >
            {(hoveredNav === "fleet" || activePopover === "fleet") && (
              <motion.span
                layoutId="ufNavHoverPill"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8] border border-[#c58a3a]/40 shadow-2xs"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Compass size={14} className="text-[#b8722c]" />
              <span>Fleet & Fares</span>
              <ChevronDown
                size={13}
                className={`text-[#7a4416] transition-transform duration-200 ${
                  activePopover === "fleet" ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>

          {/* 2. Safety & Trust Mega-Trigger */}
          <button
            type="button"
            onMouseEnter={() => openPopover("safety")}
            onClick={() =>
              activePopover === "safety" ? setActivePopover(null) : openPopover("safety")
            }
            aria-expanded={activePopover === "safety"}
            className="relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-[#3a1f0a] transition-colors"
          >
            {(hoveredNav === "safety" || activePopover === "safety") && (
              <motion.span
                layoutId="ufNavHoverPill"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8] border border-[#c58a3a]/40 shadow-2xs"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-[#b8722c]" />
              <span>Safety</span>
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
              clearPopoverTimer();
              setHoveredNav("ride");
              setActivePopover(null);
            }}
            onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
            className="relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-[#3a1f0a] transition-colors"
          >
            {(hoveredNav === "ride" || isOnRiderPage) && (
              <motion.span
                layoutId="ufNavHoverPill"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8] border border-[#c58a3a]/40 shadow-2xs"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Navigation size={13} className="text-[#b8722c]" />
              <span>Ride</span>
            </span>
          </button>

          {/* 4. Direct Captain Hub Link */}
          <button
            type="button"
            onMouseEnter={() => {
              clearPopoverTimer();
              setHoveredNav("captain");
              setActivePopover(null);
            }}
            onClick={() => navigate(isAuthenticated ? "/driver-dashboard" : "/login")}
            className="relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-[#3a1f0a] transition-colors"
          >
            {(hoveredNav === "captain" || isOnDriverPage) && (
              <motion.span
                layoutId="ufNavHoverPill"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-[#f5e6c8] border border-[#c58a3a]/40 shadow-2xs"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Car size={14} className="text-[#b8722c]" />
              <span>Drive</span>
            </span>
          </button>

          {/* 5. Admin Operations Link (Visible to Admins) */}
          {isAdmin && (
            <button
              type="button"
              onMouseEnter={() => {
                clearPopoverTimer();
                setHoveredNav("admin");
                setActivePopover(null);
              }}
              onClick={() => navigate("/admin")}
              className="relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-[#3a1f0a] transition-colors"
            >
              {(hoveredNav === "admin" || location.pathname.startsWith("/admin")) && (
                <motion.span
                  layoutId="ufNavHoverPill"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-xl bg-[#f5e6c8] border border-[#c58a3a]/40 shadow-2xs"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Shield size={13} className="text-[#b8722c]" />
                <span>Admin</span>
              </span>
            </button>
          )}
        </div>

        {/* =================================================================
            RIGHT: Auth & Console Launch Deck (Desktop)
           ================================================================= */}
        <div className="hidden md:flex items-center gap-2.5">
          {isAuthenticated ? (
            <>
              {/* Primary Console Launch Button */}
              <Button
                onClick={() => navigate(dashboardPath)}
                className="group relative h-10 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-4 text-xs font-bold text-[#ffe9be] shadow-[0_12px_26px_-8px_rgba(58,31,10,0.65)] transition-all hover:-translate-y-0.5 active:scale-95"
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>
                    {isOnDriverPage || (isDriver && !isRider)
                      ? "Captain Cockpit"
                      : "Rider Console"}
                  </span>
                  <ArrowRight
                    size={13}
                    className="text-[#ffd88a] transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Button>

              {/* Profile & Security Command Dropdown */}
              <div ref={profileMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setActivePopover(null);
                    setIsProfileMenuOpen((prev) => !prev);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] pl-1.5 pr-3 py-1.5 shadow-2xs transition-all hover:border-[#b8722c] hover:bg-[#fff4dc] active:scale-95"
                  aria-expanded={isProfileMenuOpen}
                  aria-label="Open account menu"
                >
                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-xs font-black text-[#ffd88a] shadow-2xs">
                    {userInitial}
                  </div>
                  <span className="max-w-[96px] truncate text-xs font-bold text-[#2e1808]">
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
                      className="absolute right-0 mt-2.5 w-72 overflow-hidden rounded-3xl border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9] via-[#fff5e1] to-[#f5dfb5] p-3 shadow-[0_24px_60px_-15px_rgba(46,24,8,0.35)] backdrop-blur-2xl z-50"
                    >
                      <div className="pointer-events-none absolute inset-x-6 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                      {/* Identity Card */}
                      <div className="rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/90 p-3 mb-2">
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-sm font-black text-[#ffd88a] shadow-xs">
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

                        {/* Role Switcher Inside Menu */}
                        <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl bg-[#f5e6c8]/70 p-1 border border-[#7a4416]/15">
                          <button
                            type="button"
                            onClick={() => navigate("/dashboard")}
                            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-bold transition-all ${
                              !isOnDriverPage
                                ? "bg-[#3a1f0a] text-[#ffd88a] shadow-2xs"
                                : "text-[#6b3a12] hover:text-[#2e1808]"
                            }`}
                          >
                            <Navigation size={11} /> Rider Mode
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate("/driver-dashboard")}
                            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-bold transition-all ${
                              isOnDriverPage
                                ? "bg-[#3a1f0a] text-[#ffd88a] shadow-2xs"
                                : "text-[#6b3a12] hover:text-[#2e1808]"
                            }`}
                          >
                            <Car size={11} /> Captain Mode
                          </button>
                        </div>
                      </div>

                      {/* Navigation Links */}
                      <div className="space-y-1">
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
                            RFC 6819
                          </span>
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => navigate("/admin")}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold text-[#2e1808] hover:bg-[#fffaf0] transition-colors"
                          >
                            <span className="flex items-center gap-2.5">
                              <Shield size={14} className="text-[#b8722c]" />
                              Admin Control Center
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
                          Sign out of UrbanFleet
                        </span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => navigate("/login")}
                className="h-10 rounded-xl border border-[#7a4416]/20 bg-[#fffaf0]/85 px-4 text-xs font-bold text-[#3a1f0a] transition-all hover:border-[#b8722c] hover:bg-[#fff4dc] active:scale-95"
              >
                Log in
              </Button>

              <Button
                onClick={() => navigate("/signup")}
                className="group relative h-10 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-5 text-xs font-bold text-[#ffe9be] shadow-[0_14px_30px_-10px_rgba(58,31,10,0.7)] transition-all hover:-translate-y-0.5 active:scale-95"
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-[#ffd88a]" />
                  <span>Get Started</span>
                </span>
                <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/50 to-transparent transition-transform duration-1000 group-hover:translate-x-[420%] transform-gpu" />
              </Button>
            </>
          )}
        </div>

        {/* =================================================================
            MOBILE: Quick Console Chip + Hamburger Button
           ================================================================= */}
        <div className="flex items-center gap-2 md:hidden">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => navigate(dashboardPath)}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] px-3 py-2 text-[11px] font-bold text-[#ffd88a] shadow-xs active:scale-95 transition-transform"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{isOnDriverPage ? "Captain" : "Console"}</span>
              <ArrowRight size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-2 text-xs font-bold text-[#3a1f0a] shadow-2xs active:scale-95"
            >
              Log in
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

        {/* =================================================================
            DESKTOP MEGA-POPOVER DRAWER (With Seamless Hover Bridge)
           ================================================================= */}
        <AnimatePresence>
          {activePopover && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onMouseEnter={clearPopoverTimer}
              onMouseLeave={scheduleClosePopover}
              className="hidden md:block absolute left-1/2 top-full pt-2.5 w-full max-w-3xl -translate-x-1/2 z-50"
            >
              <div className="relative overflow-hidden rounded-[2rem] border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9]/98 via-[#fff5e1]/96 to-[#f5dfb5]/96 p-6 shadow-[0_28px_70px_-15px_rgba(46,24,8,0.38)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                {activePopover === "fleet" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-3.5">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7a4416]">
                          UrbanFleet Dispatch Classes
                        </p>
                        <h3
                          className="text-lg font-black text-[#2e1808]"
                          style={{ fontFamily: DISPLAY_FONT }}
                        >
                          Proximity-matched vehicles for every journey
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] px-4 py-2 text-xs font-bold text-[#ffd88a] shadow-sm hover:opacity-95 transition-opacity"
                      >
                        <span>Book a Ride</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3.5">
                      {FLEET_PREVIEW.map((tier) => {
                        const TierIcon = tier.icon;
                        return (
                          <div
                            key={tier.name}
                            onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                            className="group cursor-pointer rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 p-4 shadow-2xs transition-all hover:-translate-y-0.5 hover:border-[#b8722c] hover:shadow-md"
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-xs group-hover:scale-105 transition-transform">
                                <TierIcon size={18} />
                              </div>
                              <span
                                className="rounded-full bg-emerald-950/15 border border-emerald-600/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-900"
                                style={{ fontFamily: MONO_FONT }}
                              >
                                {tier.eta}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <h4
                                className="text-sm font-black text-[#2e1808]"
                                style={{ fontFamily: DISPLAY_FONT }}
                              >
                                {tier.name}
                              </h4>
                              <span
                                className="text-[9px] font-black uppercase tracking-wider text-[#b8722c]"
                                style={{ fontFamily: MONO_FONT }}
                              >
                                {tier.tag}
                              </span>
                            </div>
                            <p className="text-[11px] font-medium text-[#6b3a12] mt-1">
                              {tier.desc}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-[#7a4416]/10 flex items-center justify-between">
                              <span
                                className="inline-flex items-center text-xs font-extrabold text-[#3a1f0a]"
                                style={{ fontFamily: MONO_FONT }}
                              >
                                <IndianRupee size={11} className="text-[#b8722c]" />
                                {tier.price}
                              </span>
                              <span className="text-[11px] font-bold text-[#b8722c] group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5">
                                Select <ArrowRight size={11} />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer Strip */}
                    <div className="flex items-center justify-between rounded-xl bg-[#3a1f0a]/5 px-4 py-2.5 text-xs">
                      <span className="font-semibold text-[#6b3a12]">
                        Own a commercial car, bike, or auto? Earn 80% net fare share.
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(isAuthenticated ? "/driver-dashboard" : "/login")}
                        className="font-bold text-[#3a1f0a] underline underline-offset-4 hover:text-[#b8722c]"
                      >
                        Open Captain Hub →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-3.5">
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
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#7a4416]/30 bg-[#fffaf0] px-3.5 py-2 text-xs font-bold text-[#3a1f0a] hover:bg-[#fff4dc] transition-colors"
                      >
                        <span>Manage Sessions</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3.5">
                      {SAFETY_PILLARS.map((pillar) => {
                        const PillarIcon = pillar.icon;
                        return (
                          <div
                            key={pillar.title}
                            className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 p-4 shadow-2xs"
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-950/15 text-emerald-800 border border-emerald-600/25">
                                <PillarIcon size={17} />
                              </div>
                              <span
                                className="rounded-md bg-[#3a1f0a]/10 px-2 py-0.5 text-[9px] font-bold text-[#3a1f0a]"
                                style={{ fontFamily: MONO_FONT }}
                              >
                                {pillar.badge}
                              </span>
                            </div>
                            <h4 className="text-xs font-black text-[#2e1808]">{pillar.title}</h4>
                            <p className="mt-1 text-[11px] font-medium text-[#6b3a12] leading-relaxed">
                              {pillar.desc}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* ===================================================================
          MOBILE: Floating Glassmorphic Command Drawer
         =================================================================== */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 top-20 z-40 bg-black/45 backdrop-blur-xs md:hidden"
            />

            <motion.div
              initial={{ opacity: 0, y: -14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              className="fixed inset-x-3 top-[84px] z-50 max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-[2rem] border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9] via-[#fff4dc] to-[#f5dfb5] p-5 shadow-[0_28px_70px_rgba(28,15,5,0.45)] md:hidden transform-gpu"
            >
              <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

              {isAuthenticated && (
                <div className="mb-4 flex items-center justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-3.5 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-base font-black text-[#ffd88a] shadow-sm">
                      {userInitial}
                    </div>
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-800">
                        <CheckCircle2 size={11} /> Verified Session
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

              {/* 2x2 Mobile Bento Navigation */}
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                <button
                  type="button"
                  onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#3a1f0a] text-[#ffd88a]">
                    <Navigation size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Book a Ride
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">Passenger Console</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate(isAuthenticated ? "/driver-dashboard" : "/login")}
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#3a1f0a] text-[#ffd88a]">
                    <Car size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Captain Hub
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">Driver Cockpit</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate(isAuthenticated ? "/history" : "/login")}
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#7a4416]/15 text-[#3a1f0a]">
                    <History size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Trip Ledger
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">Receipts & History</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate(isAuthenticated ? "/security-devices" : "/login")}
                  className="flex flex-col items-start justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 text-left shadow-2xs active:scale-[0.98] transition-all"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-950/15 text-emerald-800">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="mt-3">
                    <p
                      className="text-sm font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Security
                    </p>
                    <p className="text-[11px] font-medium text-[#7a4416]">Device Sessions</p>
                  </div>
                </button>
              </div>

              {/* Fleet Availability Strip */}
              <div className="mb-4 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/85 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] mb-2.5">
                  Instant Dispatch Classes
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {FLEET_PREVIEW.map((item) => (
                    <div
                      key={item.name}
                      onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                      className="cursor-pointer rounded-xl border border-[#7a4416]/15 bg-[#fffdf9] p-2.5 text-center active:scale-95 transition-transform"
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
                      className="w-full h-12 rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-xs font-bold uppercase tracking-wider text-[#ffe9be] shadow-lg active:scale-[0.98]"
                      onClick={() => navigate(dashboardPath)}
                    >
                      {isOnDriverPage || (isDriver && !isRider)
                        ? "Open Captain Cockpit"
                        : "Open Passenger Console"}
                      <ArrowRight size={14} className="ml-2 text-[#ffd88a]" />
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
                      Get Started
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