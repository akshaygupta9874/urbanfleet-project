import { motion } from "framer-motion";
import { MapPin, Navigation2 } from "lucide-react";

type LoadingScreenProps = {
  label?: string;
  sublabel?: string;
};

export default function LoadingScreen({
  label = "Loading....",
  sublabel = "Getting Things Done..",
}: LoadingScreenProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,_#fbf5ea_0%,_#f0e1c8_40%,_#d9b98a_100%)] px-6 py-10 text-[#2b1d0e]">
      {/* Ambient warm blobs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -left-24 top-8 h-80 w-80 rounded-full bg-amber-500/25 blur-[130px]"
          animate={{ x: [0, 50, -20, 0], y: [0, -30, 30, 0], scale: [1, 1.1, 0.95, 1] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-10 -right-10 h-96 w-96 rounded-full bg-[#c98a3c]/30 blur-[130px]"
          animate={{ x: [0, -60, 20, 0], y: [0, 30, -25, 0], scale: [1, 0.9, 1.08, 1] }}
          transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/3 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[#8b5a2b]/15 blur-[110px]"
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.65, 0.4] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Grain / topographic overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(80,50,20,0.4) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      <motion.section
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-[2rem] border border-[#eadfc7] bg-gradient-to-br from-[#fdf8ee]/90 via-[#f5e6cc]/85 to-[#e6cfa8]/85 p-8 shadow-[0_40px_120px_-30px_rgba(90,55,20,0.5)] backdrop-blur-2xl"
      >
        {/* Shine sweep */}
        <motion.div
          className="pointer-events-none absolute -inset-y-10 -left-1/2 w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/50 to-transparent"
          animate={{ x: ["0%", "320%"] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
        />

        {/* Perforation edges (ticket) */}
        <div className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[#e6cfa8]" />
        <div className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[#e6cfa8]" />

        <div className="relative flex flex-col items-center text-center">
          {/* Map ping + orbiting car */}
          <div className="relative mb-7 flex h-28 w-28 items-center justify-center">
            {/* Pulsing rings */}
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute inset-0 rounded-full border border-[#8b5a2b]/40"
                animate={{ scale: [1, 1.7], opacity: [0.55, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
              />
            ))}

            {/* Rotating conic ring */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, #c98a3c 90deg, transparent 180deg, #8b5a2b 270deg, transparent 360deg)",
                mask: "radial-gradient(circle, transparent 62%, black 63%)",
                WebkitMask: "radial-gradient(circle, transparent 62%, black 63%)",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
            />

            {/* Inner disc */}
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[#e2c99b] bg-gradient-to-br from-[#fff8ea] to-[#e9cfa1] shadow-inner">
              <motion.div
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <MapPin className="h-8 w-8 text-[#7a4a1f]" strokeWidth={2.2} />
              </motion.div>
            </div>

            {/* Orbiting car */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: 360 }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }}
            >
              <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#c98a3c]/60 bg-[#fdf8ee] p-1.5 shadow-md">
                <Navigation2 className="h-3.5 w-3.5 text-[#7a4a1f]" fill="#7a4a1f" />
              </div>
            </motion.div>
          </div>

          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="bg-gradient-to-r from-[#5b3a17] via-[#8b5a2b] to-[#c98a3c] bg-clip-text text-2xl font-semibold tracking-tight text-transparent"
          >
            {label}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
            className="mt-3 max-w-md text-sm leading-6 text-[#5b3a17]/75"
          >
            {sublabel}
          </motion.p>

          {/* Route line pickup -> drop */}
          <div className="mt-7 flex w-full max-w-xs items-center gap-3">
            <motion.span
              className="h-2.5 w-2.5 rounded-full bg-[#7a4a1f]"
              animate={{ scale: [1, 1.35, 1], boxShadow: ["0 0 0 0 rgba(122,74,31,0.5)", "0 0 0 8px rgba(122,74,31,0)", "0 0 0 0 rgba(122,74,31,0)"] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
            <div className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-[#8b5a2b]/20">
              <motion.div
                className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[#8b5a2b] to-transparent"
                animate={{ x: ["-100%", "300%"] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
            <motion.span
              className="h-3 w-3 rounded-sm bg-[#c98a3c]"
              animate={{ rotate: [0, 90, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>

          {/* Bouncing dots */}
          <div className="mt-6 flex items-center gap-2">
            {[0, 1, 2].map((dot) => (
              <motion.span
                key={dot}
                className="h-2 w-2 rounded-full bg-[#7a4a1f]"
                animate={{ y: [0, -7, 0], opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 0.95, repeat: Infinity, delay: dot * 0.15 }}
              />
            ))}
          </div>

          {/* Footer chip */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-7 inline-flex items-center gap-2 rounded-full border border-[#e2c99b] bg-white/60 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[#7a4a1f]"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            Live · secure connection
          </motion.div>
        </div>
      </motion.section>
    </main>
  );
}
