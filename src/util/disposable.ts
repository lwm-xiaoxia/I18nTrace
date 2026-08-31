import * as vscode from 'vscode';

/**
 * 简单的 Disposable 聚合容器。
 * 所有订阅、注册、watcher 统一 push 进来，扩展 deactivate 时一次性释放。
 */
export class DisposableStore implements vscode.Disposable {
  private readonly items: vscode.Disposable[] = [];
  private disposed = false;

  add<T extends vscode.Disposable>(item: T): T {
    if (this.disposed) {
      // 容器已释放后再加入的资源，立即释放，避免泄漏。
      item.dispose();
    } else {
      this.items.push(item);
    }
    return item;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // 后进先出释放，尽量贴近资源创建的逆序。
    while (this.items.length > 0) {
      try {
        this.items.pop()?.dispose();
      } catch (err) {
        console.error('[LocaleTrace] dispose 出错', err);
      }
    }
  }
}
