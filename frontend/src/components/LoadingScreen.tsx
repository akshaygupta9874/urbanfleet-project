import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Car,
  MapPin,
  Navigation2,
  ShieldCheck,
  Sparkles,
  Compass,
} from "lucide-react";

export type LoadingScreenProps = {
  label?: string;
  sublabel?: string;
};

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

const TELEMETRY_STEPS = [
  "Authenticating RFC 6819 session token…",
  "Synchronizing H3 geospatial index…",
  "Connecting live WebSocket dispatch radar…",
  "Calibrating Geoapify vector routing…",
];

export default function LoadingScreen({
  label = "Initializing UrbanFleet",
  sublabel = "Synchronizing live fleet telemetry & route corridors…",
}: LoadingScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev + 1) % TELEMETRY_STEPS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <main
      role="status"
      aria-live="polite"
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#f5e6c8] px-4 py-10 text-[#2e1808] select-none"
      style={{ fontFamily: BODY_FONT }}
    >
      <style>{`
        @keyframes uf-radar-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes uf-radar-counter {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes uf-ping-ring {
          0% { transform: scale(0.8); opacity: 0.75; }
          80%, 100% { transform: scale(1.65); opacity: 0; }
        }
        @keyframes uf-shimmer-sweep {
          0% { transform: translate3d(-120%, 0, 0) rotate(12deg); }
          100% { transform: translate3d(260%, 0, 0) rotate(12deg); }
        }
        .uf-spin-slow {
          animation: uf-radar-spin 4.2s linear infinite;
          will-change: transform;
        }
        .uf-spin-orbit {
          animation: uf-radar-spin 5.5s linear infinite;
          will-change: transform;
        }
        .uf-spin-reverse {
          animation: uf-radar-counter 9s linear infinite;
          will-change: transform;
        }
        .uf-radar-ping {
          animation: uf-ping-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
          will-change: transform, opacity;
        }
        .uf-radar-ping-delayed {
          animation: uf-ping-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) 1.2s infinite;
          will-change: transform, opacity;
        }
        .uf-card-shimmer {
          animation: uf-shimmer-sweep 3.8s ease-in-out infinite;
          will-change: transform;
        }
      `}</style>

      {/* Zero-Lag GPU Cartographic Parchment Backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_25%_15%,#fff8eb_0%,#f5e6c8_40%,#e6c893_75%,#c99a5a_100%)]" />

      {/* Subtle Ambient Corner Glows (Zero Gaussian Blur Shader Cost on Mobile) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(217,165,33,0.28)_0%,transparent_48%),radial-gradient(circle_at_88%_82%,rgba(122,68,22,0.32)_0%,transparent_48%)]" />

      {/* Precision Topographic Coordinate Grid Overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(rgba(80,45,15,0.4) 1px, transparent 1px), linear-gradient(to right, rgba(122,68,22,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(122,68,22,0.08) 1px, transparent 1px)",
          backgroundSize: "20px 20px, 80px 80px, 80px 80px",
        }}
      />

      {/* Main Perforated Luxury Telemetry Ticket */}
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md sm:max-w-lg overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/92 to-[#f5dfb5]/92 p-7 sm:p-10 shadow-[0_32px_90px_-20px_rgba(46,24,8,0.38),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-2xl transform-gpu"
      >
        {/* Brass Top Rail */}
        <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

        {/* GPU-Accelerated Specular Shine Sweep */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2.5rem]">
          <div className="uf-card-shimmer absolute -inset-y-16 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>

        {/* Multi-Dot Ticket Perforation Cutouts (Left & Right) */}
        <div className="pointer-events-none absolute left-0 top-1/2 hidden sm:flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={`pl-${i}`}
              className="h-2.5 w-2.5 rounded-full bg-[#e8cba0] shadow-inner"
            />
          ))}
        </div>
        <div className="pointer-events-none absolute right-0 top-1/2 hidden sm:flex translate-x-1/2 -translate-y-1/2 flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={`pr-${i}`}
              className="h-2.5 w-2.5 rounded-full bg-[#e8cba0] shadow-inner"
            />
          ))}
        </div>

        <div className="relative flex flex-col items-center text-center">
          {/* Top Brand Pill */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-3.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-[#ffd88a] shadow-sm ring-1 ring-[#c58a3a]/40">
            <Sparkles className="h-3 w-3 text-[#ffd88a]" />
            UrbanFleet Telemetry
          </div>

          {/* Central Geospatial Radar & Orbiting Beacon */}
          <div className="relative mb-7 flex h-32 w-32 items-center justify-center">
            {/* GPU Expanding Radar Rings */}
            <span className="uf-radar-ping pointer-events-none absolute inset-2 rounded-full border border-[#b8722c]/45" />
            <span className="uf-radar-ping-delayed pointer-events-none absolute inset-2 rounded-full border border-[#3a1f0a]/30" />

            {/* Outer Compass Degree Ring (Counter-Rotating SVG) */}
            <svg
              viewBox="0 0 120 120"
              className="uf-spin-reverse pointer-events-none absolute inset-0 h-full w-full"
            >
              <circle
                cx="60"
                cy="60"
                r="56"
                fill="none"
                stroke="#7a4416"
                strokeWidth="1"
                strokeDasharray="2 6"
                opacity="0.45"
              />
              <circle
                cx="60"
                cy="60"
                r="48"
                fill="none"
                stroke="#c58a3a"
                strokeWidth="1"
                strokeDasharray="12 8"
                opacity="0.35"
              />
            </svg>

            {/* Conic Radar Sweep Ring */}
            <div
              className="uf-spin-slow pointer-events-none absolute inset-2 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, rgba(197,138,58,0.85) 85deg, transparent 170deg, rgba(58,31,10,0.75) 265deg, transparent 360deg)",
                mask: "radial-gradient(circle, transparent 63%, black 65%)",
                WebkitMask: "radial-gradient(circle, transparent 63%, black 65%)",
              }}
            />

            {/* Inner Luxury Medallion */}
            <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full border border-[#c58a3a]/50 bg-gradient-to-br from-[#3a1f0a] via-[#5c3211] to-[#241205] text-[#ffd88a] shadow-[0_12px_28px_-6px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)]">
              <div className="pointer-events-none absolute inset-1.5 rounded-full border border-[#ffd88a]/20" />
              <motion.div
                animate={{ y: [0, -2.5, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                className="flex flex-col items-center"
              >
                <Car className="h-7 w-7 text-[#ffd88a]" strokeWidth={1.8} />
              </motion.div>
            </div>

            {/* Orbiting Satellite / Navigation Beacon */}
            <div className="uf-spin-orbit pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full border border-[#c58a3a] bg-[#fffdf9] shadow-md">
                <Navigation2
                  className="h-3.5 w-3.5 rotate-90 text-[#3a1f0a]"
                  fill="#3a1f0a"
                />
              </div>
            </div>
          </div>

          {/* Primary Headline */}
          <h1
            className="text-2xl sm:text-3xl font-black tracking-tight text-[#2e1808]"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {label}
          </h1>

          {/* Subtitle */}
          <p className="mt-2 max-w-sm text-xs sm:text-sm font-medium leading-relaxed text-[#6b3a12]">
            {sublabel}
          </p>

          {/* Miniature Pickup -> Drop-off Corridor Progress Bar */}
          <div className="mt-7 w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-4 shadow-inner">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a4416] mb-2.5">
              <span className="flex items-center gap-1.5 text-emerald-900">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
                Origin Lock
              </span>
              <span
                className="text-[10px] font-bold text-[#3a1f0a]"
                style={{ fontFamily: MONO_FONT }}
              >
                GPS ACTIVE
              </span>
              <span className="flex items-center gap-1 text-[#b8722c]">
                <MapPin className="h-3 w-3" />
                Corridor
              </span>
            </div>

            {/* Animated Route Track */}
            <div className="relative flex items-center w-full py-1">
              {/* Pickup Node */}
              <span className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-[#fffdf9] bg-[#3a1f0a] shadow-xs" />

              {/* Track Line */}
              <div className="relative mx-1.5 h-1.5 flex-1 overflow-hidden rounded-full bg-[#3a1f0a]/10">
                <motion.div
                  className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-[#b8722c] to-[#3a1f0a]"
                  animate={{ x: ["-100%", "260%"] }}
                  transition={{
                    duration: 1.75,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>

              {/* Destination Diamond Node */}
              <span className="relative z-10 h-3 w-3 shrink-0 rotate-45 rounded-[2px] border border-[#fffdf9] bg-[#b8722c] shadow-xs" />
            </div>

            {/* Cycling Monospace Subsystem Diagnostic Readout */}
            <div className="mt-2.5 h-4 overflow-hidden text-center">
              <AnimatePresence mode="wait">
                <motion.p
                  key={stepIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22 }}
                  className="text-[11px] font-semibold text-[#6b3a12] truncate"
                  style={{ fontFamily: MONO_FONT }}
                >
                  {TELEMETRY_STEPS[stepIndex]}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom Ticket Perforation Divider */}
          <div className="my-5 flex w-full items-center gap-2">
            <div
              className="h-px flex-1"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, #7a4416 0 6px, transparent 6px 12px)",
                opacity: 0.3,
              }}
            />
          </div>

          {/* Subsystem Telemetry Badges */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-950/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-950"
              style={{ fontFamily: MONO_FONT }}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              Socket Live
            </span>

            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#3a1f0a]"
              style={{ fontFamily: MONO_FONT }}
            >
              <ShieldCheck className="h-3 w-3 text-[#b8722c]" />
              TLS 1.3 Verified
            </span>

            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#3a1f0a]"
              style={{ fontFamily: MONO_FONT }}
            >
              <Compass className="h-3 w-3 text-[#b8722c]" />
              H3 Spatial
            </span>
          </div>
        </div>

        {/* Brass Bottom Rail */}
        <div className="pointer-events-none absolute inset-x-10 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
      </motion.section>
    </main>
  );
}