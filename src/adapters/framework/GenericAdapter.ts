import * as vscode from 'vscode';
import { ExtractContext, FrameworkAdapter, I18nCall } from '../../core/types';
import { escapeRegExp } from '../../util/text';
import {
  RawCall,
  extractDefaultNamespace,
  extractIntlMessageKeys,
  extractLocalizeKeys,
  extractPipeKeys,
  maskComments,
  namespaceFromOptions,
} from './patterns';

export type { RawCall } from './patterns';

/**
 * 通用适配器：识别绝大多数 i18n 调用形式，覆盖 JS/TS/JSX/TSX/HTML/Svelte，
 * 以及 Vue SFC 的 script 段（Vue 模板特有写法由 VueSfcAdapter 追加）。
 *
 * 覆盖：
 *   t('a.b')  $t("a.b")  i18n.t(`a.b`)  translate('a.b')  translate.instant('a.b')
 *   t('save', { ns: 'common' })          → 带命名空间
 *   useTranslation('common') + t('save') → 文件级默认命名空间
 *   {{ 'a.b' | translate }}              → ngx-translate / transloco 管道
 *   $localize`:@@a.b:文案`               → Angular 官方 i18n
 * 跳过（动态 key，按设计不猜）：
 *   t(`a.${x}`)  t(key)  t('a.' + x)
 * 注释里的调用会被屏蔽，不产生气泡。
 */
export class GenericAdapter implements FrameworkAdapter {
  readonly id = 'generic';
  readonly languages = [
    'javascript',
    'javascriptreact',
    'typescript',
    'typescriptreact',
    'html',
    'vue',
    'svelte',
    'astro',
  ];
  /** 文档版本 → useTranslation 等文件级命名空间，避免每次拉取 Inlay Hint 都扫描整篇文档。 */
  private readonly defaultNamespaceCache = new WeakMap<
    vscode.TextDocument,
    { version: number; namespace?: string }
  >();

  extractCalls(
    document: vscode.TextDocument,
    range: vscode.Range,
    ctx: ExtractContext,
  ): I18nCall[] {
    const scan = prepareScan(document, range);
    const defaultNs = this.getDefaultNamespace(document, ctx.fullText);

    const raws = [
      ...extractI18nCallsFromText(scan.text, ctx.functionNames),
      ...extractPipeKeys(scan.text),
      ...extractLocalizeKeys(scan.text),
      ...extractIntlMessageKeys(scan.text),
    ];
    return toI18nCalls(document, scan, raws, defaultNs);
  }

  private getDefaultNamespace(document: vscode.TextDocument, fullText?: string): string | undefined {
    const cached = this.defaultNamespaceCache.get(document);
    if (cached?.version === document.version) {
      return cached.namespace;
    }
    // 文件级默认命名空间要看整篇文档，不能只看可视区；同一版本只扫描一次。
    const namespace = extractDefaultNamespace(fullText ?? document.getText());
    this.defaultNamespaceCache.set(document, { version: document.version, namespace });
    return namespace;
  }
}

export interface ScanSlice {
  /** 已屏蔽注释的文本（offset 与原文一致） */
  text: string;
  /** 该片段在文档中的起始 offset */
  baseOffset: number;
}

/** 把请求范围扩到整行并屏蔽注释，返回可直接做正则的文本。 */
export function prepareScan(document: vscode.TextDocument, range: vscode.Range): ScanSlice {
  // 扩到整行，避免可视区边界把调用截断；对越界行号做钳制
  const startLine = Math.max(0, Math.min(range.start.line, document.lineCount - 1));
  const endLine = Math.max(startLine, Math.min(range.end.line, document.lineCount - 1));
  const scanRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
  return {
    text: maskComments(document.getText(scanRange)),
    baseOffset: document.offsetAt(scanRange.start),
  };
}

/** 把文本层面的 RawCall 换算成带文档位置的 I18nCall，并按位置去重。 */
export function toI18nCalls(
  document: vscode.TextDocument,
  scan: ScanSlice,
  raws: RawCall[],
  defaultNamespace?: string,
): I18nCall[] {
  const seen = new Set<number>();
  const calls: I18nCall[] = [];
  for (const raw of raws) {
    // 同一处可能被多个模式命中（如 keypath 同时像属性又像调用），按 key 起点去重
    if (seen.has(raw.keyStart)) {
      continue;
    }
    seen.add(raw.keyStart);
    calls.push({
      key: raw.key,
      namespace: raw.namespace ?? defaultNamespace,
      keyRange: new vscode.Range(
        document.positionAt(scan.baseOffset + raw.keyStart),
        document.positionAt(scan.baseOffset + raw.keyEnd),
      ),
      hintPosition: document.positionAt(scan.baseOffset + raw.hintOffset),
    });
  }
  return calls;
}

/**
 * 纯文本层面的调用提取，便于单测（不依赖 vscode.TextDocument）。
 */
export function extractI18nCallsFromText(text: string, functionNames: readonly string[]): RawCall[] {
  if (functionNames.length === 0) {
    return [];
  }
  // 允许点号形式（i18n.t、translate.instant）；按长度降序，优先匹配更具体的名字。
  const names = [...functionNames]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');

  // (?<![\w$.]) 确保不是更长标识符的一部分（xt( 不匹配 t(）
  const callRe = new RegExp(`(?<![\\w$.])(?:${names})\\s*\\(`, 'g');
  const results: RawCall[] = [];

  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    const parenIndex = m.index + m[0].length - 1; // 指向 '('
    const parsed = parseFirstStringArg(text, parenIndex);
    if (!parsed) {
      continue;
    }
    results.push(parsed);
    callRe.lastIndex = parsed.hintOffset;
  }
  return results;
}

/**
 * 从 '(' 开始解析调用：第一个实参必须是静态字符串字面量，否则视为动态 key 跳过。
 * 顺带从后续实参里读 `{ ns: 'x' }`。
 */
function parseFirstStringArg(text: string, parenIndex: number): RawCall | undefined {
  let i = parenIndex + 1;
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return undefined;
  }
  const keyStart = i;
  i++;
  let key = '';
  let closed = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      key += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === quote) {
      closed = true;
      i++;
      break;
    }
    if (quote === '`' && ch === '$' && text[i + 1] === '{') {
      // 模板字符串插值 → 动态 key，跳过
      return undefined;
    }
    key += ch;
    i++;
  }
  if (!closed || key.length === 0) {
    return undefined;
  }
  const keyEnd = i; // 闭合引号之后

  // 闭合引号后若是字符串拼接（'a.' + x），视为动态 key，跳过
  let j = keyEnd;
  while (j < text.length && /\s/.test(text[j])) {
    j++;
  }
  if (text[j] === '+') {
    return undefined;
  }

  const hintOffset = findCallClose(text, keyEnd);
  return {
    key,
    namespace: namespaceFromOptions(text, keyEnd, hintOffset),
    keyStart,
    keyEnd,
    hintOffset,
  };
}

/** 从 fromIndex 起找配平的 ')' 之后的 offset（起始 '(' 已消费）。 */
function findCallClose(text: string, fromIndex: number): number {
  let depth = 1;
  let inStr: string | null = null;
  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') {
        i++;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return text.length;
}
