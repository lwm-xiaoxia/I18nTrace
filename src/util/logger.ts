import * as vscode from 'vscode';

/**
 * 统一日志出口：写到「I18nTrace」输出频道，便于在真实项目里排查
 * （语言文件有没有被扫到、解析出多少 key、displayLocale 选了谁）。
 */
class LoggerImpl implements vscode.Disposable {
  private channel: vscode.OutputChannel | undefined;

  private get out(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel('I18nTrace');
    }
    return this.channel;
  }

  private stamp(): string {
    // 不用 Date.now 依赖，仅取本地时间字符串
    return new Date().toLocaleTimeString();
  }

  info(msg: string): void {
    this.out.appendLine(`[${this.stamp()}] ${msg}`);
  }

  warn(msg: string): void {
    this.out.appendLine(`[${this.stamp()}] ⚠ ${msg}`);
  }

  /** 直接追加一段多行文本（诊断报告用）。 */
  append(block: string): void {
    this.out.appendLine(block);
  }

  show(): void {
    this.out.show(true);
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
  }
}

export const logger = new LoggerImpl();
