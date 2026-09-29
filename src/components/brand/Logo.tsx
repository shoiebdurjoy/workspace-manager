import React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ size = 'md', showText = true, className }) => {
  const sizes = {
    sm: { icon: 'h-6 w-6', text: 'text-sm', badge: 'text-[9px] px-1 py-0.2', padding: 'p-1' },
    md: { icon: 'h-8 w-8', text: 'text-base', badge: 'text-[10px] px-1.5 py-0.5', padding: 'p-1.5' },
    lg: { icon: 'h-11 w-11', text: 'text-xl', badge: 'text-xs px-2 py-0.5', padding: 'p-2' },
  };

  return (
    <div className={cn("flex items-center gap-2.5 group select-none", className)}>
      <div className="relative shrink-0">
        <div className="absolute inset-0 bg-purple-600/30 rounded-lg blur-md group-hover:bg-purple-600/40 transition-all duration-300" />
        <div
          className={cn(
            "relative bg-gradient-to-br from-[#7B2CBF] via-[#8B48E3] to-[#7B68EE] text-white rounded-lg shadow-soft flex items-center justify-center font-black tracking-tight",
            sizes[size].padding,
            sizes[size].icon
          )}
        >
          {/* TBB Monogram / Production Icon */}
          <span className="leading-none text-white font-extrabold text-xs">TBB</span>
        </div>
      </div>
      {showText && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "font-bold text-foreground tracking-tight group-hover:text-purple-600 transition-colors",
                sizes[size].text
              )}
            >
              TBB
            </span>
            <span
              className={cn(
                "font-medium text-muted-foreground tracking-normal",
                sizes[size].text
              )}
            >
              Workspace
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Logo;
