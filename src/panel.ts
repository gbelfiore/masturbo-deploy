import * as vscode from "vscode";
import { GitRepo } from "./git";
import { findWorkspaceRepos } from "./repos";
import { ConflictInfo, runRelease, runResumeTagMerge } from "./release";
import { latestVersion, readPackageVersion } from "./version";
import { defaultTargets, HeaderTools, keepExisting, loadHeaderTools, loadSelection, saveHeaderTools, saveSelection } from "./persist";
import { LOCALES, Locale, isLocale, loadLocale, MESSAGES, saveLocale, t } from "./i18n";

type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "selectRepo"; path: string }
  | { type: "setLanguage"; locale: string }
  | { type: "saveHeaderTools"; tools: HeaderTools }
  | {
      type: "saveSelection";
      repoPath: string;
      mergeBranches: string[];
      targetBranches: string[];
    }
  | {
      type: "start";
      repoPath: string;
      version: string;
      mergeBranches: string[];
      targetBranches: string[];
      reuseReleaseBranch: boolean;
      dryRun: boolean;
      deleteMergedBranches: boolean;
      deleteReleaseBranch: boolean;
    }
  | {
      type: "resumeTag";
      repoPath: string;
      version: string;
      targetBranches: string[];
      dryRun: boolean;
    };

export class ReleasePanel {
  static current: ReleasePanel | undefined;

  static show(context: vscode.ExtensionContext): void {
    if (ReleasePanel.current) {
      ReleasePanel.current.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "releaseDeploy",
      "MasTurbo Deploy",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );
    ReleasePanel.current = new ReleasePanel(panel, context);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private selectedRepo?: string
  ) {
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png");
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => {
      ReleasePanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handle(message);
    });
  }

  reveal(): void {
    this.panel.reveal();
    this.selectedRepo = undefined;
    void this.sendI18n()
      .then(() => this.sendHeaderTools())
      .then(() => this.sendRepos());
  }

  private async handle(message: WebviewMessage): Promise<void> {
    if (message.type === "ready") {
      this.selectedRepo = undefined;
      await this.sendI18n();
      await this.sendHeaderTools();
      await this.sendRepos();
      return;
    }
    if (message.type === "refresh") {
      await this.sendI18n();
      await this.sendHeaderTools();
      await this.sendRepos();
      return;
    }
    if (message.type === "saveHeaderTools") {
      await saveHeaderTools(this.context, message.tools);
      return;
    }
    if (message.type === "setLanguage" && isLocale(message.locale)) {
      await saveLocale(this.context, message.locale);
      await this.sendI18n();
      return;
    }
    if (message.type === "selectRepo") {
      this.selectedRepo = message.path;
      await this.sendRepoState(message.path);
      return;
    }
    if (message.type === "saveSelection") {
      await saveSelection(this.context, message.repoPath, {
        mergeBranches: message.mergeBranches,
        targetBranches: message.targetBranches,
      });
      return;
    }
    if (message.type === "start") {
      await saveSelection(this.context, message.repoPath, {
        mergeBranches: message.mergeBranches,
        targetBranches: message.targetBranches,
      });
      await this.start(message);
      return;
    }
    if (message.type === "resumeTag") {
      const saved = loadSelection(this.context, message.repoPath);
      await saveSelection(this.context, message.repoPath, {
        mergeBranches: saved?.mergeBranches ?? [],
        targetBranches: message.targetBranches,
      });
      await this.resumeTag(message);
    }
  }

  private async sendRepos(): Promise<void> {
    const repos = findWorkspaceRepos();
    const selected = this.selectedRepo && repos.some((repo) => repo.path === this.selectedRepo)
      ? this.selectedRepo
      : repos[0]?.path;
    this.selectedRepo = selected;
    await this.panel.webview.postMessage({ type: "repos", repos, selected });
    if (selected) {
      await this.sendRepoState(selected);
    } else {
      await this.panel.webview.postMessage({
        type: "repoState",
        error: t(loadLocale(this.context), "noGitRepo"),
      });
    }
  }

  private async sendRepoState(repoPath: string): Promise<void> {
    try {
      const git = new GitRepo(repoPath);
      await git.fetch().catch(() => undefined);
      const [branches, current, source, production, dirty, tagVersion] = await Promise.all([
        git.branches(),
        git.currentBranch(),
        git.sourceBranch(),
        git.productionBranch(),
        git.isDirty(),
        git.latestVersionTag(),
      ]);
      const currentVersion = latestVersion(readPackageVersion(repoPath), tagVersion);
      const saved = loadSelection(this.context, repoPath);
      await this.panel.webview.postMessage({
        type: "repoState",
        branches,
        current,
        source,
        production,
        dirty,
        currentVersion,
        savedMerge: keepExisting(saved?.mergeBranches, branches),
        savedTargets: saved ? keepExisting(saved.targetBranches, branches) : defaultTargets(branches),
      });
    } catch (error) {
      await this.panel.webview.postMessage({
        type: "repoState",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async start(message: Extract<WebviewMessage, { type: "start" }>): Promise<void> {
    const result = await runRelease(
      {
        repoPath: message.repoPath,
        version: message.version,
        mergeBranches: message.mergeBranches,
        targetBranches: message.targetBranches,
        reuseReleaseBranch: message.reuseReleaseBranch,
        dryRun: message.dryRun,
        deleteMergedBranches: message.deleteMergedBranches,
        deleteReleaseBranch: message.deleteReleaseBranch,
        locale: loadLocale(this.context),
      },
      (level, text) => {
        void this.panel.webview.postMessage({ type: "log", level, message: text });
      }
    );
    await this.panel.webview.postMessage({ type: "done", ok: result.ok });
    const locale = loadLocale(this.context);
    if (result.conflict) {
      await showConflictDialog(locale, result.conflict);
      return;
    }
    if (result.ok) {
      void vscode.window.showInformationMessage(
        t(locale, "releaseCompleted", { tag: result.tag, branch: result.productionBranch })
      );
    } else {
      void vscode.window.showErrorMessage(t(locale, "releaseStopped"));
    }
  }

  private async resumeTag(message: Extract<WebviewMessage, { type: "resumeTag" }>): Promise<void> {
    const result = await runResumeTagMerge(
      {
        repoPath: message.repoPath,
        version: message.version,
        targetBranches: message.targetBranches,
        dryRun: message.dryRun,
        locale: loadLocale(this.context),
      },
      (level, text) => {
        void this.panel.webview.postMessage({ type: "log", level, message: text });
      }
    );
    await this.panel.webview.postMessage({ type: "done", ok: result.ok });
    const locale = loadLocale(this.context);
    if (result.conflict) {
      await showConflictDialog(locale, result.conflict);
      return;
    }
    if (result.ok) {
      void vscode.window.showInformationMessage(t(locale, "resumeMergeDone", { tag: result.tag }));
    } else {
      void vscode.window.showErrorMessage(t(locale, "resumeMergeStopped"));
    }
  }

  private async sendI18n(): Promise<void> {
    const locale = loadLocale(this.context);
    await this.panel.webview.postMessage({
      type: "i18n",
      locale,
      messages: MESSAGES[locale],
    });
  }

  private async sendHeaderTools(): Promise<void> {
    await this.panel.webview.postMessage({
      type: "headerTools",
      tools: loadHeaderTools(this.context),
    });
  }

  private html(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"));
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png"));
    const nonce = String(Date.now());
    const locale = loadLocale(this.context);
    const tools = loadHeaderTools(this.context);
    const langOptions = LOCALES.map(
      (item) => `<option value="${item.id}"${item.id === locale ? " selected" : ""}>${item.label}</option>`
    ).join("");
    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>MasTurbo Deploy</title>
</head>
<body>
  <div class="app">
    <div class="workspace">
        <div class="workspace-head">
          <div class="brand">
            <img class="logo" src="${iconUri}" alt="" />
            <h1>MasTurbo Deploy</h1>
          </div>
          <div class="workspace-tools">
            <label class="lang-wrap">
              <select id="lang" class="lang-select" aria-label="Language">${langOptions}</select>
            </label>
          </div>
        </div>
        <main>
          <section id="step-options" class="block card">
            <div class="block-head">
              <span class="step">1</span>
              <div>
                <h2 data-i18n="options">Options</h2>
                <p data-i18n="optionsHelp">These choices are remembered for the next openings.</p>
              </div>
            </div>
            <div class="tools-list">
              <label class="toggle"><input id="reuse" type="checkbox"${tools.reuseRelease ? " checked" : ""} /><span data-i18n="reuseRelease">Reuse release</span></label>
              <label class="toggle"><input id="dryRun" type="checkbox"${tools.dryRun ? " checked" : ""} /><span data-i18n="dryRun">Dry-run</span></label>
              <label class="toggle"><input id="deleteMerged" type="checkbox"${tools.deleteMerged ? " checked" : ""} /><span data-i18n="deleteMerged">Delete merged branches</span></label>
              <label class="toggle"><input id="deleteRelease" type="checkbox"${tools.deleteRelease ? " checked" : ""} /><span data-i18n="deleteRelease">Delete release branch</span></label>
            </div>
          </section>
          <section id="step-repo" class="block card">
            <div class="block-head">
              <span class="step">2</span>
              <div>
                <h2 data-i18n="repository">Repository</h2>
                <p data-i18n="pickRepo">Pick a git repo from the workspace.</p>
              </div>
              <button id="refresh" type="button" class="ghost" data-i18n="refreshRepos">Refresh repos</button>
            </div>
            <select id="repo" class="chip-select"></select>
            <div id="repoMeta" class="pills"></div>
          </section>
          <section id="step-version" class="block card">
            <div class="block-head">
              <span class="step">3</span>
              <div>
                <h2 data-i18n="version">Version</h2>
                <p data-i18n="versionHelp">Current version on the left, new version on the right.</p>
              </div>
            </div>
            <div class="version-row">
              <div class="version-box">
                <span class="version-label" data-i18n="current">Current</span>
                <strong id="fromVersion">—</strong>
              </div>
              <div class="version-arrow" aria-hidden="true">→</div>
              <label class="version-box input">
                <span class="version-label" data-i18n="newVersion">New version</span>
                <input id="version" type="text" placeholder="x.y.z" autocomplete="off" />
              </label>
            </div>
            <p id="versionHint" class="hint"></p>
          </section>
          <section id="step-merge" class="block card">
            <div class="block-head">
              <span class="step">4</span>
              <div>
                <h2 data-i18n="mergeTitle">Merge into release</h2>
                <p data-i18n="mergeHelp">On top of develop, already used as the base.</p>
              </div>
              <div class="tree-actions">
                <button type="button" class="ghost" data-tree="mergeBranches" data-collapse="true" data-i18n="collapseAll">Collapse all</button>
                <button type="button" class="ghost" data-tree="mergeBranches" data-collapse="false" data-i18n="expandAll">Expand all</button>
              </div>
            </div>
            <label class="search-wrap">
              <span class="search-icon" aria-hidden="true"></span>
              <input id="mergeSearch" class="search" type="search" data-i18n-placeholder="searchBranches" placeholder="Search branches..." autocomplete="off" />
            </label>
            <div id="mergeSelected" class="selected-badges"></div>
            <div id="mergeBranches" class="checks"></div>
            <p id="mergeEmpty" class="empty hidden" data-i18n="noBranchMatch">No branch matches the search.</p>
          </section>
          <section id="step-tag" class="block card">
            <div class="block-head">
              <span class="step">5</span>
              <div>
                <h2 data-i18n="tagTitle">Branches that receive the tag</h2>
                <p data-i18n="tagHelp">git pull && git merge &lt;tag&gt; --no-ff && git push</p>
              </div>
              <div class="tree-actions">
                <button type="button" class="ghost" data-tree="targetBranches" data-collapse="true" data-i18n="collapseAll">Collapse all</button>
                <button type="button" class="ghost" data-tree="targetBranches" data-collapse="false" data-i18n="expandAll">Expand all</button>
              </div>
            </div>
            <label class="search-wrap">
              <span class="search-icon" aria-hidden="true"></span>
              <input id="targetSearch" class="search" type="search" data-i18n-placeholder="searchBranches" placeholder="Search branches..." autocomplete="off" />
            </label>
            <div id="targetSelected" class="selected-badges"></div>
            <div id="targetBranches" class="checks"></div>
            <p id="targetEmpty" class="empty hidden" data-i18n="noBranchMatch">No branch matches the search.</p>
          </section>
          <section id="step-log" class="block card">
            <div class="block-head">
              <span class="step">6</span>
              <div>
                <h2 data-i18n="log">Log</h2>
                <p data-i18n="logHelp">Git command output.</p>
              </div>
            </div>
            <pre id="log"></pre>
          </section>
          <div class="form-end">
            <button id="resumeTag" type="button" class="secondary" data-i18n="resumeMergeTag">Resume merge tag</button>
            <button id="start" type="button" class="primary" data-i18n="startRelease">Start release</button>
          </div>
        </main>
      </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

async function showConflictDialog(locale: Locale, conflict: ConflictInfo): Promise<void> {
  const files = conflict.files.length ? conflict.files.join("\n") : "-";
  await vscode.window.showWarningMessage(
    t(locale, "conflictWarning", { tag: conflict.tag, branch: conflict.branch, files }),
    { modal: true }
  );
}
