# I18nTrace

在 VS Code 里**不修改源码**地常驻显示 i18n 译文，并把 `Ctrl+F` / `Ctrl+Shift+F` 增强为「按译文反查 key」。

## 功能

### 1. 代码内常驻显示译文（Inlay Hint）

自动识别代码中的 i18n key，从语言文件读取对应文案，用低干扰气泡显示在调用后面：

```ts
t('user.name')  用户名
$t('user.deleteSuccess')  删除成功
```

- 不修改源码，纯 Inlay Hint 渲染，跟随 VS Code 原生风格
- 支持切换显示语种：命令面板 `I18nTrace: 切换显示语种`
- 语言文件修改后自动刷新（含未保存的编辑）
- 找不到 key 时显示 `⚠️ <key>`（图标可换、可关）
- **漏翻提示**：key 存在但没覆盖全部语种时，气泡前加 `🌐`，悬浮框里逐行列出缺哪几个语种（图标可换、可关）
- `Ctrl/Cmd` + 点击气泡，跳转到语言文件中该 key 的定义位置
- 鼠标悬停气泡查看完整译文与其它语种

### 2. `Ctrl + F` 按译文查找

在编辑器里按 `Ctrl+F`，输入中文（或任意语种）文案，直接定位到对应的 `t('...')` 调用。

```
源码：  t('user.deleteSuccess')
中文：  删除成功
Ctrl+F 输入「删除成功」 → 跳到 t('user.deleteSuccess')
```

- 支持部分匹配、多个结果
- 命中后由 **VS Code 原生查找框**接管：`Enter` / `Shift+Enter` 前后切换、「高亮全部」、正则开关等全部原生行为
- **完整保留普通搜索**：输入的词没有匹配到任何译文时，等价于普通 `Ctrl+F` 文本查找
- 输入框右上角有「普通查找」按钮，可强制跳过译文解析
- 不想要增强？把 `i18nTrace.search.enhanceCtrlF` 设为 `false`，`Ctrl+F` 立即恢复原生

> **实现说明**：VS Code 稳定 API 无法拦截或扩展原生查找框（查找框只搜文本缓冲区，
> 不搜 Inlay Hint）。I18nTrace 的做法是：用一个轻量输入框收集短语 →
> 通过索引把「译文」解析成一组 key → 生成匹配这些 key 字面量的正则 →
> 调用官方命令 `editor.actions.findWithArgs` 交回原生查找框。因此增强与原生搜索能力共存，
> 代价只是多一次「打开输入框 + 回车」。

### 3. `Ctrl + Shift + F` 按译文全局查找

同样的输入框，范围换成整个工作区，结果交给 VS Code 原生的「在文件中查找」面板。

```
Ctrl+Shift+F 输入「删除成功」
  → 搜索框填入 ['"`](?:user\.deleteSuccess|common\.delOk)['"`]（正则已开）
  → 结果树列出所有调用这些 key 的源码位置
```

- 命中后完全由原生搜索面板接管：结果树、`F4` 逐个跳、改包含/排除范围重搜等全部原生行为
- 默认**排除语言文件本身**，否则结果里一大半是语言包中的 key 定义行（`i18nTrace.search.excludeLocaleFiles` 可关）
- 同样**完整保留普通搜索**：没有译文命中时等价于普通 `Ctrl+Shift+F`
- 把 `i18nTrace.search.enhanceCtrlShiftF` 设为 `false` 即可恢复原生

> **与当前文件版的差别**：`Ctrl+F` 会把候选 key 与当前文件里真实出现的调用取交集，
> 全局版不做这一步（那需要自建全局代码引用索引），直接把候选 key 全部交给 VS Code
> 搜索引擎去筛。代价是极少数情况下会多出误报，比如 key 名恰好出现在注释或文档里。
>
> **一处体验落差**：搜索结果树不渲染 Inlay Hint，列表里看到的是 `t('user.deleteSuccess')`
> 而不是「删除成功」。这是 VS Code 的限制，无扩展点。作为补偿，查找后会弹一条提示
> 说明「短语 → 命中了哪些 key」；点进结果跳到源码后，气泡照常显示译文。

### 反查使用哪个语种

按译文反查默认使用**显示语种**（留空时自动优先中文），也可以用 `i18nTrace.sourceLocale`
单独指定。两个查找框都会在提示行里写明当前生效的语种，右上角的 🌐 图标可直接切换。

## 兼容性

**框架 / 语言**

| 类型 | 支持 |
|---|---|
| JS / TS / JSX / TSX | ✅ 通用调用识别 |
| Vue SFC（`<template>` + `<script>`） | ✅ 含 `$t` / `v-t` / `<i18n-t keypath>` / `<i18n path>` |
| HTML / Svelte | ✅ 通用调用识别 |
| Vue I18n / Nuxt、react-i18next / i18next / Next.js | ✅（调用形式层面） |
| React Intl、Angular `$localize` / ngx-translate / Transloco | ✅ `formatMessage({ id })`、显式 id、管道和属性写法 |

**识别的调用形式**：`t('k')`、`$t("k")`、`i18n.t(\`k\`)`、`i18n.global.t('k')`、`translate('k')`，
以及 Vue 指令与组件属性、React Intl `formatMessage({ id })`、ngx-translate / Transloco 管道、Angular `$localize` 显式 id 等位置。可通过 `i18nTrace.translationFunctions` 增补函数名。

**动态 key**（`t(\`a.${x}\`)`、`t('a.' + x)`、`t(variable)`）无法可靠解析，**直接跳过，不误判**。

**语言文件格式**

| 格式 | 支持 |
|---|---|
| JSON / JSON5 | ✅ |
| YAML / YML | ✅（叶子节点带精确定位） |
| JS / TS / MJS / CJS | ✅ 静态解析 `export default { ... }` / `module.exports = { ... }`（**不执行代码**；`import` 拼接、展开外部对象、运行时计算值不支持） |

支持：嵌套 key、扁平 key、多 locale、多个 locale 目录、monorepo、多根工作区，以及 i18next 常见的 `locales/en/common.json`、`locales/en/pages/home.json` 和 `i18n/common/en/index.json` 命名空间布局。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `i18nTrace.enabled` | `true` | 总开关 |
| `i18nTrace.localeDirs` | `[]` | 手动指定语言文件目录 / glob；非空时完全以此为准 |
| `i18nTrace.localeFileGlob` | 见设置 | 自动检测语言文件的 glob |
| `i18nTrace.displayLocale` | `""` | 气泡显示语种；留空自动选（优先中文） |
| `i18nTrace.sourceLocale` | `""` | 按译文反查时使用的语种；留空跟随显示语种 |
| `i18nTrace.keySeparator` | `"."` | 嵌套语言对象拍平时的 key 分隔符 |
| `i18nTrace.keyPrefixes` | `["++","+","@","#"]` | 原 key 不命中时尝试剥离的自定义前缀；清空可关闭 |
| `i18nTrace.translationFunctions` | `["t","$t","$tc","i18n.t","i18n.global.t","translate","$translate","translate.instant","translate.get","translate.stream","transloco.translate"]` | 识别为翻译函数的名称（支持点号形式） |
| `i18nTrace.inlayHints.enabled` | `true` | 显示译文气泡 |
| `i18nTrace.inlayHints.maxLength` | `40` | 气泡译文截断长度 |
| `i18nTrace.inlayHints.showWhenMissing` | `true` | 语言文件里完全找不到该 key 时提示 |
| `i18nTrace.inlayHints.showWhenIncomplete` | `true` | key 存在但缺部分语种时提示（漏翻检测） |
| `i18nTrace.inlayHints.missingIcon` | `"⚠️"` | key 完全缺失的图标；留空只显示 key |
| `i18nTrace.inlayHints.incompleteIcon` | `"🌐"` | 漏翻的图标；留空则只在悬浮框里提示 |
| `i18nTrace.inlayHints.wrap` | `"none"` | 给行内译文加包裹符（`「」` / `『』` / `【】` / `‹›` / `()` / `[]`），便于和代码里的字符串区分 |
| `i18nTrace.languageSelector` | 见设置 | 生效的语言（languageId） |
| `i18nTrace.search.enhanceCtrlF` | `true` | Ctrl+F 增强开关（当前文件） |
| `i18nTrace.search.enhanceCtrlShiftF` | `true` | Ctrl+Shift+F 增强开关（全局） |
| `i18nTrace.search.maxKeysPerSearch` | `50` | 单次增强查找最多纳入的 key 数 |
| `i18nTrace.search.excludeLocaleFiles` | `true` | 全局按译文查找时排除语言文件本身 |

## 命令

- `I18nTrace: 按译文查找（增强 Ctrl+F）` — `i18nTrace.find`
- `I18nTrace: 按译文全局查找（增强 Ctrl+Shift+F）` — `i18nTrace.findInFiles`
- `I18nTrace: 切换显示语种` — `i18nTrace.switchDisplayLocale`
- `I18nTrace: 重建索引` — `i18nTrace.reindex`
- `I18nTrace: 开关译文气泡` — `i18nTrace.toggleInlayHints`
- `I18nTrace: 显示诊断信息` — `i18nTrace.showDiagnostics`（打印扫到的语言文件、locale、key 数、当前文件每个 `t()` 的命中情况到「I18nTrace」输出频道，排查用）

## 架构

```
Framework Adapter ─┐
Locale Parser ─────┼─→  统一 I18nIndex  ─→  InlayHints / FindEnhancer
                   │        ↑
                   └── ConfigService + ProjectScanner（自动检测 + 手动覆盖）
                            LocaleWatcher（FileSystemWatcher → 增量更新）
```

- `I18nIndex` 维护「规范 key（含命名空间）→ 各语种译文」「别名 → 规范 key」「key 末段 → 规范 key」「归一化译文 → key」几张表，均由语言文件构建
- `key → 代码引用` 按需在当前活动文档即时扫描，不建全局索引；全局查找则把候选 key 交给 VS Code 自己的搜索引擎去筛
- 新增框架 / i18n 库 / 语言文件格式 = 新增一个 `FrameworkAdapter` / `LocaleParser` 实现并在 registry 注册一次，
  核心索引、气泡、搜索逻辑不动

## 开发

```bash
pnpm install
pnpm run watch      # esbuild 监听打包
# 按 F5 启动「运行扩展」，会以 test-fixtures 为工作区打开扩展开发宿主
pnpm test           # 编译 + 打包 + 在真实 VS Code 中跑单测与集成测试
pnpm run lint
pnpm run typecheck
```

## 发布

```bash
node scripts/release.mjs               # 补丁号 +1（1.0.3 → 1.0.4）
node scripts/release.mjs minor         # 或 major / 1.4.0（指定版本号）
node scripts/release.mjs --dry-run     # 只演练
node scripts/release.mjs --ovsx        # 顺带发 Open VSX
node scripts/release.mjs --no-github   # 各平台可单独关
node scripts/release.mjs --publish-only # 补发当前版本到之前跳过/失败的平台（不升版本、不动 git）
```

执行顺序：**写版本 → 打包 → 本地 `commit` + `tag` → 发布所有平台 → 全部成功才 `git push`**。
任一平台失败就不 push，并打印回退（全失败）或「用 `--publish-only` 补发 + 手动 push」（部分成功）的指引。

凭据：Marketplace 读 `VSCE_PAT`，Open VSX 读 `OVSX_PAT`，GitHub 用已登录的 `gh`。
想发的平台缺凭据时：交互模式会让你确认，`--yes` 模式直接中止（加 `--allow-skip` 才跳过）。
被跳过或失败时退出码为 `1`。发布说明取 `CHANGELOG.md` 对应 `## <版本>` 小节。

## 已知限制

- 全局按译文查找不与实际调用取交集（那需要自建全局代码引用索引），少数情况下会有误报，例如 key 名恰好出现在注释、文档或字符串常量里
- 全局查找的结果树不显示译文，只显示源码里的 key —— VS Code 的搜索结果树不渲染 Inlay Hint，无扩展点
- JS/TS 语言文件仅静态解析 `export default { … }` / `module.exports = { … }` 里的对象字面量；通过 `import` 组合子模块、`import.meta.glob` 动态聚合、运行时计算的翻译取不到（碰到时用 `I18nTrace: 显示诊断信息` 排查，或用 `i18nTrace.localeDirs` 直接指向叶子语言文件目录）
- Angular 无显式 `@@id` 的 `$localize`、Svelte 专用写法需后续 Adapter
- `.vue` / `.svelte` 的 languageId 依赖对应语言扩展；未安装时按文件扩展名兜底识别
