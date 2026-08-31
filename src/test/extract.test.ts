import * as assert from 'assert';
import { extractI18nCallsFromText } from '../adapters/framework/GenericAdapter';
import { extractVueDirectiveKeys } from '../adapters/framework/VueSfcAdapter';
import { buildKeyLiteralRegex } from '../features/FindEnhancer';

const FUNCS = ['t', '$t', 'i18n.t', 'i18n.global.t', 'translate'];

describe('GenericAdapter / extractI18nCallsFromText', () => {
  it('识别常见调用形式的静态 key', () => {
    const code = `
      t('user.name');
      $t("user.email");
      i18n.t(\`common.ok\`);
      i18n.global.t('common.cancel');
      translate('user.deleteSuccess', { a: 1 });
    `;
    const keys = extractI18nCallsFromText(code, FUNCS).map((c) => c.key);
    assert.deepStrictEqual(keys, [
      'user.name',
      'user.email',
      'common.ok',
      'common.cancel',
      'user.deleteSuccess',
    ]);
  });

  it('跳过动态 key（模板插值 / 拼接 / 变量）', () => {
    const code = `
      t(\`user.\${part}\`);
      t('user.' + part);
      t(part);
      t(keyVar, {});
    `;
    assert.deepStrictEqual(extractI18nCallsFromText(code, FUNCS), []);
  });

  it('不匹配更长标识符的一部分', () => {
    const code = `xt('nope'); somet('nope2'); obj.t('yes.key');`;
    const keys = extractI18nCallsFromText(code, FUNCS).map((c) => c.key);
    // obj.t 里 t 前面是点号，(?<![\\w$.]) 排除 → 只剩没有匹配项
    assert.deepStrictEqual(keys, []);
  });

  it('keyRange / hintOffset 落在合理位置', () => {
    const code = `const x = t('a.b');`;
    const [call] = extractI18nCallsFromText(code, FUNCS);
    assert.strictEqual(code.slice(call.keyStart, call.keyEnd), "'a.b'");
    assert.strictEqual(code[call.hintOffset - 1], ')');
  });
});

describe('VueSfcAdapter / extractVueDirectiveKeys', () => {
  it('识别 v-t 与 keypath/path 属性', () => {
    const tpl = `
      <p v-t="'user.email'"></p>
      <i18n-t keypath="user.deleteConfirm" tag="span" />
      <i18n path="common.save" />
    `;
    const keys = extractVueDirectiveKeys(tpl).map((k) => k.key).sort();
    assert.deepStrictEqual(keys, ['common.save', 'user.deleteConfirm', 'user.email']);
  });
});

describe('FindEnhancer / buildKeyLiteralRegex', () => {
  it('转义点号并用引号包裹', () => {
    const re = buildKeyLiteralRegex(['user.name', 'user.deleteSuccess']);
    assert.strictEqual(re, `['"\`](?:user\\.name|user\\.deleteSuccess)['"\`]`);
  });

  it('生成的正则能匹配源码中的调用而不误伤相似串', () => {
    const re = new RegExp(buildKeyLiteralRegex(['user.name']));
    assert.ok(re.test(`t('user.name')`));
    assert.ok(re.test(`$t("user.name", {})`));
    assert.ok(!re.test(`t('userXname')`), 'user.name 的点号必须按字面量匹配');
    assert.ok(!re.test(`t('user.names')`), '引号锚定，user.names 不应命中');
  });
});
