import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigService } from '../config/ConfigService';
import { ProjectScanner } from '../config/ProjectScanner';
import { LocaleParserRegistry } from '../adapters/locale/registry';
import { FrameworkAdapterRegistry } from '../adapters/framework/registry';
import { IndexManager } from '../core/IndexManager';
import { I18nTraceInlayHintsProvider } from '../features/InlayHintsProvider';
import { FindEnhancer } from '../features/FindEnhancer';

function fixture(project: string, relative = 'demo.ts'): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders!.find((item) => item.name === project);
  assert.ok(folder, `未加载测试项目 ${project}`);
  return vscode.Uri.file(path.join(folder.uri.fsPath, relative));
}

function label(hint: vscode.InlayHint): string {
  return typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join('');
}

function tooltip(hint: vscode.InlayHint): string {
  assert.ok(Array.isArray(hint.label));
  const text = hint.label[0].tooltip;
  return typeof text === 'string' ? text : text?.value ?? '';
}

describe('多项目隔离（真实 VS Code 工作区）', () => {
  let config: ConfigService;
  let manager: IndexManager;
  let provider: I18nTraceInlayHintsProvider;
  const adapters = new FrameworkAdapterRegistry();

  before(async () => {
    assert.strictEqual(vscode.workspace.workspaceFolders?.length, 4);
    config = new ConfigService();
    const parsers = new LocaleParserRegistry();
    manager = new IndexManager(config, parsers, new ProjectScanner(parsers));
    provider = new I18nTraceInlayHintsProvider(manager, config, adapters);
    await manager.rebuild();
    const extension = vscode.extensions.all.find((item) => item.packageJSON?.name === 'i18n-trace');
    assert.ok(extension);
    await extension.activate();
    await vscode.commands.executeCommand('i18nTrace.reindex');
  });

  after(() => {
    provider.dispose();
    manager.dispose();
    config.dispose();
  });

  it('zh 与 zh-CN 分属不同项目，同名 key 的译文和跳转来源独立', async () => {
    const zh = fixture('project-zh');
    const region = fixture('project-region');
    assert.deepStrictEqual(manager.getIndex(zh).getLocales(), ['en', 'zh']);
    assert.deepStrictEqual(manager.getIndex(region).getLocales(), ['en', 'zh-CN']);
    assert.deepStrictEqual(manager.getIndex(fixture('project-parent', 'parent.ts')).getLocales(), [], '父根目录不能重复收录子项目资源');
    assert.deepStrictEqual(manager.getIndex(zh).getMissingLocales('app.mainDevice'), []);
    assert.strictEqual(manager.resolveDisplayLocale(zh), 'zh');
    assert.strictEqual(manager.resolveDisplayLocale(region), 'zh-CN');
    assert.strictEqual(manager.getIndex(zh).getEntry('app.mainDevice', 'en')?.value, 'Main Device');
    assert.strictEqual(manager.getIndex(region).getEntry('app.mainDevice', 'en')?.value, 'Regional Main Device');
    assert.strictEqual(manager.getIndex(zh).getEntry('app.mainDevice', 'zh')?.uri.toString(), fixture('project-zh', 'lang/zh.json').toString());

    // 活动编辑器属于 B，而请求 A 的气泡，覆盖后台/分栏编辑器仍需按文档取项目的情况。
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(region));
    const doc = await vscode.workspace.openTextDocument(zh);
    const hints = provider.provideInlayHints(doc, new vscode.Range(0, 0, doc.lineCount, 0));
    const main = hints.find((hint) => label(hint).includes('主设备'))!;
    assert.ok(main);
    assert.ok(!label(main).includes('🌐'));
    assert.ok(!tooltip(main).includes('zh-CN'));
    assert.ok(!tooltip(main).includes('Regional'));
    assert.ok(Array.isArray(main.label));
    assert.strictEqual(main.label[0].command?.arguments?.[0].toString(), fixture('project-zh', 'lang/zh.json').toString());
    assert.ok(hints.some((hint) => label(hint).includes('🌐') && label(hint).includes('English only')), '项目内真实漏翻仍要提示');
    assert.ok(hints.some((hint) => label(hint).includes('附加目录')), '同项目多个语言目录仍应合并');
    assert.ok(hints.some((hint) => label(hint).includes('⚠️') && label(hint).includes('other.only')), '不能借用其他项目的 key');
    // 同时经过已打包扩展注册的真正提供者，验证激活和路由到项目索引的完整链路。
    const runtimeHints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      'vscode.executeInlayHintProvider',
      zh,
      new vscode.Range(0, 0, doc.lineCount, 0),
    );
    const runtimeMain = runtimeHints?.find((hint) => label(hint).includes('主设备'));
    assert.ok(runtimeMain);
    assert.ok(!label(runtimeMain).includes('🌐'));
    assert.ok(!label(runtimeMain).includes('区域项目'));
  });

  it('活动项目切换、无语言资源项目和工作区外文件均不借用其它项目', async () => {
    for (const [project, locales] of [['project-zh', ['en', 'zh']], ['project-region', ['en', 'zh-CN']], ['project-empty', []]] as const) {
      const doc = await vscode.workspace.openTextDocument(fixture(project));
      await vscode.window.showTextDocument(doc);
      assert.deepStrictEqual(manager.index.getLocales(), [...locales]);
    }
    assert.deepStrictEqual(manager.getIndex(vscode.Uri.file(path.join(__dirname, 'outside.ts'))).getLocales(), []);
    const emptyDoc = await vscode.workspace.openTextDocument(fixture('project-empty'));
    assert.ok(provider.provideInlayHints(emptyDoc, new vscode.Range(0, 0, 1, 0)).some((hint) => label(hint).includes('⚠️')));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.strictEqual(manager.getProjectFolder(), undefined);
    assert.deepStrictEqual(manager.index.getLocales(), []);
  });

  it('译文反查缓存按项目区分，排除列表只包含当前项目', async () => {
    // 宿主已激活扩展并注册命令，这里只建立反查方法的实例上下文，避免重复注册。
    // 仍执行 FindEnhancer 自身的方法与缓存，使用真实项目文档和真实语言索引。
    const resolve = Object.assign(Object.create(FindEnhancer.prototype), {
      indexManager: manager,
      config,
      adapters,
      hitCache: new Map<string, string[]>(),
    }) as {
      resolveHitKeys(scope: 'workspace', document: vscode.TextDocument, phrase: string): string[];
    };
    const zhDoc = await vscode.workspace.openTextDocument(fixture('project-zh'));
    const regionDoc = await vscode.workspace.openTextDocument(fixture('project-region'));
    assert.deepStrictEqual(resolve.resolveHitKeys('workspace', zhDoc, 'Device'), ['app.mainDevice']);
    assert.deepStrictEqual(resolve.resolveHitKeys('workspace', regionDoc, 'Device'), ['app.mainDevice']);
    // 两边使用同一反查语种、同一短语，必须区分项目后才能避免缓存串用。
    assert.deepStrictEqual(resolve.resolveHitKeys('workspace', zhDoc, 'Regional'), []);
    assert.deepStrictEqual(resolve.resolveHitKeys('workspace', regionDoc, 'Regional'), ['app.mainDevice', 'other.only']);
    assert.ok(!manager.buildLocaleExcludeGlob(zhDoc.uri).includes('zh-CN'));
    assert.ok(manager.buildLocaleExcludeGlob(regionDoc.uri).includes('zh-CN'));
  });

  it('语言文件增量修改、删除和重建只影响所属项目，并发出刷新事件', async () => {
    const zh = fixture('project-zh');
    const region = fixture('project-region');
    const localeUri = fixture('project-zh', 'lang/en.json');
    const doc = await vscode.workspace.openTextDocument(localeUri);
    const original = doc.getText();
    let changed = 0;
    const sub = manager.onDidChange(() => changed++);
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(localeUri, new vscode.Range(0, 0, doc.lineCount, 0), original.replace('Main Device', 'Updated Device'));
      assert.ok(await vscode.workspace.applyEdit(edit));
      await manager.updateFile(localeUri);
      assert.strictEqual(manager.getIndex(zh).getEntry('app.mainDevice', 'en')?.value, 'Updated Device');
      assert.strictEqual(manager.getIndex(region).getEntry('app.mainDevice', 'en')?.value, 'Regional Main Device');
      manager.removeFile(localeUri);
      assert.strictEqual(manager.getIndex(zh).getAllForKey('app.mainDevice')?.has('en'), false);
      assert.strictEqual(manager.getIndex(region).getAllForKey('app.mainDevice')?.has('en'), true);
      // 删除后重新纳入，覆盖新增语言文件采用的项目归属分支。
      await manager.updateFile(localeUri);
      assert.strictEqual(manager.getIndex(zh).getEntry('app.mainDevice', 'en')?.value, 'Updated Device');
      assert.strictEqual(changed, 3);
    } finally {
      sub.dispose();
      const restore = new vscode.WorkspaceEdit();
      restore.replace(localeUri, new vscode.Range(0, 0, doc.lineCount, 0), original);
      await vscode.workspace.applyEdit(restore);
      await manager.rebuild();
    }
    assert.strictEqual(manager.getIndex(zh).getEntry('app.mainDevice', 'en')?.value, 'Main Device');
  });
});
