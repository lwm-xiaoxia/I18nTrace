# 更新日志

## 未发布

### 修复

- 语言文件未保存的编辑现在真正生效：索引改为优先读编辑器缓冲区，此前只读磁盘，与 README 承诺的行为不符
- JS/TS 语言文件里译文含 `//`（如 `路径 a//b`）不再导致整份文件解析失败、所有 key 一起丢失
- `const zhCN = {...}; export default zhCN;` 不再误取到文件里其它 `export const` 对象，改为顺着标识符找它的声明
- 解析警告改写入「I18nTrace」输出频道，此前只进开发者控制台，用户看不到
- 语言文件数量触及扫描上限时给出提示，此前静默截断；`localeDirs` 分支补上同样的上限

### 性能

- 全量重建包进一个批次：索引只重算一次、只广播一次刷新，此前每写入一个语言文件就全量重算并刷新一次
- 重建期间保留上一轮索引，气泡不再先消失再出现
- key 定位改用带 lastIndex 的正则并缓存，去掉每段一次的全文复制；行号查找由线性扫描改二分（实测 2400~9600 key 的语言文件快 1.4~1.6 倍）
- `getEntry` 回落分支不再为取一个元素构造数组并排序

### 代码质量

- 删除无引用的 `detectFrameworks` / `FrameworkHint` / `I18nIndex.isEmpty` / `I18nIndex.size` / `FrameworkAdapterRegistry.languages`
- 注释屏蔽逻辑提取到 `src/util/comments.ts`，源码扫描与语言文件解析共用一套
- 修正 `LocaleWatcher` 的 disposable 数组随配置改动无限增长
- `truncateForHint` 对非法的 `maxLength` 兜底；数值配置补 `minimum` / `maximum`
- 更新过时注释（`I18nIndex` 仍称「搜索范围仅当前文件」）

## 2.1.0

- 新增漏翻提示：key 存在、但没有覆盖索引里全部语种时，译文气泡前加 `🌐`，悬浮框逐行列出缺失语种
  - 单语种项目与「key 完全不存在」都不会触发，后者仍按原有的 `⚠️` 处理
  - 多段 key 中任一段漏翻即标记，缺失语种合并去重
  - `i18nTrace.inlayHints.showWhenIncomplete` 可关闭
- 提示图标改为可配置：`i18nTrace.inlayHints.missingIcon`（默认 `⚠️`）、`i18nTrace.inlayHints.incompleteIcon`（默认 `🌐`），留空即不显示图标
- 测试：50 项全部通过，新增 `getMissingLocales` 与漏翻标记用例

## 2.0.0

- 新增「按译文全局查找」：`Ctrl+Shift+F` 收词后把译文解析成一组 key，生成正则交给原生「在文件中查找」面板
  - 默认排除语言文件本身，避免结果里全是 key 定义行（`i18nTrace.search.excludeLocaleFiles`）
  - 语言文件很多时排除列表按目录聚合，不再无限拉长
  - 无译文命中时等价普通全局查找；`i18nTrace.search.enhanceCtrlShiftF` 可关闭增强
- 查找框显示当前反查语种，并新增 🌐 按钮直接切换（`sourceLocale` 此前可配但不可见）
- `Ctrl+F` 在当前文件没命中、但工作区里存在该译文时，提示改用 `Ctrl+Shift+F`
- FindEnhancer 重构为按 scope 分叉的单一流程，当前文件与全局两个入口共用输入框与反查逻辑
- 修正 `Ctrl+Shift+F` 的 when 条件：原先带 `!searchViewletVisible`，侧边栏停在搜索视图时快捷键会静默失效，改为只受 `enhanceCtrlShiftF` 开关控制
- 测试：47 项全部通过，新增全局查找相关用例

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
