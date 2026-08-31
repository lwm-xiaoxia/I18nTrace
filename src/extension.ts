import * as vscode from 'vscode';
import { DisposableStore } from './util/disposable';
import { ConfigService } from './config/ConfigService';
import { ProjectScanner } from './config/ProjectScanner';
import { LocaleParserRegistry } from './adapters/locale/registry';
import { FrameworkAdapterRegistry } from './adapters/framework/registry';
import { IndexManager } from './core/IndexManager';
import { LocaleWatcher } from './watch/LocaleWatcher';
import { I18nTraceInlayHintsProvider } from './features/InlayHintsProvider';
import { FindEnhancer } from './features/FindEnhancer';
import { registerCommands } from './features/commands';

let store: DisposableStore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  store = new DisposableStore();
  context.subscriptions.push(store);

  const config = store.add(new ConfigService());
  const localeParsers = new LocaleParserRegistry();
  const frameworkAdapters = new FrameworkAdapterRegistry();
  const scanner = new ProjectScanner(localeParsers);

  const indexManager = store.add(new IndexManager(config, localeParsers, scanner));

  // Inlay Hint Provider
  const inlayProvider = store.add(
    new I18nTraceInlayHintsProvider(indexManager, config, frameworkAdapters),
  );
  // 按 languageId 匹配；另加 glob 兜底，宿主未装 Volar 时 .vue/.svelte 也能触发
  const selector: vscode.DocumentSelector = [
    ...config.value.languageSelector.map((language) => ({ scheme: 'file', language })),
    { scheme: 'file', pattern: '**/*.{vue,svelte}' },
  ];
  store.add(vscode.languages.registerInlayHintsProvider(selector, inlayProvider));

  // 增强查找 + 辅助命令
  store.add(new FindEnhancer(indexManager, config, frameworkAdapters));
  store.add(registerCommands(indexManager, config));

  // 语言文件监听：增量更新索引
  store.add(
    new LocaleWatcher(
      config,
      {
        onChange: (uri) => indexManager.updateFile(uri),
        onDelete: (uri) => indexManager.removeFile(uri),
      },
      (uri) => indexManager.isTrackedLocaleFile(uri),
      (uri) => indexManager.supportsExtension(uri),
    ),
  );

  // 结构性配置变化 → 全量重建
  store.add(config.onDidChangeStructural(() => void indexManager.rebuild()));
  // 工作区目录增减 → 全量重建
  store.add(vscode.workspace.onDidChangeWorkspaceFolders(() => void indexManager.rebuild()));

  // 首次构建（不阻塞激活）
  void indexManager.rebuild();
}

export function deactivate(): void {
  store?.dispose();
  store = undefined;
}
