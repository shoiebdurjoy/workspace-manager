import React, { ReactNode } from 'react';
import AppShell from './AppShell';
import { HierarchyDialogsProvider } from '@/components/hierarchy/HierarchyDialogsProvider';

interface LayoutProps {
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <HierarchyDialogsProvider>
      <AppShell>{children}</AppShell>
    </HierarchyDialogsProvider>
  );
};

export default Layout;
