import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

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

  it('i18nTrace.find 命令已注册', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('i18nTrace.find'));
    assert.ok(all.includes('i18nTrace.switchDisplayLocale'));
  });
});
