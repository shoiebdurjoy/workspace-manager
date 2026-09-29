import * as React from "react";
import { cn } from "@/lib/utils";

export type TBBStatusType =
  | "OPEN"
  | "TODO"
  | "BACKLOG"
  | "IN_PROGRESS"
  | "IN_EDIT"
  | "QC_REVIEW"
  | "QC_1ST_APPROVAL"
  | "QC_REVISION_NEEDED"
  | "READY_TO_DELIVER"
  | "DELIVERED"
  | "CANCELLED"
  | string;

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: TBBStatusType;
  label?: string;
  size?: "sm" | "md";
  showDot?: boolean;
}

interface StatusConfig {
  label: string;
  className: string;
  dotClassName: string;
}

const statusConfigs: Record<string, StatusConfig> = {
  OPEN: {
    label: "To Do",
    className: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800",
    dotClassName: "bg-slate-400",
  },
  TODO: {
    label: "To Do",
    className: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800",
    dotClassName: "bg-slate-400",
  },
  BACKLOG: {
    label: "Backlog",
    className: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-300 dark:border-zinc-800",
    dotClassName: "bg-zinc-400",
  },
  IN_PROGRESS: {
    label: "In Progress",
    className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-900",
    dotClassName: "bg-blue-500",
  },
  IN_EDIT: {
    label: "In Edit",
    className: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-900",
    dotClassName: "bg-purple-600",
  },
  QC_REVIEW: {
    label: "QC Review",
    className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900",
    dotClassName: "bg-amber-500 animate-pulse",
  },
  QC_1ST_APPROVAL: {
    label: "QC - 1st Approval",
    className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900",
    dotClassName: "bg-amber-500",
  },
  QC_REVISION_NEEDED: {
    label: "QC - Revision",
    className: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-900",
    dotClassName: "bg-rose-500",
  },
  READY_TO_DELIVER: {
    label: "Ready to Deliver",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900 font-semibold",
    dotClassName: "bg-emerald-500",
  },
  DELIVERED: {
    label: "Delivered",
    className: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-900",
    dotClassName: "bg-teal-500",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-900/60 dark:text-gray-400 dark:border-gray-800",
    dotClassName: "bg-gray-400",
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  size = "sm",
  showDot = true,
  className,
  ...props
}) => {
  const normalizedKey = status.toUpperCase().replace(/\s+/g, "_");
  const config = statusConfigs[normalizedKey] || {
    label: status.replace(/_/g, " "),
    className: "bg-muted text-muted-foreground border-border",
    dotClassName: "bg-muted-foreground",
  };

  const displayText = label || config.label;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium select-none tracking-tight transition-colors",
        size === "sm" ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
        config.className,
        className
      )}
      {...props}
    >
      {showDot && (
        <span
          className={cn(
            "rounded-full shrink-0",
            size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
            config.dotClassName
          )}
          aria-hidden="true"
        />
      )}
      <span>{displayText}</span>
    </span>
  );
};
