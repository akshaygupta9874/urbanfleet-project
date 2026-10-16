import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Menu, X, Car, UserCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../context/auth-context";

// 1. Extract links to an array to keep the code DRY
const NAV_LINKS = [
  { name: "Ride", href: "#" },
  { name: "Drive", href: "#" },
  { name: "Business", href: "#" },
  { name: "About", href: "#" },
];

function NavBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthContext();

  const firstName = user?.firstName ? user.firstName : "Account";

  // 2. Detect scroll for a sleek glassmorphism parchment effect
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 3. Prevent background scrolling when mobile menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
  }, [isOpen]);

  return (
    <nav
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#fffaf0]/90 backdrop-blur-md shadow-[0_10px_30px_-10px_rgba(80,40,10,0.15)] border-b border-[#7a4416]/20"
          : "bg-[#f5e6c8]/90 backdrop-blur-sm border-b border-[#7a4416]/10"
      } text-[#2e1808]`}
    >
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <div 
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => navigate("/dashboard")}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)] transition-transform duration-300 group-hover:scale-105">
            <Car size={22} />
          </div>
          <h1 
            className="text-3xl font-bold tracking-tight text-[#2e1808] transition-opacity hover:opacity-80"
            style={{ fontFamily: "'Fraunces', Georgia, serif" }}
          >
            UrbanFleet
          </h1>
        </div>

        {/* Desktop Navigation */}
        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.name}>
              <a
                href={link.href}
                className="relative text-sm font-semibold text-[#6b3a12] transition-colors hover:text-[#3a1f0a]
                           after:absolute after:-bottom-1 after:left-0 after:h-[2px] after:w-0
                           after:bg-[#b8722c] after:transition-all after:duration-300 hover:after:w-full"
              >
                {link.name}
              </a>
            </li>
          ))}
        </ul>

        {/* Desktop Buttons / User Profile */}
        <div className="hidden items-center gap-3 md:flex">
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-[#7a4416]/20 bg-[#fffaf0]/80 px-4 py-2 shadow-sm">
                <UserCircle size={18} className="text-[#b8722c]" />
                <span className="text-sm font-bold text-[#3a1f0a]">
                  Hey, {firstName}
                </span>
              </div>

              <Button 
                className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 py-2.5 text-sm font-semibold text-[#ffe9be] shadow-[0_12px_28px_-10px_rgba(58,31,10,0.6)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-12px_rgba(58,31,10,0.8)]"
                onClick={() => navigate("/dashboard")}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10">Dashboard</span>
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                className="rounded-xl text-[#3a1f0a] font-semibold transition-all hover:bg-[#fff4dc] hover:text-[#2e1808]"
                onClick={() => navigate("/login")}
              >
                Log in
              </Button>

              <Button 
                className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 py-2.5 text-sm font-semibold text-[#ffe9be] shadow-[0_12px_28px_-10px_rgba(58,31,10,0.6)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-12px_rgba(58,31,10,0.8)]"
                onClick={() => navigate("/signup")}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10">Sign up</span>
              </Button>
            </>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="rounded-xl p-2.5 -mr-2 border border-[#7a4416]/20 bg-[#fffaf0]/80 text-[#3a1f0a] transition-colors hover:bg-[#fff4dc] md:hidden shadow-sm"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label="Toggle navigation menu"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu with Framer Motion */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "calc(100vh - 5rem)" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="absolute left-0 top-20 w-full overflow-hidden border-t border-[#7a4416]/20 bg-gradient-to-b from-[#fffaf0] via-[#fff4dc] to-[#f7e2b8] px-6 md:hidden shadow-2xl backdrop-blur-2xl"
          >
            <div className="flex h-full flex-col py-8">
              <ul className="flex flex-col gap-6">
                {NAV_LINKS.map((link, index) => (
                  <motion.li
                    key={link.name}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.08 }}
                  >
                    <a
                      href={link.href}
                      className="block text-3xl font-bold text-[#2e1808] transition-colors hover:text-[#b8722c]"
                      style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      onClick={() => setIsOpen(false)}
                    >
                      {link.name}
                    </a>
                  </motion.li>
                ))}
              </ul>

              <div className="mt-auto mb-10 flex flex-col gap-4 border-t border-[#7a4416]/20 pt-8">
                {isAuthenticated ? (
                  <>
                    <div className="flex items-center gap-3 rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-4 shadow-sm">
                      <UserCircle size={24} className="text-[#b8722c]" />
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#7a4416]">Signed in as</p>
                        <p className="text-base font-bold text-[#2e1808]">{firstName}</p>
                      </div>
                    </div>

                    <Button
                      className="w-full rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-6 text-base font-semibold text-[#ffe9be] shadow-[0_14px_30px_-10px_rgba(58,31,10,0.7)]"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/dashboard");
                      }}
                    >
                      Go to Dashboard
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      className="w-full justify-center rounded-xl py-6 text-base font-semibold text-[#3a1f0a] hover:bg-[#fff4dc] border border-[#7a4416]/20"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/login");
                      }}
                    >
                      Log in
                    </Button>

                    <Button
                      className="w-full rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-6 text-base font-semibold text-[#ffe9be] shadow-[0_14px_30px_-10px_rgba(58,31,10,0.7)]"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/signup");
                      }}
                    >
                      Sign up
                    </Button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default NavBar;