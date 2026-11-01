import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  [
    // Layout & Typography
    "group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-xl text-sm font-bold tracking-tight",
    // Mobile & Touch Ergonomics (Zero 300ms delay, no grey tap flash, no text selection)
    "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] cursor-pointer",
    // 60fps GPU-Composited Spring Physics
    "transform-gpu transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
    "hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.97]",
    // Accessibility Focus Ring
    " outline-none focus-visible:ring-2 focus-visible:ring-[#b8722c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5e6c8]",
    // Disabled & Loading States
    "disabled:pointer-events-none disabled:opacity-55 disabled:saturate-75",
    // SVG Icon alignment & micro-motion
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200",
    // Specular Sheen Pseudo-Element (Safe for Radix Slot / asChild)
    "overflow-hidden after:pointer-events-none after:absolute after:inset-y-0 after:-left-1/3 after:w-1/3 after:-skew-x-12 after:bg-gradient-to-r after:from-transparent after:via-[#ffd88a]/30 after:to-transparent after:transition-transform after:duration-700 hover:after:translate-x-[420%]",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffe9be]",
          "border border-[#c58a3a]/45",
          "shadow-[0_12px_28px_-8px_rgba(58,31,10,0.65),inset_0_1px_0_rgba(255,216,138,0.35)]",
          "hover:shadow-[0_18px_36px_-10px_rgba(58,31,10,0.8),inset_0_1px_0_rgba(255,216,138,0.5)]",
          "hover:border-[#ffd88a]/60",
          "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300 before:bg-[radial-gradient(120px_circle_at_var(--uf-btn-x,50%)_var(--uf-btn-y,50%),rgba(255,216,138,0.18),transparent_80%)]",
        ].join(" "),

        destructive: [
          "bg-gradient-to-br from-rose-800 via-rose-900 to-rose-950 text-rose-50",
          "border border-rose-400/35",
          "shadow-[0_12px_28px_-8px_rgba(159,18,57,0.5),inset_0_1px_0_rgba(255,228,230,0.25)]",
          "hover:shadow-[0_16px_34px_-8px_rgba(159,18,57,0.65)] hover:border-rose-300/50",
          "after:via-white/20",
        ].join(" "),

        outline: [
          "border border-[#7a4416]/25 bg-[#fffdf9]/90 text-[#3a1f0a] backdrop-blur-md",
          "shadow-[0_4px_14px_-4px_rgba(58,31,10,0.1),inset_0_1px_0_rgba(255,255,255,0.85)]",
          "hover:bg-[#fff4dc] hover:text-[#2e1808] hover:border-[#b8722c]/60",
          "hover:shadow-[0_10px_24px_-6px_rgba(58,31,10,0.18)]",
          "after:via-[#c58a3a]/15",
        ].join(" "),

        secondary: [
          "border border-[#c58a3a]/40 bg-gradient-to-b from-[#fffaf0] via-[#fff4dc] to-[#f5dfb5] text-[#2e1808]",
          "shadow-[0_8px_20px_-6px_rgba(80,40,10,0.16),inset_0_1px_0_rgba(255,255,255,0.9)]",
          "hover:border-[#b8722c] hover:shadow-[0_12px_28px_-8px_rgba(80,40,10,0.25)]",
          "after:via-white/45",
        ].join(" "),

        success: [
          "bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 text-emerald-50",
          "border border-emerald-400/35",
          "shadow-[0_12px_28px_-8px_rgba(6,95,70,0.5),inset_0_1px_0_rgba(167,243,208,0.25)]",
          "hover:shadow-[0_16px_34px_-8px_rgba(6,95,70,0.65)] hover:border-emerald-300/50",
          "after:via-emerald-200/25",
        ].join(" "),

        ghost: [
          "text-[#3a1f0a] bg-transparent",
          "hover:bg-[#3a1f0a]/8 hover:text-[#2e1808]",
          "active:bg-[#3a1f0a]/12",
          "after:hidden hover:translate-y-0",
        ].join(" "),

        link: [
          "text-[#6b3a12] underline-offset-4 hover:underline hover:text-[#3a1f0a]",
          "after:hidden hover:translate-y-0 active:scale-100",
        ].join(" "),
      },
      size: {
        default: "h-11 px-5 py-2.5 text-sm rounded-xl has-[>svg]:px-4",
        sm: "h-9 px-3.5 py-1.5 text-xs rounded-xl gap-1.5 has-[>svg]:px-2.5",
        lg: "h-13 px-7 py-3.5 text-base rounded-2xl has-[>svg]:px-5",
        xl: "h-14 px-8 py-4 text-base rounded-2xl has-[>svg]:px-6",
        icon: "size-10 rounded-xl p-0",
        "icon-sm": "size-8 rounded-lg p-0",
        "icon-lg": "size-12 rounded-2xl p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);