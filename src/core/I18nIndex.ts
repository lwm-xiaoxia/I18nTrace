import * as vscode from 'vscode';
import { LocaleEntry } from './types';
import { normalizeTranslation } from '../util/text';

/**
 * 统一 i18n 索引。数据源只有语言文件，构建成两张查询结构：
 *  1. key → locale → LocaleEntry           （气泡取译文、点击跳转）
 *  2. 归一化译文 line 列表 → 部分匹配反查 key （增强 Ctrl+F）
 *
 * 代码引用不在这里维护（搜索范围仅当前文件，按需即时扫描活动文档）。
 *
 * 变更策略：以「文件」为增量单位。某个语言文件变化时调用 replaceFile / removeFile，
 * 随后 rebuild() 从 byUri 全量重算派生结构。语言文件数量与体量都不大，全量重算简单可靠。
 */
export class I18nIndex {
  /** uriString → 该文件贡献的所有条目 */
  private readonly byUri = new Map<string, LocaleEntry[]>();

  /** key → locale → entry（派生） */
  private byKey = new Map<string, Map<string, LocaleEntry>>();
  /** 反查用的扁平列表（派生）：每条译文一行 */
  private searchRows: { norm: string; key: string; locale: string }[] = [];
  /** 已知的全部 locale（派生） */
  private localeSet = new Set<string>();

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  /** 索引内容变化事件（供 InlayHintsProvider 刷新） */
  readonly onDidChange = this.onDidChangeEmitter.event;

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  /** 用一批新条目替换某个文件的旧条目。 */
  replaceFile(uri: vscode.Uri, entries: LocaleEntry[]): void {
    this.byUri.set(uri.toString(), entries);
    this.rebuild();
  }

  /** 移除某个文件的全部条目（文件被删除时）。 */
  removeFile(uri: vscode.Uri): void {
    if (this.byUri.delete(uri.toString())) {
      this.rebuild();
    }
  }

  /** 清空整个索引（重建前）。 */
  clear(): void {
    this.byUri.clear();
    this.rebuild();
  }

  private rebuild(): void {
    const byKey = new Map<string, Map<string, LocaleEntry>>();
    const rows: { norm: string; key: string; locale: string }[] = [];
    const locales = new Set<string>();

    for (const entries of this.byUri.values()) {
      for (const entry of entries) {
        locales.add(entry.locale);

        let perLocale = byKey.get(entry.key);
        if (!perLocale) {
          perLocale = new Map();
          byKey.set(entry.key, perLocale);
        }
        // 同 key 同 locale 出现多次时，后者覆盖（就近目录已在 scanner 侧排序）。
        perLocale.set(entry.locale, entry);

        rows.push({ norm: normalizeTranslation(entry.value), key: entry.key, locale: entry.locale });
      }
    }

    this.byKey = byKey;
    this.searchRows = rows;
    this.localeSet = locales;
    this.onDidChangeEmitter.fire();
  }

  /** 是否已有任何数据。 */
  get isEmpty(): boolean {
    return this.byKey.size === 0;
  }

  getLocales(): string[] {
    return [...this.localeSet].sort();
  }

  /** 取某 key 在某 locale 的条目；locale 省略时按 getLocales 第一个。 */
  getEntry(key: string, locale?: string): LocaleEntry | undefined {
    const perLocale = this.byKey.get(key);
    if (!perLocale) {
      return undefined;
    }
    if (locale && perLocale.has(locale)) {
      return perLocale.get(locale);
    }
    if (locale) {
      return undefined;
    }
    // 未指定 locale：返回任意一个稳定结果
    const first = [...perLocale.keys()].sort()[0];
    return first ? perLocale.get(first) : undefined;
  }

  /** 取某 key 的全部 locale 条目（用于 tooltip 展示其它语种）。 */
  getAllForKey(key: string): Map<string, LocaleEntry> | undefined {
    return this.byKey.get(key);
  }

  hasKey(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * 按译文部分匹配反查 key。
   * @param query 用户输入的短语
   * @param locale 限定 locale；省略则跨全部 locale
   * @param limit 最多返回多少 key
   * @returns 去重后的 key 列表（按匹配度：完全相等 > 前缀 > 子串）
   */
  findKeysByTranslation(query: string, locale?: string, limit = 200): string[] {
    const q = normalizeTranslation(query);
    if (!q) {
      return [];
    }

    const exact: string[] = [];
    const prefix: string[] = [];
    const substr: string[] = [];
    const seen = new Set<string>();

    for (const row of this.searchRows) {
      if (locale && row.locale !== locale) {
        continue;
      }
      const idx = row.norm.indexOf(q);
      if (idx === -1) {
        continue;
      }
      if (seen.has(row.key)) {
        continue;
      }
      seen.add(row.key);

      if (row.norm === q) {
        exact.push(row.key);
      } else if (idx === 0) {
        prefix.push(row.key);
      } else {
        substr.push(row.key);
      }
    }

    return [...exact, ...prefix, ...substr].slice(0, limit);
  }
}
