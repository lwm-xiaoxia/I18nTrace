import * as vscode from 'vscode';
import JSON5 from 'json5';
import { LocaleEntry, LocaleParser } from '../../core/types';
import { flattenLocaleObject } from './flatten';

/**
 * JS / TS 语言文件解析（best-effort，静态、不执行代码）。
 *
 * 支持：
 *   export default { ... }
 *   module.exports = { ... }
 *   export const xxx = { ... }（取第一个对象字面量）
 *   TS 的 `as const` / `satisfies X` / 顶层 `: Type`（做简单剥离）
 *
 * 不支持（按设计跳过，README 说明）：
 *   import 拼接、展开运算符引用外部对象、函数调用生成的翻译、运行时计算值。
 * 解析失败时返回空数组，不阻塞其它文件。
 */
export class JsModuleParser implements LocaleParser {
  readonly extensions = ['js', 'ts', 'mjs', 'cjs'] as const;

  parse(uri: vscode.Uri, text: string, locale: string): LocaleEntry[] {
    const objectLiteral = extractDefaultObjectLiteral(text);
    if (!objectLiteral) {
      return [];
    }
    let data: unknown;
    try {
      data = JSON5.parse(objectLiteral);
    } catch {
      // 再尝试剥离 TS 特有语法后解析
      try {
        data = JSON5.parse(stripTsSyntax(objectLiteral));
      } catch (err) {
        console.warn(
          `[LocaleTrace] JS/TS 语言文件无法静态解析: ${uri.fsPath}`,
          (err as Error).message,
        );
        return [];
      }
    }
    return flattenLocaleObject(data, uri, locale, text);
  }
}

/** 去掉注释后，定位默认导出的对象字面量并按括号配平截取。 */
function extractDefaultObjectLiteral(source: string): string | undefined {
  const text = stripComments(source);
  const anchors = [
    /export\s+default\s*/g,
    /module\.exports\s*=\s*/g,
    /export\s+const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*/g,
    /(?:^|\n)\s*const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*/g,
  ];

  for (const re of anchors) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) {
      continue;
    }
    const braceStart = text.indexOf('{', m.index + m[0].length - 1);
    if (braceStart === -1) {
      continue;
    }
    const literal = sliceBalanced(text, braceStart);
    if (literal) {
      return literal;
    }
  }
  return undefined;
}

/** 从 openIndex 处的 `{` 起，按括号/字符串配平截取到匹配的 `}`。 */
function sliceBalanced(text: string, openIndex: number): string | undefined {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
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
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(openIndex, i + 1);
      }
    }
  }
  return undefined;
}

function stripComments(text: string): string {
  // 去掉块注释与行注释；字符串内的 // 不严格处理，对语言文件足够
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 剥离 TS 里 JSON5 不认的片段。 */
function stripTsSyntax(text: string): string {
  return text
    .replace(/\bas\s+const\b/g, '')
    .replace(/\bsatisfies\s+[A-Za-z_$][\w$.<>,\s[\]]*$/gm, '')
    .replace(/\bsatisfies\s+[A-Za-z_$][\w$.<>,\s[\]]*(?=[,}\n])/g, '');
}
