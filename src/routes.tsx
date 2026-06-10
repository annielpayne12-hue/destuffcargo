import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

// Lazy-load every page so Vite splits them into separate chunks.
// Only the current route's JS is downloaded on initial load.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ContainersPage = lazy(() => import('./pages/ContainersPage'));
const CargoSubPage  = lazy(() => import('./pages/CargoSubPage'));
const ReportsPage   = lazy(() => import('./pages/ReportsPage'));
const UsersPage     = lazy(() => import('./pages/UsersPage'));
const AuditLogPage  = lazy(() => import('./pages/AuditLogPage'));
const LocationsPage = lazy(() => import('./pages/LocationsPage'));
const AccountPage   = lazy(() => import('./pages/AccountPage'));
const SettingsPage  = lazy(() => import('./pages/SettingsPage'));
const ImportPage    = lazy(() => import('./pages/ImportPage'));
const DocumentationPage = lazy(() => import('./pages/DocumentationPage'));
const ContainerYardPage = lazy(() => import('./pages/ContainerYardPage'));
const ManifestsPage = lazy(() => import('./pages/ManifestsPage'));

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

export const routes: RouteConfig[] = [
  {
    name: 'Login',
    path: '/login',
    element: null, // rendered separately in App.tsx outside RouteGuard
    public: true,
  },
  {
    name: 'Dashboard',
    path: '/',
    element: <DashboardPage />,
  },
  {
    name: 'Containers',
    path: '/containers',
    element: <ContainersPage />,
  },
  {
    name: 'Locations',
    path: '/locations',
    element: <LocationsPage />,
  },
  {
    name: 'Cargo',
    path: '/containers/:containerId',
    element: <CargoSubPage />,
  },
  {
    name: 'Reports',
    path: '/reports',
    element: <ReportsPage />,
  },
  {
    name: 'Import',
    path: '/import',
    element: <ImportPage />,
  },
  {
    name: 'Users',
    path: '/users',
    element: <UsersPage />,
  },
  {
    name: 'Audit Log',
    path: '/audit-log',
    element: <AuditLogPage />,
  },
  {
    name: 'My Account',
    path: '/account',
    element: <AccountPage />,
  },
  {
    name: 'Settings',
    path: '/settings',
    element: <SettingsPage />,
  },
  {
    name: 'Documentation',
    path: '/documentation',
    element: <DocumentationPage />,
  },
  {
    name: 'Container Yard',
    path: '/container-yard',
    element: <ContainerYardPage />,
  },
  {
    name: 'Manifests',
    path: '/manifests',
    element: <ManifestsPage />,
  },
];
