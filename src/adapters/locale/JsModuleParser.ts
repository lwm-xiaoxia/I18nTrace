import * as vscode from 'vscode';
import JSON5 from 'json5';
import { LocaleEntry, LocaleParser, ParseContext } from '../../core/types';
import { maskComments } from '../../util/comments';
import { escapeRegExp } from '../../util/text';
import { logger } from '../../util/logger';
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

  parse(uri: vscode.Uri, text: string, ctx: ParseContext): LocaleEntry[] {
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
        logger.warn(
          `JS/TS 语言文件无法静态解析: ${uri.fsPath} — ${(err as Error).message}`,
        );
        return [];
      }
    }
    return flattenLocaleObject(data, uri, ctx, text);
  }
}

/**
 * 去掉注释后，定位默认导出的对象字面量并按括号配平截取。
 *
 * 按「越能确定是默认导出」的顺序尝试：
 *   1. `export default { ... }` / `module.exports = { ... }`   直接就是字面量
 *   2. `export default zhCN;`                                  顺着标识符找它的声明
 *   3. 任意 `const x = { ... }`                                 都找不到时的兜底
 *
 * 第 2 步不可省：`const zhCN = {...}; export default zhCN;` 是最常见的写法，
 * 若直接跳到第 3 步，文件里但凡还有别的 `export const xxx = {...}`（工具函数、
 * 类型示例），就会解析成那个无关对象，产出一堆不存在的 key。
 */
function extractDefaultObjectLiteral(source: string): string | undefined {
  const text = stripComments(source);

  const inline = matchLiteralAfter(text, [
    /export\s+default\s*/g,
    /module\.exports\s*=\s*/g,
  ]);
  if (inline) {
    return inline;
  }

  const named = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(text);
  if (named) {
    const declared = matchLiteralAfter(text, [
      new RegExp(
        `(?:^|[\\n;])\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(named[1])}\\s*(?::[^=]+)?=\\s*`,
        'g',
      ),
    ]);
    if (declared) {
      return declared;
    }
  }

  return matchLiteralAfter(text, [
    /export\s+const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*/g,
    /(?:^|\n)\s*const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*/g,
  ]);
}

/**
 * 依次尝试每个锚点，取第一个「紧跟其后就是 `{`」的对象字面量。
 * 只认紧跟的花括号：用 indexOf 一路往后搜会跨过整个文件截到无关的对象。
 */
function matchLiteralAfter(text: string, anchors: RegExp[]): string | undefined {
  for (const re of anchors) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      let i = m.index + m[0].length;
      while (i < text.length && /\s/.test(text[i])) {
        i++;
      }
      if (text[i] !== '{') {
        continue;
      }
      const literal = sliceBalanced(text, i);
      if (literal) {
        return literal;
      }
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

/**
 * 屏蔽注释，保留原有长度与字符串内容。
 *
 * 早先是两条正则直接删注释，会误伤译文里的 `//`（`{ tip: '路径 a//b 无效' }`）：
 * 半条字符串被删掉，JSON5 解析随即失败，整份语言文件的 key 全部丢失。
 * 共用的 maskComments 是带状态的扫描，能正确跳过字符串与模板串。
 */
function stripComments(text: string): string {
  return maskComments(text);
}

/** 剥离 TS 里 JSON5 不认的片段。 */
function stripTsSyntax(text: string): string {
  return text
    .replace(/\bas\s+const\b/g, '')
    .replace(/\bsatisfies\s+[A-Za-z_$][\w$.<>,\s[\]]*$/gm, '')
    .replace(/\bsatisfies\s+[A-Za-z_$][\w$.<>,\s[\]]*(?=[,}\n])/g, '');
}
