import React, { createContext, useContext, useEffect, useState } from 'react';

const AppDataContext = createContext(null);

const CURRENT_USER = 'Durjoy';
const MOCK_MEMBERS = [
  { id: 1, name: 'Durjoy', email: 'durjoy@workspace.local', role: 'Lead Editor', status: 'Active', assignable: true },
  { id: 2, name: 'Editor 1', email: 'editor1@workspace.local', role: 'Video Editor', status: 'Active', assignable: true },
  { id: 3, name: 'Editor 2', email: 'editor2@workspace.local', role: 'Video Editor', status: 'Busy', assignable: true },
  { id: 4, name: 'Manager 1', email: 'manager1@workspace.local', role: 'Manager', status: 'Active', assignable: false },
];

const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function AppDataProvider({ children }) {
  const [tasks, setTasks] = useState([]);
  const [members] = useState(MOCK_MEMBERS);
  const [notifications, setNotifications] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [commentsByTask, setCommentsByTask] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const pushBrowserNotification = (title, body) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      const notification = new Notification(title, { body });
      void notification;
    } catch {
      // ignore desktop notification errors
    }
  };

  const addActivity = ({ taskId, actionType, oldValue, newValue, user = CURRENT_USER, label }) => {
    const activity = {
      id: makeId('activity'),
      taskId,
      actionType,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      user,
      label,
      timestamp: new Date().toISOString(),
    };

    setActivityLogs((prev) => [activity, ...prev]);
    return activity;
  };

  const addNotification = ({
    type,
    title,
    message,
    taskId = null,
    taskTitle = '',
    to = CURRENT_USER,
    user = CURRENT_USER,
    read = false,
  }) => {
    const createdAt = new Date().toISOString();
    const notification = {
      id: makeId('notif'),
      type,
      title,
      message,
      task_id: taskId,
      taskId,
      taskTitle,
      to,
      user,
      read,
      unread: !read,
      created_at: createdAt,
      timestamp: createdAt,
    };

    setNotifications((prev) => [notification, ...prev]);

    if (!read && to === CURRENT_USER) {
      const browserBody = taskTitle ? `${taskTitle} • ${message}` : message;
      pushBrowserNotification(title, browserBody);
    }

    return notification;
  };

  const loadTasks = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:5000/api/tasks');
      if (!response.ok) {
        throw new Error('Failed to fetch tasks');
      }
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const patchTaskFields = async (taskId, payload) => {
    const response = await fetch(`http://localhost:5000/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Task update failed');
    }

    const data = await response.json();
    return data.task;
  };

  const updateTask = async (taskId, patch, user = CURRENT_USER) => {
    const hasStatus = Object.prototype.hasOwnProperty.call(patch, 'status');
    const hasVideo = Object.prototype.hasOwnProperty.call(patch, 'video_link');
    const remainingPatch = { ...patch };

    if (hasStatus) {
      await updateTaskStatus(taskId, patch.status, user);
      delete remainingPatch.status;
    }

    if (hasVideo) {
      await updateVideoLink(taskId, patch.video_link || '', user);
      delete remainingPatch.video_link;
    }

    if (Object.keys(remainingPatch).length > 0) {
      await updateTaskFields(taskId, remainingPatch, user);
    }
  };

  const updateTaskInState = (taskId, patch) => {
    setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
  };

  const createTask = async (formData, user = CURRENT_USER) => {
    const payload = {
      title: formData.title?.trim(),
      client_name: formData.client_name?.trim() || null,
      priority: formData.priority || null,
      status: formData.status || 'ASSIGNED',
    };

    const response = await fetch('http://localhost:5000/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to create task');
    }

    const data = await response.json();
    const task = data.task;

    setTasks((prev) => [task, ...prev]);

    addActivity({
      taskId: task.id,
      actionType: 'TASK_CREATED',
      oldValue: null,
      newValue: task.title,
      user,
      label: `Task created: ${task.title}`,
    });

    addNotification({
      type: 'TASK_CREATED',
      title: 'Task created',
      message: 'Task created',
      taskId: task.id,
      taskTitle: task.title,
      user,
      to: user,
    });

    return task;
  };

  const updateTaskStatus = async (taskId, newStatus, user = CURRENT_USER) => {
    const previousTask = tasks.find((task) => task.id === taskId);

    const response = await fetch(`http://localhost:5000/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!response.ok) {
      throw new Error('Failed to update task status');
    }

    updateTaskInState(taskId, { status: newStatus });

    addActivity({
      taskId,
      actionType: 'STATUS_CHANGED',
      oldValue: previousTask?.status,
      newValue: newStatus,
      user,
      label: `Status changed from ${previousTask?.status || '-'} to ${newStatus}`,
    });

    addNotification({
      type: 'STATUS_CHANGED',
      title: 'Status changed',
      message: `Status changed to ${newStatus}`,
      taskId,
      taskTitle: previousTask?.title || 'Untitled Task',
      user,
      to: previousTask?.assigned_to || previousTask?.assigned_user_name || user,
    });
  };

  const updateTaskFields = async (taskId, patch, user = CURRENT_USER) => {
    const previousTask = tasks.find((task) => task.id === taskId);
    const updatedTask = await patchTaskFields(taskId, patch);

    updateTaskInState(taskId, updatedTask);

    Object.keys(patch).forEach((field) => {
      const oldValue = previousTask?.[field] ?? null;
      const newValue = updatedTask?.[field] ?? patch[field] ?? null;
      if (oldValue === newValue) return;

      const actionType = `${field.toUpperCase()}_CHANGED`;
      addActivity({
        taskId,
        actionType,
        oldValue,
        newValue,
        user,
        label: `${field.replace('_', ' ')} changed`,
      });

      let notificationTitle = 'Task updated';
      let notificationMessage = `${field.replace('_', ' ')} changed`;
      if (field === 'assigned_to') {
        notificationTitle = 'Assignee changed';
        notificationMessage = `Assignee changed to ${newValue || 'Unassigned'}`;
      }
      if (field === 'priority') notificationTitle = 'Priority updated';
      if (field === 'due_date') notificationTitle = 'Due date updated';

      addNotification({
        type: actionType,
        title: notificationTitle,
        message: notificationMessage,
        taskId,
        taskTitle: previousTask?.title || 'Untitled Task',
        user,
        to: field === 'assigned_to' ? newValue : (previousTask?.assigned_to || previousTask?.assigned_user_name || user),
      });
    });

    return updatedTask;
  };

  const updateVideoLink = async (taskId, videoLink, user = CURRENT_USER) => {
    const previousTask = tasks.find((task) => task.id === taskId);

    const response = await fetch(`http://localhost:5000/api/tasks/${taskId}/video`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ video_link: videoLink.trim() }),
    });

    if (!response.ok) {
      throw new Error('Video update failed');
    }

    const data = await response.json();
    const savedVideoLink = data.task?.video_link ?? videoLink.trim();

    updateTaskInState(taskId, { video_link: savedVideoLink });

    addActivity({
      taskId,
      actionType: 'VIDEO_LINK_UPDATED',
      oldValue: previousTask?.video_link,
      newValue: savedVideoLink,
      user,
      label: 'Video link updated',
    });

    addNotification({
      type: 'VIDEO_LINK_UPDATED',
      title: 'Video link updated',
      message: 'Video link updated',
      taskId,
      taskTitle: previousTask?.title || 'Untitled Task',
      user,
      to: previousTask?.assigned_to || previousTask?.assigned_user_name || user,
    });

    return savedVideoLink;
  };

  const addComment = (taskId, text, user = CURRENT_USER) => {
    const content = text.trim();
    if (!content) return null;

    const comment = {
      id: makeId('comment'),
      taskId,
      text: content,
      user,
      timestamp: new Date().toISOString(),
    };

    setCommentsByTask((prev) => ({
      ...prev,
      [taskId]: [comment, ...(prev[taskId] || [])],
    }));

    addActivity({
      taskId,
      actionType: 'COMMENT_ADDED',
      oldValue: null,
      newValue: content,
      user,
      label: 'Comment added',
    });

    addNotification({
      type: 'COMMENT_ADDED',
      title: 'New comment',
      message: 'Comment added',
      taskId,
      taskTitle: tasks.find((task) => task.id === taskId)?.title || 'Untitled Task',
      user,
      to: user,
    });

    return comment;
  };

  const markNotificationRead = (notificationId) => {
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? {
      ...n,
      read: true,
      unread: false,
    } : n)));
  };

  const markNotificationUnread = (notificationId) => {
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? {
      ...n,
      read: false,
      unread: true,
    } : n)));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true, unread: false })));
  };

  const value = {
    currentUser: CURRENT_USER,
    tasks,
    members,
    notifications,
    activityLogs,
    commentsByTask,
    loading,
    error,
    setTasks,
    setError,
    loadTasks,
    createTask,
    updateTask,
    updateTaskStatus,
    updateTaskFields,
    updateVideoLink,
    addComment,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within AppDataProvider');
  }
  return context;
}
