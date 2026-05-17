/**
 * 路由兼容适配层（React Router）。
 *
 * 架构位置：部分组件保留了 Next.js 风格的 `useRouter/usePathname` 心智模型；
 * 这里把它收敛为薄 shim，避免页面层直接依赖多个路由 API。
 *
 * 注意： `back()` 使用浏览器 history，不会自动套用登录 next 路径清洗。
 */
import {
  useLocation,
  useNavigate,
  useSearchParams as useReactRouterSearchParams,
} from "react-router-dom";

/** 获取当前 path，不包含 query/hash。 */
export function usePathname(): string {
  return useLocation().pathname;
}

/** 获取当前 query 参数的只读快照。 */
export function useSearchParams(): URLSearchParams {
  const [params] = useReactRouterSearchParams();
  return params;
}

/** 提供项目内统一使用的命令式导航接口。 */
export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => window.history.back(),
  };
}
