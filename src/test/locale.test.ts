import * as assert from 'assert';
import * as vscode from 'vscode';
import { isLocaleCode, normalizeLocale } from '../config/localeCodes';
import { inferLocale } from '../config/ProjectScanner';

describe('localeCodes', () => {
  it('isLocaleCode 接受语言 / 区域代码', () => {
    for (const ok of ['en', 'zh', 'fr', 'zh-CN', 'zh_CN', 'pt-BR', 'en-US', 'zh-Hans', 'zh-Hant-HK']) {
      assert.ok(isLocaleCode(ok), `${ok} 应被接受`);
    }
  });

  it('isLocaleCode 拒绝常见目录名', () => {
    for (const no of ['src', 'lib', 'app', 'web', 'api', 'www', 'dev', 'index', 'types', 'helper', 'modules', 'common']) {
      assert.ok(!isLocaleCode(no), `${no} 不应被当成 locale`);
    }
  });

  it('normalizeLocale 归一化大小写', () => {
    assert.strictEqual(normalizeLocale('zh_cn'), 'zh-CN');
    assert.strictEqual(normalizeLocale('EN'), 'en');
    assert.strictEqual(normalizeLocale('pt-br'), 'pt-BR');
  });
});

describe('inferLocale', () => {
  const f = (p: string) => inferLocale(vscode.Uri.file(p));
  it('从文件名 / 目录推断', () => {
    assert.strictEqual(f('/x/src/languages/modules/zh-CN.ts'), 'zh-CN');
    assert.strictEqual(f('/x/src/locales/en.json'), 'en');
    assert.strictEqual(f('/x/i18n/zh/common.json'), 'zh');
    assert.strictEqual(f('/x/locales/pt_BR/app.yaml'), 'pt-BR');
    assert.strictEqual(f('/x/src/lang/common.zh-CN.json'), 'zh-CN');
  });
  it('入口 / 工具文件推断不出 locale（返回文件名）', () => {
    assert.strictEqual(f('/x/src/languages/index.ts'), 'index');
    assert.strictEqual(f('/x/src/languages/helper/translate.ts'), 'translate');
  });
});
