import * as vscode from 'vscode';
import { ExtractContext, FrameworkAdapter, I18nCall } from '../../core/types';
import { GenericAdapter, prepareScan, toI18nCalls } from './GenericAdapter';
import { extractVueDirectiveKeys } from './patterns';

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
    const scan = prepareScan(document, range);
    // 指令 / 组件属性写法与函数调用互不重叠，直接追加；toI18nCalls 内部按位置去重
    calls.push(...toI18nCalls(document, scan, extractVueDirectiveKeys(scan.text)));
    return calls;
  }
}
