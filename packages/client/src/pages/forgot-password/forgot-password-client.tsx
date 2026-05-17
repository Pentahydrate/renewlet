/**
 * 忘记密码客户端表单。
 *
 * 架构位置：直接调用 PocketBase password reset API，页面入口只决定该功能是否可见。
 *
 * 注意： 发送失败可能来自 SMTP 未配置或网络问题，展示层只反馈通用错误，避免泄漏账号存在性。
 */
import { type FormEvent, useRef, useState } from "react";
import Link from '@/components/router-link';
import { ArrowLeft, CheckCircle2, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RenewletLogo } from "@/components/icons/renewlet-logo";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { toast } from "@/components/ui/sonner";
import { pb } from "@/lib/pocketbase";
import { useI18n } from "@/i18n/I18nProvider";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ForgotPasswordClientProps = {
  enabled: boolean;
};

export function ForgotPasswordClient({ enabled }: ForgotPasswordClientProps) {
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { t } = useI18n();

  const validateEmail = () => {
    const trimmed = email.trim();
    if (!trimmed) return t("passwordReset.emailRequired");
    if (!emailPattern.test(trimmed)) return t("passwordReset.emailInvalid");
    return "";
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = validateEmail();
    if (error) {
      setEmailError(error);
      emailInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setEmailError("");
    try {
      await pb.collection("users").requestPasswordReset(email.trim());
      setSubmitted(true);
      toast.success(t("passwordReset.mailHandled"));
    } catch (err: unknown) {
      toast.error(t("passwordReset.sendFailed"), {
        description: getDisplayErrorMessage(err, t("passwordReset.sendFailedDescription")),
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
              <h1 className="text-xl font-bold text-foreground">{t("passwordReset.forgotTitle")}</h1>
              <p className="text-xs text-muted-foreground">{t("passwordReset.forgotSubtitle")}</p>
            </div>
          </div>

          {!enabled ? (
            <div className="rounded-lg border border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
              <ShieldAlert className="mb-3 h-5 w-5 text-primary" />
              <p>{t("passwordReset.smtpUnavailable1")}</p>
              <p className="mt-2">{t("passwordReset.smtpUnavailable2")}</p>
            </div>
          ) : submitted ? (
            <div className="rounded-lg border border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
              <CheckCircle2 className="mb-3 h-5 w-5 text-primary" />
              <p>{t("passwordReset.successMessage")}</p>
              <p className="mt-2">{t("passwordReset.successHint")}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="forgot-email">{t("auth.email")}</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={emailInputRef}
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (emailError) setEmailError("");
                    }}
                    className="pl-10 bg-secondary border-border"
                    autoComplete="email"
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? "forgot-email-error" : "forgot-email-description"}
                    required
                  />
                </div>
                <p id="forgot-email-description" className="text-xs text-muted-foreground">
                  {t("passwordReset.emailHelp")}
                </p>
                <FieldError id="forgot-email-error" message={emailError} />
              </div>

              <Button
                type="submit"
                className="w-full bg-primary text-primary-foreground hover:bg-primary-glow"
                disabled={isSubmitting}
              >
                {isSubmitting ? t("passwordReset.sending") : t("passwordReset.sendLink")}
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
