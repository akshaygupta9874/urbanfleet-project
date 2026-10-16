import { motion, type Variants } from "framer-motion";
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
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../context/auth-context";

const loginImage =
  "https://tb-static.uber.com/prod/udam-assets/850e6b6d-a29e-4960-bcab-46de99547d24.svg";

const services = [
  { icon: Car, title: "Ride", description: "Go anywhere with Aura. Request a ride, hop in, and go." },
  { icon: CalendarDays, title: "Reserve", description: "Reserve your ride in advance and travel stress free." },
  { icon: Bike, title: "Bike", description: "Quick and affordable bike rides around your city." },
  { icon: CarTaxiFront, title: "Intercity", description: "Travel comfortably between cities with Aura." },
  { icon: Package, title: "Parcel", description: "Send parcels quickly and securely." },
  { icon: Plane, title: "Airport", description: "Reliable airport pickups and drop-offs." },
  { icon: BatteryCharging, title: "Electric", description: "Choose eco-friendly electric rides." },
  { icon: Users, title: "Teens", description: "Safe rides designed for teens." },
  { icon: PersonStanding, title: "Seniors", description: "Convenient rides for senior citizens." },
  { icon: Bus, title: "Shuttle", description: "Shared rides at affordable prices." }
];

// --- Animation Variants ---

const gridVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const iconVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.8 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

const textSlideVariants: Variants = {
  hidden: { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.8, ease: "easeOut" },
  },
};

const imageRevealVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.8, ease: "easeOut", delay: 0.2 },
  },
};

export default function LandingPage2() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthContext();
  const firstName = user?.firstName ? user.firstName : "Rider";

  return (
    <section className="relative mx-auto max-w-7xl px-6 py-24 overflow-hidden font-sans text-[#2e1808]">
      
      {/* SERVICES GRID */}
      <motion.div
        variants={gridVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        className="px-4 mb-32 flex flex-wrap justify-center gap-6 lg:gap-8"
      >
        {services.map(({ icon: Icon, title, description }) => (
          <motion.div
            variants={iconVariants}
            key={title}
            className="group relative flex cursor-pointer flex-col items-center"
          >
            {/* Icon Box */}
            <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-5 text-[#3a1f0a] shadow-sm transition-all duration-300 group-hover:-translate-y-2 group-hover:bg-gradient-to-br group-hover:from-[#3a1f0a] group-hover:via-[#6b3a12] group-hover:to-[#2e1808] group-hover:text-[#ffd88a] group-hover:shadow-[0_12px_30px_-10px_rgba(58,31,10,0.6)] group-hover:border-[#c58a3a]/40">
              <Icon size={32} strokeWidth={1.5} />
            </div>

            <p className="mt-3 text-sm font-bold text-[#2e1808] transition-colors group-hover:text-[#b8722c]">
              {title}
            </p>

            {/* Hover Tooltip */}
            <div className="pointer-events-none absolute top-full z-50 mt-4 w-64 origin-top scale-95 rounded-2xl border border-[#c58a3a]/40 bg-gradient-to-br from-[#3a1f0a] via-[#4a2a12] to-[#2e1808] px-5 py-4 text-center text-[#ffe9be] opacity-0 shadow-2xl transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
              {/* Arrow pointer */}
              <div className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 bg-[#3a1f0a] border-t border-l border-[#c58a3a]/40" />
              <p className="text-xs font-semibold leading-relaxed">
                {description}
              </p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* ACCOUNT / AUTH SECTION */}
      <div className="flex flex-col-reverse items-center gap-16 lg:flex-row">
        
        {/* Left Side (Text) */}
        <motion.div
          variants={textSlideVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="flex-1"
        >
          <h2 
            className="max-w-lg text-4xl font-extrabold leading-[1.1] tracking-tight text-[#2e1808] sm:text-5xl"
            style={{ fontFamily: "'Fraunces', Georgia, serif" }}
          >
            {isAuthenticated
              ? `Welcome back, ${firstName}.`
              : "Log in to see your account details"}
          </h2>

          <p className="mt-6 max-w-md text-lg leading-relaxed font-medium text-[#6b3a12]">
            {isAuthenticated
              ? "Access your active trips, tailored recommendations, and driver hub straight from your dashboard."
              : "View past trips, tailored suggestions, support resources, and more."}
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-6">
            {isAuthenticated ? (
              <Button
                className="group relative h-14 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 text-base font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:scale-95"
                onClick={() => navigate("/dashboard")}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10">Open your dashboard</span>
                <span className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent transition-transform duration-1000 group-hover:translate-x-[420%]" />
              </Button>
            ) : (
              <>
                <Button
                  className="group relative h-14 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 text-base font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:scale-95"
                  onClick={() => navigate("/login")}
                >
                  <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                  <span className="relative z-10">Log in to your account</span>
                  <span className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent transition-transform duration-1000 group-hover:translate-x-[420%]" />
                </Button>

                <button
                  type="button"
                  className="group relative text-base font-semibold text-[#6b3a12] transition-colors hover:text-[#3a1f0a]"
                  onClick={() => navigate("/signup")}
                >
                  Create an account
                  <span className="absolute -bottom-1 left-0 h-[2px] w-full bg-[#7a4416]/30 transition-all duration-300 group-hover:bg-[#b8722c]"></span>
                </button>
              </>
            )}
          </div>
        </motion.div>

        {/* Right Side (Image in Golden-Brown Ticket Card Frame) */}
        <motion.div
          variants={imageRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="flex flex-1 justify-center lg:justify-end"
        >
          <div className="relative overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 shadow-[0_30px_90px_-20px_rgba(80,40,10,0.4),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-2xl transition-transform duration-500 hover:scale-[1.02]">
            {/* Brass top rail */}
            <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent z-10" />

            <img
              src={loginImage}
              alt="Aura Login Illustration"
              className="w-full max-w-xl rounded-3xl object-cover"
            />
          </div>
        </motion.div>
        
      </div>
    </section>
  );
}