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
          this.schedule(e.document.uri);
        }
      }),
    );
  }

  dispose(): void {
    for (const d of this.pending.values()) {
      d.cancel();
    }
    this.pending.clear();
    // watcherStore 不挂在 store 上（见 rebuildWatchers），单独释放
    this.watcherStore.dispose();
    this.store.dispose();
  }

  private rebuildWatchers(): void {
    // 清掉旧 watcher：重建一个内部 store。
    // 注意不要把它 add 进 this.store —— 每次结构性配置变化都会重建一个，
    // 旧的虽已释放却会永远留在 store 的数组里，条目数随配置改动无限增长。
    this.watcherStore.dispose();
    this.watcherStore = new DisposableStore();

    const folders = vscode.workspace.workspaceFolders ?? [];
    const glob = this.config.value.localeFileGlob;

    for (const folder of folders) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, glob),
      );
      this.watcherStore.add(watcher);
      this.watcherStore.add(watcher.onDidChange((uri) => this.schedule(uri)));
      this.watcherStore.add(
        watcher.onDidCreate((uri) => {
          if (this.supportsExt(uri)) {
            this.schedule(uri);
          }
        }),
      );
      this.watcherStore.add(watcher.onDidDelete((uri) => this.handlers.onDelete(uri)));
    }
  }

  /** 同一文件的连续变更合并成一次重解析。 */
  private schedule(uri: vscode.Uri): void {
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
