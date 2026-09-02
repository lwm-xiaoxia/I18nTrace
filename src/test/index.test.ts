import * as assert from 'assert';
import * as vscode from 'vscode';
import { I18nIndex } from '../core/I18nIndex';
import { LocaleEntry } from '../core/types';

const uri = vscode.Uri.file('/v/zh-CN.json');

function entry(key: string, value: string, locale = 'zh-CN', namespace?: string): LocaleEntry {
  return { key, value, locale, namespace, uri };
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
    // replaceFile 应清除旧文件里的 en 条目：该 key 现在只剩 zh-CN
    assert.deepStrictEqual([...(idx.getAllForKey('user.name')?.keys() ?? [])], ['zh-CN']);
  });

  it('getEntry 请求的 locale 缺失时回落到其它 locale（气泡尽量有内容）', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [entry('only.en', 'English only', 'en')]);
    assert.strictEqual(idx.getEntry('only.en', 'zh-CN')?.value, 'English only');
    assert.strictEqual(idx.getEntry('missing.key', 'zh-CN'), undefined);
  });

  it('resolveKey：可配置前缀剥离 + 扁平 key 回退到 <模块>.<key>', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [
      entry('common.cancel', '取消'),
      entry('common.confirm', '确认'),
      entry('article.onlyPrivate', '仅本 App'),
    ]);
    assert.strictEqual(idx.resolveKey('article.onlyPrivate'), 'article.onlyPrivate');
    assert.strictEqual(idx.resolveKey('cancel'), 'common.cancel');
    assert.strictEqual(idx.resolveKey('+cancel'), 'common.cancel');
    assert.strictEqual(idx.resolveKey('#confirm'), 'common.confirm');
    assert.strictEqual(idx.resolveKey('++cancel'), 'common.cancel');
    assert.strictEqual(idx.resolveKey('nope'), undefined);
  });

  it('优先整体解析自然语句 key，不把它错误按空格拆开', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [entry('Save changes', '保存修改', 'en')]);
    assert.deepStrictEqual(idx.resolveKeyParts('Save changes'), ['Save changes']);
  });

  it('支持 i18next namespace、调用点默认 namespace 与歧义候选', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [
      entry('save', '保存', 'zh-CN', 'common'),
      entry('save', '保存页面', 'zh-CN', 'page'),
    ]);
    assert.strictEqual(idx.resolveKey('common:save'), 'common:save');
    assert.strictEqual(idx.resolveKey('common.save'), 'common:save');
    assert.strictEqual(idx.resolveKey('save', 'page'), 'page:save');
    const ambiguous = idx.resolveKeyDetailed('save');
    assert.strictEqual(ambiguous?.key, 'common:save');
    assert.deepStrictEqual(ambiguous?.candidates, ['common:save', 'page:save']);
  });

  it('关闭前缀兼容后不再剥离 key 前缀', () => {
    const idx = new I18nIndex();
    idx.setOptions({ keyPrefixes: [] });
    idx.replaceFile(uri, [entry('common.cancel', '取消')]);
    assert.strictEqual(idx.resolveKey('+cancel'), undefined);
  });

  it('resolveKeyParts：空格分隔多段 key 全部解析', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [entry('timezone.timezone', '时区'), entry('common.name', '名称')]);
    assert.deepStrictEqual(idx.resolveKeyParts('+timezone name'), ['timezone.timezone', 'common.name']);
    assert.strictEqual(idx.resolveKeyParts('timezone missingPart'), undefined);
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

  it('getMissingLocales 找出漏翻的语种', () => {
    const idx = new I18nIndex();
    const en = vscode.Uri.file('/v/en.json');
    const fr = vscode.Uri.file('/v/fr.json');
    idx.replaceFile(uri, [entry('a', '甲'), entry('b', '乙')]);
    idx.replaceFile(en, [entry('a', 'A', 'en'), entry('b', 'B', 'en')]);
    idx.replaceFile(fr, [entry('a', 'A-fr', 'fr')]);

    assert.deepStrictEqual(idx.getMissingLocales('a'), [], '三语齐全不该报缺');
    assert.deepStrictEqual(idx.getMissingLocales('b'), ['fr'], 'b 只缺 fr');
  });

  it('getMissingLocales：单语种项目与不存在的 key 都返回空', () => {
    const idx = new I18nIndex();
    idx.replaceFile(uri, [entry('a', '甲')]);
    // 只有一个 locale 时不存在「缺某语种」，不能凭空报缺
    assert.deepStrictEqual(idx.getMissingLocales('a'), []);
    // key 压根不存在属于「key 缺失」，由调用方另作处理，不混进漏翻
    assert.deepStrictEqual(idx.getMissingLocales('nope'), []);
  });
});
