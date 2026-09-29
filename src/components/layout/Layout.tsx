import React, { ReactNode } from 'react';
import AppShell from './AppShell';

interface LayoutProps {
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return <AppShell>{children}</AppShell>;
};

export default Layout;
