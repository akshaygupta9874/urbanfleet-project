import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { ShieldAlert, Sparkles, Navigation } from "lucide-react";

// ---------- Golden-brown animated city map background ----------
function CityMapBackground() {
  const verticals = useMemo(
    () => [60, 140, 230, 320, 410, 500, 600, 700, 820, 940, 1060, 1180, 1300],
    [],
  );
  const horizontals = useMemo(() => [60, 140, 230, 330, 430, 540, 640, 740, 840], []);

  const pins = useMemo(
    () => [
      { x: 220, y: 200, delay: 0.2 },
      { x: 760, y: 140, delay: 1.1 },
      { x: 1080, y: 520, delay: 0.6 },
      { x: 340, y: 640, delay: 1.6 },
      { x: 980, y: 300, delay: 2.0 },
      { x: 540, y: 420, delay: 0.9 },
    ],
    [],
  );

  const routes = useMemo(
    () => [
      { d: "M -40 230 L 410 230 L 410 430 L 940 430 L 940 230 L 1380 230", dur: 14, delay: 0, color: "#3a1f0a" },
      { d: "M 1380 540 L 820 540 L 820 740 L 320 740 L 320 540 L -40 540", dur: 18, delay: 2, color: "#4a2a12" },
      { d: "M 140 -40 L 140 330 L 600 330 L 600 640 L 1060 640 L 1060 900", dur: 16, delay: 4, color: "#2e1808" },
    ],
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_15%,#fff7e6_0%,#f5e6c8_35%,#e6c893_65%,#c99a5a_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(rgba(80,45,15,0.35) 1px, transparent 1px), radial-gradient(rgba(80,45,15,0.2) 1px, transparent 1px)",
          backgroundSize: "3px 3px, 7px 7px",
          backgroundPosition: "0 0, 1px 2px",
        }}
      />
      <motion.div
        className="absolute -left-40 top-0 h-[560px] w-[560px] rounded-full bg-[#f4b860]/40 blur-[130px]"
        animate={{ x: [0, 60, -20, 0], y: [0, 40, -30, 0], scale: [1, 1.15, 0.9, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-40 bottom-0 h-[560px] w-[560px] rounded-full bg-[#b8722c]/40 blur-[130px]"
        animate={{ x: [0, -60, 30, 0], y: [0, -40, 30, 0], scale: [1, 0.9, 1.2, 1] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.svg
        viewBox="0 0 1340 880"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        animate={{ x: [0, -24, 0, 18, 0], y: [0, 10, 0, -8, 0] }}
        transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }}
      >
        <defs>
          <linearGradient id="brassRoute" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7a4416" />
            <stop offset="50%" stopColor="#c58a3a" />
            <stop offset="100%" stopColor="#7a4416" />
          </linearGradient>
          <radialGradient id="pinGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffd88a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffd88a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {verticals.slice(0, -1).map((vx, i) =>
          horizontals.slice(0, -1).map((hy, j) => (
            <rect
              key={`b-${i}-${j}`}
              x={vx + 6}
              y={hy + 6}
              width={verticals[i + 1] - vx - 12}
              height={horizontals[j + 1] - hy - 12}
              fill={(i + j) % 4 === 0 ? "#e8c98b" : (i + j) % 4 === 1 ? "#dbb271" : (i + j) % 4 === 2 ? "#efd8a3" : "#cf9d55"}
              rx={3}
              opacity={0.55}
            />
          )),
        )}

        {verticals.map((vx) => (
          <line key={`v-${vx}`} x1={vx} y1={-20} x2={vx} y2={900} stroke="#fff4dc" strokeWidth={10} />
        ))}
        {horizontals.map((hy) => (
          <line key={`h-${hy}`} x1={-20} y1={hy} x2={1360} y2={hy} stroke="#fff4dc" strokeWidth={10} />
        ))}

        {routes.map((r, idx) => (
          <g key={`route-${idx}`}>
            <path d={r.d} stroke={r.color} strokeOpacity={0.22} strokeWidth={5} fill="none" strokeLinecap="round" />
            <motion.path
              d={r.d}
              stroke="url(#brassRoute)"
              strokeWidth={5}
              fill="none"
              strokeLinecap="round"
              strokeDasharray="80 1600"
              initial={{ strokeDashoffset: 0 }}
              animate={{ strokeDashoffset: [-1680, 0] }}
              transition={{ duration: r.dur, delay: r.delay, repeat: Infinity, ease: "linear" }}
            />
          </g>
        ))}

        {pins.map((p, i) => (
          <g key={`pin-${i}`} transform={`translate(${p.x} ${p.y})`}>
            <circle r={28} fill="url(#pinGlow)" />
            <motion.circle
              r={6}
              fill="#c58a3a"
              opacity={0.6}
              animate={{ r: [6, 28, 6], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2.4, delay: p.delay, repeat: Infinity, ease: "easeOut" }}
            />
            <circle r={5} fill="#3a1f0a" />
            <circle r={2} fill="#fff4dc" />
          </g>
        ))}
      </motion.svg>
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#f5e6c8]/95 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#c99a5a]/60 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(60,30,8,0.35)_100%)]" />
    </div>
  );
}

export default function UnauthorizedPage() {
  const navigate = useNavigate();

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
            to="/dashboard"
            className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-3.5 text-sm font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:translate-y-0"
          >
            <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
            <span className="relative z-10 inline-flex items-center justify-center gap-2">
              <Navigation size={15} className="text-[#ffd88a]" />
              Go to Dashboard
            </span>
          </Link>

          <button
            onClick={() => navigate(-1)}
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