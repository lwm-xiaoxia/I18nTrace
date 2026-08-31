import * as vscode from 'vscode';
import { ExtractContext, FrameworkAdapter, I18nCall } from '../../core/types';
import { GenericAdapter } from './GenericAdapter';
import { escapeRegExp } from '../../util/text';

/**
 * Vue SFC 适配器。
 * - <script> / <template> 里的 $t()/t()/i18n.t() 等调用交给 GenericAdapter（其正则不区分区域）。
 * - 额外识别 Vue 特有写法：
 *     v-t="'user.name'"            指令简写
 *     <i18n-t keypath="user.name"> 组件（vue-i18n v9）
 *     <i18n path="user.name">      组件（vue-i18n v8）
 */
export class VueSfcAdapter implements FrameworkAdapter {
  readonly id = 'vue';
  readonly languages = ['vue'];

  private readonly generic = new GenericAdapter();

  extractCalls(
    document: vscode.TextDocument,
    range: vscode.Range,
    ctx: ExtractContext,
  ): I18nCall[] {
    const calls = this.generic.extractCalls(document, range, ctx);

    const startLine = Math.max(0, Math.min(range.start.line, document.lineCount - 1));
    const endLine = Math.max(startLine, Math.min(range.end.line, document.lineCount - 1));
    const scanRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
    const baseOffset = document.offsetAt(scanRange.start);
    const text = document.getText(scanRange);

    for (const raw of extractVueDirectiveKeys(text)) {
      calls.push({
        key: raw.key,
        keyRange: new vscode.Range(
          document.positionAt(baseOffset + raw.keyStart),
          document.positionAt(baseOffset + raw.keyEnd),
        ),
        hintPosition: document.positionAt(baseOffset + raw.keyEnd),
      });
    }
    return calls;
  }
}

interface RawKey {
  key: string;
  keyStart: number;
  keyEnd: number;
}

const ATTR_NAMES = ['keypath', 'path'];

export function extractVueDirectiveKeys(text: string): RawKey[] {
  const out: RawKey[] = [];

  // v-t="'user.name'"  或  v-t="`user.name`"（无插值）
  const vtRe = /v-t\s*=\s*"(\s*['"`])([^'"`$]+?)\1"/g;
  let m: RegExpExecArray | null;
  while ((m = vtRe.exec(text)) !== null) {
    const key = m[2].trim();
    if (!key) {
      continue;
    }
    const keyStart = m.index + m[0].indexOf(m[2]);
    out.push({ key, keyStart, keyEnd: keyStart + m[2].length });
  }

  // <i18n-t keypath="user.name">  /  <i18n path="user.name">
  for (const attr of ATTR_NAMES) {
    const attrRe = new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*"([^"$]+?)"`, 'g');
    while ((m = attrRe.exec(text)) !== null) {
      const key = m[1].trim();
      if (!key || key.includes('{')) {
        continue;
      }
      const keyStart = m.index + m[0].indexOf(m[1]);
      out.push({ key, keyStart, keyEnd: keyStart + m[1].length });
    }
  }

  return out;
}
