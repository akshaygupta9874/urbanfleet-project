import { useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Button } from "./ui/button";
import {
  Car,
  CalendarDays,
  Bike,
  CarTaxiFront,
  Package,
  Plane,
  BatteryCharging,
  Users,
  PersonStanding,
  Bus,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Clock,
  Zap,
  Star,
  Navigation,
  CheckCircle2,
  Wallet,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../context/auth-context";

const loginImage =
  "https://tb-static.uber.com/prod/udam-assets/850e6b6d-a29e-4960-bcab-46de99547d24.svg";

type ServiceCategory = "all" | "daily" | "travel" | "family";

interface ServiceItem {
  id: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  category: Exclude<ServiceCategory, "all">;
  eta: string;
  priceTier: string;
  badge: string;
  features: string[];
}

const SERVICES: ServiceItem[] = [
  {
    id: "ride",
    icon: Car,
    title: "Ride",
    tagline: "On-demand city sedans & hatchbacks",
    description:
      "Go anywhere with UrbanFleet. Request a climate-controlled ride, get matched in milliseconds, and hop in.",
    category: "daily",
    eta: "2 min away",
    priceTier: "From ₹99",
    badge: "Most Popular",
    features: ["4-Digit PIN Boarding", "Live GPS Telemetry", "Upfront Fare Lock"],
  },
  {
    id: "bike",
    icon: Bike,
    title: "Bike",
    tagline: "Slice through peak-hour gridlock",
    description:
      "Quick, nimble, and ultra-affordable two-wheeler dispatches designed to beat heavy urban traffic.",
    category: "daily",
    eta: "1 min away",
    priceTier: "From ₹39",
    badge: "Fastest ETA",
    features: ["Helmet Provided", "Express Lane Routing", "Zero Surge Guarantee"],
  },
  {
    id: "reserve",
    icon: CalendarDays,
    title: "Reserve",
    tagline: "Lock in your captain up to 90 days ahead",
    description:
      "Reserve your executive ride in advance for critical meetings or early-morning departures with zero stress.",
    category: "travel",
    eta: "Scheduled",
    priceTier: "From ₹249",
    badge: "Priority Lock",
    features: ["15-Min Free Wait Time", "Dedicated Top Captain", "Free Cancellation"],
  },
  {
    id: "intercity",
    icon: CarTaxiFront,
    title: "Intercity",
    tagline: "Chauffeur-driven highway cruisers",
    description:
      "Travel comfortably between cities in spacious sedans and SUVs with experienced highway captains.",
    category: "travel",
    eta: "15 min away",
    priceTier: "From ₹12/km",
    badge: "Outstation",
    features: ["One-Way & Round Trips", "Highway Toll Included", "24/7 Roadside Cover"],
  },
  {
    id: "airport",
    icon: Plane,
    title: "Airport",
    tagline: "Synchronized terminal pickups & drops",
    description:
      "Reliable airport transfers with automated flight-delay tracking and dedicated terminal curb access.",
    category: "travel",
    eta: "4 min away",
    priceTier: "From ₹349",
    badge: "Flight Sync",
    features: ["Extra Luggage Boot", "Flight Delay Tracking", "Express Terminal Bay"],
  },
  {
    id: "parcel",
    icon: Package,
    title: "Parcel",
    tagline: "Instant door-to-door courier",
    description:
      "Send documents, forgotten keys, or care packages across town quickly with real-time OTP delivery proof.",
    category: "daily",
    eta: "3 min away",
    priceTier: "From ₹49",
    badge: "OTP Verified",
    features: ["Dual Pickup/Drop PIN", "Live Courier Radar", "Insured Transit"],
  },
  {
    id: "electric",
    icon: BatteryCharging,
    title: "Electric",
    tagline: "Whisper-quiet zero-emission EV fleet",
    description:
      "Choose eco-friendly electric vehicles for a silent, smooth cabin experience with zero tailpipe emissions.",
    category: "family",
    eta: "4 min away",
    priceTier: "From ₹109",
    badge: "100% Green",
    features: ["Zero CO₂ Footprint", "Silent Acoustic Cabin", "Eco-Reward Credits"],
  },
  {
    id: "shuttle",
    icon: Bus,
    title: "Shuttle",
    tagline: "High-frequency tech-corridor express",
    description:
      "Pre-book a guaranteed seat on air-conditioned shared shuttles running along major office corridors.",
    category: "daily",
    eta: "Every 10m",
    priceTier: "From ₹29",
    badge: "Commuter Saver",
    features: ["Guaranteed Seating", "High-Speed Wi-Fi", "Fixed Corridor Stops"],
  },
  {
    id: "teens",
    icon: Users,
    title: "Teens",
    tagline: "Guardian-monitored rides for youth",
    description:
      "Safe, background-verified rides designed for teens with automatic live parental telemetry alerts.",
    category: "family",
    eta: "3 min away",
    priceTier: "From ₹99",
    badge: "Family Guard",
    features: ["Top 1% Rated Captains", "Live Parent Map Link", "Route Deviation Alerts"],
  },
  {
    id: "seniors",
    icon: PersonStanding,
    title: "Seniors",
    tagline: "Patient, doorstep-assisted transit",
    description:
      "Accessible, low-step vehicles paired with courteous captains trained to assist senior citizens.",
    category: "family",
    eta: "4 min away",
    priceTier: "From ₹99",
    badge: "Assisted Care",
    features: ["Extra Boarding Time", "Hospital & Clinic Priority", "Family Booking Support"],
  },
];

const CATEGORIES: { id: ServiceCategory; label: string }[] = [
  { id: "all", label: "All Services (10)" },
  { id: "daily", label: "Daily Commute" },
  { id: "travel", label: "Airport & Outstation" },
  { id: "family", label: "Family & Eco" },
];

const PLATFORM_METRICS = [
  { label: "Dispatch Match Speed", value: "< 180ms", sub: "H3 Spatial Indexing", icon: Zap },
  { label: "Verified Fleet Rating", value: "4.94 ★", sub: "Background-checked captains", icon: Star },
  { label: "Session Security", value: "RFC 6819", sub: "Token rotation & OTP lock", icon: Lock },
  { label: "Transparent Ledger", value: "0% Hidden", sub: "Upfront fare breakdown", icon: Wallet },
];

// --- Animation Variants ---

const gridVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const iconVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.9 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 280, damping: 22 },
  },
};

const textSlideVariants: Variants = {
  hidden: { opacity: 0, x: -32 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

const imageRevealVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.15 },
  },
};

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

export default function LandingPage2() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthContext();
  const firstName = user?.firstName ? user.firstName : "Rider";

  const [activeCategory, setActiveCategory] = useState<ServiceCategory>("all");
  const [selectedServiceId, setSelectedServiceId] = useState<string>("ride");
  const [portalMode, setPortalMode] = useState<"rider" | "driver">("rider");

  const filteredServices =
    activeCategory === "all"
      ? SERVICES
      : SERVICES.filter((s) => s.category === activeCategory);

  const activeService =
    SERVICES.find((s) => s.id === selectedServiceId) ?? SERVICES[0];
  const ActiveServiceIcon = activeService.icon;

  return (
    <section className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 overflow-hidden font-sans text-[#2e1808] selection:bg-[#3a1f0a] selection:text-[#ffd88a]">
      {/* SECTION 1: HEADER & CATEGORY FILTER DOCK */}
      <div className="mx-auto max-w-3xl text-center mb-12">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-[#ffd88a] shadow-[0_10px_25px_-8px_rgba(58,31,10,0.65)]"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#ffd88a]" />
          Complete Urban Mobility Suite
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-4 text-3xl sm:text-5xl font-black tracking-tight text-[#2e1808]"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          Ten specialized ways to{" "}
          <span className="italic bg-gradient-to-br from-[#2e1808] via-[#6b3a12] to-[#b8722c] bg-clip-text text-transparent">
            move your world.
          </span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mt-3 text-sm sm:text-base font-medium text-[#6b3a12] leading-relaxed"
        >
          Select any mobility class below to inspect real-time dispatch specs, estimated pickup
          windows, and transparent fare tiers.
        </motion.p>

        {/* Category Filter Pills */}
        <div className="mt-7 inline-flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-[#fff4dc]/80 bg-[#fffaf0]/85 p-1.5 shadow-md backdrop-blur-xl">
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.id);
                  const firstMatch =
                    cat.id === "all"
                      ? SERVICES[0]
                      : SERVICES.find((s) => s.category === cat.id);
                  if (firstMatch) setSelectedServiceId(firstMatch.id);
                }}
                className={`relative rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
                  isActive ? "text-[#ffe9be]" : "text-[#6b3a12] hover:text-[#2e1808]"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="landingCategoryPill"
                    transition={{ type: "spring", stiffness: 350, damping: 28 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] shadow-sm ring-1 ring-[#c58a3a]/40"
                  />
                )}
                <span className="relative z-10">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: INTERACTIVE 10-SERVICE ICON GRID */}
      <motion.div
        variants={gridVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        className="mb-10 flex flex-wrap justify-center gap-4 sm:gap-6"
      >
        {filteredServices.map(({ id, icon: Icon, title, description, eta, badge }) => {
          const isSelected = selectedServiceId === id;
          return (
            <motion.button
              type="button"
              variants={iconVariants}
              key={id}
              onClick={() => setSelectedServiceId(id)}
              onMouseEnter={() => setSelectedServiceId(id)}
              className="group relative flex w-[108px] sm:w-[122px] cursor-pointer flex-col items-center focus:outline-none"
            >
              {/* Floating Mini Badge */}
              <span
                className={`mb-2 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider transition-all duration-300 ${
                  isSelected
                    ? "bg-[#3a1f0a] text-[#ffd88a] shadow-xs scale-105"
                    : "bg-[#3a1f0a]/10 text-[#7a4416] opacity-75 group-hover:opacity-100"
                }`}
              >
                {badge}
              </span>

              {/* Icon Box */}
              <div
                className={`relative flex h-16 w-16 sm:h-18 sm:w-18 items-center justify-center rounded-2xl border transition-all duration-300 ${
                  isSelected
                    ? "-translate-y-1.5 border-[#c58a3a] bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-[0_14px_32px_-8px_rgba(58,31,10,0.65)] ring-2 ring-[#c58a3a]/35"
                    : "border-[#7a4416]/20 bg-[#fffaf0]/95 text-[#3a1f0a] shadow-sm group-hover:-translate-y-1.5 group-hover:border-[#b8722c]/60 group-hover:bg-[#fffdf9]"
                }`}
              >
                <Icon size={30} strokeWidth={1.6} />
              </div>

              <p
                className={`mt-2.5 text-xs sm:text-sm font-black transition-colors ${
                  isSelected ? "text-[#3a1f0a]" : "text-[#2e1808] group-hover:text-[#b8722c]"
                }`}
                style={{ fontFamily: DISPLAY_FONT }}
              >
                {title}
              </p>

              <span
                className="text-[10px] font-semibold text-[#7a4416]"
                style={{ fontFamily: MONO_FONT }}
              >
                {eta}
              </span>

              {/* Desktop Hover Tooltip */}
              <div className="pointer-events-none absolute top-full z-40 mt-3 hidden lg:block w-60 origin-top scale-95 rounded-2xl border border-[#c58a3a]/40 bg-gradient-to-br from-[#3a1f0a] via-[#4a2a12] to-[#2e1808] px-4 py-3.5 text-center text-[#ffe9be] opacity-0 shadow-2xl transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
                <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-[#3a1f0a] border-t border-l border-[#c58a3a]/40" />
                <p className="text-[11px] font-semibold leading-relaxed">{description}</p>
              </div>
            </motion.button>
          );
        })}
      </motion.div>

      {/* SECTION 3: INTERACTIVE SERVICE TELEMETRY SPOTLIGHT TICKET */}
      <div className="mb-24">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeService.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="relative overflow-hidden rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e1]/92 to-[#f5dfb5]/92 p-6 sm:p-8 shadow-[0_20px_50px_-15px_rgba(58,31,10,0.2)] backdrop-blur-2xl"
          >
            {/* Brass Top Rail */}
            <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              {/* Left: Selected Service Details */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 max-w-2xl">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-lg ring-2 ring-[#c58a3a]/40">
                  <ActiveServiceIcon size={32} strokeWidth={1.75} />
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#3a1f0a] px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#ffd88a]">
                      {activeService.badge}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-950/15 border border-emerald-600/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-900"
                      style={{ fontFamily: MONO_FONT }}
                    >
                      <Clock className="h-3 w-3 text-emerald-700" />
                      {activeService.eta}
                    </span>
                    <span
                      className="rounded-full bg-[#3a1f0a]/10 border border-[#7a4416]/20 px-2.5 py-0.5 text-[11px] font-bold text-[#3a1f0a]"
                      style={{ fontFamily: MONO_FONT }}
                    >
                      {activeService.priceTier}
                    </span>
                  </div>

                  <h3
                    className="text-2xl sm:text-3xl font-black text-[#2e1808]"
                    style={{ fontFamily: DISPLAY_FONT }}
                  >
                    UrbanFleet {activeService.title}{" "}
                    <span className="text-base sm:text-lg font-semibold text-[#7a4416]">
                      — {activeService.tagline}
                    </span>
                  </h3>

                  <p className="text-xs sm:text-sm font-medium text-[#6b3a12] leading-relaxed">
                    {activeService.description}
                  </p>

                  {/* Feature Check Pills */}
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    {activeService.features.map((feat) => (
                      <span
                        key={feat}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#7a4416]/20 bg-[#fffaf0] px-3 py-1 text-[11px] font-bold text-[#3a1f0a] shadow-2xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                        {feat}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: Direct Dispatch CTA */}
              <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-3 shrink-0 border-t lg:border-t-0 lg:border-l border-[#7a4416]/15 pt-4 lg:pt-0 lg:pl-6">
                <div className="text-left lg:text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                    Estimated Tariff
                  </p>
                  <p
                    className="text-2xl font-black text-[#2e1808]"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {activeService.priceTier}
                  </p>
                </div>

                <Button
                  onClick={() => navigate(isAuthenticated ? "/dashboard" : "/login")}
                  className="group relative h-12 rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 text-xs font-bold uppercase tracking-wider text-[#ffe9be] shadow-lg hover:opacity-95 active:scale-95 transition-all"
                >
                  <span className="flex items-center gap-2">
                    Book {activeService.title} Now
                    <ArrowRight className="h-4 w-4 text-[#ffd88a] transition-transform group-hover:translate-x-1" />
                  </span>
                </Button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* SECTION 4: PLATFORM TELEMETRY & ARCHITECTURE METRICS STRIP */}
      <div className="mb-24 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLATFORM_METRICS.map(({ label, value, sub, icon: MetricIcon }) => (
          <div
            key={label}
            className="group rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff5e1]/90 to-[#f7e2b8]/90 p-5 shadow-md backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-[#b8722c]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a4416]">
                {label}
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-xs">
                <MetricIcon className="h-4 w-4" />
              </div>
            </div>
            <p
              className="mt-2.5 text-2xl font-black text-[#2e1808]"
              style={{ fontFamily: MONO_FONT }}
            >
              {value}
            </p>
            <p className="mt-0.5 text-xs font-medium text-[#6b3a12]">{sub}</p>
          </div>
        ))}
      </div>

      {/* SECTION 5: ACCOUNT / DUAL-PORTAL SHOWCASE (RIDER VS. CAPTAIN) */}
      <div className="flex flex-col-reverse items-center gap-12 lg:gap-16 lg:flex-row">
        {/* Left Side: Interactive Role Switcher & Auth CTA */}
        <motion.div
          variants={textSlideVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="flex-1 w-full"
        >
          {/* Role Switcher Tabs (Passenger vs. Driver Partner) */}
          <div className="mb-6 inline-flex items-center gap-1.5 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0]/90 p-1.5 shadow-sm">
            <button
              type="button"
              onClick={() => setPortalMode("rider")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                portalMode === "rider"
                  ? "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-sm"
                  : "text-[#6b3a12] hover:bg-[#fff4dc]"
              }`}
            >
              <Navigation className="h-3.5 w-3.5 text-[#ffd88a]" />
              Passenger Console
            </button>
            <button
              type="button"
              onClick={() => setPortalMode("driver")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                portalMode === "driver"
                  ? "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-sm"
                  : "text-[#6b3a12] hover:bg-[#fff4dc]"
              }`}
            >
              <Car className="h-3.5 w-3.5 text-[#b8722c]" />
              Captain & Fleet Hub
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={portalMode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <h2
                className="max-w-lg text-3xl font-black leading-[1.1] tracking-tight text-[#2e1808] sm:text-5xl"
                style={{ fontFamily: DISPLAY_FONT }}
              >
                {portalMode === "rider"
                  ? isAuthenticated
                    ? `Welcome back, ${firstName}.`
                    : "Log in to see your account details"
                  : "Drive when you want, earn what you need."}
              </h2>

              <p className="mt-5 max-w-md text-base sm:text-lg leading-relaxed font-medium text-[#6b3a12]">
                {portalMode === "rider"
                  ? isAuthenticated
                    ? "Access your active trips, one-click route rebooking, and RFC-secured device sessions straight from your passenger console."
                    : "View past trips, upfront fare receipts, live driver telemetry, and active security sessions in one unified dashboard."
                  : "Join UrbanFleet's verified captain network. Enjoy instant Razorpay wallet settlements, live geospatial ride radar, and full fare breakdown transparency."}
              </p>

              {/* Feature Bullet List */}
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                {(portalMode === "rider"
                  ? [
                      "One-click route rebooking",
                      "4-digit OTP boarding lock",
                      "Live Geoapify vector tracking",
                      "Multi-device session control",
                    ]
                  : [
                      "Instant driver wallet payouts",
                      "Real-time proximity dispatch",
                      "Audited commission ledger",
                      "Digital RTO document vault",
                    ]
                ).map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 text-xs font-bold text-[#3a1f0a]"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-950/15 text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="mt-9 flex flex-wrap items-center gap-5">
                {isAuthenticated ? (
                  <>
                    <Button
                      className="group relative h-14 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 text-base font-bold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:scale-95"
                      onClick={() =>
                        navigate(portalMode === "driver" ? "/driver-dashboard" : "/dashboard")
                      }
                    >
                      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                      <span className="relative z-10 flex items-center gap-2">
                        {portalMode === "driver"
                          ? "Open Captain Console"
                          : "Open Passenger Console"}
                        <ArrowRight className="h-4 w-4 text-[#ffd88a] transition-transform group-hover:translate-x-1" />
                      </span>
                      <span className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent transition-transform duration-1000 group-hover:translate-x-[420%]" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="group relative h-14 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 text-base font-bold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:scale-95"
                      onClick={() => navigate("/login")}
                    >
                      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                      <span className="relative z-10 flex items-center gap-2">
                        Log in to your account
                        <ArrowRight className="h-4 w-4 text-[#ffd88a] transition-transform group-hover:translate-x-1" />
                      </span>
                      <span className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent transition-transform duration-1000 group-hover:translate-x-[420%]" />
                    </Button>

                    <button
                      type="button"
                      className="group relative text-base font-bold text-[#6b3a12] transition-colors hover:text-[#3a1f0a]"
                      onClick={() => navigate("/signup")}
                    >
                      {portalMode === "driver" ? "Register as a Captain" : "Create an account"}
                      <span className="absolute -bottom-1 left-0 h-[2px] w-full bg-[#7a4416]/30 transition-all duration-300 group-hover:bg-[#b8722c]" />
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* Right Side: Golden-Brown Perforated Ticket Frame with Floating Telemetry HUDs */}
        <motion.div
          variants={imageRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="relative flex flex-1 justify-center lg:justify-end w-full"
        >
          <div className="relative w-full max-w-xl">
            {/* Floating Top-Left Live Dispatch HUD Pill */}
            <div className="pointer-events-none absolute -top-4 -left-2 sm:-left-6 z-20 flex items-center gap-3 rounded-2xl border border-[#fff4dc]/80 bg-[#2e1808]/95 px-4 py-3 text-[#ffe9be] shadow-2xl backdrop-blur-xl">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#ffd88a]">
                  Live Telemetry Active
                </p>
                <p className="text-xs font-bold text-white" style={{ fontFamily: MONO_FONT }}>
                  Captain Assigned • 2 min ETA
                </p>
              </div>
            </div>

            {/* Main Perforated Ticket Frame */}
            <div className="relative overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 sm:p-5 shadow-[0_30px_90px_-20px_rgba(80,40,10,0.42),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-2xl transition-transform duration-500 hover:scale-[1.015]">
              {/* Brass Top Rail */}
              <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent z-10" />

              {/* Perforation Edge Cutouts */}
              <div className="pointer-events-none absolute left-0 top-1/2 hidden sm:flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2 z-10">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span
                    key={`tl-${i}`}
                    className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
                  />
                ))}
              </div>
              <div className="pointer-events-none absolute right-0 top-1/2 hidden sm:flex translate-x-1/2 -translate-y-1/2 flex-col gap-2 z-10">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span
                    key={`tr-${i}`}
                    className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
                  />
                ))}
              </div>

              <img
                src={loginImage}
                alt="UrbanFleet Mobility Illustration"
                className="w-full rounded-3xl object-cover"
              />

              {/* Brass Bottom Rail */}
              <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent z-10" />
            </div>

            {/* Floating Bottom-Right Security & OTP Badge */}
            <div className="pointer-events-none absolute -bottom-4 -right-2 sm:-right-5 z-20 flex items-center gap-3 rounded-2xl border border-[#c58a3a]/45 bg-[#fffdf9]/95 px-4 py-3 text-[#2e1808] shadow-2xl backdrop-blur-xl">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-sm">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                  Verified Protection
                </p>
                <p className="text-xs font-black text-[#2e1808]">
                  PIN Verified • Upfront Ledger
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}