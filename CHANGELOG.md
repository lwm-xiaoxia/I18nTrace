# 更新日志

## 1.0.0

- 新增扩展图标（`{ 文 }`）
- 默认扫描 glob 补 `language` / `languages` / `messages` / `intl` 等目录名，覆盖 `src/languages` 这类结构
- 新增 `isLocaleCode`（ISO-639-1 白名单），不再把 `src` / `lib` / `app` 当 locale；i18n 入口 / 工具文件不再当语言文件
- key 解析增强：剥离 `+` / `++` / `@` / `#` 前缀、扁平 key 回退 `<模块>.<key>`、空格分隔多段 key
- Inlay Hint 错峰多次刷新 + 监听编辑器切换，修复首次索引后需手动滚动才出译文
- 新增「I18nTrace」输出频道与命令 `I18nTrace: 显示诊断信息`
- 索引重建改为并发安全（进行中再次触发会复用同一次构建并在结束后补跑）

## 0.1.0

首版：

- 代码内 Inlay Hint 常驻显示 i18n 译文（不改源码），支持切换显示语种、语言文件变更自动刷新、Ctrl+点击跳转定义
- 增强 Ctrl+F：按译文反查 key 并交回原生查找框；无译文命中时等价普通文本查找
- 框架：JS/TS/JSX/TSX、Vue SFC（$t / v-t / i18n-t keypath）、HTML/Svelte 通用调用识别
- 语言文件：JSON / JSON5 / YAML / JS / TS（静态解析）
- 可扩展 Adapter / Parser 架构，自动检测项目配置 + 手动覆盖
