import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export default function BottomBanner() {
  // Reference to the section to track its position in the viewport
  const containerRef = useRef<HTMLElement>(null);

  // Track the scroll progress specifically for this component
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end end"], 
    // "start end" = when top of section hits bottom of viewport
    // "end end" = when bottom of section hits bottom of viewport
  });

  // Map the scroll progress (0 to 1) to animation values
  const textY = useTransform(scrollYProgress, [0, 1], [100, 0]); // Moves up
  const textOpacity = useTransform(scrollYProgress, [0, 0.8, 1], [0, 0.8, 1]); // Fades in
  const textScale = useTransform(scrollYProgress, [0, 1], [0.8, 1]); // Scales up

  return (
    <section 
      ref={containerRef}
      className="relative flex h-[30vh] items-center justify-center overflow-hidden bg-black md:h-[40vh]"
    >
      {/* Subtle top border to separate it from the previous section */}
      <div className="absolute top-0 h-[1px] w-full bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

      {/* Animated Background Text */}
      <motion.div 
        style={{ 
          y: textY, 
          opacity: textOpacity, 
          scale: textScale 
        }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <h1
          className="
            select-none
            whitespace-nowrap
            font-black
            leading-none
            tracking-[-0.08em]
            text-transparent
            bg-gradient-to-b
            from-zinc-600
            via-zinc-800
            to-black
            bg-clip-text
            opacity-80
            
            /* Responsive text sizing */
            text-7xl
            sm:text-8xl
            md:text-[10rem]
            lg:text-[13rem]
            xl:text-[16rem]
          "
        >
          Built by Akshay
        </h1>
      </motion.div>

    </section>
  );
}