import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export interface LoadingStateProps {
  title?: string;
  description?: string;
  spinnerSize?: "sm" | "md" | "lg";
  variant?: "spinner" | "skeleton";
  skeletonRows?: number;
  className?: string;
}

const spinnerSizes = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

export const LoadingState: React.FC<LoadingStateProps> = ({
  title,
  description,
  spinnerSize = "md",
  variant = "spinner",
  skeletonRows = 3,
  className,
}) => {
  if (variant === "skeleton") {
    return (
      <div className={cn("w-full space-y-3 p-4", className)}>
        {title && <Skeleton className="h-5 w-1/3" />}
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              "h-12 w-full",
              i === 0 ? "h-10" : i % 2 === 0 ? "h-14" : "h-12"
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-[200px] w-full flex-col items-center justify-center p-6 text-center animate-in fade-in-50",
        className
      )}
    >
      <Loader2
        className={cn(
          "animate-spin text-primary shrink-0 mb-3",
          spinnerSizes[spinnerSize]
        )}
      />
      {title && (
        <h4 className="text-sm font-medium text-foreground tracking-tight">
          {title}
        </h4>
      )}
      {description && (
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          {description}
        </p>
      )}
    </div>
  );
};
