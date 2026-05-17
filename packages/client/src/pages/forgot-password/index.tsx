/**
 * 忘记密码页面入口。
 *
 * 架构位置：当前由后端/部署配置决定 SMTP 可用性；入口组件只把可用性传给客户端表单。
 *
 * TODO： 如果后续开放运行时 SMTP 探测，可在这里接入 `usePasswordResetAvailability`。
 */
import { ForgotPasswordClient } from "./forgot-password-client";

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient enabled />;
}
