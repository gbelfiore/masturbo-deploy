import { GitError, GitRepo } from "./git";
import { Locale, t } from "./i18n";
import { bumpPackageFiles } from "./version";
import * as fs from "fs";
import * as path from "path";

export interface ReleaseInput {
  repoPath: string;
  version: string;
  mergeBranches: string[];
  targetBranches: string[];
  sourceBranch: string;
  reuseReleaseBranch: boolean;
  dryRun: boolean;
  deleteMergedBranches: boolean;
  deleteReleaseBranch: boolean;
  locale: Locale;
}

export interface ReleaseLog {
  level: "info" | "ok" | "warn" | "error";
  message: string;
}

export interface ReleaseResult {
  ok: boolean;
  logs: ReleaseLog[];
  releaseBranch: string;
  tag: string;
  productionBranch: string;
  conflict?: ConflictInfo;
}

export interface ResumeTagInput {
  repoPath: string;
  version: string;
  targetBranches: string[];
  dryRun: boolean;
  locale: Locale;
}

export interface ConflictInfo {
  branch: string;
  files: string[];
  tag: string;
}

type Logger = (level: ReleaseLog["level"], message: string) => void;

export async function runRelease(input: ReleaseInput, onLog?: Logger): Promise<ReleaseResult> {
  const logs: ReleaseLog[] = [];
  const log: Logger = (level, message) => {
    logs.push({ level, message });
    onLog?.(level, message);
  };

  const version = input.version.trim();
  const releaseBranch = `release/${version}`;
  const tag = version;
  const git = new GitRepo(input.repoPath);
  const locale = input.locale;

  try {
    if (!version) {
      throw new Error(t(locale, "enterReleaseNumber"));
    }

    log("info", input.dryRun ? t(locale, "dryRunMode") : t(locale, "startingRelease", { version }));
    log("info", `${t(locale, "historyRepo")}: ${input.repoPath}`);

    if (!input.dryRun && (await git.isDirty())) {
      throw new Error(t(locale, "dirtyWorkingTree"));
    }

    await step(input.dryRun, log, locale, git, t(locale, "logFetch"), "git fetch --all --prune", () => git.fetch());

    const source = input.sourceBranch.trim() || (await git.sourceBranch());
    const production = await git.productionBranch();
    log("info", t(locale, "sourceBranch", { name: source }));
    log("info", t(locale, "productionBranch", { name: production }));

    if (!(await git.hasBranch(source))) {
      throw new Error(t(locale, "branchNotFound", { name: source }));
    }
    if (!(await git.hasBranch(production))) {
      throw new Error(t(locale, "branchNotFound", { name: production }));
    }

    const releaseExists = await git.hasBranch(releaseBranch);
    if (releaseExists && !input.reuseReleaseBranch) {
      throw new Error(t(locale, "releaseExists", { name: releaseBranch }));
    }

    const pulled = await step(
      input.dryRun,
      log,
      locale,
      git,
      t(locale, "logCheckoutPull", { name: source }),
      `git checkout ${source} && git pull`,
      async () => {
        await git.checkout(source);
        await git.pull();
      },
      source
    );
    if (pulled) {
      return stopOnConflict(logs, releaseBranch, tag, production, pulled, locale, log);
    }

    if (releaseExists && input.reuseReleaseBranch) {
      await step(
        input.dryRun,
        log,
        locale,
        git,
        t(locale, "logReuseRelease", { name: releaseBranch }),
        `git checkout ${releaseBranch}`,
        () => git.checkout(releaseBranch)
      );
    } else {
      await step(
        input.dryRun,
        log,
        locale,
        git,
        t(locale, "logCreateRelease", { name: releaseBranch }),
        `git checkout -B ${releaseBranch} ${source}`,
        () => git.checkoutNew(releaseBranch, source)
      );
    }

    if (!input.dryRun) {
      const files = bumpPackageFiles(input.repoPath, version);
      log("ok", t(locale, "versionBumped", { version, files: files.join(", ") }));
      if (!files.includes("package-lock.json")) {
        log("info", t(locale, "noPackageLock"));
      }
      await git.add(files);
      if (await git.isDirty()) {
        await git.commit(`chore: bump version to ${version}`);
        log("ok", t(locale, "committedVersion", { version }));
      } else {
        log("info", t(locale, "versionUnchanged"));
      }
    } else {
      const lock = fs.existsSync(path.join(input.repoPath, "package-lock.json"));
      log("info", t(locale, lock ? "dryRunBoth" : "dryRunPkgOnly", { version }));
    }

    for (const branch of unique(input.mergeBranches)) {
      if (branch === releaseBranch) {
        continue;
      }
      const conflict = await step(
        input.dryRun,
        log,
        locale,
        git,
        t(locale, "logMergeBranch", { name: branch }),
        `git merge ${branch} --no-ff`,
        () => git.merge(branch, `Merge branch '${branch}' into ${releaseBranch}`),
        branch
      );
      if (conflict) {
        return stopOnConflict(logs, releaseBranch, tag, production, conflict, locale, log);
      }
    }

    await step(
      input.dryRun,
      log,
      locale,
      git,
      t(locale, "logPushRelease"),
      `git push -u origin ${releaseBranch}`,
      () => git.push(releaseBranch)
    );

    const prodPull = await step(
      input.dryRun,
      log,
      locale,
      git,
      t(locale, "logCheckoutPull", { name: production }),
      `git checkout ${production} && git pull`,
      async () => {
        await git.checkout(production);
        await git.pull();
      },
      production
    );
    if (prodPull) {
      return stopOnConflict(logs, releaseBranch, tag, production, prodPull, locale, log);
    }

    const prodMerge = await step(
      input.dryRun,
      log,
      locale,
      git,
      t(locale, "logMergeProduction", { name: production }),
      `git merge ${releaseBranch} --no-ff`,
      () => git.merge(releaseBranch, `Merge branch '${releaseBranch}'`),
      production
    );
    if (prodMerge) {
      return stopOnConflict(logs, releaseBranch, tag, production, prodMerge, locale, log);
    }

    await step(
      input.dryRun,
      log,
      locale,
      git,
      t(locale, "logPushProduction", { name: production }),
      `git push origin ${production}`,
      () => git.push(production)
    );

    if (await git.hasTag(tag)) {
      log("warn", t(locale, "tagExists", { tag }));
    } else {
      await step(input.dryRun, log, locale, git, t(locale, "logCreateTag", { tag }), `git tag ${tag}`, () => git.tag(tag));
    }
    await step(input.dryRun, log, locale, git, t(locale, "logPushTags"), "git push origin --tags", () => git.pushTags());

    for (const branch of unique(input.targetBranches)) {
      if (branch === production || branch === releaseBranch) {
        continue;
      }
      const conflict = await step(
        input.dryRun,
        log,
        locale,
        git,
        t(locale, "logMergeTag", { tag, name: branch }),
        `git checkout ${branch} && git pull && git merge ${tag} --no-ff && git push`,
        async () => {
          await git.checkout(branch);
          await git.pull();
          await git.merge(tag, `Merge tag '${tag}' into ${branch}`);
          await git.push(branch);
        },
        branch
      );
      if (conflict) {
        return stopOnConflict(logs, releaseBranch, tag, production, conflict, locale, log);
      }
    }

    await step(
      input.dryRun,
      log,
      locale,
      git,
      t(locale, "logCheckout", { name: production }),
      `git checkout ${production}`,
      () => git.checkout(production)
    );

    if (input.deleteMergedBranches) {
      const protectedBranches = new Set([
        source,
        production,
        releaseBranch,
        "develop",
        "dev",
        "main",
        "master",
        "unstable",
        "staging",
      ]);
      for (const branch of unique(input.mergeBranches)) {
        if (protectedBranches.has(branch)) {
          log("warn", t(locale, "notDeletingProtected", { name: branch }));
          continue;
        }
        await step(
          input.dryRun,
          log,
          locale,
          git,
          t(locale, "logDeleteBranch", { name: branch }),
          `git push origin --delete ${branch} && git branch -D ${branch}`,
          async () => {
            try {
              await git.deleteRemoteBranch(branch);
            } catch (error) {
              log("warn", t(locale, "remoteError", { name: branch, error: formatError(error) }));
            }
            try {
              await git.deleteLocalBranch(branch);
            } catch (error) {
              log("warn", t(locale, "localError", { name: branch, error: formatError(error) }));
            }
          }
        );
      }
    }

    if (input.deleteReleaseBranch) {
      await step(
        input.dryRun,
        log,
        locale,
        git,
        t(locale, "logDeleteRelease", { name: releaseBranch }),
        `git push origin --delete ${releaseBranch} && git branch -D ${releaseBranch}`,
        async () => {
          try {
            await git.deleteRemoteBranch(releaseBranch);
          } catch (error) {
            log("warn", t(locale, "remoteError", { name: releaseBranch, error: formatError(error) }));
          }
          try {
            await git.deleteLocalBranch(releaseBranch);
          } catch (error) {
            log("warn", t(locale, "localError", { name: releaseBranch, error: formatError(error) }));
          }
        }
      );
    }

    log("ok", t(locale, "releaseDone", { version }));
    return { ok: true, logs, releaseBranch, tag, productionBranch: production };
  } catch (error) {
    const message = formatError(error);
    log("error", message);
    const conflict = await detectConflict(git, tag, error);
    if (conflict) {
      return stopOnConflict(logs, releaseBranch, tag, "main", conflict, locale, log);
    }
    return { ok: false, logs, releaseBranch, tag, productionBranch: "main" };
  }
}

export async function runResumeTagMerge(input: ResumeTagInput, onLog?: Logger): Promise<ReleaseResult> {
  const logs: ReleaseLog[] = [];
  const log: Logger = (level, message) => {
    logs.push({ level, message });
    onLog?.(level, message);
  };

  const version = input.version.trim();
  const tag = version;
  const git = new GitRepo(input.repoPath);
  const locale = input.locale;
  const targets = unique(input.targetBranches);

  try {
    if (!version) {
      throw new Error(t(locale, "enterReleaseNumber"));
    }
    if (!targets.length) {
      throw new Error(t(locale, "noTargetBranches"));
    }

    log("info", input.dryRun ? t(locale, "dryRunMode") : t(locale, "resumingTag", { tag }));
    log("info", `${t(locale, "historyRepo")}: ${input.repoPath}`);

    await step(input.dryRun, log, locale, git, t(locale, "logFetch"), "git fetch --all --prune", () => git.fetch());

    if (!input.dryRun && !(await git.hasTag(tag))) {
      throw new Error(t(locale, "tagNotFound", { tag }));
    }

    const current = await git.currentBranch().catch(() => "");
    if (!input.dryRun && (await git.inMerge())) {
      const files = await git.conflictedFiles();
      if (files.length) {
        const conflict = { branch: current || targets[0], files, tag };
        return stopOnConflict(logs, `release/${version}`, tag, current || "main", conflict, locale, log);
      }
      await step(
        false,
        log,
        locale,
        git,
        t(locale, "logCommitMerge", { name: current }),
        `git commit -m "Merge tag '${tag}'"`,
        () => git.commit(`Merge tag '${tag}' into ${current}`)
      );
      await step(
        false,
        log,
        locale,
        git,
        t(locale, "logPushProduction", { name: current }),
        `git push origin ${current}`,
        () => git.push(current)
      );
    } else if (!input.dryRun && (await git.isDirty())) {
      const files = await git.conflictedFiles();
      if (files.length) {
        const conflict = { branch: current || targets[0], files, tag };
        return stopOnConflict(logs, `release/${version}`, tag, current || "main", conflict, locale, log);
      }
      throw new Error(t(locale, "dirtyWorkingTree"));
    }

    for (const branch of targets) {
      const conflict = await step(
        input.dryRun,
        log,
        locale,
        git,
        t(locale, "logMergeTag", { tag, name: branch }),
        `git checkout ${branch} && git pull && git merge ${tag} --no-ff && git push`,
        async () => {
          await git.checkout(branch);
          await git.pull();
          const afterPull = await git.conflictedFiles();
          if (afterPull.length) {
            throw Object.assign(new Error(t(locale, "mergeStopped", { name: branch })), {
              conflictFiles: afterPull,
              conflictBranch: branch,
            });
          }
          if (await git.inMerge()) {
            await git.commit(`Merge tag '${tag}' into ${branch}`);
          } else {
            await git.merge(tag, `Merge tag '${tag}' into ${branch}`);
          }
          await git.push(branch);
        },
        branch
      );
      if (conflict) {
        return stopOnConflict(logs, `release/${version}`, tag, branch, conflict, locale, log);
      }
    }

    log("ok", t(locale, "resumeMergeDone", { tag }));
    return { ok: true, logs, releaseBranch: `release/${version}`, tag, productionBranch: targets[0] };
  } catch (error) {
    const message = formatError(error);
    log("error", message);
    const conflict = await detectConflict(git, tag, error);
    if (conflict) {
      return stopOnConflict(logs, `release/${version}`, tag, "main", conflict, locale, log);
    }
    return { ok: false, logs, releaseBranch: `release/${version}`, tag, productionBranch: "main" };
  }
}

function stopOnConflict(
  logs: ReleaseLog[],
  releaseBranch: string,
  tag: string,
  productionBranch: string,
  conflict: ConflictInfo,
  locale: Locale,
  log: Logger
): ReleaseResult {
  conflict.tag = conflict.tag || tag;
  log("error", t(locale, "mergeStopped", { name: conflict.branch }));
  log("warn", t(locale, "conflictLog", { branch: conflict.branch, files: conflict.files.join(", ") || "-" }));
  return { ok: false, logs, releaseBranch, tag, productionBranch, conflict };
}

async function step(
  dryRun: boolean,
  log: Logger,
  locale: Locale,
  git: GitRepo,
  title: string,
  command: string,
  run: () => Promise<unknown>,
  mergeBranch?: string
): Promise<ConflictInfo | undefined> {
  if (dryRun) {
    log("info", `${title}\n[dry-run] ${command}`);
    return undefined;
  }
  log("info", `${title}\n${command}`);
  try {
    await run();
    const leftover = await git.conflictedFiles();
    if (leftover.length) {
      return { branch: mergeBranch || (await git.currentBranch().catch(() => "")), files: leftover, tag: "" };
    }
    log("ok", t(locale, "logStepOk", { title }));
    return undefined;
  } catch (error) {
    const conflict = await detectConflict(git, "", error);
    if (conflict) {
      if (mergeBranch) {
        conflict.branch = mergeBranch;
      }
      return conflict;
    }
    throw error;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatError(error: unknown): string {
  if (error instanceof GitError) {
    const detail = error.stderr.trim() || error.message;
    return `${error.command}\n${detail}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isConflictText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("conflict") || lower.includes("unmerged") || lower.includes("fix them") || lower.includes("fix conflicts");
}

async function detectConflict(git: GitRepo, tag: string, error: unknown): Promise<ConflictInfo | undefined> {
  const extra = error as { conflictFiles?: string[]; conflictBranch?: string };
  const files = extra.conflictFiles?.length ? extra.conflictFiles : await git.conflictedFiles();
  const text = formatError(error);
  if (!files.length && !isConflictText(text) && extra.conflictFiles === undefined) {
    return undefined;
  }
  const branch = extra.conflictBranch || (await git.currentBranch().catch(() => ""));
  return { branch, files, tag };
}
