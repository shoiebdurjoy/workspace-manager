import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './App.css';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import { useAppData } from './context/AppDataContext';

const ALLOWED_STATUSES = [
  'TO_BE_EDITED',
  'IN_EDIT',
  'QC_FIRST_APPROVAL',
  'QC_REVISION_NEEDED',
  'QC_FINAL_APPROVAL',
  'SENT_TO_CLIENT',
  'CLIENT_REVISION_NEEDED',
  'APPROVED',
  'COMPLETE',
  'CANCELLED',
  'ASSIGNED',
];

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const PAGE_NAMES = ['Dashboard', 'Inbox', 'Tasks', 'Members', 'Settings'];
const GLOBAL_SECTIONS = ['COMPLETE', 'CLIENT_REVISION', 'SENT_TO_CLIENT', 'APPROVED', 'IN_EDIT', 'TO_BE_EDITED'];
const INBOX_TABS = ['All', 'Unread'];
const UNKNOWN_CLIENT_LABEL = 'Unknown Client';

const getGlobalSectionFromStatus = (status) => {
  if (status === 'ASSIGNED' || status === 'TO_BE_EDITED') return 'TO_BE_EDITED';
  if (status === 'IN_EDIT' || status === 'QC_FIRST_APPROVAL' || status === 'QC_REVISION_NEEDED' || status === 'QC_FINAL_APPROVAL') return 'IN_EDIT';
  if (status === 'SENT_TO_CLIENT') return 'SENT_TO_CLIENT';
  if (status === 'CLIENT_REVISION_NEEDED') return 'CLIENT_REVISION';
  if (status === 'APPROVED') return 'APPROVED';
  if (status === 'COMPLETE' || status === 'CANCELLED') return 'COMPLETE';
  return 'TO_BE_EDITED';
};

const getClientLabel = (task) => (task.client_name && task.client_name.trim() ? task.client_name.trim() : UNKNOWN_CLIENT_LABEL);
const formatSectionLabel = (section) => section.replaceAll('_', ' ');

const getInitials = (name) => {
  if (!name) return 'NA';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
};

const toDateInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
};

const shortenLink = (rawLink) => {
  if (!rawLink) return '';
  let display = rawLink.trim();
  try {
    const url = new URL(display);
    display = `${url.hostname}${url.pathname}`;
  } catch {
    display = display.replace(/^https?:\/\//i, '');
  }
  return display.length <= 34 ? display : `${display.slice(0, 34)}...`;
};

const getNotificationTaskId = (notification) => notification.task_id || notification.taskId || null;
const getNotificationTimestamp = (notification) => notification.created_at || notification.timestamp || null;
const isNotificationUnread = (notification) => {
  if (typeof notification.read === 'boolean') return !notification.read;
  return Boolean(notification.unread);
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

function App() {
  const {
    currentUser,
    tasks,
    setTasks,
    members,
    notifications,
    activityLogs,
    commentsByTask,
    loading,
    error,
    updateTask,
    addComment,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
  } = useAppData();

  const [activePage, setActivePage] = useState('Tasks');
  const [formData, setFormData] = useState({ title: '', client_name: '', priority: '', status: 'ASSIGNED' });
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [hoveredTask, setHoveredTask] = useState(null);

  const [openStatusMenu, setOpenStatusMenu] = useState(null);
  const [openPriorityMenu, setOpenPriorityMenu] = useState(null);
  const [openAssigneeMenu, setOpenAssigneeMenu] = useState(null);
  const [openClientMenu, setOpenClientMenu] = useState(null);
  const [statusSearch, setStatusSearch] = useState('');

  const [editingVideoTaskId, setEditingVideoTaskId] = useState(null);
  const [videoDraft, setVideoDraft] = useState('');
  const [videoSaving, setVideoSaving] = useState(false);
  const [videoEditError, setVideoEditError] = useState('');

  const [editingDueDateTaskId, setEditingDueDateTaskId] = useState(null);
  const [dueDateDraft, setDueDateDraft] = useState('');
  const [dueDateSaving, setDueDateSaving] = useState(false);

  const [selectedClient, setSelectedClient] = useState('All Clients');
  const [collapsedClientGroups, setCollapsedClientGroups] = useState({});
  const [collapsedStatuses, setCollapsedStatuses] = useState(
    () => Object.fromEntries(GLOBAL_SECTIONS.map((section) => [section, true]))
  );

  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [drawerDraft, setDrawerDraft] = useState({
    title: '',
    client_name: '',
    status: '',
    assigned_to: '',
    priority: '',
    due_date: '',
    video_link: '',
  });
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [isEditingDrawerTitle, setIsEditingDrawerTitle] = useState(false);
  const [openDrawerMenu, setOpenDrawerMenu] = useState(null);

  const [activeInboxTab, setActiveInboxTab] = useState('All');
  const [memberSearch, setMemberSearch] = useState('');

  const statusMenuRef = useRef(null);
  const statusTriggerRefs = useRef({});
  const priorityMenuRef = useRef(null);
  const priorityTriggerRefs = useRef({});
  const assigneeMenuRef = useRef(null);
  const assigneeTriggerRefs = useRef({});
  const clientMenuRef = useRef(null);
  const clientTriggerRefs = useRef({});
  const drawerMenuRef = useRef(null);
  const drawerTriggerRefs = useRef({});

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId) || null, [tasks, selectedTaskId]);

  useEffect(() => {
    if (!selectedTask) return;
    setDrawerDraft({
      title: selectedTask.title || '',
      client_name: selectedTask.client_name || '',
      status: selectedTask.status || '',
      assigned_to: selectedTask.assigned_to || selectedTask.assigned_user_name || '',
      priority: selectedTask.priority || '',
      due_date: toDateInputValue(selectedTask.due_date),
      video_link: selectedTask.video_link || '',
    });
    setDrawerError('');
    setCommentDraft('');
    setIsEditingDrawerTitle(false);
    setOpenDrawerMenu(null);
  }, [selectedTask]);

  const closeAllMenus = () => {
    setOpenStatusMenu(null);
    setOpenPriorityMenu(null);
    setOpenAssigneeMenu(null);
    setOpenClientMenu(null);
    setOpenDrawerMenu(null);
    setStatusSearch('');
  };

  useEffect(() => {
    const setupOutsideClose = (menuState, setMenuState, menuRef, triggerRefMap, clearSearch) => {
      if (!menuState) return undefined;
      const onClick = (event) => {
        const menuEl = menuRef.current;
        const triggerEl = triggerRefMap.current[menuState.taskId];
        if (menuEl && menuEl.contains(event.target)) return;
        if (triggerEl && triggerEl.contains(event.target)) return;
        setMenuState(null);
        if (clearSearch) clearSearch('');
      };
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    };

    const cleanupStatus = setupOutsideClose(openStatusMenu, setOpenStatusMenu, statusMenuRef, statusTriggerRefs, setStatusSearch);
    const cleanupPriority = setupOutsideClose(openPriorityMenu, setOpenPriorityMenu, priorityMenuRef, priorityTriggerRefs);
    const cleanupAssignee = setupOutsideClose(openAssigneeMenu, setOpenAssigneeMenu, assigneeMenuRef, assigneeTriggerRefs);
    const cleanupClient = setupOutsideClose(openClientMenu, setOpenClientMenu, clientMenuRef, clientTriggerRefs);
    const cleanupDrawer = setupOutsideClose(openDrawerMenu, setOpenDrawerMenu, drawerMenuRef, drawerTriggerRefs);

    return () => {
      if (cleanupStatus) cleanupStatus();
      if (cleanupPriority) cleanupPriority();
      if (cleanupAssignee) cleanupAssignee();
      if (cleanupClient) cleanupClient();
      if (cleanupDrawer) cleanupDrawer();
    };
  }, [openStatusMenu, openPriorityMenu, openAssigneeMenu, openClientMenu, openDrawerMenu]);

  useEffect(() => {
    const updatePosition = (state, setState, refs) => {
      if (!state) return;
      const triggerEl = refs.current[state.taskId];
      if (!triggerEl) return;
      const rect = triggerEl.getBoundingClientRect();
      setState((prev) => (prev ? { ...prev, left: rect.left + window.scrollX, top: rect.bottom + window.scrollY + 6 } : prev));
    };

    const onUpdate = () => {
      updatePosition(openStatusMenu, setOpenStatusMenu, statusTriggerRefs);
      updatePosition(openPriorityMenu, setOpenPriorityMenu, priorityTriggerRefs);
      updatePosition(openAssigneeMenu, setOpenAssigneeMenu, assigneeTriggerRefs);
      updatePosition(openClientMenu, setOpenClientMenu, clientTriggerRefs);
      updatePosition(openDrawerMenu, setOpenDrawerMenu, drawerTriggerRefs);
    };

    onUpdate();
    window.addEventListener('resize', onUpdate);
    window.addEventListener('scroll', onUpdate, true);
    return () => {
      window.removeEventListener('resize', onUpdate);
      window.removeEventListener('scroll', onUpdate, true);
    };
  }, [openStatusMenu, openPriorityMenu, openAssigneeMenu, openClientMenu, openDrawerMenu]);

  const clientList = useMemo(() => {
    const uniqueClients = Array.from(new Set(
      tasks
        .map((task) => (task.client_name || '').trim())
        .filter((name) => Boolean(name))
    ));

    uniqueClients.sort((a, b) => a.localeCompare(b));
    return uniqueClients;
  }, [tasks]);

  useEffect(() => {
    const hasMissingOrUntrimmedClient = tasks.some((task) => {
      const rawClient = task.client_name;
      if (!rawClient) return true;
      return rawClient.trim() !== rawClient;
    });

    if (!hasMissingOrUntrimmedClient) return;

    setTasks((prev) => {
      let didChange = false;
      const normalizedTasks = prev.map((task) => {
        const trimmedClient = (task.client_name || '').trim();
        const nextClientName = trimmedClient || UNKNOWN_CLIENT_LABEL;
        if (task.client_name === nextClientName) return task;
        didChange = true;
        return { ...task, client_name: nextClientName };
      });
      return didChange ? normalizedTasks : prev;
    });
  }, [tasks, setTasks]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const title = (formData.title || '').trim();
    const rawClientName = (formData.client_name || '').trim();

    if (!title) {
      setCreateError('Title is required');
      return;
    }

    if (!rawClientName) {
      setCreateError('Client name is required');
      return;
    }

    setSubmitting(true);
    setCreateError(null);

    try {
      const matchedClientName = clientList.find((client) => client.toLowerCase() === rawClientName.toLowerCase());
      const clientName = matchedClientName || rawClientName;

      const payload = {
        title,
        client_name: clientName,
        priority: formData.priority || null,
        status: formData.status || 'ASSIGNED',
      };

      if (Object.prototype.hasOwnProperty.call(formData, 'assigned_to') && formData.assigned_to) {
        payload.assigned_to = formData.assigned_to;
      }

      const requestOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };

      let response = await fetch('/api/tasks', requestOptions);
      if (!response.ok) {
        response = await fetch('http://localhost:5000/api/tasks', requestOptions);
      }

      if (!response.ok) {
        throw new Error('Failed to create task');
      }

      const data = await response.json();
      const createdTask = data.task;

      if (createdTask) {
        setTasks((prev) => [createdTask, ...prev]);
      }

      setFormData({ title: '', client_name: '', priority: '', status: 'ASSIGNED' });
    } catch (err) {
      console.error(err);
      setCreateError(err.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusBadgeClick = (taskId, event) => {
    if (openStatusMenu?.taskId === taskId) {
      setOpenStatusMenu(null);
      setStatusSearch('');
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenStatusMenu({ taskId, left: rect.left + window.scrollX, top: rect.bottom + window.scrollY + 6 });
    setStatusSearch('');
  };

  const handleStatusSelect = async (taskId, selectedStatus) => {
    try {
      await updateTask(taskId, { status: selectedStatus }, currentUser);
      setOpenStatusMenu(null);
      setStatusSearch('');
    } catch (err) {
      console.error(err);
    }
  };

  const handlePriorityBadgeClick = (taskId, event) => {
    if (openPriorityMenu?.taskId === taskId) {
      setOpenPriorityMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenPriorityMenu({ taskId, left: rect.left + window.scrollX, top: rect.bottom + window.scrollY + 6 });
  };

  const handlePrioritySelect = async (taskId, priority) => {
    try {
      await updateTask(taskId, { priority }, currentUser);
      setOpenPriorityMenu(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssigneeClick = (taskId, event) => {
    if (openAssigneeMenu?.taskId === taskId) {
      setOpenAssigneeMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenAssigneeMenu({ taskId, left: rect.left + window.scrollX, top: rect.bottom + window.scrollY + 6 });
  };

  const handleAssigneeSelect = async (taskId, assignedTo) => {
    try {
      await updateTask(taskId, { assigned_to: assignedTo }, currentUser);
      setOpenAssigneeMenu(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClientClick = (taskId, event) => {
    if (openClientMenu?.taskId === taskId) {
      setOpenClientMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenClientMenu({ taskId, left: rect.left + window.scrollX, top: rect.bottom + window.scrollY + 6 });
  };

  const handleClientSelect = async (taskId, clientName) => {
    try {
      await updateTaskField(taskId, { client_name: clientName });
      setOpenClientMenu(null);
    } catch (err) {
      console.error(err);
    }
  };

  const startVideoEdit = (task) => {
    setEditingVideoTaskId(task.id);
    setVideoDraft(task.video_link || '');
    setVideoEditError('');
  };

  const cancelVideoEdit = () => {
    setEditingVideoTaskId(null);
    setVideoDraft('');
    setVideoEditError('');
  };

  const saveVideoLink = async (taskId) => {
    if (videoSaving) return;
    setVideoSaving(true);
    setVideoEditError('');
    try {
      await updateTask(taskId, { video_link: videoDraft }, currentUser);
      setEditingVideoTaskId(null);
      setVideoDraft('');
    } catch {
      setVideoEditError('Could not save link. Please try again.');
    } finally {
      setVideoSaving(false);
    }
  };

  const startDueDateEdit = (task) => {
    setEditingDueDateTaskId(task.id);
    setDueDateDraft(toDateInputValue(task.due_date));
  };

  const saveDueDate = async (taskId, nextDateValue) => {
    if (dueDateSaving) return;
    setDueDateSaving(true);
    try {
      await updateTask(taskId, { due_date: nextDateValue || null }, currentUser);
      setEditingDueDateTaskId(null);
      setDueDateDraft('');
    } catch (err) {
      console.error(err);
    } finally {
      setDueDateSaving(false);
    }
  };

  const openTaskDetails = (taskId) => {
    setSelectedTaskId(taskId);
    setDrawerError('');
  };

  const closeTaskDetails = () => {
    setSelectedTaskId(null);
    setDrawerError('');
    setCommentDraft('');
    setIsEditingDrawerTitle(false);
    setOpenDrawerMenu(null);
  };

  const autoSaveDrawerField = async (field, rawValue) => {
    if (!selectedTask || drawerSaving) return;

    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    if (field === 'client_name' && !value) {
      setDrawerError('Client is required');
      return;
    }

    const nextValue = value || null;
    setDrawerSaving(true);
    setDrawerError('');

    try {
      await updateTaskField(selectedTask.id, { [field]: nextValue });
    } catch {
      setDrawerError('Could not save changes.');
    } finally {
      setDrawerSaving(false);
    }
  };

  const handleDrawerTitleBlur = async () => {
    await autoSaveDrawerField('title', drawerDraft.title);
    setIsEditingDrawerTitle(false);
  };

  const handleDrawerFieldMenuOpen = (field, event) => {
    if (openDrawerMenu?.field === field) {
      setOpenDrawerMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenDrawerMenu({
      field,
      left: rect.left + window.scrollX,
      top: rect.bottom + window.scrollY + 6,
    });
  };

  const handleDrawerFieldSelect = async (field, value) => {
    setDrawerDraft((prev) => ({ ...prev, [field]: value }));
    setOpenDrawerMenu(null);
    await autoSaveDrawerField(field, value);
  };

  const handleDrawerDueDateSave = async () => {
    await autoSaveDrawerField('due_date', drawerDraft.due_date || null);
  };

  const updateTaskField = async (taskId, updatedFields) => {
    try {
      const requestOptions = {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields),
      };

      let response = await fetch(`/api/tasks/${taskId}`, requestOptions);
      if (!response.ok) {
        response = await fetch(`http://localhost:5000/api/tasks/${taskId}`, requestOptions);
      }

      if (!response.ok) {
        throw new Error('Failed to update task field');
      }

      const data = await response.json();
      const updatedTask = data.task;

      setTasks((prev) => prev.map((task) => (task.id === taskId ? updatedTask : task)));

      if (selectedTaskId === taskId) {
        setDrawerDraft((prev) => ({
          ...prev,
          ...updatedFields,
          due_date: Object.prototype.hasOwnProperty.call(updatedFields, 'due_date')
            ? toDateInputValue(updatedTask?.due_date)
            : prev.due_date,
        }));
      }

      return updatedTask;
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const submitComment = () => {
    if (!selectedTask) return;
    const comment = addComment(selectedTask.id, commentDraft, currentUser);
    if (comment) setCommentDraft('');
  };

  const toggleClientGroup = (globalSection, clientName) => {
    const key = `${globalSection}::${clientName}`;
    setCollapsedClientGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleStatusSection = (globalSection) => {
    setCollapsedStatuses((prev) => ({ ...prev, [globalSection]: !prev[globalSection] }));
  };

  const isStatusSectionCollapsed = (globalSection) => Boolean(collapsedStatuses[globalSection]);
  const isClientGroupCollapsed = (globalSection, clientName) => Boolean(collapsedClientGroups[`${globalSection}::${clientName}`]);

  const handleNavigate = (page) => {
    if (!PAGE_NAMES.includes(page)) return;
    setActivePage(page);
    closeAllMenus();
    cancelVideoEdit();
    setEditingDueDateTaskId(null);
    if (page !== 'Tasks') {
      closeTaskDetails();
    }
  };

  const handleNotificationClick = (notification) => {
    markNotificationRead(notification.id);
    const taskId = getNotificationTaskId(notification);
    if (taskId) {
      setActivePage('Tasks');
      openTaskDetails(taskId);
    } else {
      setActivePage('Inbox');
    }
  };

  const getStatusColor = (status) => {
    if (status === 'ASSIGNED' || status === 'TO_BE_EDITED') return '#9CA3AF';
    if (status === 'IN_EDIT') return '#3B82F6';
    if (status === 'QC_FIRST_APPROVAL') return '#F59E0B';
    if (status === 'QC_REVISION_NEEDED') return '#8B5CF6';
    if (status === 'QC_FINAL_APPROVAL') return '#8B5E3C';
    if (status === 'APPROVED') return '#22C55E';
    if (status === 'SENT_TO_CLIENT') return '#EC4899';
    if (status === 'CLIENT_REVISION_NEEDED') return '#A16207';
    if (status === 'COMPLETE') return '#14B8A6';
    return '#374151';
  };

  const getStatusBadgeStyle = (status) => {
    const accent = getStatusColor(status);
    return { color: accent, backgroundColor: `${accent}1A`, border: `1px solid ${accent}66` };
  };

  const getPriorityBadgeStyle = (priority) => {
    const normalized = (priority || '').toUpperCase();
    if (normalized === 'LOW') return { color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px solid #D1D5DB' };
    if (normalized === 'MEDIUM') return { color: '#1D4ED8', backgroundColor: '#DBEAFE', border: '1px solid #93C5FD' };
    if (normalized === 'HIGH') return { color: '#B45309', backgroundColor: '#FEF3C7', border: '1px solid #FCD34D' };
    if (normalized === 'URGENT') return { color: '#B91C1C', backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5' };
    return { color: '#64748B', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' };
  };

  const getPriorityDotColor = (priority) => {
    const normalized = (priority || '').toUpperCase();
    if (normalized === 'LOW') return '#6B7280';
    if (normalized === 'MEDIUM') return '#1D4ED8';
    if (normalized === 'HIGH') return '#B45309';
    if (normalized === 'URGENT') return '#B91C1C';
    return '#94A3B8';
  };

  const clientOptions = useMemo(() => ['All Clients', ...clientList], [clientList]);

  const filteredTasks = useMemo(() => (
    selectedClient === 'All Clients' ? tasks : tasks.filter((task) => getClientLabel(task) === selectedClient)
  ), [tasks, selectedClient]);

  const groupedByGlobalSectionAndClient = useMemo(() => {
    const grouped = {};
    GLOBAL_SECTIONS.forEach((section) => { grouped[section] = {}; });

    filteredTasks.forEach((task) => {
      const globalSection = getGlobalSectionFromStatus(task.status);
      const clientName = getClientLabel(task);
      if (!grouped[globalSection][clientName]) grouped[globalSection][clientName] = [];
      grouped[globalSection][clientName].push(task);
    });

    return grouped;
  }, [filteredTasks]);

  const filteredStatuses = ALLOWED_STATUSES.filter((status) => status.toLowerCase().includes(statusSearch.toLowerCase()));
  const openStatusTask = openStatusMenu ? tasks.find((task) => task.id === openStatusMenu.taskId) : null;
  const openPriorityTask = openPriorityMenu ? tasks.find((task) => task.id === openPriorityMenu.taskId) : null;
  const openAssigneeTask = openAssigneeMenu ? tasks.find((task) => task.id === openAssigneeMenu.taskId) : null;
  const openClientTask = openClientMenu ? tasks.find((task) => task.id === openClientMenu.taskId) : null;

  const memberPerformance = useMemo(() => {
    const performance = {};
    members.forEach((member) => {
      performance[member.name] = { assigned: 0, completed: 0, inProgress: 0, videosCompleted: 0 };
    });

    tasks.forEach((task) => {
      const assignee = task.assigned_to || task.assigned_user_name;
      if (!assignee) return;
      if (!performance[assignee]) {
        performance[assignee] = { assigned: 0, completed: 0, inProgress: 0, videosCompleted: 0 };
      }

      performance[assignee].assigned += 1;
      if (getGlobalSectionFromStatus(task.status) === 'COMPLETE') performance[assignee].completed += 1;
      if (getGlobalSectionFromStatus(task.status) === 'IN_EDIT') performance[assignee].inProgress += 1;
      if (task.video_link && getGlobalSectionFromStatus(task.status) === 'COMPLETE') performance[assignee].videosCompleted += 1;
    });

    return performance;
  }, [tasks, members]);

  const dashboardStats = useMemo(() => {
    const bySection = (section) => tasks.filter((task) => getGlobalSectionFromStatus(task.status) === section).length;
    return [
      { label: 'Total Tasks', value: tasks.length, tone: 'slate' },
      { label: 'In Edit', value: bySection('IN_EDIT'), tone: 'blue' },
      { label: 'Sent to Client', value: bySection('SENT_TO_CLIENT'), tone: 'pink' },
      { label: 'Approved', value: bySection('APPROVED'), tone: 'green' },
      { label: 'Complete', value: bySection('COMPLETE'), tone: 'teal' },
    ];
  }, [tasks]);

  const statusCounts = useMemo(() => {
    const counts = {};
    GLOBAL_SECTIONS.forEach((section) => { counts[section] = 0; });
    tasks.forEach((task) => {
      const section = getGlobalSectionFromStatus(task.status);
      counts[section] = (counts[section] || 0) + 1;
    });
    return counts;
  }, [tasks]);

  const monthlyCompleted = useMemo(() => {
    const map = {};
    tasks.forEach((task) => {
      if (getGlobalSectionFromStatus(task.status) !== 'COMPLETE') return;
      const date = task.updated_at || task.created_at;
      if (!date) return;
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6);
  }, [tasks]);

  const tasksPerMemberBars = useMemo(() => {
    const entries = Object.entries(memberPerformance).map(([name, perf]) => ({
      name,
      assigned: perf.assigned,
      completed: perf.completed,
      inProgress: perf.inProgress,
      videosCompleted: perf.videosCompleted,
    }));
    entries.sort((a, b) => b.assigned - a.assigned);
    return entries;
  }, [memberPerformance]);

  const recentTasks = useMemo(() => [...tasks]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 6), [tasks]);

  const recentActivity = useMemo(() => activityLogs.slice(0, 10), [activityLogs]);

  const inboxItems = useMemo(() => {
    if (activeInboxTab === 'Unread') {
      return notifications.filter((item) => isNotificationUnread(item));
    }
    return notifications;
  }, [notifications, activeInboxTab]);

  const unreadNotificationCount = notifications.filter((n) => isNotificationUnread(n)).length;

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => (
      member.name.toLowerCase().includes(query)
      || member.email.toLowerCase().includes(query)
      || member.role.toLowerCase().includes(query)
    ));
  }, [memberSearch, members]);

  const renderDashboardPage = () => (
    <div className="task-page dashboard-page">
      <div className="stats-grid">
        {dashboardStats.map((stat) => (
          <div key={stat.label} className={`stats-card tone-${stat.tone}`}>
            <p>{stat.label}</p>
            <h3>{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="dashboard-panels">
        <section className="dashboard-card">
          <div className="section-head-row"><h3>Tasks per Member</h3></div>
          <div className="bar-list">
            {tasksPerMemberBars.map((row) => (
              <div key={row.name} className="bar-row">
                <span>{row.name}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, row.assigned * 10)}%` }} /></div>
                <strong>{row.assigned}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-card">
          <div className="section-head-row"><h3>Videos Completed per Member</h3></div>
          <div className="bar-list">
            {tasksPerMemberBars.map((row) => (
              <div key={`${row.name}-videos`} className="bar-row">
                <span>{row.name}</span>
                <div className="bar-track"><div className="bar-fill teal" style={{ width: `${Math.max(8, row.videosCompleted * 15)}%` }} /></div>
                <strong>{row.videosCompleted}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-card">
          <div className="section-head-row"><h3>Monthly Completed Tasks</h3></div>
          <div className="bar-list">
            {monthlyCompleted.length === 0 ? <p className="muted">No completed tasks yet</p> : monthlyCompleted.map(([month, count]) => (
              <div key={month} className="bar-row">
                <span>{month}</span>
                <div className="bar-track"><div className="bar-fill green" style={{ width: `${Math.max(8, count * 16)}%` }} /></div>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-card">
          <div className="section-head-row"><h3>Tasks by Status</h3></div>
          <div className="bar-list">
            {GLOBAL_SECTIONS.map((section) => (
              <div key={section} className="bar-row">
                <span>{formatSectionLabel(section)}</span>
                <div className="bar-track"><div className="bar-fill pink" style={{ width: `${Math.max(8, (statusCounts[section] || 0) * 10)}%` }} /></div>
                <strong>{statusCounts[section] || 0}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-card">
          <div className="section-head-row">
            <h3>Recent Tasks</h3>
            <button type="button" className="link-button" onClick={() => handleNavigate('Tasks')}>Open Tasks</button>
          </div>
          <div className="simple-list">
            {recentTasks.length === 0 ? <p className="muted">No tasks yet</p> : recentTasks.map((task) => (
              <button key={task.id} type="button" className="simple-list-row" onClick={() => { handleNavigate('Tasks'); openTaskDetails(task.id); }}>
                <span>{task.title}</span>
                <span className="mini-pill">{task.status}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-card">
          <div className="section-head-row">
            <h3>Recent Activity</h3>
            <button type="button" className="link-button" onClick={() => handleNavigate('Inbox')}>Open Inbox</button>
          </div>
          <div className="simple-list">
            {recentActivity.length === 0 ? <p className="muted">No activity yet</p> : recentActivity.map((item) => (
              <div key={item.id} className="simple-list-row unread">
                <span>{item.label || item.actionType}</span>
                <small>{formatDateTime(item.timestamp)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  const renderInboxPage = () => (
    <div className="task-page inbox-page">
      <div className="inbox-content-wrap">
        <div className="inbox-tabs">
          {INBOX_TABS.map((tab) => (
            <button key={tab} type="button" className={`inbox-tab ${activeInboxTab === tab ? 'active' : ''}`} onClick={() => setActiveInboxTab(tab)}>
              {tab}
            </button>
          ))}
        </div>

        <div className="inbox-list">
          {inboxItems.length === 0 ? (
            <div className="inbox-empty-state">
              <span className="inbox-empty-icon">N</span>
              <p className="muted">No notifications yet</p>
            </div>
          ) : inboxItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`inbox-row card ${isNotificationUnread(item) ? 'unread' : 'read'}`}
              onClick={() => handleNotificationClick(item)}
            >
              <span className={`inbox-type-pill tone-${getNotificationTone(item.type)} icon-${getNotificationIcon(item.type)}`}>
                {getNotificationIcon(item.type) === 'dot' ? '' : getNotificationIcon(item.type)}
              </span>
              <span className="inbox-main">
                <span className="inbox-message">{item.message || item.title || 'Task updated'}</span>
                <span className="inbox-title">{item.taskTitle || 'Untitled Task'}{item.user ? ` • ${item.user}` : ''}</span>
              </span>
              <span className="inbox-time">{formatDateTime(getNotificationTimestamp(item))}</span>
              <span className="inbox-row-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="inbox-action-btn"
                  onClick={() => {
                    if (isNotificationUnread(item)) {
                      markNotificationRead(item.id);
                    } else {
                      markNotificationUnread(item.id);
                    }
                  }}
                >
                  {isNotificationUnread(item) ? 'Mark read' : 'Mark unread'}
                </button>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMembersPage = () => (
    <div className="task-page members-page">
      <div className="members-head-row">
        <h2 className="task-section-title">Members</h2>
        <input type="text" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} className="members-search" placeholder="Search members" />
      </div>

      <div className="members-list">
        {filteredMembers.map((member) => {
          const perf = memberPerformance[member.name] || { assigned: 0, completed: 0, inProgress: 0 };
          return (
            <div key={member.id} className="member-row">
              <span className="member-avatar">{getInitials(member.name)}</span>
              <div className="member-meta">
                <strong>{member.name}</strong>
                <small>{member.email}</small>
              </div>
              <span className="member-role">{member.role}</span>
              <span className={`member-status ${member.status.toLowerCase()}`}>{member.status}</span>
              <span className={`member-tag ${member.assignable ? 'assignable' : 'non-assignable'}`}>{member.assignable ? 'Assignable' : 'View Only'}</span>
              <span className="member-performance">Assigned: {perf.assigned}</span>
              <span className="member-performance">In Progress: {perf.inProgress}</span>
              <span className="member-performance">Complete: {perf.completed}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderSettingsPage = () => (
    <div className="task-page settings-page">
      <div className="settings-grid">
        <section className="settings-card">
          <h3>Profile</h3>
          <p>Name: {currentUser}</p>
          <p>Email: durjoy@workspace.local</p>
        </section>
        <section className="settings-card">
          <h3>Workspace</h3>
          <p>Workspace Name: Workspacemanager</p>
          <p>Timezone: UTC+6</p>
        </section>
        <section className="settings-card">
          <h3>Task Settings</h3>
          <p>Default Status: ASSIGNED</p>
          <p>Priorities: LOW, MEDIUM, HIGH, URGENT</p>
        </section>
        <section className="settings-card">
          <h3>Status Settings</h3>
          <p>Workflow: TO_BE_EDITED -&gt; IN_EDIT -&gt; SENT_TO_CLIENT -&gt; APPROVED -&gt; COMPLETE</p>
          <p>Revision Loop: CLIENT_REVISION_NEEDED</p>
        </section>
      </div>
    </div>
  );

  const renderTasksPage = () => (
    <div className="task-page">
      <div className="tasks-page-header">
        <h2 className="task-section-title">Tasks Workspace</h2>
        <div className="client-filter-wrap">
          <label htmlFor="clientFilter" className="client-filter-label">Client</label>
          <select id="clientFilter" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)} className="client-filter-select">
            {clientOptions.map((clientName) => <option key={clientName} value={clientName}>{clientName}</option>)}
          </select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="task-create-inline-bar">
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="form-input compact"
          placeholder="Title"
          required
        />
        <input
          type="text"
          name="client_name"
          value={formData.client_name}
          onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
          className="form-input compact"
          placeholder="Client Name"
          list="task-clients"
          required
        />
        <select
          name="priority"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
          className="form-select compact"
        >
          <option value="">Priority</option>
          {PRIORITY_OPTIONS.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
        </select>
        <select
          name="status"
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          className="form-select compact"
        >
          {ALLOWED_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button type="submit" disabled={submitting} className="primary-btn compact-create-btn">{submitting ? 'Creating...' : 'Create'}</button>
      </form>
      <datalist id="task-clients">
        {clientList.map((clientName) => <option key={clientName} value={clientName} />)}
      </datalist>

      {createError && <p className="video-inline-error tasks-create-error">{createError}</p>}

      <div className="task-list-toolbar">
        <h3 className="task-list-heading">Task Sections</h3>
      </div>

      {loading && <p className="muted">Loading tasks...</p>}
      {error && <p className="video-inline-error">Error: {error}</p>}

      {!loading && !error && (
        <div className="task-sections-wrap">
          {GLOBAL_SECTIONS.map((globalSection) => {
            const clientGroups = groupedByGlobalSectionAndClient[globalSection] || {};
            const clientNames = Object.keys(clientGroups).sort((a, b) => a.localeCompare(b));
            const isCollapsedSection = isStatusSectionCollapsed(globalSection);
            const sectionClassName = `section-${globalSection.toLowerCase().replaceAll('_', '-')}`;

            return (
              <div key={globalSection} className={`global-section ${sectionClassName}`}>
                <button type="button" className="status-section-header" onClick={() => toggleStatusSection(globalSection)}>
                  <span className={`collapse-arrow ${isCollapsedSection ? 'collapsed' : 'open'}`}>▾</span>
                  <h2 className="global-section-title">{formatSectionLabel(globalSection)}</h2>
                  <span className="section-count-pill">{clientNames.reduce((acc, client) => acc + (clientGroups[client]?.length || 0), 0)}</span>
                </button>

                {!isCollapsedSection && clientNames.length === 0 && (
                  <div className="section-empty-row">No tasks in this section</div>
                )}

                {!isCollapsedSection && clientNames.map((clientName) => {
                  const tasksInClient = clientGroups[clientName] || [];
                  const isCollapsed = isClientGroupCollapsed(globalSection, clientName);

                  return (
                    <div key={`${globalSection}-${clientName}`} className="client-group-block">
                      <button type="button" className="client-group-header" onClick={() => toggleClientGroup(globalSection, clientName)}>
                        <span className={`collapse-arrow ${isCollapsed ? 'collapsed' : 'open'}`}>▾</span>
                        <span className="client-group-title">{clientName}</span>
                        <span className="client-group-count">({tasksInClient.length})</span>
                      </button>

                      {!isCollapsed && (
                        <>
                          <div className="table-header-row">
                            <span className="table-col-head col-name" style={{ flex: 2.2, padding: '5px 8px' }}>Name</span>
                            <span className="table-col-head col-client" style={{ flex: 1.2, padding: '5px 8px' }}>Client</span>
                            <span className="table-col-head col-assignee" style={{ flex: 1.3, padding: '5px 8px' }}>Assignee</span>
                            <span className="table-col-head col-video" style={{ flex: 1.9, padding: '5px 8px' }}>Edited Video Link</span>
                            <span className="table-col-head col-status" style={{ flex: 1.3, padding: '5px 8px' }}>Status</span>
                            <span className="table-col-head col-priority" style={{ flex: 0.9, padding: '5px 8px' }}>Priority</span>
                            <span className="table-col-head col-due-date" style={{ flex: 1.1, padding: '5px 8px' }}>Due Date</span>
                            <span className="table-col-head col-created" style={{ flex: 1.6, padding: '5px 8px' }}>Created</span>
                          </div>

                          <div>
                            {tasksInClient.map((task) => (
                              <div
                                key={task.id}
                                className="table-task-row clickable-row"
                                style={{ backgroundColor: hoveredTask === task.id ? 'var(--row-hover-bg, #f7faff)' : '#fff' }}
                                onMouseEnter={() => setHoveredTask(task.id)}
                                onMouseLeave={() => setHoveredTask(null)}
                                onClick={() => openTaskDetails(task.id)}
                              >
                                <span className="task-cell col-name" style={{ flex: 2.2, padding: '6px', fontWeight: 700, color: '#0f172a', fontSize: '13px' }}>{task.title}</span>
                                <span className="task-cell col-client row-control" style={{ flex: 1.2, padding: '6px' }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    ref={(el) => { clientTriggerRefs.current[task.id] = el; }}
                                    className="assignee-chip client-chip"
                                    onClick={(e) => handleClientClick(task.id, e)}
                                  >
                                    <span className="assignee-name">{getClientLabel(task)}</span>
                                    <span className="assignee-caret">▾</span>
                                  </button>
                                </span>

                                <span className="task-cell col-assignee row-control" style={{ flex: 1.3, padding: '6px' }} onClick={(e) => e.stopPropagation()}>
                                  <button type="button" ref={(el) => { assigneeTriggerRefs.current[task.id] = el; }} className="assignee-chip" onClick={(e) => handleAssigneeClick(task.id, e)}>
                                    <span className="assignee-avatar">{getInitials(task.assigned_to || task.assigned_user_name)}</span>
                                    <span className="assignee-name">{task.assigned_to || task.assigned_user_name || 'Unassigned'}</span>
                                    <span className="assignee-caret">▾</span>
                                  </button>
                                </span>

                                <span className="task-cell col-video row-control" style={{ flex: 1.9, padding: '6px', minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
                                  {editingVideoTaskId === task.id ? (
                                    <div className="video-edit-inline">
                                      <input type="text" value={videoDraft} onChange={(e) => setVideoDraft(e.target.value)} placeholder="Paste video URL" className="video-inline-input" />
                                      <div className="video-inline-actions">
                                        <button type="button" className="video-action-btn save" onClick={() => saveVideoLink(task.id)} disabled={videoSaving}>{videoSaving ? 'Saving...' : 'Save'}</button>
                                        <button type="button" className="video-action-btn" onClick={cancelVideoEdit} disabled={videoSaving}>Cancel</button>
                                      </div>
                                      {videoEditError && <p className="video-inline-error">{videoEditError}</p>}
                                    </div>
                                  ) : (
                                    <div className="video-link-display">
                                      {task.video_link ? (
                                        <a href={task.video_link} target="_blank" rel="noreferrer" className="video-link-open" title={task.video_link} onClick={(e) => e.stopPropagation()}>
                                          {shortenLink(task.video_link)}
                                        </a>
                                      ) : (
                                        <button type="button" className="video-link-placeholder" onClick={() => startVideoEdit(task)}>Add link</button>
                                      )}
                                      <button type="button" className="video-edit-trigger" onClick={() => startVideoEdit(task)}>Edit</button>
                                    </div>
                                  )}
                                </span>

                                <span className="task-cell col-status row-control" style={{ flex: 1.3, padding: '6px' }} onClick={(e) => e.stopPropagation()}>
                                  <span
                                    ref={(el) => { statusTriggerRefs.current[task.id] = el; }}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', ...getStatusBadgeStyle(task.status), padding: '5px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
                                    onClick={(e) => handleStatusBadgeClick(task.id, e)}
                                  >
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: getStatusColor(task.status) }} />
                                    {task.status}
                                    <span style={{ fontSize: '10px', opacity: 0.9 }}>▼</span>
                                  </span>
                                </span>

                                <span className="task-cell col-priority row-control" style={{ flex: 0.9, padding: '6px' }} onClick={(e) => e.stopPropagation()}>
                                  <span ref={(el) => { priorityTriggerRefs.current[task.id] = el; }} className="priority-pill interactive-pill" style={getPriorityBadgeStyle(task.priority)} onClick={(e) => handlePriorityBadgeClick(task.id, e)}>
                                    <span className="priority-dot" style={{ backgroundColor: getPriorityDotColor(task.priority) }} />
                                    {task.priority || 'SET'}
                                    <span style={{ fontSize: '10px', opacity: 0.8 }}>▼</span>
                                  </span>
                                </span>

                                <span className="task-cell col-due-date row-control" style={{ flex: 1.1, padding: '6px' }} onClick={(e) => e.stopPropagation()}>
                                  {editingDueDateTaskId === task.id ? (
                                    <input
                                      type="date"
                                      value={dueDateDraft}
                                      onChange={(e) => {
                                        const nextValue = e.target.value;
                                        setDueDateDraft(nextValue);
                                        saveDueDate(task.id, nextValue);
                                      }}
                                      className="due-date-input"
                                      autoFocus
                                      disabled={dueDateSaving}
                                    />
                                  ) : (
                                    <button type="button" className={`due-date-chip ${task.due_date ? 'has-date' : 'empty-date'}`} onClick={() => startDueDateEdit(task)}>
                                      {task.due_date ? formatDate(task.due_date) : 'Set date'}
                                    </button>
                                  )}
                                </span>

                                <span className="task-cell col-created" style={{ flex: 1.6, padding: '6px', color: '#475569', fontSize: '12px' }}>{formatDateTime(task.created_at)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {openStatusMenu && openStatusTask && createPortal(
        <div ref={statusMenuRef} className="status-dropdown-portal" style={{ position: 'absolute', top: `${openStatusMenu.top}px`, left: `${openStatusMenu.left}px`, zIndex: 9999 }}>
          <div className="status-dropdown-search-wrap">
            <input type="text" value={statusSearch} onChange={(e) => setStatusSearch(e.target.value)} placeholder="Search status" className="status-dropdown-search" />
          </div>
          <div className="status-dropdown-list">
            {filteredStatuses.length === 0 ? (
              <div className="status-dropdown-empty">No status found</div>
            ) : filteredStatuses.map((statusOption) => {
              const isSelected = openStatusTask.status === statusOption;
              const optionAccent = getStatusColor(statusOption);
              return (
                <div
                  key={statusOption}
                  onClick={() => handleStatusSelect(openStatusTask.id, statusOption)}
                  className="status-dropdown-item"
                  style={{ backgroundColor: isSelected ? `${optionAccent}14` : '#fff', borderLeft: isSelected ? `3px solid ${optionAccent}` : '3px solid transparent' }}
                >
                  <span className="status-dropdown-dot" style={{ backgroundColor: optionAccent }} />
                  <span>{statusOption}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {openPriorityMenu && openPriorityTask && createPortal(
        <div ref={priorityMenuRef} className="status-dropdown-portal" style={{ position: 'absolute', top: `${openPriorityMenu.top}px`, left: `${openPriorityMenu.left}px`, zIndex: 9999 }}>
          <div className="status-dropdown-list">
            {PRIORITY_OPTIONS.map((priorityOption) => {
              const isSelected = (openPriorityTask.priority || '').toUpperCase() === priorityOption;
              const optionAccent = getPriorityDotColor(priorityOption);
              return (
                <div
                  key={priorityOption}
                  onClick={() => handlePrioritySelect(openPriorityTask.id, priorityOption)}
                  className="status-dropdown-item"
                  style={{ backgroundColor: isSelected ? `${optionAccent}14` : '#fff', borderLeft: isSelected ? `3px solid ${optionAccent}` : '3px solid transparent' }}
                >
                  <span className="status-dropdown-dot" style={{ backgroundColor: optionAccent }} />
                  <span>{priorityOption}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {openAssigneeMenu && openAssigneeTask && createPortal(
        <div ref={assigneeMenuRef} className="status-dropdown-portal" style={{ position: 'absolute', top: `${openAssigneeMenu.top}px`, left: `${openAssigneeMenu.left}px`, zIndex: 9999 }}>
          <div className="status-dropdown-list">
            {members.map((member) => {
              const currentAssignee = openAssigneeTask.assigned_to || openAssigneeTask.assigned_user_name || '';
              const isSelected = currentAssignee === member.name;
              return (
                <div
                  key={member.id}
                  onClick={() => handleAssigneeSelect(openAssigneeTask.id, member.name)}
                  className="status-dropdown-item"
                  style={{ backgroundColor: isSelected ? '#e0ecff' : '#fff', borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent' }}
                >
                  <span className="status-dropdown-dot" style={{ backgroundColor: '#2563eb' }} />
                  <span>{member.name}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {openClientMenu && openClientTask && createPortal(
        <div ref={clientMenuRef} className="status-dropdown-portal" style={{ position: 'absolute', top: `${openClientMenu.top}px`, left: `${openClientMenu.left}px`, zIndex: 9999 }}>
          <div className="status-dropdown-list">
            {clientList.length === 0 ? (
              <div className="status-dropdown-empty">No clients available</div>
            ) : clientList.map((clientName) => {
              const isSelected = (openClientTask.client_name || '').trim() === clientName;
              return (
                <div
                  key={clientName}
                  onClick={() => handleClientSelect(openClientTask.id, clientName)}
                  className="status-dropdown-item"
                  style={{ backgroundColor: isSelected ? '#e0ecff' : '#fff', borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent' }}
                >
                  <span className="status-dropdown-dot" style={{ backgroundColor: '#2563eb' }} />
                  <span>{clientName}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );

  const taskComments = selectedTask ? (commentsByTask[selectedTask.id] || []) : [];
  const taskActivity = selectedTask ? activityLogs.filter((item) => item.taskId === selectedTask.id) : [];

  return (
    <div className="app-shell">
      <Sidebar activeItem={activePage} onNavigate={handleNavigate} />

      <main className="app-main">
        <TopHeader
          title={activePage}
          notifications={notifications.slice(0, 8)}
          unreadCount={unreadNotificationCount}
          userName={currentUser}
          onOpenInbox={() => handleNavigate('Inbox')}
          onOpenSettings={() => handleNavigate('Settings')}
          onOpenProfile={() => handleNavigate('Members')}
          onLogout={() => handleNavigate('Dashboard')}
          onNotificationClick={handleNotificationClick}
          onMarkAllNotificationsRead={markAllNotificationsRead}
        />

        <div className="main-content">
          {activePage === 'Tasks' && renderTasksPage()}
          {activePage === 'Dashboard' && renderDashboardPage()}
          {activePage === 'Inbox' && renderInboxPage()}
          {activePage === 'Members' && renderMembersPage()}
          {activePage === 'Settings' && renderSettingsPage()}
        </div>
      </main>

      {selectedTask && activePage === 'Tasks' && (
        <div className="task-detail-backdrop" onClick={closeTaskDetails}>
          <div className="task-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="task-detail-header">
              <div className="task-detail-title-wrap">
                {isEditingDrawerTitle ? (
                  <input
                    type="text"
                    value={drawerDraft.title}
                    onChange={(e) => setDrawerDraft((prev) => ({ ...prev, title: e.target.value }))}
                    onBlur={handleDrawerTitleBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (e.key === 'Escape') {
                        setDrawerDraft((prev) => ({ ...prev, title: selectedTask.title || '' }));
                        setIsEditingDrawerTitle(false);
                      }
                    }}
                    className="drawer-title-input"
                    autoFocus
                  />
                ) : (
                  <h2 className="drawer-title-display" onClick={() => setIsEditingDrawerTitle(true)}>{drawerDraft.title || 'Untitled Task'}</h2>
                )}
                <p className="drawer-subtitle">Click fields to edit. Changes save automatically.</p>
              </div>
              <button type="button" className="task-detail-close" onClick={closeTaskDetails}>Close</button>
            </div>

            <div className="task-detail-grid">
              <div className="task-detail-column">
                <div className="task-detail-field">
                  <p className="task-detail-label">Status</p>
                  <button type="button" className="drawer-value-pill" ref={(el) => { drawerTriggerRefs.current.status = el; }} onClick={(e) => handleDrawerFieldMenuOpen('status', e)}>
                    {drawerDraft.status || 'Select status'} <span>▾</span>
                  </button>
                </div>

                <div className="task-detail-field">
                  <p className="task-detail-label">Assignee</p>
                  <button type="button" className="drawer-value-pill" ref={(el) => { drawerTriggerRefs.current.assigned_to = el; }} onClick={(e) => handleDrawerFieldMenuOpen('assigned_to', e)}>
                    {drawerDraft.assigned_to || 'Unassigned'} <span>▾</span>
                  </button>
                </div>

                <div className="task-detail-field">
                  <p className="task-detail-label">Client</p>
                  <button type="button" className="drawer-value-pill" ref={(el) => { drawerTriggerRefs.current.client_name = el; }} onClick={(e) => handleDrawerFieldMenuOpen('client_name', e)}>
                    {drawerDraft.client_name || 'Select client'} <span>▾</span>
                  </button>
                </div>
              </div>

              <div className="task-detail-column">
                <div className="task-detail-field">
                  <p className="task-detail-label">Priority</p>
                  <button type="button" className="drawer-value-pill" ref={(el) => { drawerTriggerRefs.current.priority = el; }} onClick={(e) => handleDrawerFieldMenuOpen('priority', e)}>
                    {drawerDraft.priority || 'Select priority'} <span>▾</span>
                  </button>
                </div>

                <div className="task-detail-field">
                  <p className="task-detail-label">Due Date</p>
                  <input
                    type="date"
                    value={drawerDraft.due_date || ''}
                    onChange={(e) => setDrawerDraft((prev) => ({ ...prev, due_date: e.target.value }))}
                    onBlur={handleDrawerDueDateSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    className="task-detail-date-pill"
                  />
                </div>
              </div>

              <div className="task-detail-field task-detail-field-wide">
                <p className="task-detail-label">Video Link</p>
                {selectedTask.video_link && (
                  <a href={selectedTask.video_link} target="_blank" rel="noreferrer" className="video-link-open">{shortenLink(selectedTask.video_link)}</a>
                )}
                <div className="task-detail-video-edit">
                  <input
                    type="text"
                    value={drawerDraft.video_link}
                    onChange={(e) => setDrawerDraft((prev) => ({ ...prev, video_link: e.target.value }))}
                    onBlur={() => autoSaveDrawerField('video_link', drawerDraft.video_link)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    className="task-detail-video-input"
                    placeholder="Paste video URL"
                  />
                </div>
              </div>

              <div className="task-detail-field">
                <p className="task-detail-label">Created At</p>
                <p className="task-detail-value">{formatDateTime(selectedTask.created_at)}</p>
              </div>

              <div className="task-detail-field">
                <p className="task-detail-label">Updated At</p>
                <p className="task-detail-value">{formatDateTime(selectedTask.updated_at)}</p>
              </div>
            </div>

            {drawerError && <p className="video-inline-error" style={{ marginTop: '8px' }}>{drawerError}</p>}

            <div className="task-detail-activity">
              <p className="task-detail-label">Activity</p>
              <div className="activity-feed-list">
                {taskActivity.length === 0 ? <p className="muted">No activity yet.</p> : taskActivity.map((item) => (
                  <div key={item.id} className="activity-feed-item">
                    <span className="activity-feed-text">{item.label || item.actionType}</span>
                    <small className="activity-feed-meta">{item.user} · {formatDateTime(item.timestamp)}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="task-detail-activity">
              <p className="task-detail-label">Comments</p>
              <div className="comments-composer">
                <input type="text" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} className="task-detail-video-input" placeholder="Add a comment" />
                <button type="button" className="video-action-btn save" onClick={submitComment}>Post</button>
              </div>
              <div className="comments-list">
                {taskComments.length === 0 ? <p className="muted">No comments yet.</p> : taskComments.map((comment) => (
                  <div key={comment.id} className="comment-item">
                    <span className="comment-text">{comment.text}</span>
                    <small className="comment-meta">{comment.user} · {formatDateTime(comment.timestamp)}</small>
                  </div>
                ))}
              </div>
            </div>

            {openDrawerMenu && createPortal(
              <div ref={drawerMenuRef} className="status-dropdown-portal" style={{ position: 'absolute', top: `${openDrawerMenu.top}px`, left: `${openDrawerMenu.left}px`, zIndex: 10020 }}>
                <div className="status-dropdown-list">
                  {openDrawerMenu.field === 'status' && ALLOWED_STATUSES.map((status) => (
                    <div key={status} className="status-dropdown-item" style={{ backgroundColor: drawerDraft.status === status ? `${getStatusColor(status)}1A` : '#fff' }} onClick={() => handleDrawerFieldSelect('status', status)}>
                      <span className="status-dropdown-dot" style={{ backgroundColor: getStatusColor(status) }} />
                      <span>{status}</span>
                    </div>
                  ))}

                  {openDrawerMenu.field === 'priority' && PRIORITY_OPTIONS.map((priority) => (
                    <div key={priority} className="status-dropdown-item" style={{ backgroundColor: drawerDraft.priority === priority ? `${getPriorityDotColor(priority)}1A` : '#fff' }} onClick={() => handleDrawerFieldSelect('priority', priority)}>
                      <span className="status-dropdown-dot" style={{ backgroundColor: getPriorityDotColor(priority) }} />
                      <span>{priority}</span>
                    </div>
                  ))}

                  {openDrawerMenu.field === 'assigned_to' && members.map((member) => (
                    <div key={member.id} className="status-dropdown-item" style={{ backgroundColor: drawerDraft.assigned_to === member.name ? '#e0ecff' : '#fff' }} onClick={() => handleDrawerFieldSelect('assigned_to', member.name)}>
                      <span className="status-dropdown-dot" style={{ backgroundColor: '#2563eb' }} />
                      <span>{member.name}</span>
                    </div>
                  ))}

                  {openDrawerMenu.field === 'client_name' && clientList.map((clientName) => (
                    <div key={clientName} className="status-dropdown-item" style={{ backgroundColor: drawerDraft.client_name === clientName ? '#f1f5f9' : '#fff' }} onClick={() => handleDrawerFieldSelect('client_name', clientName)}>
                      <span className="status-dropdown-dot" style={{ backgroundColor: '#64748b' }} />
                      <span>{clientName}</span>
                    </div>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
