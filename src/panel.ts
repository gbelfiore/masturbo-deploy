import * as vscode from "vscode";
import { GitRepo } from "./git";
import { findWorkspaceRepos } from "./repos";
import { ConflictInfo, runRelease, runResumeTagMerge } from "./release";
import { latestVersion, readPackageVersion } from "./version";
import { defaultSource, defaultTargets, DeployRecord, HeaderTools, keepExisting, loadHeaderTools, loadHeaderToolsAsync, loadHistory, loadSelection, saveDeploy, saveHeaderTools, saveSelection } from "./persist";
import * as path from "path";
import { LOCALES, Locale, isLocale, loadLocale, MESSAGES, saveLocale, t } from "./i18n";

type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh"; repoPath?: string }
  | { type: "selectRepo"; path: string }
  | { type: "setLanguage"; locale: string }
  | { type: "saveHeaderTools"; tools: HeaderTools }
  | {
      type: "saveSelection";
      repoPath: string;
      mergeBranches: string[];
      targetBranches: string[];
      sourceBranch: string;
    }
  | {
      type: "start";
      repoPath: string;
      version: string;
      mergeBranches: string[];
      targetBranches: string[];
      sourceBranch: string;
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

  static show(context: vscode.ExtensionContext, selectedRepo?: string): void {
    if (ReleasePanel.current) {
      ReleasePanel.current.reveal(selectedRepo);
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
    ReleasePanel.current = new ReleasePanel(panel, context, selectedRepo);
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

  reveal(selectedRepo?: string): void {
    this.selectedRepo = selectedRepo;
    this.panel.reveal();
    this.panel.webview.html = this.html();
  }

  private async handle(message: WebviewMessage): Promise<void> {
    if (message.type === "ready") {
      await this.sendI18n();
      await this.sendHeaderTools();
      await this.sendHistory();
      await this.sendRepos();
      return;
    }
    if (message.type === "refresh") {
      this.selectedRepo = message.repoPath || this.selectedRepo;
      this.panel.webview.html = this.html();
      return;
    }
    if (message.type === "saveHeaderTools") {
      await saveHeaderTools(this.context, {
        reuseRelease: message.tools?.reuseRelease === true,
        dryRun: message.tools?.dryRun === true,
        deleteMerged: message.tools?.deleteMerged === true,
        deleteRelease: message.tools?.deleteRelease === true,
      });
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
        sourceBranch: message.sourceBranch,
      });
      return;
    }
    if (message.type === "start") {
      await saveHeaderTools(this.context, {
        reuseRelease: message.reuseReleaseBranch === true,
        dryRun: message.dryRun === true,
        deleteMerged: message.deleteMergedBranches === true,
        deleteRelease: message.deleteReleaseBranch === true,
      });
      await saveSelection(this.context, message.repoPath, {
        mergeBranches: message.mergeBranches,
        targetBranches: message.targetBranches,
        sourceBranch: message.sourceBranch,
      });
      await this.start(message);
      return;
    }
    if (message.type === "resumeTag") {
      const current = loadHeaderTools(this.context);
      await saveHeaderTools(this.context, { ...current, dryRun: message.dryRun === true });
      const saved = loadSelection(this.context, message.repoPath);
      await saveSelection(this.context, message.repoPath, {
        mergeBranches: saved?.mergeBranches ?? [],
        targetBranches: message.targetBranches,
        sourceBranch: saved?.sourceBranch,
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
        savedSource: defaultSource(branches, saved?.sourceBranch),
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
        sourceBranch: message.sourceBranch,
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
    await this.storeDeploy("release", message.repoPath, message.version, message.mergeBranches, message.targetBranches, message.dryRun, result);
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
    await this.storeDeploy("resume", message.repoPath, message.version, [], message.targetBranches, message.dryRun, result);
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

  private async storeDeploy(
    kind: DeployRecord["kind"],
    repoPath: string,
    version: string,
    originBranches: string[],
    targetBranches: string[],
    dryRun: boolean,
    result: { ok: boolean; tag: string; logs: { level: "info" | "ok" | "warn" | "error"; message: string }[]; conflict?: ConflictInfo }
  ): Promise<void> {
    await saveDeploy(this.context, {
      id: `${Date.now()}-${version}`,
      at: Date.now(),
      kind,
      repoName: path.basename(repoPath),
      repoPath,
      tag: result.tag || version,
      originBranches,
      targetBranches,
      dryRun,
      ok: result.ok,
      logs: result.logs,
      conflictBranch: result.conflict?.branch,
      conflictFiles: result.conflict?.files,
    });
    await this.sendHistory();
  }

  private async sendHistory(): Promise<void> {
    await this.panel.webview.postMessage({ type: "history", records: loadHistory(this.context) });
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
      tools: await loadHeaderToolsAsync(this.context),
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
            <nav class="page-nav">
              <button type="button" id="navRelease" class="nav-btn is-active" data-i18n="navRelease">Release</button>
              <button type="button" id="navHistory" class="nav-btn" data-i18n="navHistory">History</button>
            </nav>
            <button type="button" id="refreshAll" class="ghost header-refresh" data-i18n="refreshAll">Refresh</button>
            <label class="lang-wrap">
              <select id="lang" class="lang-select" aria-label="Language">${langOptions}</select>
            </label>
          </div>
        </div>
        <div id="page-release">
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
          <section id="step-source" class="block card">
            <div class="block-head">
              <span class="step">4</span>
              <div>
                <h2 data-i18n="sourceTitle">Release start branch</h2>
                <p data-i18n="sourceHelp">The release is created from this branch. Develop is preselected when present.</p>
              </div>
            </div>
            <select id="sourceBranch" class="chip-select"></select>
          </section>
          <section id="step-merge" class="block card">
            <div class="block-head">
              <span class="step">5</span>
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
              <span class="step">6</span>
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
              <span class="step">7</span>
              <div>
                <h2 data-i18n="log">Log</h2>
                <p data-i18n="logHelp">Git command output.</p>
              </div>
            </div>
            <div id="log" class="log-view"></div>
          </section>
          <div class="form-end">
            <button id="resumeTag" type="button" class="secondary" data-i18n="resumeMergeTag">Resume merge tag</button>
            <button id="start" type="button" class="primary" data-i18n="startRelease">Start release</button>
          </div>
        </main>
        </div>
        <div id="page-history" class="hidden">
          <section class="block card">
            <div class="block-head">
              <span class="step">1</span>
              <div>
                <h2 data-i18n="historyTitle">Deploy history</h2>
                <p data-i18n="historyHelp">Saved deploys with tag, origin branches, destination branches and log.</p>
              </div>
            </div>
            <p id="historyEmpty" class="empty" data-i18n="historyEmpty">No deploys yet.</p>
            <div id="historyList" class="history-list"></div>
          </section>
          <section id="historyDetail" class="block card hidden">
            <div class="block-head">
              <span class="step">2</span>
              <div>
                <h2 id="historyDetailTitle">—</h2>
                <p id="historyDetailMeta"></p>
              </div>
            </div>
            <div id="historyMeta" class="history-meta"></div>
            <div id="historyLog" class="log-view"></div>
          </section>
        </div>
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
