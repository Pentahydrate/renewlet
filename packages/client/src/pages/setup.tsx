/**
 * 首次安装页面。
 *
 * 架构位置：检查 setup 状态后调用 `/api/app/setup` 创建初始管理员；
 * 是否允许初始化、是否同步 PocketBase superuser 由后端最终裁决。
 *
 * 注意： 这里的表单校验只是 UX，不能放宽后端 strict JSON 和安装状态检查。
 */
import { type FormEvent, useRef, useState } from "react";
import { useRouter } from '@/lib/router';
import { ArrowRight, Lock, Mail, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RenewletLogo } from "@/components/icons/renewlet-logo";
import { toast } from "@/components/ui/sonner";
import { apiFetch } from "@/lib/api-client";
import { setupCreateResponseSchema } from "@/lib/api/schemas/app";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { useI18n } from "@/i18n/I18nProvider";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SetupErrors = Partial<Record<"name" | "email" | "password", string>>;

export default function SetupPage() {
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const { setupRequired, isLoading: isSetupStatusLoading } = useSetupStatus();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("Admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<SetupErrors>({});
  const { t } = useI18n();

  const validate = () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const nextErrors: SetupErrors = {};

    if (!trimmedName) nextErrors.name = t("setup.validation.nameRequired");
    if (!trimmedEmail || !emailPattern.test(trimmedEmail)) nextErrors.email = t("setup.validation.emailInvalid");
    if (password.length < 8) nextErrors.password = t("setup.validation.passwordLength");

    return { nextErrors, trimmedName, trimmedEmail };
  };

  const focusFirstError = (nextErrors: SetupErrors) => {
    if (nextErrors.name) {
      nameInputRef.current?.focus();
      return;
    }
    if (nextErrors.email) {
      emailInputRef.current?.focus();
      return;
    }
    if (nextErrors.password) {
      passwordInputRef.current?.focus();
    }
  };

  const clearError = (field: keyof SetupErrors) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const { nextErrors, trimmedName, trimmedEmail } = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusFirstError(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});
    try {
      await apiFetch("/api/app/setup", setupCreateResponseSchema, {
        method: "POST",
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail, password }),
      });

      toast.success(t("setup.adminCreated"));
      router.replace("/login");
    } catch (error: unknown) {
      toast.error(t("setup.failed"), {
        description: getDisplayErrorMessage(error, t("setup.failedDescription")),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isSetupStatusLoading && setupRequired === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 theme-gradient">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <h1 className="text-xl font-semibold text-foreground">{t("setup.completedTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("setup.completedDescription")}</p>
          <Button className="mt-6 w-full" onClick={() => router.replace("/login")}>
            {t("setup.goToLogin")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 theme-gradient">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-card">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#111720] text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_32px_-22px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
            <RenewletLogo className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{t("setup.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("setup.subtitle")}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="name">{t("setup.name")}</Label>
            <div className="relative">
              <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={nameInputRef}
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError("name");
                }}
                className="pl-10"
                autoComplete="name"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "setup-name-error" : undefined}
                required
              />
            </div>
            <FieldError id="setup-name-error" message={errors.name} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={emailInputRef}
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError("email");
                }}
                className="pl-10"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "setup-email-error" : undefined}
                required
              />
            </div>
            <FieldError id="setup-email-error" message={errors.email} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={passwordInputRef}
                id="password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError("password");
                }}
                className="pl-10"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "setup-password-error" : undefined}
                required
              />
            </div>
            <FieldError id="setup-password-error" message={errors.password} />
          </div>

          <div className="pt-3">
            <Button type="submit" className="w-full" disabled={isSubmitting || isSetupStatusLoading}>
              {isSubmitting ? t("common.creating") : t("setup.createAdmin")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
