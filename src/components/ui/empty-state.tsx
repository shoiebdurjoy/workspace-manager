import * as React from "react";
import { cn } from "@/lib/utils";
import { FolderOpen } from "lucide-react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex min-h-[260px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 p-8 text-center animate-in fade-in-50",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-xs mb-3.5">
        {icon || <FolderOpen className="h-6 w-6 text-muted-foreground/80" />}
      </div>
      <h3 className="text-base font-semibold text-foreground tracking-tight mb-1">
        {title}
      </h3>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground leading-relaxed mb-4">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
};
