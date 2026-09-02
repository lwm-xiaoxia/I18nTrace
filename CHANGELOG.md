# 更新日志

## 1.0.3

- 重构核心模块：提取 `patterns.ts` 与 `localePath.ts` 独立模块，提升代码可维护性
- 关键词解析增强：I18nIndex 关键词解析逻辑重写，支持配置前缀剥离、命名空间变体、扁平 key 兜底
- 配置结构分离：ConfigService 新增「结构型 vs 显示型」变更检测，仅结构变更时触发索引重建
- 项目扫描改进：ProjectScanner locale/namespace 推断更精准，支持 i18next 多文件命名空间布局
- 搜索命中缓存：FindEnhancer 新增 hitCache，Ctrl+F 增强查找性能更佳
- 适配器全面更新：GenericAdapter 改用新 patterns 模块，VueSfcAdapter 与之配合
- 注释屏蔽：注释掉的 `t(...)` 不再产生气泡（带状态扫描，正确跳过字符串、保留模板串 `${}` 内的调用）
- 调用形式扩充：ngx-translate / Transloco 管道与 `[translate]` 绑定、Angular `$localize`:@@id:` 与 `i18n="@@id"`、React Intl `formatMessage({ id })`、`t(key, { ns })`、`useTranslation(ns)` 文件级默认命名空间
- 默认识别函数补充 `$tc` / `translate.instant` / `translate.get` / `translate.stream` / `transloco.translate`
- 测试：39 项全部通过，新增命名空间布局、注释屏蔽、Angular 模板等用例

## 1.0.1

- 修复译文悬浮框内容重复显示两遍（tooltip 同时挂在 hint 和 label part 上）
- 修复 Ctrl/Cmd + 点击气泡无法打开语言文件：改用 `command`（`vscode.open` + 定位行）替代 `location`
- 悬浮框排版微调

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
