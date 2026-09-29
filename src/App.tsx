
import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";

import Layout from "@/components/layout/Layout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import LandingPage from "@/pages/LandingPage";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Tasks from "@/pages/Tasks";
import TaskNew from "@/pages/TaskNew";
import Workspaces from "@/pages/Workspaces";
import WorkspaceNew from "@/pages/WorkspaceNew";
import WorkspaceDetail from "@/pages/WorkspaceDetail";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import Payments from "@/pages/Payments";
import Reports from "@/pages/Reports";
import Unauthorized from "@/pages/Unauthorized";
import NotFound from "@/pages/NotFound";
import DesignSystemShowcase from "@/pages/DesignSystemShowcase";
import { UserRole } from "./types";

// Create a client
const queryClient = new QueryClient();

const App = () => (
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* Protected Routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Dashboard />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/tasks"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Tasks />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              
              <Route
                path="/workspaces/:id/tasks/new"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <TaskNew />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              
              <Route
                path="/workspaces"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Workspaces />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/workspaces/new"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <WorkspaceNew />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              
              <Route
                path="/workspaces/:id"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <WorkspaceDetail />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Profile />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Settings />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/payments"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Payments />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/reports"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.AUTHOR]}>
                    <Layout>
                      <Reports />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              {/* Author Only Routes */}
              <Route
                path="/employees"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.AUTHOR]}>
                    <Layout>
                      <div className="p-4">Employees Management (Admin Only)</div>
                    </Layout>
                  </ProtectedRoute>
                }
              />

              {/* Design System Showcase (Phase 2) */}
              <Route
                path="/design-system"
                element={
                  <Layout>
                    <DesignSystemShowcase />
                  </Layout>
                }
              />

              {/* Fallback */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <Toaster />
            <Sonner />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

export default App;
