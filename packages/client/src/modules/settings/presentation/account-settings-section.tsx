/**
 * 账号设置展示区。
 *
 * 架构位置：只渲染邮箱、密码弹窗和 PocketBase Admin 入口；密码修改流程由 application hook 管理。
 *
 * 注意： 不要在展示层缓存密码字段，关闭弹窗时必须交给 controller 清理。
 */
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from '@/components/router-link';
import { useI18n } from '@/i18n/I18nProvider';
import { ExternalLink } from 'lucide-react';

export interface AccountSettingsSectionProps {
  accountEmail: string | null;
  canAccessPocketBaseAdmin: boolean;
  passwordResetEnabled: boolean;
  passwordDialogOpen: boolean;
  setPasswordDialogOpen: (open: boolean) => void;
  handlePasswordDialogOpenChange: (open: boolean) => void;
  currentPassword: string;
  setCurrentPassword: (value: string) => void;
  newPassword: string;
  setNewPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  isUpdatingPassword: boolean;
  updatePassword: () => void | Promise<void>;
}

export function AccountSettingsSection({
  accountEmail,
  canAccessPocketBaseAdmin,
  passwordResetEnabled,
  passwordDialogOpen,
  setPasswordDialogOpen,
  handlePasswordDialogOpenChange,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  isUpdatingPassword,
  updatePassword,
}: AccountSettingsSectionProps) {
  const { t } = useI18n();

  return (
    <>
                  <section className="rounded-xl border border-border bg-card p-6">
                    <h2 className="mb-6 text-lg font-semibold text-foreground">{t("settings.account")}</h2>
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="username">{t("settings.username")}</Label>
                        <Input
                          id="username"
                          value={accountEmail ?? ""}
                          placeholder={accountEmail === null ? t("settings.emailLoading") : t("settings.emailMissing")}
                          readOnly
                          className="border-border bg-secondary"
                        />
                        <p className="text-xs text-muted-foreground">{t("settings.usernameHelp")}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <Link
                            href="/admin/users"
                            className="inline-flex text-xs text-primary hover:underline"
                          >
                            {t("settings.manageUsers")}
                          </Link>
                          {canAccessPocketBaseAdmin ? (
                            <a
                              href="/_/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              {t("settings.pocketBaseAdmin")}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="password">{t("auth.password")}</Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          readOnly
                          className="border-border bg-secondary"
                        />
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-primary/40 text-primary hover:bg-primary/10"
                            onClick={() => setPasswordDialogOpen(true)}
                          >
                            {t("settings.changePassword")}
                          </Button>
                          {passwordResetEnabled ? (
                            <Link
                              href="/forgot-password"
                              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {t("auth.forgotPassword")}
                            </Link>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{t("settings.passwordHelp")}</p>
                      </div>
                    </div>
                  </section>
      
                  {/* 修改密码弹窗 */}
                  <Dialog
                    open={passwordDialogOpen}
                    onOpenChange={handlePasswordDialogOpenChange}
                  >
                    <DialogContent className="border-border bg-card">
                      <DialogHeader>
                        <DialogTitle>{t("settings.passwordDialogTitle")}</DialogTitle>
                        <DialogDescription>
                          {t("settings.passwordDialogDescription")}
                        </DialogDescription>
                      </DialogHeader>
      
                      <div className="grid gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="currentPassword">{t("settings.currentPassword")}</Label>
                          <Input
                            id="currentPassword"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder={t("settings.currentPasswordPlaceholder")}
                            className="border-border bg-secondary"
                            autoComplete="current-password"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="newPassword">{t("passwordReset.newPassword")}</Label>
                          <Input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder={t("settings.newPasswordPlaceholder")}
                            className="border-border bg-secondary"
                            autoComplete="new-password"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="confirmPassword">{t("passwordReset.confirmPassword")}</Label>
                          <Input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder={t("settings.confirmPasswordPlaceholder")}
                            className="border-border bg-secondary"
                            autoComplete="new-password"
                          />
                        </div>
                      </div>
      
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                          {t("common.cancel")}
                        </Button>
                        <Button
                          type="button"
                          onClick={updatePassword}
                          disabled={isUpdatingPassword}
                          className="bg-primary text-primary-foreground hover:bg-primary-glow"
                        >
                          {isUpdatingPassword ? t("common.saving") : t("settings.saveNewPassword")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
      
    </>
  );
}
