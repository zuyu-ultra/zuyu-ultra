import fs from "node:fs";

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_USER ?? "zuyu-ultra";
const startMarker = "<!-- recent-activity:start -->";
const endMarker = "<!-- recent-activity:end -->";

if (!token) {
  throw new Error("GITHUB_TOKEN is required to update recent activity.");
}

const github = async (path) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "zuyu-profile-activity",
    },
  });

  if (response.status === 404 || response.status === 409) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${path}`);
  }
  return response.json();
};

const repositories = await github(
  `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`,
);

const candidates = repositories
  .filter(
    (repository) =>
      !repository.fork &&
      !repository.archived &&
      !repository.name.toLowerCase().includes("zzeasy"),
  )
  .slice(0, 12);

const oneYearAgo = new Date();
oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);

const commits = (
  await Promise.all(
    candidates.map(async (repository) => {
      const result = await github(
        `/repos/${repository.full_name}/commits?author=${encodeURIComponent(login)}&per_page=1`,
      );
      const commit = result?.[0];
      if (!commit) return null;

      return {
        repository: repository.name,
        repositoryUrl: repository.html_url,
        sha: commit.sha.slice(0, 7),
        commitUrl: commit.html_url,
        message: commit.commit.message.split("\n")[0],
        date: commit.commit.author?.date ?? commit.commit.committer.date,
      };
    }),
  )
)
  .filter(Boolean)
  .filter((commit) => !commit.message.startsWith("chore: refresh recent activity"))
  .filter((commit) => !commit.message.toLowerCase().includes("profile scoreboard"))
  .filter((commit) => new Date(commit.date) >= oneYearAgo)
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, 5);

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatDate = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(value))
    .replace("-", ".");

const trimMessage = (message) => {
  const normalized = message.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 92 ? `${normalized.slice(0, 89)}...` : normalized;
};

const rows = commits.length
  ? commits
      .map(
        (commit, index) => `  <tr>
    <td width="15%" valign="middle"><code>SIGNAL ${String(index + 1).padStart(2, "0")}</code><br /><sub>${formatDate(commit.date)}</sub></td>
    <td width="63%" valign="middle"><a href="${commit.repositoryUrl}"><strong>${escapeHtml(commit.repository)}</strong></a><br /><sub>${escapeHtml(trimMessage(commit.message))}</sub></td>
    <td width="22%" align="right" valign="middle"><a href="${commit.commitUrl}"><code>${commit.sha} ↗</code></a></td>
  </tr>`,
      )
      .join("\n")
  : `  <tr>
    <td><sub>No public commit signals found yet.</sub></td>
  </tr>`;

const latestSignal = commits[0]
  ? `LATEST SIGNAL / ${formatDate(commits[0].date)}`
  : "AWAITING SIGNAL";

const activity = `${startMarker}
<table>
${rows}
</table>

<p align="right"><sub><code>${latestSignal}</code> · sourced from public GitHub commits</sub></p>
${endMarker}`;

const readmePath = "README.md";
const readme = fs.readFileSync(readmePath, "utf8");
const start = readme.indexOf(startMarker);
const end = readme.indexOf(endMarker);

if (start === -1 || end === -1 || end < start) {
  throw new Error("Recent activity markers were not found in README.md.");
}

const updated = `${readme.slice(0, start)}${activity}${readme.slice(end + endMarker.length)}`;
fs.writeFileSync(readmePath, updated);
console.log(`Updated README.md with ${commits.length} recent commit signals.`);
