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
        "relative flex min-h-[280px] w-full flex-col items-center justify-center overflow-hidden rounded-[18px] border border-border/70 bg-[radial-gradient(30rem_14rem_at_50%_0%,hsl(var(--primary)/0.07),transparent_70%)] bg-card p-10 text-center shadow-[var(--shadow-soft)] animate-in fade-in-50 zoom-in-[0.98] duration-500",
        className
      )}
    >
      <div aria-hidden className="empty-illustration">
        <span className="[&_svg]:h-6 [&_svg]:w-6">{icon || <FolderOpen />}</span>
        <i />
        <i />
      </div>
      <h3 className="mb-1 text-lg font-semibold tracking-[-0.02em] text-foreground">
        {title}
      </h3>
      {description && (
        <p className="mb-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
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
