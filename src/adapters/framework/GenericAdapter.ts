import * as vscode from 'vscode';
import { ExtractContext, FrameworkAdapter, I18nCall } from '../../core/types';
import { escapeRegExp } from '../../util/text';

/**
 * 通用适配器：正则识别常见 i18n 调用形式，适用于 JS/TS/JSX/TSX（以及 Vue/HTML 的 <script> 段）。
 *
 * 覆盖：
 *   t('a.b')  $t("a.b")  i18n.t(`a.b`)  translate('a.b')  vm.$t('a.b', {...})
 * 跳过（动态 key，按设计不猜）：
 *   t(`a.${x}`)  t(key)  t('a.' + x)
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
  ];

  extractCalls(
    document: vscode.TextDocument,
    range: vscode.Range,
    ctx: ExtractContext,
  ): I18nCall[] {
    // 扩到整行，避免可视区边界把调用截断；对越界行号做钳制（防御 executeInlayHintProvider 传入越界 range）
    const startLine = Math.max(0, Math.min(range.start.line, document.lineCount - 1));
    const endLine = Math.max(startLine, Math.min(range.end.line, document.lineCount - 1));
    const scanRange = new vscode.Range(
      startLine,
      0,
      endLine,
      document.lineAt(endLine).text.length,
    );
    const baseOffset = document.offsetAt(scanRange.start);
    const text = document.getText(scanRange);

    return extractI18nCallsFromText(text, ctx.functionNames).map((raw) => ({
      key: raw.key,
      keyRange: new vscode.Range(
        document.positionAt(baseOffset + raw.keyStart),
        document.positionAt(baseOffset + raw.keyEnd),
      ),
      hintPosition: document.positionAt(baseOffset + raw.hintOffset),
    }));
  }
}

export interface RawCall {
  key: string;
  /** key 字符串字面量（含引号）在 text 中的起止 offset */
  keyStart: number;
  keyEnd: number;
  /** Inlay Hint 锚点 offset（调用右括号之后） */
  hintOffset: number;
}

/**
 * 纯文本层面的调用提取，便于单测（不依赖 vscode.TextDocument）。
 */
export function extractI18nCallsFromText(text: string, functionNames: readonly string[]): RawCall[] {
  if (functionNames.length === 0) {
    return [];
  }
  // 允许点号形式（i18n.t）；名字里非首段可含点。按长度降序，优先匹配更具体的名字。
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
 * 返回 key 内容、字面量范围、调用右括号后的 offset。
 */
function parseFirstStringArg(text: string, parenIndex: number): RawCall | undefined {
  let i = parenIndex + 1;
  // 跳过空白
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

  // 找调用右括号（跳过后续实参）
  const hintOffset = findCallClose(text, keyEnd, parenIndex);
  return { key, keyStart, keyEnd, hintOffset };
}

/** 从 fromIndex 起、已知起始 '(' 在 parenIndex，找配平的 ')' 之后的 offset。 */
function findCallClose(text: string, fromIndex: number, parenIndex: number): number {
  let depth = 1; // 已经进入 parenIndex 的括号
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
    } else if (ch === '\n' && depth === 1) {
      // 容错：单行内没闭合就停在行尾，避免跨越太多
      // 继续尝试，i 已经到换行；不 break，允许多行调用
    }
  }
  void parenIndex;
  return text.length;
}
