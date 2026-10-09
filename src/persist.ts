import * as fs from "fs";
import * as vscode from "vscode";
import { DEFAULT_HEADER_TOOLS, DEFAULT_TARGET_BRANCHES, ensureMtDeploy, HeaderTools, mtHistoryPath, saveMtTools, toolsFromConfig } from "./mtdeploy";

const STORE_KEY = "masturbo.repoSelections";
export { DEFAULT_HEADER_TOOLS, DEFAULT_TARGET_BRANCHES, HeaderTools };

export function loadHeaderTools(repoPath?: string): HeaderTools {
  if (!repoPath) {
    return { ...DEFAULT_HEADER_TOOLS };
  }
  return toolsFromConfig(ensureMtDeploy(repoPath));
}

export async function loadHeaderToolsAsync(repoPath?: string): Promise<HeaderTools> {
  return loadHeaderTools(repoPath);
}

export async function saveHeaderTools(repoPath: string | undefined, tools: HeaderTools): Promise<void> {
  if (!repoPath) {
    return;
  }
  saveMtTools(repoPath, tools);
}

export interface RepoSelection {
  releaseNotes?: string;
}

export function defaultSource(branches: string[], saved?: string): string {
  if (saved && branches.includes(saved)) {
    return saved;
  }
  if (branches.includes("develop")) {
    return "develop";
  }
  if (branches.includes("dev")) {
    return "dev";
  }
  return branches[0] || "develop";
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
  githubUrl?: string;
  author?: string;
  githubTitle?: string;
  githubBody?: string;
}

export function loadHistory(context: vscode.ExtensionContext, repoPath?: string): DeployRecord[] {
  if (!repoPath) {
    return [];
  }
  ensureMtDeploy(repoPath);
  const fromFile = readHistoryFile(repoPath);
  if (fromFile.length) {
    return fromFile;
  }
  const migrated = context.globalState.get<DeployRecord[]>(HISTORY_KEY, []).filter((record) => record.repoPath === repoPath);
  if (migrated.length) {
    writeHistoryFile(repoPath, migrated);
  }
  return migrated;
}

export async function saveDeploy(context: vscode.ExtensionContext, record: DeployRecord): Promise<void> {
  const current = loadHistory(context, record.repoPath).filter((item) => item.id !== record.id);
  writeHistoryFile(record.repoPath, capHistory([record, ...current]));
}

export function writeHistoryFile(repoPath: string, records: DeployRecord[]): void {
  ensureMtDeploy(repoPath);
  fs.writeFileSync(mtHistoryPath(repoPath), `${JSON.stringify({ version: 1, records: capHistory(records) }, null, 2)}\n`, "utf8");
}

function readHistoryFile(repoPath: string): DeployRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(mtHistoryPath(repoPath), "utf8"));
    const rows = Array.isArray(raw) ? raw : raw?.records;
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.filter((item) => item && typeof item === "object" && typeof item.tag === "string");
  } catch {
    return [];
  }
}

function isLocalOnly(record: DeployRecord): boolean {
  return record.dryRun === true || record.ok === false;
}

function capHistory(records: DeployRecord[]): DeployRecord[] {
  const shared = records.filter((record) => !isLocalOnly(record));
  const localOnly = records.filter(isLocalOnly).slice(0, HISTORY_LIMIT);
  return [...shared, ...localOnly].sort((a, b) => (b.at || 0) - (a.at || 0));
}

