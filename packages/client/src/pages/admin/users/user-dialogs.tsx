/**
 * 管理员用户操作弹窗。
 *
 * 架构位置：创建、重置密码、删除确认都由 AdminUsersPage 持有状态，本文件只负责表单可访问性和展示。
 *
 * 注意： 删除弹窗文案必须继续提示关联数据会被清理；后端实际级联逻辑变化时要同步这里。
 */
import type { FormEvent, RefObject } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/I18nProvider";
import type { AdminUser } from "@/lib/api/schemas/admin";
import type { CreateUserErrors, CreateUserFormState, ResetPasswordErrors } from "./types";

export interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: CreateUserFormState;
  errors: CreateUserErrors;
  isCreating: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  updateForm: <K extends keyof CreateUserFormState>(field: K, value: CreateUserFormState[K]) => void;
  nameInputRef: RefObject<HTMLInputElement | null>;
  emailInputRef: RefObject<HTMLInputElement | null>;
  passwordInputRef: RefObject<HTMLInputElement | null>;
  confirmPasswordInputRef: RefObject<HTMLInputElement | null>;
}

export function CreateUserDialog({
  open,
  onOpenChange,
  form,
  errors,
  isCreating,
  onSubmit,
  updateForm,
  nameInputRef,
  emailInputRef,
  passwordInputRef,
  confirmPasswordInputRef,
}: CreateUserDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {t("admin.createUser")}
          </DialogTitle>
          <DialogDescription>{t("admin.createDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="create-user-name">{t("setup.name")}</Label>
              <Input
                ref={nameInputRef}
                id="create-user-name"
                value={form.name}
                onChange={(e) => updateForm("name", e.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "create-user-name-error" : undefined}
                autoComplete="name"
                required
              />
              <FieldError id="create-user-name-error" message={errors.name} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-user-email">{t("auth.email")}</Label>
              <Input
                ref={emailInputRef}
                id="create-user-email"
                type="email"
                value={form.email}
                onChange={(e) => updateForm("email", e.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "create-user-email-error" : undefined}
                autoComplete="email"
                required
              />
              <FieldError id="create-user-email-error" message={errors.email} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="create-user-password">{t("admin.initialPassword")}</Label>
              <Input
                ref={passwordInputRef}
                id="create-user-password"
                type="password"
                minLength={8}
                value={form.password}
                onChange={(e) => updateForm("password", e.target.value)}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "create-user-password-error" : undefined}
                autoComplete="new-password"
                required
              />
              <FieldError id="create-user-password-error" message={errors.password} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-user-confirm-password">{t("admin.confirmInitialPassword")}</Label>
              <Input
                ref={confirmPasswordInputRef}
                id="create-user-confirm-password"
                type="password"
                minLength={8}
                value={form.confirmPassword}
                onChange={(e) => updateForm("confirmPassword", e.target.value)}
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={errors.confirmPassword ? "create-user-confirm-password-error" : undefined}
                autoComplete="new-password"
                required
              />
              <FieldError id="create-user-confirm-password-error" message={errors.confirmPassword} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-user-role">{t("admin.role")}</Label>
            <Select
              value={form.role}
              onValueChange={(value) => updateForm("role", value === "admin" ? "admin" : "user")}
            >
              <SelectTrigger id="create-user-role" aria-label={t("admin.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t("admin.roleUser")}</SelectItem>
                <SelectItem value="admin">{t("admin.roleAdmin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary-glow"
              disabled={isCreating}
            >
              {isCreating ? t("common.creating") : t("admin.createUser")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface ResetPasswordDialogProps {
  user: AdminUser | null;
  updatingUserIds: Set<string>;
  password: string;
  confirmPassword: string;
  errors: ResetPasswordErrors;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onPasswordChange: (password: string) => void;
  onConfirmPasswordChange: (password: string) => void;
  clearErrors: () => void;
  resetDialog: () => void;
  passwordInputRef: RefObject<HTMLInputElement | null>;
  confirmPasswordInputRef: RefObject<HTMLInputElement | null>;
}

export function ResetPasswordDialog({
  user,
  updatingUserIds,
  password,
  confirmPassword,
  errors,
  onOpenChange,
  onSubmit,
  onPasswordChange,
  onConfirmPasswordChange,
  clearErrors,
  resetDialog,
  passwordInputRef,
  confirmPasswordInputRef,
}: ResetPasswordDialogProps) {
  const { t } = useI18n();
  const isSaving = user ? updatingUserIds.has(user.id) : false;

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            {t("admin.resetPassword")}
          </DialogTitle>
          <DialogDescription>
            {user
              ? t("admin.resetDescription", { name: user.name, email: user.email })
              : t("admin.resetFallback")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="reset-user-password">{t("passwordReset.newPassword")}</Label>
            <Input
              ref={passwordInputRef}
              id="reset-user-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => {
                onPasswordChange(e.target.value);
                clearErrors();
              }}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "reset-user-password-error" : undefined}
              autoComplete="new-password"
              required
            />
            <FieldError id="reset-user-password-error" message={errors.password} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reset-user-confirm-password">{t("passwordReset.confirmPassword")}</Label>
            <Input
              ref={confirmPasswordInputRef}
              id="reset-user-confirm-password"
              type="password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => {
                onConfirmPasswordChange(e.target.value);
                clearErrors();
              }}
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={errors.confirmPassword ? "reset-user-confirm-password-error" : undefined}
              autoComplete="new-password"
              required
            />
            <FieldError id="reset-user-confirm-password-error" message={errors.confirmPassword} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={resetDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary-glow"
              disabled={!user || isSaving}
            >
              {isSaving ? t("common.saving") : t("passwordReset.saveNew")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface DeleteUserDialogProps {
  target: AdminUser | null;
  updatingUserIds: Set<string>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}

export function DeleteUserDialog({ target, updatingUserIds, onOpenChange, onConfirm }: DeleteUserDialogProps) {
  const { t } = useI18n();
  const isDeleting = target ? updatingUserIds.has(target.id) : false;

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-border bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("admin.deleteUser")}</AlertDialogTitle>
          <AlertDialogDescription>
            {target
              ? t("admin.deleteDescription", { name: target.name, email: target.email })
              : t("admin.deleteFallback")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!target || isDeleting}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
          >
            {isDeleting ? t("admin.deleting") : t("admin.confirmDelete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
