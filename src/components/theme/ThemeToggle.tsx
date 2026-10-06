import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    localStorage.setItem('theme', newTheme);
  };

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={toggleTheme}
      className={cn(
        "rounded-full relative overflow-hidden transition-all duration-300",
        "hover:bg-accent hover:text-foreground"
      )}
      aria-label="Toggle theme"
    >
      <Sun className={cn(
        "h-5 w-5 absolute transition-all duration-300",
        theme === 'light' ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
      )} />
      <Moon className={cn(
        "h-5 w-5 absolute transition-all duration-300",
        theme === 'dark' ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
      )} />
    </Button>
  );
};

export default ThemeToggle;
