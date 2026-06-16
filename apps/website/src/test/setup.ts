import '@testing-library/jest-dom/vitest'

// Radix/Vaul 在 jsdom 下会探测 pointer capture；测试环境补空实现，避免布局用例被浏览器 API 缺失卡住。
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}

if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}

if (!Element.prototype.scrollIntoView) {
  // 官网组件只关心目标元素存在，jsdom 不做真实滚动，空实现能让焦点/弹层测试稳定。
  Element.prototype.scrollIntoView = () => {}
}
