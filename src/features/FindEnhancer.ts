import * as vscode from 'vscode';
import { IndexManager } from '../core/IndexManager';
import { ConfigService } from '../config/ConfigService';
import { FrameworkAdapterRegistry } from '../adapters/framework/registry';
import { escapeRegExp } from '../util/text';
import { DisposableStore } from '../util/disposable';

/**
 * 增强 Ctrl+F：把「译文」翻译成一组 key，再交回 VS Code 原生查找框。
 *
 * 设计要点（见方案）：VS Code 稳定 API 无法拦截/扩展原生查找框，因此：
 *  1. 用轻量 InputBox 收集短语；
 *  2. 用索引把短语部分匹配成一组 key，并与「当前文件实际出现的 key」取交集；
 *  3. 交集非空 → 构造匹配这些 key 字面量的正则，调 editor.actions.findWithArgs（isRegex）；
 *  4. 交集为空 / 无译文命中 / 非代码文件 → 原样把短语交给原生查找（等价普通 Ctrl+F）。
 *
 * 之后的 Enter / Shift+Enter / 高亮全部 / 关闭，全部是原生查找框行为。
 */
export class FindEnhancer {
  private readonly store = new DisposableStore();

  constructor(
    private readonly indexManager: IndexManager,
    private readonly config: ConfigService,
    private readonly adapters: FrameworkAdapterRegistry,
  ) {
    this.store.add(
      vscode.commands.registerCommand('i18nTrace.find', () => this.run()),
    );
  }

  dispose(): void {
    this.store.dispose();
  }

  private async run(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.commands.executeCommand('actions.find');
      return;
    }

    // 增强关闭时（一般 when 子句已拦截，这里兜底）直接走原生
    if (!this.config.value.search.enhanceCtrlF) {
      await vscode.commands.executeCommand('actions.find');
      return;
    }

    const seed = editor.document.getText(editor.selection).split('\n')[0] ?? '';

    const input = vscode.window.createInputBox();
    input.title = 'I18nTrace 查找';
    input.placeholder = '输入译文或普通关键字，Enter 查找';
    input.prompt = '命中译文 → 跳到对应 key 调用；未命中 → 普通查找';
    input.value = seed;
    const plainButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('search'),
      tooltip: '按普通文本查找（跳过译文解析）',
    };
    input.buttons = [plainButton];

    let done = false;
    const finish = async (mode: 'auto' | 'plain'): Promise<void> => {
      if (done) {
        return;
      }
      done = true;
      const phrase = input.value.trim();
      input.hide();
      if (!phrase) {
        await vscode.commands.executeCommand('actions.find');
        return;
      }
      await this.dispatch(editor, phrase, mode);
    };

    // 本次调用的临时订阅，随输入框关闭一起释放
    const local: vscode.Disposable[] = [];
    local.push(
      input.onDidTriggerButton((btn) => {
        if (btn === plainButton) {
          void finish('plain');
        }
      }),
      input.onDidAccept(() => void finish('auto')),
      // 实时提示匹配到多少 key（轻量，不做结果列表）
      input.onDidChangeValue((v) => {
        const q = v.trim();
        if (!q) {
          input.prompt = '命中译文 → 跳到对应 key 调用；未命中 → 普通查找';
          return;
        }
        const n = this.resolveHitKeys(editor.document, q).length;
        input.prompt = n > 0 ? `匹配到 ${n} 个 key（Enter 用正则定位）` : '无译文命中，Enter 走普通查找';
      }),
      input.onDidHide(() => {
        done = true;
        for (const d of local) {
          d.dispose();
        }
        input.dispose();
      }),
    );

    input.show();
  }

  private async dispatch(
    editor: vscode.TextEditor,
    phrase: string,
    mode: 'auto' | 'plain',
  ): Promise<void> {
    if (mode === 'plain') {
      await this.nativeFind(phrase, false);
      return;
    }

    const hitKeys = this.resolveHitKeys(editor.document, phrase);
    if (hitKeys.length === 0) {
      // 译文可能在别的文件里命中，提示一下（当前版本搜索范围仅当前文件）
      const globalHits = this.indexManager.index.findKeysByTranslation(
        phrase,
        this.indexManager.resolveDisplayLocale(),
        1,
      );
      if (globalHits.length > 0) {
        void vscode.window.showInformationMessage(
          `I18nTrace：「${phrase}」对应的 key 不在当前文件，已按普通文本查找。`,
        );
      }
      await this.nativeFind(phrase, false);
      return;
    }

    const max = Math.max(1, this.config.value.search.maxKeysPerSearch);
    let keys = hitKeys;
    if (keys.length > max) {
      keys = keys.slice(0, max);
      void vscode.window.showInformationMessage(
        `I18nTrace：命中 ${hitKeys.length} 个 key，仅纳入前 ${max} 个。可缩小搜索词。`,
      );
    }

    await this.nativeFind(buildKeyLiteralRegex(keys), true);
  }

  /** 短语 → 当前文件里真实出现、且译文匹配的 key 列表。 */
  private resolveHitKeys(document: vscode.TextDocument, phrase: string): string[] {
    const matchedKeys = new Set(
      this.indexManager.index.findKeysByTranslation(
        phrase,
        this.indexManager.resolveDisplayLocale(),
      ),
    );
    if (matchedKeys.size === 0) {
      return [];
    }

    const adapter = this.adapters.forDocument(document);
    if (!adapter) {
      // 非代码文件：无法定位调用，交给普通查找
      return [];
    }

    const fullRange = new vscode.Range(
      0,
      0,
      document.lineCount - 1,
      Math.max(0, document.lineAt(Math.max(0, document.lineCount - 1)).text.length),
    );
    const calls = adapter.extractCalls(document, fullRange, {
      functionNames: this.config.value.translationFunctions,
    });

    const seen = new Set<string>();
    const result: string[] = [];
    for (const call of calls) {
      if (matchedKeys.has(call.key) && !seen.has(call.key)) {
        seen.add(call.key);
        result.push(call.key);
      }
    }
    return result;
  }

  private async nativeFind(searchString: string, isRegex: boolean): Promise<void> {
    await vscode.commands.executeCommand('editor.actions.findWithArgs', {
      searchString,
      isRegex,
    });
  }
}

/**
 * 构造匹配一组 key「被引号包裹的字面量」的正则，与调用形式无关：
 *   ['"`](?:user\.name|user\.deleteSuccess)['"`]
 */
export function buildKeyLiteralRegex(keys: string[]): string {
  const alt = keys.map((k) => escapeRegExp(k)).join('|');
  return `['"\`](?:${alt})['"\`]`;
}
