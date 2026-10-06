import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface UserAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name?: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  status?: "online" | "offline" | "busy" | "away";
  className?: string;
}

const sizeClasses = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
  xl: "h-14 w-14 text-base",
};

const statusDotSizes = {
  xs: "h-1.5 w-1.5 ring-1",
  sm: "h-2 w-2 ring-1.5",
  md: "h-2.5 w-2.5 ring-2",
  lg: "h-3 w-3 ring-2",
  xl: "h-3.5 w-3.5 ring-2",
};

const statusClasses = {
  online: "bg-emerald-500",
  offline: "bg-slate-400",
  busy: "bg-rose-500",
  away: "bg-amber-500",
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name = "User",
  src,
  size = "md",
  status,
  className,
  ...props
}) => {
  const getInitials = (n: string) => {
    const parts = n.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return n.slice(0, 2).toUpperCase() || "U";
  };

  return (
    <div className={cn("relative inline-block shrink-0", className)} {...props}>
      <Avatar className={cn(sizeClasses[size], "border border-border/60")}>
        <AvatarImage src={src} alt={name} />
        <AvatarFallback className="bg-foreground text-background font-semibold">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>

      {status && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-background",
            statusDotSizes[size],
            statusClasses[status]
          )}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  );
};
