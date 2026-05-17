/**
 * 重置密码客户端表单。
 *
 * 架构位置：负责本地密码一致性校验和 PocketBase confirmPasswordReset 调用。
 *
 * 注意： 成功后立即清空本地密码 state，避免用户离开页面前明文继续停留在内存和输入框中。
 */
import { type FormEvent, useRef, useState } from "react";
import Link from '@/components/router-link';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RenewletLogo } from "@/components/icons/renewlet-logo";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { toast } from "@/components/ui/sonner";
import { pb } from "@/lib/pocketbase";
import { useI18n } from "@/i18n/I18nProvider";

type ResetPasswordClientProps = {
  token: string;
};

type ResetPasswordErrors = Partial<Record<"password" | "confirm", string>>;

export function ResetPasswordClient({ token }: ResetPasswordClientProps) {
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<ResetPasswordErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const { t } = useI18n();

  const validate = () => {
    const nextErrors: ResetPasswordErrors = {};
    if (!password.trim()) {
      nextErrors.password = t("passwordReset.passwordRequired");
    } else if (password.length < 8) {
      nextErrors.password = t("passwordReset.passwordLength");
    }

    if (!confirm) {
      nextErrors.confirm = t("passwordReset.confirmRequired");
    } else if (password !== confirm) {
      nextErrors.confirm = t("passwordReset.passwordMismatch");
    }

    return nextErrors;
  };

  const focusFirstError = (nextErrors: ResetPasswordErrors) => {
    if (nextErrors.password) {
      passwordInputRef.current?.focus();
      return;
    }
    if (nextErrors.confirm) {
      confirmInputRef.current?.focus();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusFirstError(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});
    try {
      await pb.collection("users").confirmPasswordReset(token, password, password);
      setSucceeded(true);
      setPassword("");
      setConfirm("");
      toast.success(t("passwordReset.passwordUpdated"));
    } catch (err: unknown) {
      toast.error(t("passwordReset.resetFailed"), {
        description: getDisplayErrorMessage(err, t("passwordReset.resetFailedDescription")),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen theme-gradient flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card grid gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#111720] text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_32px_-22px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
              <RenewletLogo className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("passwordReset.newTitle")}</h1>
              <p className="text-xs text-muted-foreground">{t("passwordReset.newSubtitle")}</p>
            </div>
          </div>

          {!token ? (
            <div className="rounded-lg border border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
              <ShieldAlert className="mb-3 h-5 w-5 text-primary" />
              <p>{t("passwordReset.tokenMissing1")}</p>
              <p className="mt-2">{t("passwordReset.tokenMissing2")}</p>
            </div>
          ) : succeeded ? (
            <div className="rounded-lg border border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
              <CheckCircle2 className="mb-3 h-5 w-5 text-primary" />
              <p>{t("passwordReset.updatedLogin")}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="new-password">{t("passwordReset.newPassword")}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={passwordInputRef}
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (errors.password) setErrors((prev) => {
                        const { password: _password, ...next } = prev;
                        return next;
                      });
                    }}
                    className="pl-10 pr-10 bg-secondary border-border"
                    autoComplete="new-password"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? "new-password-error" : "new-password-description"}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p id="new-password-description" className="text-xs text-muted-foreground">
                  {t("passwordReset.passwordHelp")}
                </p>
                <FieldError id="new-password-error" message={errors.password} />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="confirm-password">{t("passwordReset.confirmPassword")}</Label>
                <Input
                  ref={confirmInputRef}
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    if (errors.confirm) setErrors((prev) => {
                      const { confirm: _confirm, ...next } = prev;
                      return next;
                    });
                  }}
                  className="bg-secondary border-border"
                  autoComplete="new-password"
                  aria-invalid={Boolean(errors.confirm)}
                  aria-describedby={errors.confirm ? "confirm-password-error" : undefined}
                  required
                />
                <FieldError id="confirm-password-error" message={errors.confirm} />
              </div>

              <Button
                type="submit"
                className="w-full bg-primary text-primary-foreground hover:bg-primary-glow"
                disabled={isSubmitting}
              >
                {isSubmitting ? t("common.saving") : t("passwordReset.saveNew")}
              </Button>
            </form>
          )}

          <div className="flex items-center justify-between text-sm">
            <Link href="/login" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              {t("common.backToLogin")}
            </Link>
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              {t("common.backHome")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
