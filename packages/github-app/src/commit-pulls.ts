// @fractalboxdev/flare-dispatch-github-app — the pull requests a commit belongs to.
//
//   GET /repos/{owner}/{repo}/commits/{sha}/pulls
//
// A gate run asks this before each spawn: whether the pull request it was
// started for is still open and still at the commit it gates. The answer
// carries each PR's state, merge time and current head, which is all that
// question needs. One page of 100 covers any commit's PR set in practice.
//
// Every non-2xx throws `GithubApiError`; the caller decides what an unknown
// answer means.

import { assertOk, ghHeaders, resolveClient, splitRepo } from "./http";
import { GithubApiError } from "./errors";

/** One pull request associated with a commit. */
export type CommitPullRequest = {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  /** The PR's current head commit — not necessarily the commit asked about. */
  readonly headSha: string;
  /** `owner/name` of the head repository; `""` when GitHub returns none (a deleted fork). */
  readonly headRepo: string;
};

export type ListCommitPullRequestsOptions = {
  readonly token: string;
  readonly repo: string;
  readonly sha: string;
  readonly apiBase?: string;
  readonly fetchImpl?: typeof fetch;
};

export const commitPullsUrl = (opts: {
  readonly repo: string;
  readonly sha: string;
  readonly apiBase?: string;
}): string => {
  if (!/^[0-9a-f]{40}$/i.test(opts.sha)) {
    throw new GithubApiError(`malformed commit sha "${opts.sha}"`, 0, "");
  }
  const { owner, name } = splitRepo(opts.repo);
  const { apiBase } = resolveClient(opts);
  return `${apiBase}/repos/${owner}/${name}/commits/${opts.sha}/pulls?per_page=100`;
};

/** The pull requests GitHub associates with `sha`. */
export const listCommitPullRequests = async (
  opts: ListCommitPullRequestsOptions,
): Promise<readonly CommitPullRequest[]> => {
  const { doFetch } = resolveClient(opts);
  const res = await doFetch(commitPullsUrl(opts), { method: "GET", headers: ghHeaders(opts.token) });
  await assertOk(res, `pull request lookup failed for ${opts.repo}@${opts.sha}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) {
    throw new GithubApiError(`pull request lookup for ${opts.repo}@${opts.sha} returned no list`, res.status, "");
  }
  return body.flatMap((raw): CommitPullRequest[] => {
    const pr = raw as {
      number?: unknown;
      state?: unknown;
      merged_at?: unknown;
      head?: { sha?: unknown; repo?: { full_name?: unknown } | null };
    };
    if (typeof pr.number !== "number" || (pr.state !== "open" && pr.state !== "closed")) return [];
    if (typeof pr.head?.sha !== "string") return [];
    return [
      {
        number: pr.number,
        state: pr.state,
        merged: typeof pr.merged_at === "string",
        headSha: pr.head.sha,
        headRepo: typeof pr.head.repo?.full_name === "string" ? pr.head.repo.full_name : "",
      },
    ];
  });
};
