import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { FullScreenSpinner, GuestRoute, ProtectedRoute, RequirePermission } from './guards.jsx';
import AuthLayout from '../layouts/AuthLayout.jsx';
import AppLayout from '../layouts/AppLayout.jsx';
import NotFound from '../pages/NotFound.jsx';

// Auth pages are small and first-paint critical, so they are eager. Everything inside the app shell is lazy.
import Login from '../pages/auth/Login.jsx';
import Register from '../pages/auth/Register.jsx';
import ForgotPassword from '../pages/auth/ForgotPassword.jsx';
import ResetPassword from '../pages/auth/ResetPassword.jsx';
import VerifyEmail from '../pages/auth/VerifyEmail.jsx';

const Dashboard = lazy(() => import('../pages/dashboard/Dashboard.jsx'));
const Files = lazy(() => import('../pages/files/Files.jsx'));
const Shared = lazy(() => import('../pages/shared/Shared.jsx'));
const Starred = lazy(() => import('../pages/starred/Starred.jsx'));
const Recent = lazy(() => import('../pages/recent/Recent.jsx'));
const Trash = lazy(() => import('../pages/trash/Trash.jsx'));
const Search = lazy(() => import('../pages/search/Search.jsx'));
const Activity = lazy(() => import('../pages/activity/Activity.jsx'));
const Notifications = lazy(() => import('../pages/notifications/Notifications.jsx'));
const Settings = lazy(() => import('../pages/settings/Settings.jsx'));
const AdminLayout = lazy(() => import('../pages/admin/AdminLayout.jsx'));
const AdminOverview = lazy(() => import('../pages/admin/Overview.jsx'));
const AdminUsers = lazy(() => import('../pages/admin/Users.jsx'));
const AdminRoles = lazy(() => import('../pages/admin/Roles.jsx'));
const AdminActivity = lazy(() => import('../pages/admin/AdminActivity.jsx'));
const AdminStorage = lazy(() => import('../pages/admin/AdminStorage.jsx'));
const PublicShare = lazy(() => import('../pages/public/PublicShare.jsx'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        {/* Public: works signed in or out */}
        <Route path="/s/:token" element={<PublicShare />} />
        <Route element={<AuthLayout />}>
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Route>
        </Route>

        {/* Signed in */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="files" element={<Files />} />
            <Route path="files/:folderId" element={<Files />} />
            <Route path="shared" element={<Shared />} />
            <Route path="starred" element={<Starred />} />
            <Route path="recent" element={<Recent />} />
            <Route path="trash" element={<Trash />} />
            <Route path="search" element={<Search />} />
            <Route element={<RequirePermission permission="activity:read-own" />}>
              <Route path="activity" element={<Activity />} />
            </Route>
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<Settings />} />

            <Route path="admin" element={<RequirePermission permission="admin:access" />}>
              <Route element={<AdminLayout />}>
                <Route index element={<RequirePermission permission="admin:analytics"><AdminOverview /></RequirePermission>} />
                <Route path="users" element={<RequirePermission permission="user:read"><AdminUsers /></RequirePermission>} />
                <Route path="roles" element={<RequirePermission permission="user:read"><AdminRoles /></RequirePermission>} />
                <Route path="activity" element={<RequirePermission permission="activity:read-all"><AdminActivity /></RequirePermission>} />
                <Route path="storage" element={<RequirePermission permission="admin:analytics"><AdminStorage /></RequirePermission>} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>

        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
