import * as vscode from 'vscode';
import { IndexManager } from '../core/IndexManager';
import { ConfigService } from '../config/ConfigService';
import { DisposableStore } from '../util/disposable';

/**
 * 注册除增强查找外的辅助命令：切换显示语种、重建索引、开关气泡。
 */
export function registerCommands(
  indexManager: IndexManager,
  config: ConfigService,
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

  return store;
}
