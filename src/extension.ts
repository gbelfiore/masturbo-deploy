import * as vscode from "vscode";
import { ReleasePanel } from "./panel";
import { RepoTreeProvider } from "./repos";

export function activate(context: vscode.ExtensionContext): void {
  const repos = new RepoTreeProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("releaseDeploy.repos", {
      treeDataProvider: repos,
    }),
    vscode.commands.registerCommand("releaseDeploy.open", (repoPath?: string) => {
      ReleasePanel.show(context, typeof repoPath === "string" ? repoPath : undefined);
    }),
    vscode.commands.registerCommand("releaseDeploy.refreshRepos", () => repos.refresh())
  );
}

export function deactivate(): void {}
