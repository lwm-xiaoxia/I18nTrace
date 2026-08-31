# 更新日志

## 0.1.0

首版：

- 代码内 Inlay Hint 常驻显示 i18n 译文（不改源码），支持切换显示语种、语言文件变更自动刷新、Ctrl+点击跳转定义
- 增强 Ctrl+F：按译文反查 key 并交回原生查找框；无译文命中时等价普通文本查找
- 框架：JS/TS/JSX/TSX、Vue SFC（$t / v-t / i18n-t keypath）、HTML/Svelte 通用调用识别
- 语言文件：JSON / JSON5 / YAML / JS / TS（静态解析）
- 可扩展 Adapter / Parser 架构，自动检测项目配置 + 手动覆盖
