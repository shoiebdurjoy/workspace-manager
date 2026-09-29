import * as React from "react";
import { cn } from "@/lib/utils";
import { Flag } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type TBBPriority = "URGENT" | "HIGH" | "NORMAL" | "LOW" | "NONE" | string;

export interface PriorityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  priority: TBBPriority;
  /** Whether to show text label or icon only */
  iconOnly?: boolean;
  size?: "sm" | "md";
}

interface PriorityConfig {
  label: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

const priorityConfigs: Record<string, PriorityConfig> = {
  URGENT: {
    label: "Urgent",
    colorClass: "text-red-600 dark:text-red-400 fill-red-600 dark:fill-red-400",
    bgClass: "bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300",
    borderClass: "border-red-200 dark:border-red-900",
  },
  HIGH: {
    label: "High",
    colorClass: "text-amber-600 dark:text-amber-400 fill-amber-600 dark:fill-amber-400",
    bgClass: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300",
    borderClass: "border-amber-200 dark:border-amber-900",
  },
  NORMAL: {
    label: "Normal",
    colorClass: "text-blue-600 dark:text-blue-400 fill-blue-600 dark:fill-blue-400",
    bgClass: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300",
    borderClass: "border-blue-200 dark:border-blue-900",
  },
  LOW: {
    label: "Low",
    colorClass: "text-slate-500 dark:text-slate-400 fill-slate-500 dark:fill-slate-400",
    bgClass: "bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300",
    borderClass: "border-slate-200 dark:border-slate-800",
  },
  NONE: {
    label: "None",
    colorClass: "text-muted-foreground/40",
    bgClass: "bg-muted/40 text-muted-foreground",
    borderClass: "border-transparent",
  },
};

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({
  priority,
  iconOnly = false,
  size = "sm",
  className,
  ...props
}) => {
  const normalized = priority.toUpperCase();
  const config = priorityConfigs[normalized] || priorityConfigs.NONE;

  const badgeContent = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-medium select-none tracking-tight transition-colors",
        config.bgClass,
        config.borderClass,
        iconOnly
          ? size === "sm"
            ? "p-1"
            : "p-1.5"
          : size === "sm"
          ? "px-2 py-0.5 text-[11px]"
          : "px-2.5 py-1 text-xs",
        className
      )}
      {...props}
    >
      <Flag
        className={cn(
          "shrink-0",
          size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5",
          config.colorClass
        )}
      />
      {!iconOnly && <span>{config.label}</span>}
    </span>
  );

  if (iconOnly) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{badgeContent}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Priority: {config.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badgeContent;
};
