import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly command: string
  ) {
    super(message);
    this.name = "GitError";
  }
}

export class GitRepo {
  constructor(public readonly cwd: string) {}

  async run(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd: this.cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim();
    } catch (error) {
      const err = error as { message?: string; stderr?: string };
      throw new GitError(
        err.message ?? "git command failed",
        String(err.stderr ?? ""),
        `git ${args.join(" ")}`
      );
    }
  }

  async currentBranch(): Promise<string> {
    return this.run(["rev-parse", "--abbrev-ref", "HEAD"]);
  }

  async isDirty(): Promise<boolean> {
    const status = await this.run(["status", "--porcelain"]);
    return status.length > 0;
  }

  async inMerge(): Promise<boolean> {
    try {
      await this.run(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async conflictedFiles(): Promise<string[]> {
    try {
      const out = await this.run(["diff", "--name-only", "--diff-filter=U"]);
      return out ? out.split("\n").map((line) => line.trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async branches(): Promise<string[]> {
    const out = await this.run(["branch", "-a", "--format=%(refname:short)"]);
    const names = new Set<string>();
    for (const raw of out.split("\n")) {
      const line = raw.trim();
      if (!line || line.includes("->")) {
        continue;
      }
      const cleaned = line.replace(/^remotes\/origin\//, "").replace(/^origin\//, "");
      if (!cleaned || cleaned === "HEAD") {
        continue;
      }
      names.add(cleaned);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  async hasLocalBranch(name: string): Promise<boolean> {
    try {
      await this.run(["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async hasRemoteBranch(name: string): Promise<boolean> {
    try {
      await this.run(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async hasBranch(name: string): Promise<boolean> {
    return (await this.hasLocalBranch(name)) || (await this.hasRemoteBranch(name));
  }

  async hasTag(name: string): Promise<boolean> {
    try {
      await this.run(["rev-parse", "--verify", "--quiet", `refs/tags/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<string> {
    return this.run(["fetch", "--all", "--prune"]);
  }

  async checkout(branch: string): Promise<string> {
    if (await this.hasLocalBranch(branch)) {
      return this.run(["checkout", branch]);
    }
    if (await this.hasRemoteBranch(branch)) {
      return this.run(["checkout", "-B", branch, `origin/${branch}`]);
    }
    throw new GitError(`branch ${branch} not found`, "", `git checkout ${branch}`);
  }

  async checkoutNew(name: string, from: string): Promise<string> {
    const source = (await this.hasLocalBranch(from)) ? from : `origin/${from}`;
    return this.run(["checkout", "-B", name, source]);
  }

  async pull(): Promise<string> {
    return this.run(["pull"]);
  }

  async push(branch?: string): Promise<string> {
    if (branch) {
      return this.run(["push", "-u", "origin", branch]);
    }
    return this.run(["push"]);
  }

  async merge(ref: string, message?: string): Promise<string> {
    const args = ["merge", ref, "--no-ff"];
    if (message) {
      args.push("-m", message);
    }
    return this.run(args);
  }

  async add(paths: string[]): Promise<string> {
    return this.run(["add", ...paths]);
  }

  async commit(message: string): Promise<string> {
    return this.run(["commit", "-m", message]);
  }

  async tag(name: string): Promise<string> {
    return this.run(["tag", name]);
  }

  async pushTags(): Promise<string> {
    return this.run(["push", "origin", "--tags"]);
  }

  async deleteRemoteBranch(branch: string): Promise<string> {
    return this.run(["push", "origin", "--delete", branch]);
  }

  async deleteLocalBranch(branch: string): Promise<string> {
    return this.run(["branch", "-D", branch]);
  }

  async productionBranch(): Promise<"main" | "master"> {
    if (await this.hasBranch("main")) {
      return "main";
    }
    if (await this.hasBranch("master")) {
      return "master";
    }
    return "main";
  }

  async sourceBranch(): Promise<string> {
    if (await this.hasBranch("develop")) {
      return "develop";
    }
    if (await this.hasBranch("dev")) {
      return "dev";
    }
    return "develop";
  }

  async latestVersionTag(): Promise<string | undefined> {
    try {
      const out = await this.run(["tag", "--list", "--sort=-v:refname"]);
      const tag = out.split("\n").map((line) => line.trim()).find(Boolean);
      return tag ? tag.replace(/^v/i, "") : undefined;
    } catch {
      return undefined;
    }
  }
}
