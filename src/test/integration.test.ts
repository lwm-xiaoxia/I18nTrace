import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

const EXT_ID = 'i18n-trace.i18n-trace';

function fixture(rel: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders![0];
  return vscode.Uri.file(path.join(folder.uri.fsPath, rel));
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('集成：激活 + Inlay Hint + 增强查找', function () {
  this.timeout(30000);

  before(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `未找到扩展 ${EXT_ID}`);
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

  it('i18next 的 locale/语言/namespace.json 布局可通过默认或显式 namespace 命中', async () => {
    const doc = await vscode.workspace.openTextDocument(fixture('src/I18nextDemo.ts'));
    const hints = (await vscode.commands.executeCommand(
      'vscode.executeInlayHintProvider',
      doc.uri,
      new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0),
    )) as vscode.InlayHint[];
    const labels = hints.map((hint) =>
      typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join(''),
    );
    assert.ok(labels.some((label) => label.includes('Save')), `默认 namespace 未命中：${labels.join(' | ')}`);
    assert.ok(labels.some((label) => label.includes('Cancel')), `显式 namespace 未命中：${labels.join(' | ')}`);
  });

  it('i18nTrace.find 命令已注册', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('i18nTrace.find'));
    assert.ok(all.includes('i18nTrace.switchDisplayLocale'));
  });
});
