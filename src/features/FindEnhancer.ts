import * as vscode from 'vscode';
import { IndexManager } from '../core/IndexManager';
import { ConfigService } from '../config/ConfigService';
import { FrameworkAdapterRegistry } from '../adapters/framework/registry';
import { escapeRegExp } from '../util/text';
import { DisposableStore } from '../util/disposable';
import { debounce } from '../util/debounce';

/** 查找范围：当前文件（Ctrl+F）或整个工作区（Ctrl+Shift+F）。 */
type FindScope = 'document' | 'workspace';

/**
 * 增强查找：把「译文」翻译成一组 key，再交回 VS Code 原生查找 UI。
 *
 * 两个入口共用同一套「输入框 → 译文反查 key → 构造 key 字面量正则」的流程，
 * 只在「候选 key 如何收敛」和「交给哪个原生 UI」上分叉：
 *
 * - document（Ctrl+F）：与当前文件实际出现的 key 取交集 → editor.actions.findWithArgs。
 *   取交集是因为编辑器查找只在本文件内高亮，塞入本文件不存在的 key 只会让正则变长。
 * - workspace（Ctrl+Shift+F）：不取交集，直接把全部候选 key 交给
 *   workbench.action.findInFiles，由 VS Code 搜索引擎筛掉工作区里不存在的 key。
 *   （全局取交集意味着要自建代码引用索引，成本远高于收益。）
 *
 * 两种范围下，未命中任何译文时都退回原样短语的普通查找，等价于原生行为。
 */
export class FindEnhancer {
  private readonly store = new DisposableStore();
  /** 文档版本 + 词组的结果缓存，避免输入时反复扫描整篇源码。 */
  private readonly hitCache = new Map<string, string[]>();

  constructor(
    private readonly indexManager: IndexManager,
    private readonly config: ConfigService,
    private readonly adapters: FrameworkAdapterRegistry,
  ) {
    this.store.add(
      vscode.commands.registerCommand('i18nTrace.find', () => this.run('document')),
    );
    this.store.add(
      vscode.commands.registerCommand('i18nTrace.findInFiles', () => this.run('workspace')),
    );
    this.store.add(this.indexManager.index.onDidChange(() => this.hitCache.clear()));
    this.store.add(this.config.onDidChangeDisplay(() => this.hitCache.clear()));
  }

  dispose(): void {
    this.store.dispose();
  }

  private async run(scope: FindScope): Promise<void> {
    const enhanced =
      scope === 'document'
        ? this.config.value.search.enhanceCtrlF
        : this.config.value.search.enhanceCtrlShiftF;
    // 增强关闭时（一般 when 子句已拦截，这里兜底）直接走原生
    if (!enhanced) {
      await this.nativeFallback(scope);
      return;
    }

    const editor = vscode.window.activeTextEditor;
    // 当前文件查找必须有活动编辑器；全局查找没有编辑器也能用
    if (scope === 'document' && !editor) {
      await this.nativeFallback(scope);
      return;
    }

    const seed = editor ? (editor.document.getText(editor.selection).split('\n')[0] ?? '') : '';

    const input = vscode.window.createInputBox();
    input.title = scope === 'document' ? 'I18nTrace 查找' : 'I18nTrace 全局查找';
    input.placeholder = '输入译文或普通关键字，Enter 查找';
    input.value = seed;

    const plainButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('search'),
      tooltip: '按普通文本查找（跳过译文解析）',
    };
    const localeButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('globe'),
      tooltip: '切换反查语种',
    };
    input.buttons = [localeButton, plainButton];

    let done = false;
    const finish = async (mode: 'auto' | 'plain'): Promise<void> => {
      if (done) {
        return;
      }
      done = true;
      const phrase = input.value.trim();
      input.hide();
      if (!phrase) {
        await this.nativeFallback(scope);
        return;
      }
      await this.dispatch(scope, editor, phrase, mode);
    };

    // 本次调用的临时订阅，随输入框关闭一起释放
    const local: vscode.Disposable[] = [];

    // 把「按哪个语种反查」明确写出来：sourceLocale 配置早就存在，但此前不可见，
    // 用户无从确认当前生效的是哪个语种。
    const idlePrompt = (): string => {
      const locale = this.indexManager.resolveSourceLocale();
      const where = scope === 'document' ? '当前文件' : '整个工作区';
      return locale
        ? `按 ${locale} 译文在${where}查找（右上角图标可切换语种）`
        : `尚无可用语种，将按普通文本在${where}查找`;
    };
    input.prompt = idlePrompt();

    const updatePrompt = debounce((value: string) => {
      const q = value.trim();
      if (done || input.value !== value) {
        return;
      }
      if (!q) {
        input.prompt = idlePrompt();
        return;
      }
      const n = this.resolveHitKeys(scope, editor?.document, q).length;
      const action = scope === 'document' ? 'Enter 用正则定位' : 'Enter 在文件中查找';
      input.prompt = n > 0 ? `匹配到 ${n} 个 key（${action}）` : '无译文命中，Enter 走普通查找';
    }, 150);
    local.push({ dispose: () => updatePrompt.cancel() });
    local.push(
      input.onDidTriggerButton((btn) => {
        if (btn === plainButton) {
          void finish('plain');
          return;
        }
        if (btn === localeButton) {
          void this.pickSourceLocale().then((changed) => {
            if (done) {
              return;
            }
            if (changed) {
              // 语种变了，命中数与提示都要重算
              this.hitCache.clear();
            }
            input.prompt = idlePrompt();
            updatePrompt(input.value);
            // QuickPick 会顶掉输入框，选完要重新显示
            input.show();
          });
        }
      }),
      input.onDidAccept(() => void finish('auto')),
      // 实时提示匹配到多少 key（轻量，不做结果列表）
      input.onDidChangeValue((v) => {
        updatePrompt(v);
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

  /** 查找框里的「切换反查语种」，返回是否真的改了。 */
  private async pickSourceLocale(): Promise<boolean> {
    const locales = this.indexManager.index.getLocales();
    if (locales.length === 0) {
      void vscode.window.showInformationMessage('I18nTrace：尚未发现任何语言文件。');
      return false;
    }
    const current = this.indexManager.resolveSourceLocale();
    const picked = await vscode.window.showQuickPick(
      locales.map((l) => ({ label: l, description: l === current ? '当前' : undefined })),
      { title: 'I18nTrace：选择按译文反查使用的语种' },
    );
    if (!picked || picked.label === current) {
      return false;
    }
    await this.config.setSourceLocale(picked.label);
    return true;
  }

  private async dispatch(
    scope: FindScope,
    editor: vscode.TextEditor | undefined,
    phrase: string,
    mode: 'auto' | 'plain',
  ): Promise<void> {
    if (mode === 'plain') {
      await this.nativeFind(scope, phrase, false);
      return;
    }

    const hitKeys = this.resolveHitKeys(scope, editor?.document, phrase);
    if (hitKeys.length === 0) {
      if (scope === 'document') {
        // 译文可能在别的文件里命中，提示可以改用全局查找
        const globalHits = this.indexManager.index.findKeysByTranslation(
          phrase,
          this.indexManager.resolveSourceLocale(),
          1,
        );
        if (globalHits.length > 0) {
          void vscode.window.showInformationMessage(
            `I18nTrace：「${phrase}」对应的 key 不在当前文件，已按普通文本查找。可用 Ctrl+Shift+F 全局查找。`,
          );
        }
      }
      await this.nativeFind(scope, phrase, false);
      return;
    }

    const max = Math.max(1, this.config.value.search.maxKeysPerSearch);
    let keys = hitKeys;
    if (keys.length > max) {
      keys = keys.slice(0, max);
      void vscode.window.showInformationMessage(
        `I18nTrace：命中 ${hitKeys.length} 个 key，仅纳入前 ${max} 个。可缩小搜索词。`,
      );
    } else if (scope === 'workspace') {
      // 搜索结果树不渲染 Inlay Hint，用户只看得到 key；
      // 用一条提示补上「短语 → key」的对应关系，否则无从判断结果属于哪条译文。
      void vscode.window.showInformationMessage(
        `I18nTrace：「${phrase}」→ ${keys.length} 个 key：${keys.join(' / ')}`,
      );
    }

    await this.nativeFind(scope, buildKeyLiteralRegex(keys), true);
  }

  /**
   * 短语 → 用于构造正则的 key 列表。
   *
   * - workspace：索引里译文匹配的全部规范 key，原样返回（不与任何文档取交集）。
   * - document：再与当前文件里真实出现的调用取交集，返回代码里的字面量写法。
   */
  private resolveHitKeys(
    scope: FindScope,
    document: vscode.TextDocument | undefined,
    phrase: string,
  ): string[] {
    const cacheKey = [
      scope,
      document ? document.uri.toString() : '',
      document ? String(document.version) : '',
      this.indexManager.resolveSourceLocale() ?? '',
      phrase,
    ].join(' ');
    const cached = this.hitCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const matched = this.indexManager.index.findKeysByTranslation(
      phrase,
      this.indexManager.resolveSourceLocale(),
    );
    if (matched.length === 0) {
      return this.cache(cacheKey, []);
    }
    if (scope === 'workspace') {
      return this.cache(cacheKey, matched.map(toSearchableKey));
    }

    const matchedKeys = new Set(matched);
    const adapter = document ? this.adapters.forDocument(document) : undefined;
    if (!document || !adapter) {
      // 非代码文件：无法定位调用，交给普通查找
      return this.cache(cacheKey, []);
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
      // call.key 是代码里的字面量（可能带前缀 / 是扁平 key）；解析成索引真实 key 再比对，
      // 但返回的仍是字面量本身，供 buildKeyLiteralRegex 在源码里精确定位。
      const resolved = this.indexManager.index.resolveKey(call.key, call.namespace) ?? call.key;
      if (matchedKeys.has(resolved) && !seen.has(call.key)) {
        seen.add(call.key);
        result.push(call.key);
      }
    }
    return this.cache(cacheKey, result);
  }

  private cache(cacheKey: string, value: string[]): string[] {
    // 使用有上限的简单 FIFO，避免长时间编辑时缓存无限增长。
    if (this.hitCache.size >= 100) {
      const first = this.hitCache.keys().next().value;
      if (first) {
        this.hitCache.delete(first);
      }
    }
    this.hitCache.set(cacheKey, value);
    return value;
  }

  /** 不带查询词地打开对应的原生查找 UI。 */
  private async nativeFallback(scope: FindScope): Promise<void> {
    await vscode.commands.executeCommand(
      scope === 'document' ? 'actions.find' : 'workbench.action.findInFiles',
    );
  }

  private async nativeFind(scope: FindScope, searchString: string, isRegex: boolean): Promise<void> {
    if (scope === 'document') {
      await vscode.commands.executeCommand('editor.actions.findWithArgs', {
        searchString,
        isRegex,
      });
      return;
    }
    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      query: searchString,
      isRegex,
      triggerSearch: true,
      // 只在按译文反查（isRegex）时排除语言文件；普通文本查找时用户可能就是想搜语言包
      filesToExclude:
        isRegex && this.config.value.search.excludeLocaleFiles
          ? this.indexManager.buildLocaleExcludeGlob()
          : '',
    });
  }
}

/**
 * 规范 key → 源码里可能出现的字面量。
 *
 * 索引里带命名空间的 key 形如 `common:save`，但源码中通常写作 `t('save')`
 * 或 `t('common:save')`；冒号左边那段是索引内部加的。全局查找无法像当前文件版
 * 那样反查实际调用写法，这里取冒号右侧作为搜索用字面量 —— 宁可多匹配到同名 key，
 * 也不要因为命名空间前缀而一条都搜不到。
 */
export function toSearchableKey(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? key : key.slice(idx + 1);
}

/**
 * 构造匹配一组 key「被引号包裹的字面量」的正则，与调用形式无关：
 *   ['"`](?:user\.name|user\.deleteSuccess)['"`]
 */
export function buildKeyLiteralRegex(keys: string[]): string {
  const alt = [...new Set(keys)].map((k) => escapeRegExp(k)).join('|');
  return `['"\`](?:${alt})['"\`]`;
}
