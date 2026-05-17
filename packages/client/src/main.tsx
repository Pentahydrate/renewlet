/**
 * 客户端应用挂载入口。
 *
 * 架构位置：这里只负责把 React、Router 与全局 Providers 接到 Vite 生成的
 * `#root` 节点；业务初始化必须继续下沉到 Providers 或各 application hook，
 * 避免入口文件成为隐式全局状态容器。
 *
 * 启动链路：
 *   DOM 根节点 -> StrictMode -> BrowserRouter -> Providers -> App 路由
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import Providers from "@/providers";
import "@/index.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <App />
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
