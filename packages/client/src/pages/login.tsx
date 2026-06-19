/**
 * 登录/注册页（/login）。
 *
 * 支持：
 * - 邮箱 + 密码登录
 *
 * 跳转逻辑：
 * - 通过查询参数 `next` 传入登录后要跳转的站内路径（例如：/settings）
 * - 为安全起见，仅允许以 `/` 开头的站内相对路径
 */

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from '@/components/router-link';
import { useRouter } from '@/lib/router';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from "@/components/ui/form-field";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RenewletBrandLockup } from '@/components/brand/renewlet-brand-mark';
import { toast } from '@/components/ui/sonner';
import { authClient } from '@/lib/auth-client';
import { getAuthDisplayMessage } from '@/lib/display-error';
import { sanitizeNextPath } from '@/lib/redirect';
import { reportClientError } from "@/lib/report-client-error";
import { usePasswordResetAvailability } from '@/hooks/use-password-reset-availability';
import { useSetupStatus } from '@/hooks/use-setup-status';
import { useI18n } from '@/i18n/I18nProvider';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REMEMBERED_LOGIN_EMAIL_STORAGE_KEY = "renewlet_login_email";

type LoginErrors = Partial<Record<"email" | "password", string>>;

function readRememberedLoginEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(REMEMBERED_LOGIN_EMAIL_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function rememberLoginEmail(email: string) {
  try {
    window.localStorage.setItem(REMEMBERED_LOGIN_EMAIL_STORAGE_KEY, email);
  } catch {
    // 邮箱缓存只是表单便利，不参与认证；隐私模式或存储受限时静默退化为不记住账号。
  }
}

function forgetRememberedLoginEmail() {
  try {
    window.localStorage.removeItem(REMEMBERED_LOGIN_EMAIL_STORAGE_KEY);
  } catch {
    // 同上，清理失败不应阻断登录流程。
  }
}

const Login = () => {
  const router = useRouter();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState(readRememberedLoginEmail);
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(true);
  const [errors, setErrors] = useState<LoginErrors>({});
  const passwordResetEnabled = usePasswordResetAvailability();
  const setupStatus = useSetupStatus();
  const { t } = useI18n();
  const showSetupPrompt = setupStatus.setupRequired && setupStatus.setupEnabled;

  /** 读取并校验 next 跳转路径；登录页是开放路由，必须在这里防止开放重定向。 */
  const getNextPath = () => {
    if (typeof window === "undefined") return "/";
    const raw = new URLSearchParams(window.location.search).get("next");
    return sanitizeNextPath(raw);
  };

  const validate = () => {
    const trimmedEmail = email.trim();
    const nextErrors: LoginErrors = {};

    if (!trimmedEmail) {
      nextErrors.email = t("auth.validation.emailRequired");
    } else if (!emailPattern.test(trimmedEmail)) {
      nextErrors.email = t("auth.validation.emailInvalid");
    }
    if (!password) nextErrors.password = t("auth.validation.passwordRequired");

    return { nextErrors, trimmedEmail };
  };

  const focusFirstError = (nextErrors: LoginErrors) => {
    if (nextErrors.email) {
      emailInputRef.current?.focus();
      return;
    }
    if (nextErrors.password) {
      passwordInputRef.current?.focus();
    }
  };

  const clearError = (field: keyof LoginErrors) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { nextErrors, trimmedEmail } = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusFirstError(nextErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});
    try {
      const { error } = await authClient.signIn.email({ email: trimmedEmail, password });
      if (error) {
        reportClientError(error, { source: "login" });
        toast.error(t("auth.loginFailed"), {
          description: getAuthDisplayMessage(error),
        });
        return;
      }
      if (rememberEmail) {
        rememberLoginEmail(trimmedEmail);
      } else {
        forgetRememberedLoginEmail();
      }
      toast.success(t("auth.loginSuccess"));
      // 登录成功后只跳转 sanitize 后的站内路径，避免 next 参数把 token/session 状态带到外站。
      router.push(getNextPath());
    } catch (err: unknown) {
      reportClientError(err, { source: "login" });
      toast.error(t("auth.loginFailed"), {
        description: getAuthDisplayMessage(err),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-page bg-background theme-gradient flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary/20 via-primary/10 to-background items-center justify-center p-12">
        <div className="max-w-md grid gap-8">
          <RenewletBrandLockup
            title="Renewlet"
            subtitle={t("app.tagline")}
            markSize="lg"
            titleClassName="text-3xl font-extrabold tracking-tight"
            subtitleClassName="text-sm"
          />
          
          <div className="grid gap-4">
            <h2 className="text-2xl font-semibold text-foreground">
              {t("auth.heroTitle")}
            </h2>
            <ul className="grid gap-3 text-muted-foreground">
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t("auth.heroTrackCosts")}
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t("auth.heroRenewalReminder")}
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t("auth.heroAnalyzeSpending")}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="auth-form-panel flex-1 flex items-center justify-center">
        <div className="w-full max-w-md grid gap-8">
          <RenewletBrandLockup
            title="Renewlet"
            subtitle={t("app.tagline")}
            className="justify-center lg:hidden"
            titleClassName="text-2xl font-extrabold tracking-tight"
          />

          <div className="text-center lg:text-left">
            <h2 className="text-2xl font-bold text-foreground">{t("auth.welcomeBack")}</h2>
            <p className="mt-2 text-muted-foreground">
              {t("auth.loginSubtitle")}
            </p>
          </div>

          <div className="grid gap-6">
            <form onSubmit={handleLogin} className="grid gap-4" noValidate>
              <FormField id="login-email" label={t("auth.email")} error={errors.email}>
                {(field) => (
                  <>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={emailInputRef}
                    id={field.id}
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    enterKeyHint="next"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearError("email");
                    }}
                    className="pl-10 bg-secondary border-border"
                    aria-invalid={field.invalid}
                    aria-describedby={field.describedBy}
                    required
                  />
                </div>
                  </>
                )}
              </FormField>

              <FormField
                id="login-password"
                error={errors.password}
                labelSlot={(
                  <div className="flex items-center justify-between">
                  <Label htmlFor="login-password">{t("auth.password")}</Label>
                  {passwordResetEnabled ? (
                    <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                      {t("auth.forgotPassword")}
                    </Link>
                  ) : null}
                </div>
                )}
              >
                {(field) => (
                  <>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={passwordInputRef}
                    id={field.id}
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    enterKeyHint="done"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearError("password");
                    }}
                    className="pl-10 pr-10 bg-secondary border-border"
                    aria-invalid={field.invalid}
                    aria-describedby={field.describedBy}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                  </>
                )}
              </FormField>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember-login-email"
                  checked={rememberEmail}
                  onCheckedChange={(checked) => {
                    const nextRememberEmail = checked === true;
                    setRememberEmail(nextRememberEmail);
                    if (!nextRememberEmail) forgetRememberedLoginEmail();
                  }}
                />
                <Label htmlFor="remember-login-email" className="cursor-pointer text-sm font-normal text-muted-foreground">
                  {t("auth.rememberEmail")}
                </Label>
              </div>

              <div className="pt-3">
                <Button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary-glow"
                  disabled={isLoading}
                >
                  {isLoading ? t("auth.loggingIn") : t("auth.login")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </form>
            {showSetupPrompt ? (
              <p className="text-center text-xs text-muted-foreground">
                {t("auth.firstDeploy")} <Link href="/setup" className="text-primary hover:underline">{t("auth.setupAdminLink")}</Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
