import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, RotateCcw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try Again",
  onBack,
  backLabel = "Go Back",
  className,
}) => {
  return (
    <div
      className={cn(
        "flex min-h-[240px] w-full flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center animate-in fade-in-50",
        className
      )}
      role="alert"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h4 className="text-sm font-semibold text-foreground tracking-tight mb-1">
        {title}
      </h4>
      <p className="max-w-md text-xs text-muted-foreground leading-relaxed mb-4">
        {message}
      </p>
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button
            size="sm"
            variant="default"
            onClick={onRetry}
            className="h-8 gap-1.5 text-xs font-medium"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {retryLabel}
          </Button>
        )}
        {onBack && (
          <Button
            size="sm"
            variant="outline"
            onClick={onBack}
            className="h-8 gap-1.5 text-xs font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Button>
        )}
      </div>
    </div>
  );
};
