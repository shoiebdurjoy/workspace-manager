import React from 'react';

const NAV_ITEMS = ['Dashboard', 'Inbox', 'Tasks', 'Members', 'Settings'];

function Sidebar({ activeItem = 'Tasks' }) {
  return (
    <aside className="app-sidebar">
      <div className="workspace-brand">
        <div className="workspace-logo">WM</div>
        <div>
          <p className="workspace-label">Workspace</p>
          <h2 className="workspace-name">Workspacemanager</h2>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={`sidebar-link ${activeItem === item ? 'active' : ''}`}
          >
            <span className="sidebar-dot" />
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
