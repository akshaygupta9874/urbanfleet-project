import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./button-variants";

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
  loadingText?: React.ReactNode;
  enableSpotlight?: boolean;
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  isLoading = false,
  loadingText,
  enableSpotlight = true,
  disabled,
   onPointerMove,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const isDisabled = Boolean(disabled || isLoading);

  // Zero-re-render pointer tracking for subtle desktop brass spotlight
  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (enableSpotlight && event.pointerType === "mouse") {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        event.currentTarget.style.setProperty("--uf-btn-x", `${x}px`);
        event.currentTarget.style.setProperty("--uf-btn-y", `${y}px`);
      }
      onPointerMove?.(event);
    },
    [enableSpotlight, onPointerMove]
  );

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={isLoading ? "true" : undefined}
      aria-busy={isLoading || undefined}
      disabled={isDisabled}
      onPointerMove={handlePointerMove}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : isLoading ? (
        <>
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-current opacity-90"
            aria-hidden="true"
          />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants };