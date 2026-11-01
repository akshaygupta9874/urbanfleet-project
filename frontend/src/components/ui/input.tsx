import * as React from "react";

import { cn } from "../../lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  variant?: "default" | "ghost" | "console";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = "default", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        data-variant={variant}
        className={cn(
          // Core Layout & Mobile Auto-Zoom Prevention (16px base on mobile, 14px on sm+)
          "flex h-11 w-full min-w-0 rounded-xl px-3.5 py-2 text-base sm:text-sm font-semibold text-[#2e1808]",
          // Mobile Touch & Selection Ergonomics
          "touch-manipulation [-webkit-tap-highlight-color:transparent]",
          "selection:bg-[#3a1f0a] selection:text-[#ffd88a]",
          // Smooth 60fps Cubic-Bezier Transitions
          "transform-gpu transition-[border-color,box-shadow,background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none",
          // Placeholder Typography
          "placeholder:font-normal placeholder:text-[#7a4416]/45",
          // Variant Styles
          variant === "default" && [
            "border border-[#7a4416]/25 bg-[#fffdf9]/95",
            "shadow-[0_2px_10px_-4px_rgba(58,31,10,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]",
            "hover:border-[#b8722c]/60 hover:bg-[#fffdf9]",
            "focus-visible:border-[#3a1f0a] focus-visible:bg-[#fffdf9] focus-visible:ring-3 focus-visible:ring-[#c58a3a]/25",
          ],
          variant === "ghost" && [
            "border-0 bg-transparent px-0 shadow-none",
            "focus-visible:ring-0",
          ],
          variant === "console" && [
            "border-2 border-[#7a4416]/30 bg-[#fffaf0] font-mono tracking-wider",
            "shadow-inner",
            "hover:border-[#b8722c]",
            "focus-visible:border-[#3a1f0a] focus-visible:bg-[#fffdf9] focus-visible:ring-4 focus-visible:ring-[#c58a3a]/25",
          ],
          // Styled File Upload Pill (for Driver Document & Passbook Uploads)
          "file:mr-3 file:inline-flex file:h-7 file:cursor-pointer file:items-center file: rounded-lg file:border-0",
          "file:bg-gradient-to-br file:from-[#3a1f0a] file:to-[#6b3a12] file:px-3 file:text-xs file:font-bold file:text-[#ffd88a]",
          "file:shadow-2xs file:transition-all hover:file:opacity-95 active:file:scale-95",
          // Validation & Error States
          "aria-invalid:border-rose-600 aria-invalid:bg-rose-950/5 aria-invalid:ring-3 aria-invalid:ring-rose-500/20",
          // Disabled State
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[#f5e6c8]/60 disabled:text-[#7a4416]/50 disabled:opacity-60",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input };