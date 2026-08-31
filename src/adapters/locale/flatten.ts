import * as vscode from 'vscode';
import { LocaleEntry } from '../../core/types';
import { escapeRegExp } from '../../util/text';

/** key 分隔符（拍平嵌套对象时使用），与 vue-i18n / i18next 默认一致。 */
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
  locale: string,
  rawText: string,
): LocaleEntry[] {
  const entries: LocaleEntry[] = [];
  const locator = new KeyLocator(rawText);

  const walk = (node: unknown, path: string[]): void => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      if (path.length === 0) {
        return;
      }
      const key = path.join(KEY_SEPARATOR);
      entries.push({
        key,
        locale,
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
      const re = new RegExp(`["']${escapeRegExp(seg)}["']\\s*:|(?:^|\\s)${escapeRegExp(seg)}\\s*:`, 'm');
      re.lastIndex = searchFrom;
      const sub = this.text.slice(searchFrom);
      const m = re.exec(sub);
      if (!m) {
        return this.offsetToRange(lastOffset);
      }
      lastOffset = searchFrom + m.index;
      searchFrom = lastOffset + m[0].length;
    }
    return this.offsetToRange(lastOffset);
  }

  private offsetToRange(offset: number): vscode.Range | undefined {
    if (offset < 0) {
      return undefined;
    }
    let line = 0;
    // 线性/二分皆可，语言文件不大，线性足够
    for (let i = 0; i < this.lineStart.length; i++) {
      if (this.lineStart[i] > offset) {
        break;
      }
      line = i;
    }
    const col = offset - this.lineStart[line];
    return new vscode.Range(line, Math.max(0, col), line, this.lines[line]?.length ?? col);
  }
}
