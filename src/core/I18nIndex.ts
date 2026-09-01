import * as vscode from 'vscode';
import { LocaleEntry } from './types';
import { normalizeTranslation } from '../util/text';

/** 内部规范 key 的命名空间分隔符（与 i18next 习惯一致）。 */
export const NS_SEPARATOR = ':';

/** 一次 key 解析的结果。 */
export interface KeyResolution {
  /** 索引中的规范 key（含命名空间时形如 `common:save`） */
  key: string;
  /** 命中方式，用于调试 / tooltip 提示 */
  via: 'exact' | 'namespace' | 'alias' | 'prefix' | 'lastSegment';
  /** 同名候选（>1 说明有歧义，取了第一个） */
  candidates: string[];
}

export interface I18nIndexOptions {
  /** 代码里可能出现的大小写 / 原样前缀，如 `+key`、`++key`（自定义 t 的约定） */
  keyPrefixes: readonly string[];
}

// 这些是早期版本已兼容的常见自定义前缀；现在通过配置传入，默认值仅保证独立使用
// I18nIndex 时也保持与扩展默认配置一致。
const DEFAULT_OPTIONS: I18nIndexOptions = { keyPrefixes: ['++', '+', '@', '#'] };

/**
 * 统一 i18n 索引。数据源只有语言文件，构建成几张查询结构：
 *  1. 规范 key → locale → LocaleEntry     （气泡取译文、点击跳转）
 *  2. 别名 → 规范 key[]                    （命名空间的不同写法、裸 key）
 *  3. key 末段 → 规范 key[]                （扁平 key 调用的兜底）
 *  4. 归一化译文行                          （增强 Ctrl+F 的反查）
 *
 * 「规范 key」= 有命名空间时 `ns:key`，否则就是 key 本身。
 *
 * 代码引用不在这里维护（搜索范围仅当前文件，按需即时扫描活动文档）。
 *
 * 变更策略：以「文件」为增量单位。某个语言文件变化时调用 replaceFile / removeFile，
 * 随后 rebuild() 从 byUri 全量重算派生结构。语言文件数量与体量都不大，全量重算简单可靠。
 */
export class I18nIndex {
  /** uriString → 该文件贡献的所有条目 */
  private readonly byUri = new Map<string, LocaleEntry[]>();

  /** 规范 key → locale → entry（派生） */
  private byKey = new Map<string, Map<string, LocaleEntry>>();
  /** 别名 → 规范 key 列表（派生） */
  private aliasIndex = new Map<string, string[]>();
  /** key 末段 → 规范 key 列表（派生） */
  private lastSegIndex = new Map<string, string[]>();
  /** 反查用的扁平列表（派生）：每条译文一行 */
  private searchRows: { norm: string; key: string; locale: string }[] = [];
  /** 已知的全部 locale（派生） */
  private localeSet = new Set<string>();
  /** 已知的全部命名空间（派生） */
  private namespaceSet = new Set<string>();

  private options: I18nIndexOptions = DEFAULT_OPTIONS;

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  /** 索引内容变化事件（供 InlayHintsProvider 刷新） */
  readonly onDidChange = this.onDidChangeEmitter.event;

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  /** 更新解析选项（配置变化时调用）。 */
  setOptions(options: I18nIndexOptions): void {
    this.options = options;
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
    const namespaces = new Set<string>();

    for (const entries of this.byUri.values()) {
      for (const entry of entries) {
        locales.add(entry.locale);
        if (entry.namespace) {
          namespaces.add(entry.namespace);
        }
        const canonical = canonicalKey(entry);

        let perLocale = byKey.get(canonical);
        if (!perLocale) {
          perLocale = new Map();
          byKey.set(canonical, perLocale);
        }
        // 同 key 同 locale 出现多次时，后者覆盖（就近目录已在 scanner 侧排序）。
        perLocale.set(entry.locale, entry);

        rows.push({ norm: normalizeTranslation(entry.value), key: canonical, locale: entry.locale });
      }
    }

    // 别名与末段索引
    const aliasIndex = new Map<string, string[]>();
    const lastSegIndex = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, alias: string, canonical: string): void => {
      if (!alias || alias === canonical) {
        return;
      }
      const arr = map.get(alias);
      if (arr) {
        if (!arr.includes(canonical)) {
          arr.push(canonical);
        }
      } else {
        map.set(alias, [canonical]);
      }
    };

    for (const canonical of byKey.keys()) {
      const nsIdx = canonical.indexOf(NS_SEPARATOR);
      if (nsIdx > 0) {
        const ns = canonical.slice(0, nsIdx);
        const bare = canonical.slice(nsIdx + 1);
        // 裸 key：useTranslation('ns') 后代码里只写 key
        push(aliasIndex, bare, canonical);
        // ns 用别的分隔符写：common.save / common/save
        push(aliasIndex, `${ns}.${bare}`, canonical);
        push(aliasIndex, `${ns}/${bare}`, canonical);
      }
      const bareKey = nsIdx > 0 ? canonical.slice(nsIdx + 1) : canonical;
      const dot = bareKey.lastIndexOf('.');
      if (dot >= 0) {
        push(lastSegIndex, bareKey.slice(dot + 1), canonical);
      } else {
        push(lastSegIndex, bareKey, canonical);
      }
    }

    this.byKey = byKey;
    this.aliasIndex = aliasIndex;
    this.lastSegIndex = lastSegIndex;
    this.searchRows = rows;
    this.localeSet = locales;
    this.namespaceSet = namespaces;
    this.onDidChangeEmitter.fire();
  }

  // ────────────────────────────── key 解析 ──────────────────────────────

  /**
   * 把「代码里写的 key」解析成索引中的规范 key。
   *
   * 分层回退（每层都先原样试，再试变体），保证不同项目约定都能命中，
   * 又不会因为某个项目的私有约定误伤别的项目：
   *   1. 原样精确匹配
   *   2. 调用点已知命名空间补全（`t('save')` + useTranslation('common')）
   *   3. 命名空间分隔符变体（`common:save` ↔ `common.save` ↔ `common/save`）与裸 key 别名
   *   4. 剥离自定义前缀（`+key` / `++key` / `@key` / `#key`）后重来一遍
   *   5. key 末段兜底（扁平 key 调用命中 `<模块>.<key>`）
   */
  resolveKeyDetailed(rawKey: string, hintNamespace?: string): KeyResolution | undefined {
    const key = rawKey.trim();
    if (!key) {
      return undefined;
    }

    const direct = this.resolveWithoutPrefix(key, hintNamespace);
    if (direct) {
      return direct;
    }

    // 自定义前缀：先原样查不到，才尝试剥前缀，避免误伤真的以这些字符开头的 key
    for (const p of this.options.keyPrefixes) {
      if (p && key.startsWith(p) && key.length > p.length) {
        const stripped = this.resolveWithoutPrefix(key.slice(p.length).trim(), hintNamespace);
        if (stripped) {
          return { ...stripped, via: 'prefix' };
        }
      }
    }
    return undefined;
  }

  /** 便捷版：只要规范 key。 */
  resolveKey(rawKey: string, hintNamespace?: string): string | undefined {
    return this.resolveKeyDetailed(rawKey, hintNamespace)?.key;
  }

  private resolveWithoutPrefix(key: string, hintNamespace?: string): KeyResolution | undefined {
    // 1. 原样
    if (this.byKey.has(key)) {
      return { key, via: 'exact', candidates: [key] };
    }

    // 2. 调用点已知命名空间
    if (hintNamespace) {
      const withNs = `${hintNamespace}${NS_SEPARATOR}${key}`;
      if (this.byKey.has(withNs)) {
        return { key: withNs, via: 'namespace', candidates: [withNs] };
      }
    }

    // 3. 分隔符变体 + 别名
    for (const variant of spellingVariants(key)) {
      if (this.byKey.has(variant)) {
        return { key: variant, via: 'namespace', candidates: [variant] };
      }
    }
    for (const candidate of [key, ...spellingVariants(key)]) {
      const hit = this.aliasIndex.get(candidate);
      if (hit && hit.length > 0) {
        // 有命名空间提示时优先选同 ns 的候选
        const preferred =
          (hintNamespace && hit.find((k) => k.startsWith(`${hintNamespace}${NS_SEPARATOR}`))) ||
          hit[0];
        return { key: preferred, via: 'alias', candidates: hit };
      }
    }

    // 4. 末段兜底
    const lastSeg = lastSegmentOf(key);
    const segHit = this.lastSegIndex.get(lastSeg);
    if (segHit && segHit.length > 0) {
      const preferred =
        (hintNamespace && segHit.find((k) => k.startsWith(`${hintNamespace}${NS_SEPARATOR}`))) ||
        segHit[0];
      return { key: preferred, via: 'lastSegment', candidates: segHit };
    }
    return undefined;
  }

  /**
   * 解析 key，必要时按空格拆成多段（某些自定义 t 支持 `t('+timezone name')` 逐段翻译拼接）。
   *
   * 先整体解析：很多项目直接用自然语句当 key（`t('Save changes')`），
   * 一上来就按空格切会把它切碎导致误报缺失。
   */
  resolveKeyPartsDetailed(rawKey: string, hintNamespace?: string): KeyResolution[] | undefined {
    const whole = this.resolveKeyDetailed(rawKey, hintNamespace);
    if (whole) {
      return [whole];
    }
    const tokens = rawKey.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      return undefined;
    }
    const resolved: KeyResolution[] = [];
    for (const token of tokens) {
      const r = this.resolveKeyDetailed(token, hintNamespace);
      if (!r) {
        return undefined;
      }
      resolved.push(r);
    }
    return resolved;
  }

  /** 便捷版：只要规范 key 列表。 */
  resolveKeyParts(rawKey: string, hintNamespace?: string): string[] | undefined {
    return this.resolveKeyPartsDetailed(rawKey, hintNamespace)?.map((r) => r.key);
  }

  // ────────────────────────────── 查询 ──────────────────────────────

  /** 是否已有任何数据。 */
  get isEmpty(): boolean {
    return this.byKey.size === 0;
  }

  /** 索引里的 key 总数（诊断用）。 */
  get size(): number {
    return this.byKey.size;
  }

  getLocales(): string[] {
    return [...this.localeSet].sort();
  }

  getNamespaces(): string[] {
    return [...this.namespaceSet].sort();
  }

  /** 取某规范 key 在某 locale 的条目；该 locale 缺失时回落到其它 locale。 */
  getEntry(key: string, locale?: string): LocaleEntry | undefined {
    const perLocale = this.byKey.get(key);
    if (!perLocale) {
      return undefined;
    }
    if (locale && perLocale.has(locale)) {
      return perLocale.get(locale);
    }
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
   * @returns 去重后的规范 key 列表（按匹配度：完全相等 > 前缀 > 子串）
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
      if (idx === -1 || seen.has(row.key)) {
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

function canonicalKey(entry: LocaleEntry): string {
  return entry.namespace ? `${entry.namespace}${NS_SEPARATOR}${entry.key}` : entry.key;
}

function lastSegmentOf(key: string): string {
  const afterNs = key.slice(key.indexOf(NS_SEPARATOR) + 1);
  const dot = afterNs.lastIndexOf('.');
  return dot >= 0 ? afterNs.slice(dot + 1) : afterNs;
}

/**
 * 命名空间分隔符的其它写法。
 * `common:save` / `common.save` / `common/save` 在不同项目里都出现过，
 * 这里只替换第一个分隔符（后面的点属于嵌套 key 的一部分）。
 */
function spellingVariants(key: string): string[] {
  const out: string[] = [];
  const seps = [NS_SEPARATOR, '.', '/'];
  for (const from of seps) {
    const idx = key.indexOf(from);
    if (idx <= 0) {
      continue;
    }
    for (const to of seps) {
      if (to === from) {
        continue;
      }
      out.push(key.slice(0, idx) + to + key.slice(idx + from.length));
    }
  }
  return out;
}
