import * as vscode from 'vscode';
import { LocaleEntry, ParseContext } from '../../core/types';
import { escapeRegExp } from '../../util/text';

/** key 分隔符默认值，与 vue-i18n / i18next 默认一致。 */
export const KEY_SEPARATOR = '.';

/**
 * 把已解析的 JS 值（对象/数组/字符串）拍平成 LocaleEntry 列表。
 * - 字符串叶子 → 一条 entry
 * - 数字/布尔叶子 → 转成字符串（有的项目把复数、数字文案直接写值）
 * - 数组 → 用下标作为 key 段
 * - null / undefined / 函数 → 跳过
 *
 * @param rawText 原始文件文本，用于 best-effort 定位 key 的行范围
 */
export function flattenLocaleObject(
  value: unknown,
  uri: vscode.Uri,
  ctx: ParseContext,
  rawText: string,
): LocaleEntry[] {
  const entries: LocaleEntry[] = [];
  const locator = new KeyLocator(rawText);
  const sep = ctx.keySeparator || KEY_SEPARATOR;

  const walk = (node: unknown, path: string[]): void => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      if (path.length === 0) {
        return;
      }
      entries.push({
        key: path.join(sep),
        namespace: ctx.namespace,
        locale: ctx.locale,
        value: String(node),
        uri,
        range: locator.locate(path),
      });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, [...path, k]);
      }
    }
  };

  walk(value, []);
  return entries;
}

/**
 * best-effort 定位：按 key 段顺序在原文里逐段向后搜索 `"seg"` 或 `seg:`。
 * 适用于「键按声明顺序出现」的常规语言文件；定位不到就返回 undefined（点击仍能打开文件）。
 */
class KeyLocator {
  private readonly lines: string[];
  /** 每行起始的全局 offset */
  private readonly lineStart: number[];
  /** key 段 → 匹配它的正则。同一段名在文件里往往出现很多次，编译一次复用。 */
  private readonly segRe = new Map<string, RegExp>();

  constructor(private readonly text: string) {
    this.lines = text.split(/\r?\n/);
    this.lineStart = [];
    let acc = 0;
    for (const line of this.lines) {
      this.lineStart.push(acc);
      acc += line.length + 1;
    }
  }

  locate(path: string[]): vscode.Range | undefined {
    let searchFrom = 0;
    let lastOffset = -1;
    for (const seg of path) {
      // 数组下标段不参与文本定位
      if (/^\d+$/.test(seg)) {
        continue;
      }
      // 用 global 正则 + lastIndex 从指定位置起匹配。早先的写法是
      // slice(searchFrom) 再匹配，等于给每个 key 的每一段都复制一份全文剩余部分，
      // 大语言文件下是 O(key 数 × 文件长度) 的纯拷贝开销。
      const re = this.regexFor(seg);
      re.lastIndex = searchFrom;
      const m = re.exec(this.text);
      if (!m) {
        return this.offsetToRange(lastOffset);
      }
      lastOffset = m.index;
      searchFrom = m.index + m[0].length;
    }
    return this.offsetToRange(lastOffset);
  }

  private regexFor(seg: string): RegExp {
    let re = this.segRe.get(seg);
    if (!re) {
      const escaped = escapeRegExp(seg);
      re = new RegExp(`["']${escaped}["']\\s*:|(?:^|\\s)${escaped}\\s*:`, 'gm');
      this.segRe.set(seg, re);
    }
    return re;
  }

  private offsetToRange(offset: number): vscode.Range | undefined {
    if (offset < 0) {
      return undefined;
    }
    const line = this.lineAt(offset);
    const col = offset - this.lineStart[line];
    return new vscode.Range(line, Math.max(0, col), line, this.lines[line]?.length ?? col);
  }

  /** 二分查出 offset 所在行：每个 key 都要查一次，线性扫描在大文件上是 O(key 数 × 行数)。 */
  private lineAt(offset: number): number {
    let lo = 0;
    let hi = this.lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStart[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }
}
