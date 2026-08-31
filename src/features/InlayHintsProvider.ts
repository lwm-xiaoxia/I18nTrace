import * as vscode from 'vscode';
import { IndexManager } from '../core/IndexManager';
import { ConfigService } from '../config/ConfigService';
import { FrameworkAdapterRegistry } from '../adapters/framework/registry';
import { truncateForHint } from '../util/text';
import { DisposableStore } from '../util/disposable';

/**
 * 在 i18n 调用旁用 Inlay Hint 常驻显示译文。不修改源码。
 * 命中 key → 显示译文（截断）；找不到 key 且开启提示 → 显示 ⚠️。
 * 点击气泡跳转到语言文件中该 key 的定义位置。
 */
export class LocaleTraceInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly store = new DisposableStore();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.changeEmitter.event;

  constructor(
    private readonly indexManager: IndexManager,
    private readonly config: ConfigService,
    private readonly adapters: FrameworkAdapterRegistry,
  ) {
    this.store.add(this.changeEmitter);
    // 索引或显示配置变化时，请求编辑器重新拉取 hint
    this.store.add(this.indexManager.index.onDidChange(() => this.changeEmitter.fire()));
    this.store.add(this.config.onDidChangeDisplay(() => this.changeEmitter.fire()));
  }

  dispose(): void {
    this.store.dispose();
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const cfg = this.config.value;
    if (!cfg.enabled || !cfg.inlayHints.enabled) {
      return [];
    }
    const adapter = this.adapters.forDocument(document);
    if (!adapter) {
      return [];
    }

    const displayLocale = this.indexManager.resolveDisplayLocale();
    const calls = adapter.extractCalls(document, range, {
      functionNames: cfg.translationFunctions,
    });

    const hints: vscode.InlayHint[] = [];
    for (const call of calls) {
      const entry = this.indexManager.index.getEntry(call.key, displayLocale);
      if (!entry) {
        if (cfg.inlayHints.showWhenMissing && !this.indexManager.index.hasKey(call.key)) {
          const hint = new vscode.InlayHint(
            call.hintPosition,
            `⚠️ ${call.key}`,
            vscode.InlayHintKind.Type,
          );
          hint.paddingLeft = true;
          hint.tooltip = new vscode.MarkdownString(
            `LocaleTrace：语言文件中未找到 key \`${call.key}\``,
          );
          hints.push(hint);
        }
        continue;
      }

      const tooltip = this.buildTooltip(call.key, displayLocale);
      const part = new vscode.InlayHintLabelPart(
        truncateForHint(entry.value, cfg.inlayHints.maxLength),
      );
      part.tooltip = tooltip;
      // 设置 location 后，Ctrl/Cmd+点击气泡即可跳转到语言文件中该 key 的定义。
      part.location = new vscode.Location(
        entry.uri,
        entry.range ?? new vscode.Range(0, 0, 0, 0),
      );

      const hint = new vscode.InlayHint(
        call.hintPosition,
        [part],
        vscode.InlayHintKind.Type,
      );
      hint.paddingLeft = true;
      hint.tooltip = tooltip;
      hints.push(hint);
    }
    return hints;
  }

  private buildTooltip(key: string, displayLocale: string | undefined): vscode.MarkdownString {
    const all = this.indexManager.index.getAllForKey(key);
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**\`${key}\`**\n\n`);
    if (all) {
      for (const [locale, entry] of [...all.entries()].sort()) {
        const marker = locale === displayLocale ? '▸ ' : '';
        md.appendMarkdown(`${marker}\`${locale}\`: ${escapeMd(entry.value)}\n\n`);
      }
    }
    md.isTrusted = false;
    return md;
  }
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&').replace(/\n/g, ' ');
}
