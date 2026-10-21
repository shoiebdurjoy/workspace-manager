import React from 'react';
import { Link } from 'react-router-dom';

interface NodeCardProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Row actions (the node menu). Kept outside the link so it stays independently focusable. */
  actions?: React.ReactNode;
}

/** A clickable child of a Space or Folder on its overview page. */
const NodeCard: React.FC<NodeCardProps> = ({ to, icon, title, subtitle, actions }) => (
  <div className="group relative flex items-center gap-3 surface-card press p-3 transition-shadow hover:bg-muted/30">
    <Link
      to={to}
      className="flex min-w-0 flex-1 items-center gap-3 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      <span className="min-w-0">
        <span className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground" title={typeof title === "string" ? title : undefined}>{title}</span>
        {subtitle && <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>}
      </span>
    </Link>
    {actions}
  </div>
);

export default NodeCard;
