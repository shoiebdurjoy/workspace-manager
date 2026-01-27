import React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ size = 'md', showText = true, className }) => {
  const sizes = {
    sm: { icon: 'h-6 w-6', text: 'text-base', padding: 'p-1.5' },
    md: { icon: 'h-8 w-8', text: 'text-lg', padding: 'p-2' },
    lg: { icon: 'h-12 w-12', text: 'text-2xl', padding: 'p-3' },
  };

  return (
    <div className={cn("flex items-center gap-2.5 group", className)}>
      <div className="relative">
        <div className="absolute inset-0 bg-primary/20 rounded-xl blur-lg group-hover:bg-primary/30 transition-all duration-300" />
        <div className={cn(
          "relative gradient-primary text-primary-foreground rounded-xl shadow-soft flex items-center justify-center",
          sizes[size].padding
        )}>
          {/* Custom W Logo */}
          <svg 
            viewBox="0 0 24 24" 
            fill="none" 
            className={cn(sizes[size].icon)}
            stroke="currentColor" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <path d="M3 6L7 18L12 10L17 18L21 6" />
          </svg>
        </div>
      </div>
      {showText && (
        <span className={cn(
          "font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent",
          sizes[size].text
        )}>
          WorkWise
        </span>
      )}
    </div>
  );
};

export default Logo;
