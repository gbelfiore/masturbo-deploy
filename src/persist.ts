import * as vscode from "vscode";

const STORE_KEY = "masturbo.repoSelections";
const TOOLS_KEY = "masturbo.headerTools";
export const DEFAULT_TARGET_BRANCHES = ["develop", "unstable", "staging"];

export interface HeaderTools {
  reuseRelease: boolean;
  dryRun: boolean;
  deleteMerged: boolean;
  deleteRelease: boolean;
}

export const DEFAULT_HEADER_TOOLS: HeaderTools = {
  reuseRelease: false,
  dryRun: true,
  deleteMerged: true,
  deleteRelease: true,
};

export function loadHeaderTools(context: vscode.ExtensionContext): HeaderTools {
  const saved = context.globalState.get<Partial<HeaderTools>>(TOOLS_KEY, {});
  return { ...DEFAULT_HEADER_TOOLS, ...saved };
}

export async function saveHeaderTools(context: vscode.ExtensionContext, tools: HeaderTools): Promise<void> {
  await context.globalState.update(TOOLS_KEY, tools);
}

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

const HISTORY_KEY = "masturbo.deployHistory";
const HISTORY_LIMIT = 80;

export interface DeployLogLine {
  level: "info" | "ok" | "warn" | "error";
  message: string;
}

export interface DeployRecord {
  id: string;
  at: number;
  kind: "release" | "resume";
  repoName: string;
  repoPath: string;
  tag: string;
  originBranches: string[];
  targetBranches: string[];
  dryRun: boolean;
  ok: boolean;
  logs: DeployLogLine[];
  conflictBranch?: string;
  conflictFiles?: string[];
}

export function loadHistory(context: vscode.ExtensionContext): DeployRecord[] {
  return context.globalState.get<DeployRecord[]>(HISTORY_KEY, []);
}

export async function saveDeploy(context: vscode.ExtensionContext, record: DeployRecord): Promise<void> {
  const all = [record, ...loadHistory(context)].slice(0, HISTORY_LIMIT);
  await context.globalState.update(HISTORY_KEY, all);
}
