import * as path from 'path';
import * as vscode from 'vscode';
import { FrameworkAdapter } from '../../core/types';
import { GenericAdapter } from './GenericAdapter';
import { VueSfcAdapter } from './VueSfcAdapter';

/** 文件扩展名 → languageId 兜底映射（宿主未安装 Volar 等语言扩展时 .vue/.svelte 可能不是预期 languageId）。 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  vue: 'vue',
  svelte: 'svelte',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  html: 'html',
  htm: 'html',
};

/**
 * 框架适配器注册表：按 languageId 选择适配器。
 * 新增框架：实现 FrameworkAdapter，在 defaultFrameworkAdapters 里 push 一次。
 * 同一 languageId 命中多个时，越靠前优先（更具体的放前面）。
 */
export class FrameworkAdapterRegistry {
  constructor(private readonly adapters: FrameworkAdapter[] = defaultFrameworkAdapters()) {}

  forLanguage(languageId: string): FrameworkAdapter | undefined {
    return this.adapters.find((a) => a.languages.includes(languageId));
  }

  /** 优先按 languageId 选择，选不到再按文件扩展名兜底。 */
  forDocument(document: vscode.TextDocument): FrameworkAdapter | undefined {
    const byLang = this.forLanguage(document.languageId);
    if (byLang) {
      return byLang;
    }
    const ext = path.extname(document.uri.fsPath).slice(1).toLowerCase();
    const mapped = EXT_TO_LANGUAGE[ext];
    return mapped ? this.forLanguage(mapped) : undefined;
  }

  get languages(): string[] {
    return [...new Set(this.adapters.flatMap((a) => a.languages))];
  }
}

export function defaultFrameworkAdapters(): FrameworkAdapter[] {
  // VueSfcAdapter 在前：.vue 用它；其余落到 GenericAdapter
  return [new VueSfcAdapter(), new GenericAdapter()];
}
