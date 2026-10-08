import * as vscode from "vscode";

const STORE_KEY = "masturbo.repoSelections";
export const DEFAULT_TARGET_BRANCHES = ["develop", "unstable", "staging"];

export interface RepoSelection {
  mergeBranches: string[];
  targetBranches: string[];
}

export function loadSelection(context: vscode.ExtensionContext, repoPath: string): RepoSelection | undefined {
  const all = context.globalState.get<Record<string, RepoSelection>>(STORE_KEY, {});
  return all[repoPath];
}

export async function saveSelection(
  context: vscode.ExtensionContext,
  repoPath: string,
  selection: RepoSelection
): Promise<void> {
  const all = { ...context.globalState.get<Record<string, RepoSelection>>(STORE_KEY, {}) };
  all[repoPath] = selection;
  await context.globalState.update(STORE_KEY, all);
}

export function defaultTargets(branches: string[]): string[] {
  const names = new Set(branches);
  return DEFAULT_TARGET_BRANCHES.filter((name) => names.has(name));
}

export function keepExisting(saved: string[] | undefined, branches: string[]): string[] {
  if (!saved) {
    return [];
  }
  const names = new Set(branches);
  return saved.filter((name) => names.has(name));
}
