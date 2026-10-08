import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface WorkspaceRepo {
  name: string;
  path: string;
}

export function findWorkspaceRepos(): WorkspaceRepo[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const found = new Map<string, WorkspaceRepo>();

  for (const folder of folders) {
    collectRepo(folder.uri.fsPath, folder.name, found);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(folder.uri.fsPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      collectRepo(path.join(folder.uri.fsPath, entry.name), entry.name, found);
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectRepo(dir: string, name: string, found: Map<string, WorkspaceRepo>): void {
  if (found.has(dir)) {
    return;
  }
  if (fs.existsSync(path.join(dir, ".git"))) {
    found.set(dir, { name, path: dir });
  }
}

export class RepoItem extends vscode.TreeItem {
  constructor(public readonly repo: WorkspaceRepo) {
    super(repo.name, vscode.TreeItemCollapsibleState.None);
    this.description = repo.path;
    this.tooltip = repo.path;
    this.contextValue = "repo";
    this.iconPath = new vscode.ThemeIcon("repo");
    this.command = {
      command: "releaseDeploy.open",
      title: "Open wizard",
      arguments: [repo.path],
    };
  }
}

export class RepoTreeProvider implements vscode.TreeDataProvider<RepoItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: RepoItem): vscode.TreeItem {
    return element;
  }

  getChildren(): RepoItem[] {
    return findWorkspaceRepos().map((repo) => new RepoItem(repo));
  }
}
