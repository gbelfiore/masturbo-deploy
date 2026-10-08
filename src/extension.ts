import * as vscode from "vscode";
import { ReleasePanel } from "./panel";
import { RepoTreeProvider } from "./repos";

export function activate(context: vscode.ExtensionContext): void {
  const repos = new RepoTreeProvider();
  const tree = vscode.window.createTreeView("releaseDeploy.repos", {
    treeDataProvider: repos,
  });
  context.subscriptions.push(
    tree,
    tree.onDidChangeSelection((event) => {
      const picked = event.selection[0];
      if (picked) {
        ReleasePanel.show(context, picked.repo.path);
      }
    }),
    vscode.commands.registerCommand("releaseDeploy.open", (repoPath?: string) => {
      ReleasePanel.show(context, typeof repoPath === "string" ? repoPath : undefined);
    }),
    vscode.commands.registerCommand("releaseDeploy.refreshRepos", () => repos.refresh())
  );
}

export function deactivate(): void {}
