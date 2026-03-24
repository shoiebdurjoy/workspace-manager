import React, { useEffect, useRef, useState } from 'react';

const getNotificationTimestamp = (item) => item.created_at || item.timestamp;
const isNotificationUnread = (item) => {
  if (typeof item.read === 'boolean') return !item.read;
  return Boolean(item.unread);
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const getNotificationIcon = (type) => {
  if (type === 'TASK_CREATED') return '+';
  if (type === 'STATUS_CHANGED') return 'dot';
  if (type === 'ASSIGNED_TO_CHANGED') return '@';
  if (type === 'VIDEO_LINK_UPDATED') return 'lnk';
  if (type === 'COMMENT_ADDED') return 'msg';
  return 'n';
};

const getNotificationTone = (type) => {
  if (type === 'STATUS_CHANGED') return 'status';
  if (type === 'ASSIGNED_TO_CHANGED') return 'assign';
  if (type === 'VIDEO_LINK_UPDATED') return 'video';
  if (type === 'COMMENT_ADDED') return 'comment';
  if (type === 'TASK_CREATED') return 'created';
  return 'default';
};

function TopHeader({
  title,
  searchPlaceholder = 'Search tasks, members, statuses',
  notifications = [],
  unreadCount = 0,
  userName = 'Durjoy User',
  onOpenInbox,
  onOpenSettings,
  onOpenProfile,
  onLogout,
  onNotificationClick,
  onMarkAllNotificationsRead,
}) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const bellRef = useRef(null);
  const profileRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (bellRef.current && !bellRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const initials = userName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="top-header">
      <div>
        <p className="page-subtitle">Internal Workspace</p>
        <h1 className="page-title">{title}</h1>
      </div>

      <div className="header-actions">
        <input type="text" placeholder={searchPlaceholder} className="header-search" />
        <div className="header-action-wrap" ref={bellRef}>
          <button
            type="button"
            className="header-icon"
            aria-label="Notifications"
            onClick={() => setShowNotifications((prev) => !prev)}
          >
            Bell
            {unreadCount > 0 && <span className="header-badge-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>

          {showNotifications && (
            <div className="header-dropdown-panel notifications-panel">
              <div className="header-dropdown-title-row">
                <span>Notifications</span>
                <button
                  type="button"
                  onClick={() => {
                    onMarkAllNotificationsRead?.();
                  }}
                >
                  Mark all read
                </button>
              </div>

              <div className="header-dropdown-list">
                {notifications.length === 0 ? (
                  <div className="header-dropdown-empty-state">
                    <span className="header-empty-icon">N</span>
                    <p className="header-dropdown-empty">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`header-dropdown-item card ${isNotificationUnread(item) ? 'unread' : 'read'}`}
                      onClick={() => {
                        onNotificationClick?.(item);
                        setShowNotifications(false);
                      }}
                    >
                      <span className={`notif-type-icon tone-${getNotificationTone(item.type)} icon-${getNotificationIcon(item.type)}`}>
                        {getNotificationIcon(item.type) === 'dot' ? '' : getNotificationIcon(item.type)}
                      </span>
                      <span className="notif-content">
                        <strong className="notif-main-text">{item.message || item.title}</strong>
                        <small className="notif-sub-text">{item.taskTitle || item.title || 'Task update'}{item.user ? ` • ${item.user}` : ''}</small>
                      </span>
                      <small className="notif-time">{formatDateTime(getNotificationTimestamp(item))}</small>
                    </button>
                  ))
                )}
              </div>

              <button
                type="button"
                className="header-dropdown-footer-btn"
                onClick={() => {
                  onOpenInbox?.();
                  setShowNotifications(false);
                }}
              >
                Open Full Inbox
              </button>
            </div>
          )}
        </div>

        <div className="header-action-wrap" ref={profileRef}>
          <button
            type="button"
            className="header-avatar"
            aria-label="Profile"
            onClick={() => setShowProfileMenu((prev) => !prev)}
          >
            {initials}
          </button>

          {showProfileMenu && (
            <div className="header-dropdown-panel profile-panel">
              <button type="button" className="header-dropdown-item" onClick={() => { onOpenProfile?.(); setShowProfileMenu(false); }}>Profile</button>
              <button type="button" className="header-dropdown-item" onClick={() => { onOpenSettings?.(); setShowProfileMenu(false); }}>Settings</button>
              <button type="button" className="header-dropdown-item" onClick={() => { onLogout?.(); setShowProfileMenu(false); }}>Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default TopHeader;
