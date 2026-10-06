import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbItem } from '@/lib/hierarchy';

interface Props {
  icon: React.ReactNode;
  title: string;
  description?: string | null;
  trail?: BreadcrumbItem[];
  actions?: React.ReactNode;
}

const HierarchyPageHeader: React.FC<Props> = ({ icon, title, description, trail = [], actions }) => (
  <header className="space-y-2">
    {trail.length > 0 && (
      <nav aria-label="Location" className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        {trail.map((item, i) => (
          <React.Fragment key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
            {item.href ? (
              <Link to={item.href} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span>{item.label}</span>
            )}
          </React.Fragment>
        ))}
      </nav>
    )}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="max-w-prose text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  </header>
);

export default HierarchyPageHeader;
