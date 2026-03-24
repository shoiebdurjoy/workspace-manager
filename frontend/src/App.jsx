import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';

const ALLOWED_STATUSES = [
  'ASSIGNED',
  'IN_EDIT',
  'QC_FIRST_APPROVAL',
  'QC_REVISION_NEEDED',
  'QC_FINAL_APPROVAL',
  'APPROVED',
  'SENT_TO_CLIENT',
  'CLIENT_REVISION_NEEDED',
  'COMPLETE',
  'CANCELLED',
];

function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({ title: '', client_name: '', priority: '', status: 'IN_EDIT' });
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [hoveredTask, setHoveredTask] = useState(null);
  const [hoveredStatusBadge, setHoveredStatusBadge] = useState(null);
  const [openStatusMenuTaskId, setOpenStatusMenuTaskId] = useState(null);
  const [statusSearch, setStatusSearch] = useState('');
  const statusMenuRef = useRef(null);

  const fetchTasks = () => {
    setLoading(true);
    setError(null);
    fetch('http://localhost:5000/api/tasks')
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch tasks');
        }
        return response.json();
      })
      .then(data => {
        setTasks(data.tasks || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!statusMenuRef.current) return;
      if (!statusMenuRef.current.contains(event.target)) {
        setOpenStatusMenuTaskId(null);
        setStatusSearch('');
      }
    };

    if (openStatusMenuTaskId !== null) {
      document.addEventListener('mousedown', handleOutsideClick);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [openStatusMenuTaskId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      setCreateError('Title is required');
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const response = await fetch('http://localhost:5000/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      if (!response.ok) {
        throw new Error('Failed to create task');
      }
      setFormData({ title: '', client_name: '', priority: '', status: 'ASSIGNED' });
      fetchTasks();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    try {
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

      setTasks(prevTasks => prevTasks.map(task =>
        task.id === taskId ? { ...task, status: newStatus } : task
      ));
    } catch (error) {
      console.error('Failed to update status', error);
    }
  };

  const handleStatusBadgeClick = (taskId) => {
    if (openStatusMenuTaskId === taskId) {
      setOpenStatusMenuTaskId(null);
      setStatusSearch('');
      return;
    }

    setOpenStatusMenuTaskId(taskId);
    setStatusSearch('');
  };

  const handleStatusSelect = async (taskId, selectedStatus) => {
    await updateTaskStatus(taskId, selectedStatus);
    setOpenStatusMenuTaskId(null);
    setStatusSearch('');
  };

  if (loading) {
    return (
      <div className="app-shell">
        <Sidebar activeItem="Tasks" />
        <main className="app-main">
          <TopHeader title="Tasks" />
          <div className="main-content">
            <div className="task-page">Loading tasks...</div>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell">
        <Sidebar activeItem="Tasks" />
        <main className="app-main">
          <TopHeader title="Tasks" />
          <div className="main-content">
            <div className="task-page" style={{ color: '#dc2626' }}>Error: {error}</div>
          </div>
        </main>
      </div>
    );
  }

  const getStatusColor = (status) => {
    if (status === 'ASSIGNED') return '#9CA3AF';
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

  const statuses = ALLOWED_STATUSES;
  const filteredStatuses = ALLOWED_STATUSES.filter(status =>
    status.toLowerCase().includes(statusSearch.toLowerCase())
  );
  const groupedTasks = tasks.reduce((acc, task) => {
    acc[task.status] = acc[task.status] || [];
    acc[task.status].push(task);
    return acc;
  }, {});

  return (
    <div className="app-shell">
      <Sidebar activeItem="Tasks" />

      <main className="app-main">
        <TopHeader title="Tasks" />

        <div className="main-content">
          <div className="task-page">
            <h2 className="task-section-title">Create Task</h2>
            <form onSubmit={handleSubmit} className="task-create-card">
          <div style={{ marginBottom: '10px' }}>
            <label>Title (required): </label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              required
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>Client Name: </label>
            <input
              type="text"
              name="client_name"
              value={formData.client_name}
              onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>Priority: </label>
            <input
              type="text"
              name="priority"
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>Status: </label>
            <select
              name="status"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            >
              {ALLOWED_STATUSES.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={submitting} style={{ padding: '10px 20px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: submitting ? 'not-allowed' : 'pointer' }}>
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
          {createError && <p style={{ color: 'red', marginTop: '10px' }}>Error: {createError}</p>}
            </form>

            <h2 className="task-section-title">Task List</h2>
            {tasks.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '14px' }}>No tasks found</p>
            ) : (
              <div style={{ width: '100%' }}>
          {statuses.map(status => {
            const tasksInStatus = groupedTasks[status] || [];
            if (tasksInStatus.length === 0) return null;
            return (
              <div key={status} style={{ marginBottom: '30px', width: '100%' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, marginTop: '18px', marginBottom: '8px', color: '#0f172a' }}>{status.replaceAll('_', ' ')}</h2>
                <div className="table-header-row">
                  <span style={{ flex: 3, padding: '5px 6px' }}>Name</span>
                  <span style={{ flex: 1.3, padding: '5px 6px' }}>Assignee</span>
                  <span style={{ flex: 1.2, padding: '5px 6px' }}>Status</span>
                  <span style={{ flex: 1.8, padding: '5px 6px' }}>Created</span>
                </div>
                <div>
                  {tasksInStatus.map(task => (
                    <div
                      key={task.id}
                      className="table-task-row"
                      style={{ backgroundColor: hoveredTask === task.id ? '#f8fafc' : '#fff' }}
                      onMouseEnter={() => setHoveredTask(task.id)}
                      onMouseLeave={() => setHoveredTask(null)}
                    >
                      <span style={{ flex: 3, padding: '6px', fontWeight: 700, color: '#0f172a', fontSize: '13px' }}>{task.title}</span>
                      <span style={{ flex: 1.3, padding: '6px', color: '#334155', fontSize: '13px' }}>{task.assigned_user_name || 'Not assigned'}</span>
                      <span style={{ flex: 1.2, padding: '6px', position: 'relative' }}>
                        <span
                          ref={openStatusMenuTaskId === task.id ? statusMenuRef : null}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: getStatusColor(task.status),
                            color: '#fff',
                            padding: '5px 10px',
                            borderRadius: '999px',
                            fontSize: '10px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            userSelect: 'none',
                            transition: 'transform 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease',
                            transform: hoveredStatusBadge === task.id ? 'scale(1.04)' : 'scale(1)',
                            filter: hoveredStatusBadge === task.id ? 'brightness(1.08)' : 'brightness(1)',
                            boxShadow: hoveredStatusBadge === task.id ? '0 2px 8px rgba(0,0,0,0.18)' : 'none'
                          }}
                          onMouseEnter={() => setHoveredStatusBadge(task.id)}
                          onMouseLeave={() => setHoveredStatusBadge(null)}
                          onClick={() => handleStatusBadgeClick(task.id)}
                        >
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: '#fff',
                              opacity: 0.9,
                            }}
                          />
                          {task.status}
                          <span style={{ fontSize: '10px', opacity: 0.9 }}>▼</span>
                        </span>

                        {openStatusMenuTaskId === task.id && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '38px',
                              left: 0,
                              width: '260px',
                              backgroundColor: '#fff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '10px',
                              boxShadow: '0 10px 30px rgba(15, 23, 42, 0.14)',
                              zIndex: 20,
                              overflow: 'hidden'
                            }}
                          >
                            <div style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                              <input
                                type="text"
                                value={statusSearch}
                                onChange={(e) => setStatusSearch(e.target.value)}
                                placeholder="Search status"
                                style={{
                                  width: '100%',
                                  padding: '7px 9px',
                                  borderRadius: '8px',
                                  border: '1px solid #d1d5db',
                                  fontSize: '12px',
                                  outline: 'none'
                                }}
                              />
                            </div>

                            <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                              {filteredStatuses.length === 0 ? (
                                <div style={{ padding: '10px 12px', fontSize: '12px', color: '#6b7280' }}>No status found</div>
                              ) : (
                                filteredStatuses.map(statusOption => {
                                  const isSelected = task.status === statusOption;

                                  return (
                                    <div
                                      key={statusOption}
                                      onClick={() => handleStatusSelect(task.id, statusOption)}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '8px 12px',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        backgroundColor: isSelected ? '#eff6ff' : '#fff',
                                        color: '#0f172a',
                                        fontWeight: isSelected ? 600 : 500,
                                        borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent'
                                      }}
                                    >
                                      <span
                                        style={{
                                          width: '8px',
                                          height: '8px',
                                          borderRadius: '50%',
                                          backgroundColor: getStatusColor(statusOption),
                                          flexShrink: 0,
                                        }}
                                      />
                                      <span>{statusOption}</span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </span>
                      <span style={{ flex: 1.8, padding: '6px', color: '#475569', fontSize: '12px' }}>{new Date(task.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
