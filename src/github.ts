import * as vscode from "vscode";
import { GitRepo } from "./git";
import { DeployLogLine, DeployRecord } from "./persist";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubRelease {
  id: number;
  tag: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: number;
  draft: boolean;
}

export interface HistoryViewRecord {
  id: string;
  tag: string;
  at: number;
  repoName: string;
  githubUrl?: string;
  githubTitle?: string;
  githubBody?: string;
  hasLocal: boolean;
  originBranches?: string[];
  targetBranches?: string[];
  dryRun?: boolean;
  ok?: boolean;
  kind?: "release" | "resume";
  logs?: DeployLogLine[];
  conflictBranch?: string;
  conflictFiles?: string[];
}

export function parseGithubRemote(url: string): GitHubRepoRef | undefined {
  const raw = url.trim().replace(/\.git$/i, "");
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+)$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i,
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/(.+)$/i,
    /^git:\/\/github\.com\/([^/]+)\/(.+)$/i,
  ];
  for (const re of patterns) {
    const match = raw.match(re);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\/+$/, "") };
    }
  }
  return undefined;
}

export async function getOriginGithubRepo(repoPath: string): Promise<GitHubRepoRef | undefined> {
  const url = await new GitRepo(repoPath).originUrl();
  return url ? parseGithubRemote(url) : undefined;
}

export function normTag(tag: string): string {
  return tag.replace(/^v/i, "").trim();
}

export async function listGithubReleases(repo: GitHubRepoRef): Promise<GitHubRelease[]> {
  let token = await githubToken(false);
  let response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases?per_page=100`, token);
  if ((response.status === 401 || response.status === 404) && !token) {
    token = await githubToken(true);
    response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases?per_page=100`, token);
  }
  if (!response.ok) {
    throw new Error(await githubError(response));
  }
  const rows = (await response.json()) as Array<{
    id: number;
    tag_name: string;
    name: string | null;
    body: string | null;
    html_url: string;
    published_at: string | null;
    created_at: string;
    draft: boolean;
  }>;
  return rows
    .filter((row) => !row.draft)
    .map((row) => ({
      id: row.id,
      tag: row.tag_name,
      name: row.name || row.tag_name,
      body: row.body || "",
      htmlUrl: row.html_url,
      publishedAt: Date.parse(row.published_at || row.created_at) || Date.now(),
      draft: row.draft,
    }));
}

export async function createGithubRelease(
  repo: GitHubRepoRef,
  tag: string,
  notes: string
): Promise<{ htmlUrl: string; existed: boolean }> {
  const token = await githubToken(true);
  if (!token) {
    throw new Error("github auth missing");
  }
  const existing = await findReleaseByTag(repo, tag, token);
  if (existing) {
    return { htmlUrl: existing.htmlUrl, existed: true };
  }
  const response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases`, token, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: notes.trim(),
      draft: false,
      prerelease: false,
    }),
  });
  if (response.status === 422) {
    const again = await findReleaseByTag(repo, tag, token);
    if (again) {
      return { htmlUrl: again.htmlUrl, existed: true };
    }
  }
  if (!response.ok) {
    throw new Error(await githubError(response));
  }
  const created = (await response.json()) as { html_url: string };
  return { htmlUrl: created.html_url, existed: false };
}

export function mergeGithubHistory(
  releases: GitHubRelease[],
  local: DeployRecord[],
  repoName: string
): HistoryViewRecord[] {
  return releases.map((release) => {
    const localMatch = latestLocal(local, release.tag);
    const record: HistoryViewRecord = {
      id: `gh-${release.id}`,
      tag: release.tag,
      at: localMatch?.at || release.publishedAt,
      repoName: localMatch?.repoName || repoName,
      githubUrl: release.htmlUrl,
      githubTitle: release.name,
      githubBody: release.body,
      hasLocal: Boolean(localMatch),
    };
    if (!localMatch) {
      return record;
    }
    return {
      ...record,
      originBranches: localMatch.originBranches,
      targetBranches: localMatch.targetBranches,
      dryRun: localMatch.dryRun,
      ok: localMatch.ok,
      kind: localMatch.kind,
      logs: localMatch.logs,
      conflictBranch: localMatch.conflictBranch,
      conflictFiles: localMatch.conflictFiles,
    };
  });
}

function latestLocal(local: DeployRecord[], tag: string): DeployRecord | undefined {
  const wanted = normTag(tag);
  const matches = local.filter((record) => normTag(record.tag) === wanted && !record.dryRun);
  return matches.find((record) => record.ok) || matches[0];
}

async function findReleaseByTag(
  repo: GitHubRepoRef,
  tag: string,
  token: string
): Promise<GitHubRelease | undefined> {
  const tags = [...new Set([tag, `v${normTag(tag)}`, normTag(tag)])];
  for (const name of tags) {
    const response = await githubRequest(
      `/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(name)}`,
      token
    );
    if (response.status === 404) {
      continue;
    }
    if (!response.ok) {
      throw new Error(await githubError(response));
    }
    const row = (await response.json()) as {
      id: number;
      tag_name: string;
      name: string | null;
      body: string | null;
      html_url: string;
      published_at: string | null;
      created_at: string;
      draft: boolean;
    };
    return {
      id: row.id,
      tag: row.tag_name,
      name: row.name || row.tag_name,
      body: row.body || "",
      htmlUrl: row.html_url,
      publishedAt: Date.parse(row.published_at || row.created_at) || Date.now(),
      draft: row.draft,
    };
  }
  return undefined;
}

async function githubToken(interactive: boolean): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: interactive,
      silent: !interactive,
    });
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

async function githubRequest(pathname: string, token: string | undefined, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "MasTurboDeploy",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`https://api.github.com${pathname}`, { ...init, headers });
}

async function githubError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
