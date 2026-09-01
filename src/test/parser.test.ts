import * as assert from 'assert';
import * as vscode from 'vscode';
import { JsonParser } from '../adapters/locale/JsonParser';
import { YamlParser } from '../adapters/locale/YamlParser';
import { JsModuleParser } from '../adapters/locale/JsModuleParser';

const uri = vscode.Uri.file('/virtual/zh-CN.json');
const zhContext = { locale: 'zh-CN', keySeparator: '.' };

describe('LocaleParser', () => {
  it('JsonParser 拍平嵌套 key', () => {
    const entries = new JsonParser().parse(
      uri,
      JSON.stringify({ user: { name: '用户名', nested: { a: '甲' } }, ok: '确定' }),
      zhContext,
    );
    const map = Object.fromEntries(entries.map((e) => [e.key, e.value]));
    assert.strictEqual(map['user.name'], '用户名');
    assert.strictEqual(map['user.nested.a'], '甲');
    assert.strictEqual(map['ok'], '确定');
  });

  it('JsonParser 兼容 JSON5（注释、尾逗号、单引号）', () => {
    const text = `{
      // 注释
      user: { name: '用户名', },
    }`;
    const entries = new JsonParser().parse(uri, text, zhContext);
    assert.strictEqual(entries.find((e) => e.key === 'user.name')?.value, '用户名');
  });

  it('YamlParser 解析并带范围', () => {
    const text = 'user:\n  name: 用户名\n  email: 邮箱\n';
    const entries = new YamlParser().parse(vscode.Uri.file('/v/zh.yaml'), text, zhContext);
    const name = entries.find((e) => e.key === 'user.name');
    assert.strictEqual(name?.value, '用户名');
    assert.ok(name?.range, 'YAML 叶子应带 range');
  });

  it('JsModuleParser 解析 export default 对象字面量', () => {
    const text = `export default {\n  user: { name: '用户名' },\n  ok: '确定',\n};`;
    const entries = new JsModuleParser().parse(vscode.Uri.file('/v/zh.ts'), text, zhContext);
    const map = Object.fromEntries(entries.map((e) => [e.key, e.value]));
    assert.strictEqual(map['user.name'], '用户名');
    assert.strictEqual(map['ok'], '确定');
  });

  it('JsModuleParser 兼容 as const / satisfies', () => {
    const text = `const messages = { greeting: 'hi' } as const;\nexport default messages;`;
    const entries = new JsModuleParser().parse(vscode.Uri.file('/v/en.ts'), text, {
      locale: 'en',
      keySeparator: '.',
    });
    assert.strictEqual(entries.find((e) => e.key === 'greeting')?.value, 'hi');
  });

  it('解析器传递命名空间与可配置 key 分隔符', () => {
    const entries = new JsonParser().parse(uri, JSON.stringify({ user: { name: '用户名' } }), {
      locale: 'zh-CN',
      namespace: 'common',
      keySeparator: '_',
    });
    assert.deepStrictEqual(entries.map((item) => [item.namespace, item.key]), [['common', 'user_name']]);
  });
});
