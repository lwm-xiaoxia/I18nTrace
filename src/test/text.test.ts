import * as assert from 'assert';
import { normalizeTranslation, escapeRegExp, truncateForHint } from '../util/text';

describe('util/text', () => {
  it('normalizeTranslation 压缩空白并转小写', () => {
    assert.strictEqual(normalizeTranslation('  Hello   World \n'), 'hello world');
    assert.strictEqual(normalizeTranslation('删除\t成功'), '删除 成功');
  });

  it('escapeRegExp 转义元字符', () => {
    assert.strictEqual(escapeRegExp('user.name'), 'user\\.name');
    assert.strictEqual(escapeRegExp('a+b(c)'), 'a\\+b\\(c\\)');
  });

  it('truncateForHint 按显示宽度截断', () => {
    assert.strictEqual(truncateForHint('short', 40), 'short');
    assert.strictEqual(truncateForHint('一二三四五', 6), '一二三…');
    assert.strictEqual(truncateForHint('multi\nline text', 40), 'multi line text');
  });

  it('truncateForHint 对非法长度兜底，不至于只剩省略号', () => {
    // settings.json 可以手写 0 / 负数 / NaN，绕过设置界面的 minimum
    for (const bad of [0, -1, Number.NaN]) {
      const out = truncateForHint('用户名', bad);
      assert.ok(out.length > 1, `maxLen=${bad} 时不该只剩省略号，实际：${out}`);
    }
  });
});
