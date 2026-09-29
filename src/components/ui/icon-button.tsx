import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The accessible name for screen readers (required for accessibility) */
  "aria-label": string;
  /** The icon element to render inside the button */
  icon: React.ReactNode;
  /** Optional tooltip text. If set to true, uses aria-label. */
  tooltip?: string | boolean;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  variant?: ButtonProps["variant"];
  size?: "xs" | "sm" | "md" | "lg";
}

const sizeClasses = {
  xs: "h-7 w-7 p-0 [&_svg]:h-3.5 [&_svg]:w-3.5",
  sm: "h-8 w-8 p-0 [&_svg]:h-4 [&_svg]:w-4",
  md: "h-9 w-9 p-0 [&_svg]:h-4 [&_svg]:w-4",
  lg: "h-10 w-10 p-0 [&_svg]:h-5 [&_svg]:w-5",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      "aria-label": ariaLabel,
      icon,
      tooltip,
      tooltipSide = "top",
      variant = "ghost",
      size = "md",
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const button = (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          "shrink-0 rounded-md transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {icon}
      </Button>
    );

    if (!tooltip) {
      return button;
    }

    const tooltipText = typeof tooltip === "string" ? tooltip : ariaLabel;

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side={tooltipSide} className="text-xs font-medium">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
);

IconButton.displayName = "IconButton";
