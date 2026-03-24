import React from 'react';

function TopHeader({ title }) {
  return (
    <header className="top-header">
      <div>
        <p className="page-subtitle">Internal Workspace</p>
        <h1 className="page-title">{title}</h1>
      </div>

      <div className="header-actions">
        <input type="text" placeholder="Search tasks, members, statuses" className="header-search" />
        <button type="button" className="header-icon" aria-label="Notifications">
          Bell
        </button>
        <button type="button" className="header-avatar" aria-label="Profile">
          DU
        </button>
      </div>
    </header>
  );
}

export default TopHeader;
