import * as assert from 'assert';
import * as vscode from 'vscode';
import { I18nIndex } from '../core/I18nIndex';
import { LocaleEntry } from '../core/types';

const uri = vscode.Uri.file('/v/zh-CN.json');

function entry(key: string, value: string, locale = 'zh-CN'): LocaleEntry {
  return { key, value, locale, uri };
}

describe('I18nIndex', () => {
  it('findKeysByTranslation 部分匹配 + 排序（完全相等 > 前缀 > 子串）', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [
      entry('user.deleteSuccess', '删除成功'),
      entry('user.deleteFail', '删除失败'),
      entry('msg.done', '操作已完成，删除成功'),
      entry('common.ok', '确定'),
    ]);

    const keys = idx.findKeysByTranslation('删除成功');
    assert.deepStrictEqual(keys, ['user.deleteSuccess', 'msg.done']);

    const partial = idx.findKeysByTranslation('删除');
    assert.deepStrictEqual(
      partial.slice(0, 2),
      ['user.deleteSuccess', 'user.deleteFail'],
      '前缀匹配应排在子串匹配之前',
    );
  });

  it('大小写不敏感', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [entry('a', 'Delete Success', 'en')]);
    assert.deepStrictEqual(idx.findKeysByTranslation('delete success', 'en'), ['a']);
  });

  it('getEntry 按 locale 取值，replaceFile 增量覆盖', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [entry('user.name', '用户名', 'zh-CN'), entry('user.name', 'User', 'en')]);
    assert.strictEqual(idx.getEntry('user.name', 'zh-CN')?.value, '用户名');
    assert.strictEqual(idx.getEntry('user.name', 'en')?.value, 'User');

    idx.replaceFile(uri, [entry('user.name', '账号', 'zh-CN')]);
    assert.strictEqual(idx.getEntry('user.name', 'zh-CN')?.value, '账号');
    assert.strictEqual(idx.getEntry('user.name', 'en'), undefined, '旧文件条目应被替换清除');
  });

  it('removeFile 清除该文件条目', () => {
    const idx = new I18nIndex();
    const other = vscode.Uri.file('/v/en.json');
    idx.replaceFile(uri, [entry('a', '甲')]);
    idx.replaceFile(other, [entry('b', 'B', 'en')]);
    idx.removeFile(uri);
    assert.strictEqual(idx.hasKey('a'), false);
    assert.strictEqual(idx.hasKey('b'), true);
  });
});
