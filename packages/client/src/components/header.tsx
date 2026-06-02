/**
 * 顶部导航栏（桌面）+ 底部导航栏（移动端）。
 *
 * 作用：
 * - 提供全局导航（仪表盘/订阅/日历/统计/设置）
 * - 主题切换（dark/light）
 * - 可选：在支持的页面提供“新增订阅”入口
 *
 * 注意： Header 的主题切换只代表本设备即时偏好；跨设备外观同步必须在 Settings 页保存完成。
 */

import Link, { NavLink } from '@/components/router-link';
import { useRouter } from '@/lib/router';
import { LayoutDashboard, List, CalendarDays, BarChart3, Settings, Sun, Moon, LogOut } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { SubscriptionDraft } from '@/types/subscription';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme-provider';
import { useToast } from '@/hooks/use-toast';
import { RenewletLogo } from '@/components/icons/renewlet-logo';
import { authClient } from '@/lib/auth-client';
import { AddSubscriptionDialog } from '@/components/add-subscription-dialog';
import { SystemUpdateDialog } from '@/components/system-update-dialog';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages';

interface HeaderProps {
  /** 新增订阅回调（传入订阅主体数据，不包含 id）。不传则隐藏“新增订阅”按钮。 */
  onAddSubscription?: (subscription: SubscriptionDraft) => void;
  /** 当前用户已有标签建议，用于新增订阅弹窗复用。 */
  availableTags?: readonly string[] | undefined;
}

type NavIconKey = "dashboard" | "subscriptions" | "calendar" | "statistics" | "settings";

/** 导航项配置：路径 / 文案 / 图标 key。 */
const navItems: Array<{ path: string; labelKey: MessageKey; icon: NavIconKey }> = [
  { path: '/', labelKey: 'nav.dashboard', icon: "dashboard" },
  { path: '/subscriptions', labelKey: 'nav.subscriptions', icon: "subscriptions" },
  { path: '/calendar', labelKey: 'nav.calendar', icon: "calendar" },
  { path: '/statistics', labelKey: 'nav.statistics', icon: "statistics" },
  { path: '/settings', labelKey: 'nav.settings', icon: "settings" },
];

function renderNavIcon(icon: NavIconKey, className: string) {
  switch (icon) {
    case "dashboard":
      return <LayoutDashboard className={className} />;
    case "subscriptions":
      return <List className={className} />;
    case "calendar":
      return <CalendarDays className={className} />;
    case "statistics":
      return <BarChart3 className={className} />;
    case "settings":
      return <Settings className={className} />;
  }
}

/** Header 组件：全局导航 + 主题切换 + 新增订阅入口。 */
export function Header({ onAddSubscription, availableTags }: HeaderProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const { t } = useI18n();
  const { data: sessionData } = authClient.useSession();
  const [systemDialogOpen, setSystemDialogOpen] = useState(false);
  const isAdmin = sessionData?.user.role === "admin";

  /**
   * Header 是全局快捷开关，只写本机偏好；账户级外观草稿必须从 Settings 页外观控件产生。
   */
  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  };

  /** 退出登录：清理本地认证会话并回到 /login。 */
  const handleLogout = async () => {
    try {
      await authClient.signOut();
      toast({
        title: t("header.logoutSuccessTitle"),
        description: t("header.logoutSuccessDescription"),
      });
      router.replace('/login');
    } catch {
      toast({
        title: t("header.logoutFailedTitle"),
        description: t("error.generic"),
        variant: "destructive",
      });
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl" data-testid="app-header">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-4 lg:gap-8">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#111720] text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_30px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
              <RenewletLogo className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold tracking-tight text-foreground">Renewlet</h1>
              <p className="hidden truncate text-xs text-muted-foreground min-[380px]:block">{t("app.tagline")}</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                href={item.path}
                end={item.path === "/"}
                className={({ isActive }) => cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                {renderNavIcon(item.icon, "h-4 w-4")}
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {isAdmin ? <SystemUpdateDialog open={systemDialogOpen} onOpenChange={setSystemDialogOpen} /> : null}

          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleTheme}
            className="h-9 w-9"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">{t("header.toggleTheme")}</span>
          </Button>
          
          {onAddSubscription && (
            <AddSubscriptionDialog onAdd={onAddSubscription} availableTags={availableTags} />
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
            title={t("header.logout")}
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">{t("header.logout")}</span>
          </Button>
        </div>
      </div>

      {/* 移动端导航 */}
      <nav className="flex border-t border-border lg:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            href={item.path}
            end={item.path === "/"}
            className={({ isActive }) => cn(
              "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            {renderNavIcon(item.icon, "h-5 w-5")}
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
