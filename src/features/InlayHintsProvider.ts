import * as vscode from 'vscode';
import { IndexManager } from '../core/IndexManager';
import { ConfigService } from '../config/ConfigService';
import { FrameworkAdapterRegistry } from '../adapters/framework/registry';
import { LocaleEntry } from '../core/types';
import { truncateForHint } from '../util/text';
import { DisposableStore } from '../util/disposable';

/**
 * 在 i18n 调用旁用 Inlay Hint 常驻显示译文。不修改源码。
 * 命中 key → 显示译文（截断）；找不到 key 且开启提示 → 显示 ⚠️。
 * 点击气泡跳转到语言文件中该 key 的定义位置。
 */
export class I18nTraceInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly store = new DisposableStore();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.changeEmitter.event;
  private refreshTimers: NodeJS.Timeout[] = [];

  constructor(
    private readonly indexManager: IndexManager,
    private readonly config: ConfigService,
    private readonly adapters: FrameworkAdapterRegistry,
  ) {
    this.store.add(this.changeEmitter);
    // 索引或显示配置变化时，请求编辑器重新拉取 hint
    this.store.add(this.indexManager.index.onDidChange(() => this.refresh()));
    this.store.add(this.config.onDidChangeDisplay(() => this.refresh()));
    // 切换 / 新开编辑器时也刷新：宿主的语言服务（如 Volar）可能在扩展激活后才把
    // .vue 的 languageId 从 plaintext 切到 vue，触发一次可见编辑器变化。
    this.store.add(vscode.window.onDidChangeActiveTextEditor(() => this.changeEmitter.fire()));
    this.store.add(vscode.window.onDidChangeVisibleTextEditors(() => this.changeEmitter.fire()));
  }

  /**
   * 主动请求编辑器重新拉取 hint，并在之后的几秒内错峰多补几次。
   *
   * 原因：首次索引常在编辑器已渲染、甚至已发起过 hint 请求之后才完成；
   * 且宿主语言服务启动、VS Code 对变更事件去抖等因素叠加，单次 fire 时常
   * 与「索引进行中 / 语言未就绪」的旧请求相互覆盖，表现为译文迟迟不出现、
   * 需手动滚动才刷新。错峰重发覆盖这段不稳定窗口。
   */
  refresh(): void {
    this.clearTimers();
    this.changeEmitter.fire();
    for (const delay of [300, 1000, 2500]) {
      this.refreshTimers.push(setTimeout(() => this.changeEmitter.fire(), delay));
    }
  }

  private clearTimers(): void {
    for (const t of this.refreshTimers) {
      clearTimeout(t);
    }
    this.refreshTimers = [];
  }

  dispose(): void {
    this.clearTimers();
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

    const index = this.indexManager.index;
    const joiner = displayLocale && /^en/i.test(displayLocale) ? ' ' : '';
    const hints: vscode.InlayHint[] = [];
    for (const call of calls) {
      // 代码里的 key 可能带前缀、可能是扁平 key、也可能是空格分隔的多段 key
      const resolvedKeys = index.resolveKeyParts(call.key);
      const entries = resolvedKeys?.map((k) => index.getEntry(k, displayLocale));
      if (!resolvedKeys || !entries || entries.some((e) => !e)) {
        if (cfg.inlayHints.showWhenMissing) {
          const hint = new vscode.InlayHint(
            call.hintPosition,
            `⚠️ ${call.key}`,
            vscode.InlayHintKind.Type,
          );
          hint.paddingLeft = true;
          hint.tooltip = new vscode.MarkdownString(
            `I18nTrace：语言文件中未找到 key \`${call.key}\``,
          );
          hints.push(hint);
        }
        continue;
      }

      const okEntries = entries as LocaleEntry[];
      const primaryKey = resolvedKeys[0];
      const primary = okEntries[0];
      const composedValue = okEntries.map((e) => e.value).join(joiner);
      const tooltip =
        resolvedKeys.length === 1
          ? this.buildTooltip(primaryKey, displayLocale)
          : new vscode.MarkdownString(
              resolvedKeys.map((k, i) => `\`${k}\`: ${escapeMd(okEntries[i].value)}`).join('\n\n'),
            );
      // 命中的不是目标显示语种（回落到了其它 locale）时，前面标出实际语种
      const prefix =
        displayLocale && primary.locale !== displayLocale ? `${primary.locale}: ` : '';
      const part = new vscode.InlayHintLabelPart(
        prefix + truncateForHint(composedValue, cfg.inlayHints.maxLength),
      );
      part.tooltip = tooltip;
      // 设置 location 后，Ctrl/Cmd+点击气泡即可跳转到语言文件中该 key 的定义。
      part.location = new vscode.Location(
        primary.uri,
        primary.range ?? new vscode.Range(0, 0, 0, 0),
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
