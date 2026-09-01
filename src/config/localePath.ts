import { isLocaleCode, normalizeLocale } from './localeCodes';

/**
 * 从语言文件路径推断 locale 与命名空间。
 *
 * 需要覆盖的常见目录结构：
 * ```
 * locales/zh-CN.json                → zh-CN,  ns 无
 * src/languages/modules/zh-CN.ts    → zh-CN,  ns 无（modules 是容器目录）
 * locales/zh-CN/index.ts            → zh-CN,  ns 无
 * locales/en/common.json            → en,     ns common          （i18next 经典）
 * locales/en/pages/home.json        → en,     ns pages/home      （i18next 多级 ns）
 * i18n/common/zh-CN.json            → zh-CN,  ns common          （ns 在前）
 * locales/common.zh-CN.json         → zh-CN,  ns common          （ns.locale 同名文件）
 * lang/zh_CN.yaml                   → zh-CN,  ns 无
 * ```
 * 推断不出 locale 时返回 `locale = 文件名`，调用方据此判断「这不是语言文件」。
 */
export interface LocalePathInfo {
  locale: string;
  namespace?: string;
  /** locale 是从文件名还是目录名推断出来的，便于日志排查 */
  from: 'filename' | 'directory' | 'unknown';
}

/**
 * 纯容器目录名：出现在语言文件路径里只表示「这里放国际化资源」，
 * 不构成命名空间。
 */
const CONTAINER_DIRS = new Set([
  'locale',
  'locales',
  'lang',
  'langs',
  'language',
  'languages',
  'i18n',
  'i18n-locales',
  'intl',
  'translation',
  'translations',
  'messages',
  'modules',
  'module',
  'resources',
  'resource',
  'assets',
  'src',
  'app',
  'lib',
  'public',
  'static',
  'config',
  'data',
  'json',
]);

/** 不构成命名空间的文件名（约定为「该目录的入口」）。 */
const INDEX_STEMS = new Set(['index', 'main', 'default']);

export function analyzeLocalePath(fsPath: string): LocalePathInfo {
  const parts = fsPath.split(/[\\/]/).filter(Boolean);
  const file = parts[parts.length - 1] ?? '';
  const dirs = parts.slice(0, -1);
  const stem = file.replace(/\.[^.]+$/, '');

  // ── 情况 1：整个文件名就是 locale（zh-CN.json）
  if (isLocaleCode(stem)) {
    return {
      locale: normalizeLocale(stem),
      namespace: namespaceFromParentDir(dirs),
      from: 'filename',
    };
  }

  // ── 情况 2：文件名里含 locale 段（common.zh-CN.json / zh-CN.common.json）
  const stemSegs = stem.split('.');
  if (stemSegs.length > 1) {
    const localeIdx = stemSegs.findIndex((s) => isLocaleCode(s));
    if (localeIdx !== -1) {
      const rest = stemSegs.filter((_, i) => i !== localeIdx).join('.');
      return {
        locale: normalizeLocale(stemSegs[localeIdx]),
        namespace: rest && !INDEX_STEMS.has(rest) ? rest : namespaceFromParentDir(dirs),
        from: 'filename',
      };
    }
  }

  // ── 情况 3：locale 是某一层目录名（locales/en/common.json）
  // 从最靠近文件的一层往上找，避免路径里更外层的巧合命中。
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (!isLocaleCode(dirs[i])) {
      continue;
    }
    // locale 目录之后的所有目录 + 文件名，构成多级命名空间
    const tail = [...dirs.slice(i + 1), stem].filter((s) => !CONTAINER_DIRS.has(s.toLowerCase()));
    // 末尾的 index/main/default 不计入命名空间
    while (tail.length > 0 && INDEX_STEMS.has(tail[tail.length - 1].toLowerCase())) {
      tail.pop();
    }
    return {
      locale: normalizeLocale(dirs[i]),
      namespace: tail.length > 0 ? tail.join('/') : namespaceBeforeLocale(dirs, i),
      from: 'directory',
    };
  }

  return { locale: stem, from: 'unknown' };
}

/**
 * 文件名即 locale 时，父目录若不是容器目录就当作命名空间。
 * 例：`i18n/common/zh-CN.json` → common；`locales/zh-CN.json` → 无。
 */
function namespaceFromParentDir(dirs: string[]): string | undefined {
  const parent = dirs[dirs.length - 1];
  if (!parent) {
    return undefined;
  }
  const lower = parent.toLowerCase();
  if (CONTAINER_DIRS.has(lower) || isLocaleCode(parent) || INDEX_STEMS.has(lower)) {
    return undefined;
  }
  return parent;
}

/**
 * locale 位于命名空间目录的末尾时，取最近语言资源容器之后的目录。
 * 例：`i18n/common/en/index.json` → `common`；`locales/en/index.json` → 无。
 */
function namespaceBeforeLocale(dirs: string[], localeIndex: number): string | undefined {
  let boundary = -1;
  for (let i = localeIndex - 1; i >= 0; i--) {
    if (CONTAINER_DIRS.has(dirs[i].toLowerCase())) {
      boundary = i;
      break;
    }
  }
  const parts = dirs
    .slice(boundary + 1, localeIndex)
    .filter((part) => !CONTAINER_DIRS.has(part.toLowerCase()) && !isLocaleCode(part));
  return parts.length > 0 ? parts.join('/') : undefined;
}
