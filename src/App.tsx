import React, { Suspense, lazy } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthProvider';
import { useAuth } from '@/hooks/use-auth';
import Layout from '@/components/layout/Layout';
import ProtectedRoute, { FullScreen } from '@/components/auth/ProtectedRoute';
import { LoadingState } from '@/components/ui/loading-state';
import Login from '@/pages/Login';
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const AuthCallback = lazy(() => import('@/pages/AuthCallback'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));
const Home = lazy(() => import('@/pages/Home'));
const Team = lazy(() => import('@/pages/Team'));
const SpacePage = lazy(() => import('@/pages/SpacePage'));
const FolderPage = lazy(() => import('@/pages/FolderPage'));
const ListPage = lazy(() => import('@/pages/ListPage'));
const Profile = lazy(() => import('@/pages/Profile'));
const Settings = lazy(() => import('@/pages/Settings'));
const Unauthorized = lazy(() => import('@/pages/Unauthorized'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const DesignSystemShowcase = lazy(() => import('@/pages/DesignSystemShowcase'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401/403 is never going to succeed on retry; everything else retries once.
      retry: (failureCount, error) => {
        const code = (error as { code?: string } | null)?.code;
        if (code === 'PERMISSION_DENIED' || code === '42501' || code === 'PGRST301') return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: true,
    },
  },
});

/** `/` sends people where they belong: the app when signed in, otherwise sign-in. */
const RootRedirect: React.FC = () => {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <FullScreen>
        <LoadingState title="Loading TBB Workspace" />
      </FullScreen>
    );
  }
  return <Navigate to={status === 'unauthenticated' ? '/login' : '/home'} replace />;
};

const App = () => (
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <Suspense
              fallback={
                <FullScreen>
                  <LoadingState title="Loading..." />
                </FullScreen>
              }
            >
            <Routes>
              <Route path="/" element={<RootRedirect />} />

              {/* Signed-out screens */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/callback" element={<AuthCallback />} />

              {/* Signed in, but not yet part of a workspace */}
              <Route
                path="/onboarding"
                element={
                  <ProtectedRoute requireWorkspace={false}>
                    <Onboarding />
                  </ProtectedRoute>
                }
              />

              {/* Workspace members */}
              <Route
                path="/home"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Home />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route path="/dashboard" element={<Navigate to="/home" replace />} />
              <Route
                path="/spaces/:spaceId"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <SpacePage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/spaces/:spaceId/folders/:folderId"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <FolderPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/spaces/:spaceId/lists/:listId"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <ListPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/team"
                element={
                  <ProtectedRoute capability="team:view">
                    <Layout>
                      <Team />
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
                path="/design-system"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <DesignSystemShowcase />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route path="/unauthorized" element={<Unauthorized />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            <Toaster />
            <Sonner />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

export default App;
