
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
import Workspaces from "@/pages/Workspaces";
import WorkspaceDetail from "@/pages/WorkspaceDetail";
import Unauthorized from "@/pages/Unauthorized";
import NotFound from "@/pages/NotFound";
import { UserRole } from "./types";

// Create a client
const queryClient = new QueryClient();

const App = () => (
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AuthProvider>
            <Toaster />
            <Sonner />
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
                path="/workspaces/:id"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <WorkspaceDetail />
                    </Layout>
                  </ProtectedRoute>
                }
              />

              {/* Author/Admin Only Routes */}
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

              {/* 404 Page for payments */}
              <Route path="/payments" element={<NotFound />} />

              {/* Fallback */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

export default App;
