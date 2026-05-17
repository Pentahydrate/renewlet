/**
 * 路由 Link 适配组件。
 *
 * 架构位置：把 React Router 的 `to` 兼容为项目内习惯使用的 `href`，方便页面从
 * 让 Next 风格组件迁移时不把路由库细节扩散到每个调用点。
 *
 * 注意： 外链仍应使用原生 `<a>`；这里默认参与 SPA 路由解析。
 */
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  type LinkProps as RouterLinkProps,
  type NavLinkProps as RouterNavLinkProps,
} from "react-router-dom";

type LinkProps = Omit<RouterLinkProps, "to"> & {
  href?: RouterLinkProps["to"];
  to?: RouterLinkProps["to"];
};

type NavLinkProps = Omit<RouterNavLinkProps, "to"> & {
  href?: RouterNavLinkProps["to"];
  to?: RouterNavLinkProps["to"];
};

/** 使用 `href` 或 `to` 的 React Router Link。 */
export function Link({ href, to, ...props }: LinkProps) {
  return <RouterLink to={to ?? href ?? "/"} {...props} />;
}

/** 使用 `href` 或 `to` 的 React Router NavLink。 */
export function NavLink({ href, to, ...props }: NavLinkProps) {
  return <RouterNavLink to={to ?? href ?? "/"} {...props} />;
}

export default Link;
