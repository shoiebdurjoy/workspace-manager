
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { loadTasksFromLocalStorage } from './services/mockData'

// Ensure mock data is loaded before rendering
try {
  loadTasksFromLocalStorage();
} catch (error) {
  console.error('Error loading tasks from localStorage:', error);
}

createRoot(document.getElementById("root")!).render(<App />);
