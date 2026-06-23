import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border-[2.5px] border-[#111111] text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "bg-[#111111] text-white",
        secondary: "bg-white text-[#0A4454]",
        outline: "bg-[#F5F5F3] text-[#0A4454]",
        ghost: "border-transparent bg-transparent text-[#0A4454] hover:border-[#111111] hover:bg-white",
        destructive: "bg-destructive text-destructive-foreground"
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-9 px-3",
        lg: "min-h-12 px-6 py-2.5 text-base",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const buttonVariant = variant ?? "default";
    const buttonSize = size ?? "default";

    return (
      <Comp
        data-slot="button"
        data-variant={buttonVariant}
        data-size={buttonSize}
        className={cn(buttonVariants({ variant: buttonVariant, size: buttonSize, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
