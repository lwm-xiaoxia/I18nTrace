import * as vscode from 'vscode';
import { DisposableStore } from '../util/disposable';
import { debounce } from '../util/debounce';
import { ConfigService } from '../config/ConfigService';

export interface LocaleWatcherHandlers {
  onChange(uri: vscode.Uri): void | Promise<void>;
  onDelete(uri: vscode.Uri): void;
}

/**
 * 监听语言文件的增删改。
 * - 按当前配置的 glob 建 FileSystemWatcher（每个工作区目录一个）
 * - 变更事件按 uri 去抖（默认 200ms），避免保存时多次触发
 * - 编辑器里未保存的修改也监听（onDidChangeTextDocument）以便实时刷新
 */
export class LocaleWatcher {
  private readonly store = new DisposableStore();
  private readonly pending = new Map<string, ReturnType<typeof debounce>>();
  /** 当前一批 FileSystemWatcher；结构性配置变化时整体替换 */
  private watcherStore = new DisposableStore();

  constructor(
    private readonly config: ConfigService,
    private readonly handlers: LocaleWatcherHandlers,
    private readonly isTracked: (uri: vscode.Uri) => boolean,
    private readonly supportsExt: (uri: vscode.Uri) => boolean,
  ) {
    this.rebuildWatchers();
    this.store.add(this.config.onDidChangeStructural(() => this.rebuildWatchers()));

    // 未保存的编辑：语言文件在编辑器中改动时也刷新
    this.store.add(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.isTracked(e.document.uri)) {
          this.schedule(e.document.uri, 'change');
        }
      }),
    );
  }

  dispose(): void {
    for (const d of this.pending.values()) {
      d.cancel();
    }
    this.pending.clear();
    this.store.dispose();
  }

  private rebuildWatchers(): void {
    // 清掉旧 watcher：重建一个内部 store
    this.watcherStore.dispose();
    this.watcherStore = new DisposableStore();
    this.store.add(this.watcherStore);

    const folders = vscode.workspace.workspaceFolders ?? [];
    const glob = this.config.value.localeFileGlob;

    for (const folder of folders) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, glob),
      );
      this.watcherStore.add(watcher);
      this.watcherStore.add(watcher.onDidChange((uri) => this.schedule(uri, 'change')));
      this.watcherStore.add(
        watcher.onDidCreate((uri) => {
          if (this.supportsExt(uri)) {
            this.schedule(uri, 'change');
          }
        }),
      );
      this.watcherStore.add(watcher.onDidDelete((uri) => this.handlers.onDelete(uri)));
    }
  }

  private schedule(uri: vscode.Uri, kind: 'change'): void {
    void kind;
    const key = uri.toString();
    let d = this.pending.get(key);
    if (!d) {
      d = debounce(() => {
        this.pending.delete(key);
        void this.handlers.onChange(uri);
      }, 200);
      this.pending.set(key, d);
    }
    d();
  }
}
