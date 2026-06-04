import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom 没有真实浏览器 storage；补内存实现让 auth/theme/i18n 测试保持和浏览器同一 API 形状。
class MemoryStorageMock implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function installStorage(name: "localStorage" | "sessionStorage") {
  // 这里不用 vi.stubGlobal，也不读取 Node 25 的内建 storage getter；前者会被 vi.unstubAllGlobals() 还原，后者会打印无效路径 warning。
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: new MemoryStorageMock(),
  });
}

// 组件库依赖 ResizeObserver/scrollIntoView，但单测只验证 React 状态和可访问输出，不需要真实布局引擎。
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
installStorage("localStorage");
installStorage("sessionStorage");
localStorage.setItem("renewlet_locale", "zh-CN");
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  installStorage("localStorage");
  installStorage("sessionStorage");
  localStorage.clear();
  localStorage.setItem("renewlet_locale", "zh-CN");
  sessionStorage.clear();
});
