import * as vscode from "vscode";
import { GitRepo } from "./git";
import { findWorkspaceRepos } from "./repos";
import { runRelease } from "./release";
import { latestVersion, readPackageVersion } from "./version";
import { defaultTargets, keepExisting, loadSelection, saveSelection } from "./persist";

type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "selectRepo"; path: string }
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
    this.panel.reveal();
    if (selectedRepo) {
      this.selectedRepo = selectedRepo;
      void this.sendRepos();
    }
  }

  private async handle(message: WebviewMessage): Promise<void> {
    if (message.type === "ready" || message.type === "refresh") {
      await this.sendRepos();
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
        error: "nessun repository git trovato nel workspace",
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
      },
      (level, text) => {
        void this.panel.webview.postMessage({ type: "log", level, message: text });
      }
    );
    await this.panel.webview.postMessage({ type: "done", ok: result.ok });
    if (result.ok) {
      void vscode.window.showInformationMessage(
        `Release ${result.tag} completata su ${result.productionBranch}`
      );
    } else {
      void vscode.window.showErrorMessage("Release interrotta. Controlla il log nel wizard.");
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"));
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png"));
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="it">
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
            <label class="toggle"><input id="reuse" type="checkbox" /><span>Riusa release</span></label>
            <label class="toggle"><input id="dryRun" type="checkbox" checked /><span>Dry-run</span></label>
            <label class="toggle"><input id="deleteMerged" type="checkbox" checked /><span>Elimina branch mergiati</span></label>
            <label class="toggle"><input id="deleteRelease" type="checkbox" checked /><span>Elimina branch release</span></label>
          </div>
        </div>
        <main>
          <section id="step-repo" class="block card">
            <div class="block-head">
              <span class="step">1</span>
              <div>
                <h2>Repository</h2>
                <p>Scegli il git repo del workspace.</p>
              </div>
              <button id="refresh" type="button" class="ghost">Aggiorna repo</button>
            </div>
            <select id="repo" class="chip-select"></select>
            <div id="repoMeta" class="pills"></div>
          </section>
          <section id="step-version" class="block card">
            <div class="block-head">
              <span class="step">2</span>
              <div>
                <h2>Versione</h2>
                <p>Partenza a sinistra, destinazione a destra.</p>
              </div>
            </div>
            <div class="version-row">
              <div class="version-box">
                <span class="version-label">Provenienza</span>
                <strong id="fromVersion">—</strong>
              </div>
              <div class="version-arrow" aria-hidden="true">→</div>
              <label class="version-box input">
                <span class="version-label">Nuova versione</span>
                <input id="version" type="text" placeholder="x.y.z" autocomplete="off" />
              </label>
            </div>
            <p id="versionHint" class="hint">La nuova versione diventa branch release, bump su package.json e tag git.</p>
          </section>
          <section id="step-merge" class="block card">
            <div class="block-head">
              <span class="step">3</span>
              <div>
                <h2>Merge sulla release</h2>
                <p>Oltre a develop, già usato come base.</p>
              </div>
              <div class="tree-actions">
                <button type="button" class="ghost" data-tree="mergeBranches" data-collapse="true">Comprimi tutti</button>
                <button type="button" class="ghost" data-tree="mergeBranches" data-collapse="false">Espandi tutti</button>
              </div>
            </div>
            <label class="search-wrap">
              <span class="search-icon" aria-hidden="true"></span>
              <input id="mergeSearch" class="search" type="search" placeholder="Cerca branch..." autocomplete="off" />
            </label>
            <div id="mergeSelected" class="selected-badges"></div>
            <div id="mergeBranches" class="checks"></div>
            <p id="mergeEmpty" class="empty hidden">Nessun branch corrisponde alla ricerca.</p>
          </section>
          <section id="step-tag" class="block card">
            <div class="block-head">
              <span class="step">4</span>
              <div>
                <h2>Branch che ricevono il tag</h2>
                <p>git pull && git merge &lt;tag&gt; --no-ff && git push</p>
              </div>
              <div class="tree-actions">
                <button type="button" class="ghost" data-tree="targetBranches" data-collapse="true">Comprimi tutti</button>
                <button type="button" class="ghost" data-tree="targetBranches" data-collapse="false">Espandi tutti</button>
              </div>
            </div>
            <label class="search-wrap">
              <span class="search-icon" aria-hidden="true"></span>
              <input id="targetSearch" class="search" type="search" placeholder="Cerca branch..." autocomplete="off" />
            </label>
            <div id="targetSelected" class="selected-badges"></div>
            <div id="targetBranches" class="checks"></div>
            <p id="targetEmpty" class="empty hidden">Nessun branch corrisponde alla ricerca.</p>
          </section>
          <section id="step-log" class="block card">
            <div class="block-head">
              <span class="step">5</span>
              <div>
                <h2>Log</h2>
                <p>Output dei comandi git.</p>
              </div>
            </div>
            <pre id="log"></pre>
          </section>
          <div class="form-end">
            <button id="start" type="button" class="primary">Avvia release</button>
          </div>
        </main>
      </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
