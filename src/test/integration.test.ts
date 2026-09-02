import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigService } from '../config/ConfigService';
import { ProjectScanner } from '../config/ProjectScanner';
import { LocaleParserRegistry } from '../adapters/locale/registry';
import { IndexManager } from '../core/IndexManager';
import { buildKeyLiteralRegex, toSearchableKey } from '../features/FindEnhancer';

/** 按 package.json 的 name 查找，避免 publisher 变更后测试失效。 */
const EXT_NAME = 'i18n-trace';

function fixture(rel: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders![0];
  return vscode.Uri.file(path.join(folder.uri.fsPath, rel));
}

/** 取整篇文档的 Inlay Hint 文本，便于断言。 */
async function inlayLabels(doc: vscode.TextDocument): Promise<string[]> {
  const hints = (await vscode.commands.executeCommand(
    'vscode.executeInlayHintProvider',
    doc.uri,
    new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0),
  )) as vscode.InlayHint[];
  return hints.map((hint) =>
    typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join(''),
  );
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('集成：激活 + Inlay Hint + 增强查找', function () {
  this.timeout(30000);

  before(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON?.name === EXT_NAME);
    assert.ok(ext, `未找到扩展 ${EXT_NAME}`);
    await ext!.activate();
    await vscode.commands.executeCommand('i18nTrace.reindex');
    await delay(500);
  });

  it('语言文件被索引，locale 至少含 zh-CN / en', async () => {
    // switchDisplayLocale 会在无 locale 时提示；这里通过 reindex 后的 hint 侧面验证
    const doc = await vscode.workspace.openTextDocument(fixture('src/demo.ts'));
    const hints = (await vscode.commands.executeCommand(
      'vscode.executeInlayHintProvider',
      doc.uri,
      new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0),
    )) as vscode.InlayHint[];

    const labels = hints.map((h) => (typeof h.label === 'string' ? h.label : h.label.map((p) => p.value).join('')));
    // t('user.name') → 用户名
    assert.ok(labels.some((l) => l.includes('用户名')), `期望出现「用户名」气泡，实际: ${labels.join(' | ')}`);
    // 未知 key → ⚠️
    assert.ok(labels.some((l) => l.includes('⚠️') && l.includes('user.unknownKey')));
    // 动态 key 不产生气泡（user.${part} 不应带来额外 user.name 之外的项）
    assert.ok(!labels.some((l) => l.includes('${')));
  });

  it('Vue SFC 模板中的 $t / v-t / keypath 均出气泡', async () => {
    const doc = await vscode.workspace.openTextDocument(fixture('src/Demo.vue'));
    const hints = (await vscode.commands.executeCommand(
      'vscode.executeInlayHintProvider',
      doc.uri,
      new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0),
    )) as vscode.InlayHint[];
    const labels = hints.map((h) => (typeof h.label === 'string' ? h.label : h.label.map((p) => p.value).join('')));
    assert.ok(labels.some((l) => l.includes('用户名')), '$t(user.name)');
    assert.ok(labels.some((l) => l.includes('邮箱')), "v-t=\"'user.email'\"");
    assert.ok(labels.some((l) => l.includes('确认删除')), 'keypath=user.deleteConfirm');
  });

  it('i18next 多文件 namespace 布局：默认 ns / 显式 ns / options.ns 均命中', async () => {
    const doc = await vscode.workspace.openTextDocument(fixture('src/Namespaced.tsx'));
    const labels = await inlayLabels(doc);
    const joined = labels.join(' | ');
    // useTranslation('common') 后写裸 key
    assert.ok(labels.some((l) => l.includes('保存')), `默认 namespace 未命中：${joined}`);
    // 嵌套 key 也走同一个 namespace
    assert.ok(labels.some((l) => l.includes('深层文案')), `namespace 内嵌套 key 未命中：${joined}`);
    // 显式 ns 前缀 home:title
    assert.ok(labels.some((l) => l.includes('首页标题')), `显式 namespace 未命中：${joined}`);
    // ns 目录在前的布局 i18n/checkout/zh-CN.json，且通过 options.ns 指定
    assert.ok(labels.some((l) => l.includes('去支付')), `options.ns 未命中：${joined}`);
    // 自然语句 key 不被空格拆开
    assert.ok(labels.some((l) => l.includes('保存更改')), `自然语句 key 未命中：${joined}`);
    // 注释里的调用不产生气泡
    assert.ok(!labels.some((l) => l.includes('取消')), `注释里的调用不应出气泡：${joined}`);
  });

  it('Angular / ngx-translate 模板写法命中', async () => {
    const doc = await vscode.workspace.openTextDocument(fixture('src/Angular.html'));
    const labels = await inlayLabels(doc);
    const joined = labels.join(' | ');
    assert.ok(labels.some((l) => l.includes('去支付')), `translate 管道未命中：${joined}`);
    assert.ok(labels.some((l) => l.includes('保存')), `[translate] 绑定未命中：${joined}`);
    assert.ok(labels.some((l) => l.includes('取消')), `i18n=@@id 未命中：${joined}`);
  });

  it('漏翻的 key 带图标，语种齐全的不带', async () => {
    // fixtures：user.deleteConfirm 只有 zh-CN / en，fr.yaml 里没有 → 缺 fr
    //           user.name 三个语种都有 → 不该标记
    const doc = await vscode.workspace.openTextDocument(fixture('src/Demo.vue'));
    const labels = await inlayLabels(doc);
    const joined = labels.join(' | ');

    const confirm = labels.find((l) => l.includes('确认删除'));
    assert.ok(confirm, `未找到 user.deleteConfirm 的气泡：${joined}`);
    assert.ok(confirm!.includes('🌐'), `漏翻的 key 应带图标：${confirm}`);

    const name = labels.find((l) => l.includes('用户名'));
    if (name) {
      assert.ok(!name.includes('🌐'), `语种齐全的 key 不该带图标：${name}`);
    }
  });

  it('i18nTrace.find 命令已注册', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('i18nTrace.find'));
    assert.ok(all.includes('i18nTrace.findInFiles'));
    assert.ok(all.includes('i18nTrace.switchDisplayLocale'));
  });

  it('全局查找依赖的原生命令存在', async () => {
    // workbench.action.findInFiles 不在 vscode.d.ts 里，属于内置命令；
    // 断言它存在，宿主版本若移除该命令能立刻在测试里暴露出来。
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('workbench.action.findInFiles'));
  });

  it('全局查找的参数能被原生搜索面板接受', async () => {
    // 参数名写错时 VS Code 不会报错、只是静默忽略，所以这里只能验证调用链不抛异常；
    // 真正的「搜索框被填对」需要人工在扩展开发宿主里确认。
    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      query: `['"\`](?:user\\.name)['"\`]`,
      isRegex: true,
      triggerSearch: true,
      filesToExclude: 'locales/**',
    });
    await delay(300);
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
  });

  it('全局查找链路：译文 → key → 正则能命中真实源码', async () => {
    const config = new ConfigService();
    const parsers = new LocaleParserRegistry();
    const manager = new IndexManager(config, parsers, new ProjectScanner(parsers));
    try {
      await manager.rebuild();

      // 走的是 FindEnhancer 在 workspace 范围下的同一条链路：反查 → 剥命名空间 → 建正则
      const keys = manager.index
        .findKeysByTranslation('删除成功', 'zh-CN')
        .map(toSearchableKey);
      assert.ok(keys.includes('user.deleteSuccess'), `未反查到 key：${keys.join(',')}`);

      const re = new RegExp(buildKeyLiteralRegex(keys));
      const source = (
        await vscode.workspace.fs.readFile(fixture('src/demo.ts'))
      ).toString();
      assert.ok(re.test(source), `正则未命中 demo.ts：${re.source}`);
      // 只该命中目标调用，不该把同前缀的其它 key 也带上
      assert.ok(!re.test(`t('user.deleteConfirm')`), '不应命中未反查到的 key');
    } finally {
      manager.dispose();
      config.dispose();
    }
  });

  it('排除 glob 覆盖全部语言文件且不含源码', async () => {
    const config = new ConfigService();
    const parsers = new LocaleParserRegistry();
    const manager = new IndexManager(config, parsers, new ProjectScanner(parsers));
    try {
      await manager.rebuild();
      const glob = manager.buildLocaleExcludeGlob();
      const parts = glob.split(',');

      assert.ok(parts.length > 0, '应至少排除一个语言文件');
      assert.ok(!glob.includes('\\'), `glob 必须用正斜杠：${glob}`);
      // 语言文件在列
      assert.ok(
        parts.some((p) => p.endsWith('locales/zh-CN.json')),
        `缺少 locales/zh-CN.json：${glob}`,
      );
      // 源码不该被排除，否则结果会被清空
      assert.ok(
        !parts.some((p) => p.endsWith('.ts') && p.includes('src/')),
        `源码被误排除：${glob}`,
      );
    } finally {
      manager.dispose();
      config.dispose();
    }
  });
});
