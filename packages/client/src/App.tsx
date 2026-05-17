/**
 * SPA 路由表。
 *
 * 架构位置：只声明 URL 到页面组件的映射；认证跳转、setup 可见性和缓存刷新由
 * AuthSync / 页面级 hook 处理，避免路由表承载业务副作用。
 *
 * 注意： 新增公开页面时必须同步 `public-routes.ts`，否则刷新后会被客户端守卫带回登录页。
 */
import { Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "@/pages/dashboard";
import Subscriptions from "@/pages/subscriptions";
import Calendar from "@/pages/calendar";
import Statistics from "@/pages/statistics";
import Settings from "@/pages/settings";
import Setup from "@/pages/setup";
import Login from "@/pages/login";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import AdminUsers from "@/pages/admin/users";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/subscriptions" element={<Subscriptions />} />
      <Route path="/calendar" element={<Calendar />} />
      <Route path="/statistics" element={<Statistics />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/admin/users" element={<AdminUsers />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
