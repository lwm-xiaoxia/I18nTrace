import * as vscode from 'vscode';
import { IndexManager } from '../core/IndexManager';
import { ConfigService } from '../config/ConfigService';
import { FrameworkAdapterRegistry } from '../adapters/framework/registry';
import { DisposableStore } from '../util/disposable';
import { logger } from '../util/logger';

/**
 * 注册除增强查找外的辅助命令：切换显示语种、重建索引、开关气泡、显示诊断。
 */
export function registerCommands(
  indexManager: IndexManager,
  config: ConfigService,
  adapters: FrameworkAdapterRegistry,
): vscode.Disposable {
  const store = new DisposableStore();

  store.add(
    vscode.commands.registerCommand('i18nTrace.switchDisplayLocale', async () => {
      const locales = indexManager.index.getLocales();
      if (locales.length === 0) {
        void vscode.window.showInformationMessage('I18nTrace：尚未发现任何语言文件。');
        return;
      }
      const current = indexManager.resolveDisplayLocale();
      const picked = await vscode.window.showQuickPick(
        locales.map((l) => ({
          label: l,
          description: l === current ? '当前' : undefined,
        })),
        { title: 'I18nTrace：选择气泡显示语种' },
      );
      if (picked) {
        await config.setDisplayLocale(picked.label);
      }
    }),
  );

  store.add(
    vscode.commands.registerCommand('i18nTrace.reindex', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'I18nTrace：重建索引' },
        () => indexManager.rebuild(),
      );
      void vscode.window.showInformationMessage(
        `I18nTrace：索引完成，locale = [${indexManager.index.getLocales().join(', ') || '无'}]`,
      );
    }),
  );

  store.add(
    vscode.commands.registerCommand('i18nTrace.toggleInlayHints', async () => {
      await config.setInlayHintsEnabled(!config.value.inlayHints.enabled);
    }),
  );

  store.add(
    vscode.commands.registerCommand('i18nTrace.showDiagnostics', async () => {
      await indexManager.rebuild();
      const editor = vscode.window.activeTextEditor;
      logger.append('');
      logger.append(indexManager.buildDiagnosticsReport(editor?.document));

      // 针对当前文件，逐个 i18n 调用报告命中情况
      if (editor) {
        const adapter = adapters.forDocument(editor.document);
        if (!adapter) {
          logger.append(`当前文件无匹配的框架适配器（languageId=${editor.document.languageId}）。`);
        } else {
          const full = new vscode.Range(
            0,
            0,
            Math.max(0, editor.document.lineCount - 1),
            0,
          );
          const calls = adapter.extractCalls(editor.document, full, {
            functionNames: config.value.translationFunctions,
          });
          logger.append(`适配器 ${adapter.id} 提取到 ${calls.length} 个静态 i18n 调用：`);
          const seen = new Set<string>();
          for (const call of calls) {
            if (seen.has(call.key)) {
              continue;
            }
            seen.add(call.key);
            const parts = indexManager.index.resolveKeyParts(call.key, call.namespace);
            if (!parts) {
              logger.append(`  ✗ ${call.key} — 无法解析到任何 key`);
              continue;
            }
            const shown = parts.map((k) => {
              const hit = indexManager.lookupKey(k);
              const arrow = k === call.key ? '' : ` → ${k}`;
              return hit.locales.length > 0
                ? `${k}${arrow} [${hit.locales.join(',')}]${hit.sample ? `「${hit.sample}」` : ''}`
                : `${k}${arrow} ✗不存在`;
            });
            logger.append(`  ✓ ${call.key} — ${shown.join(' + ')}`);
          }
        }
      }
      logger.show();
    }),
  );

  return store;
}
