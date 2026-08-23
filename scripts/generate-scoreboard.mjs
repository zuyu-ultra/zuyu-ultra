import fs from "node:fs";

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_USER ?? "zuyu-ultra";

if (!token) {
  throw new Error("GITHUB_TOKEN is required to generate the scoreboard.");
}

const now = new Date();
const from = new Date(now);
from.setUTCDate(from.getUTCDate() - 364);

const query = `
  query ProfileScoreboard($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      repositories(
        first: 100
        ownerAffiliations: OWNER
        privacy: PUBLIC
        isFork: false
      ) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node { name color }
            }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "zuyu-profile-scoreboard",
  },
  body: JSON.stringify({
    query,
    variables: {
      login,
      from: from.toISOString(),
      to: now.toISOString(),
    },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed: ${response.status}`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(payload.errors.map((error) => error.message).join("; "));
}
if (!payload.data?.user) {
  throw new Error(`GitHub user ${login} was not found.`);
}

const { repositories, contributionsCollection } = payload.data.user;
const calendar = contributionsCollection.contributionCalendar;
const contributionDays = calendar.weeks
  .flatMap((week) => week.contributionDays)
  .sort((a, b) => a.date.localeCompare(b.date));

const byDate = new Map(
  contributionDays.map((day) => [day.date, day.contributionCount]),
);

const dateKey = (date) => date.toISOString().slice(0, 10);
let streakCursor = new Date(now);
if ((byDate.get(dateKey(streakCursor)) ?? 0) === 0) {
  streakCursor.setUTCDate(streakCursor.getUTCDate() - 1);
}

let currentStreak = 0;
while ((byDate.get(dateKey(streakCursor)) ?? 0) > 0) {
  currentStreak += 1;
  streakCursor.setUTCDate(streakCursor.getUTCDate() - 1);
}

const languageTotals = new Map();
for (const repository of repositories.nodes) {
  for (const edge of repository.languages.edges) {
    const previous = languageTotals.get(edge.node.name) ?? {
      bytes: 0,
      color: edge.node.color,
    };
    previous.bytes += edge.size;
    previous.color ||= edge.node.color;
    languageTotals.set(edge.node.name, previous);
  }
}

const palette = ["#1D4ED8", "#E33A32", "#F7D647", "#171717", "#8B5CF6"];
const topLanguages = [...languageTotals.entries()]
  .map(([name, data], index) => ({
    name,
    bytes: data.bytes,
    color: data.color || palette[index % palette.length],
  }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 5);

const languageBytes = topLanguages.reduce((sum, language) => sum + language.bytes, 0);
for (const [index, language] of topLanguages.entries()) {
  language.color = palette[index % palette.length];
  language.percent = languageBytes
    ? Math.round((language.bytes / languageBytes) * 100)
    : 0;
}

const recentDays = contributionDays.slice(-28);
const maxRecentCount = Math.max(...recentDays.map((day) => day.contributionCount), 1);
const totalRecent = recentDays.reduce((sum, day) => sum + day.contributionCount, 0);

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const metric = ({ x, width, label, value, accent, note }) => `
  <g>
    <rect x="${x + 6}" y="104" width="${width}" height="118" fill="#171717"/>
    <rect x="${x}" y="98" width="${width}" height="118" fill="#FFFDF7" stroke="#171717" stroke-width="4"/>
    <rect x="${x}" y="98" width="12" height="118" fill="${accent}"/>
    <text x="${x + 28}" y="127" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="800" letter-spacing="1.4" fill="#59574F">${escapeXml(label)}</text>
    <text x="${x + 28}" y="180" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="42" font-weight="900" letter-spacing="1" fill="#171717">${escapeXml(value)}</text>
    <text x="${x + 28}" y="204" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="600" fill="#59574F">${escapeXml(note)}</text>
  </g>`;

const bars = recentDays
  .map((day, index) => {
    const barWidth = 16;
    const gap = 8;
    const x = 54 + index * (barWidth + gap);
    const height = day.contributionCount
      ? Math.max(10, Math.round(Math.sqrt(day.contributionCount / maxRecentCount) * 78))
      : 4;
    const y = 385 - height;
    const color = day.contributionCount === maxRecentCount
      ? "#E33A32"
      : day.contributionCount > 0
        ? "#1D4ED8"
        : "#D6D3CA";
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="2" fill="${color}"/>
      ${day.contributionCount === maxRecentCount ? `<circle cx="${x + 8}" cy="${y - 7}" r="5" fill="#F7D647" stroke="#171717" stroke-width="2"/>` : ""}`;
  })
  .join("");

let languageOffset = 0;
const languageSegments = topLanguages
  .map((language, index) => {
    const remaining = 370 - languageOffset;
    const width = index === topLanguages.length - 1
      ? remaining
      : Math.max(8, Math.round((language.percent / 100) * 370));
    const segment = `<rect x="${786 + languageOffset}" y="295" width="${Math.min(width, remaining)}" height="18" fill="${language.color}"/>`;
    languageOffset += Math.min(width, remaining);
    return segment;
  })
  .join("");

const languageLegend = topLanguages
  .map((language, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 786 + column * 188;
    const y = 344 + row * 32;
    return `
      <rect x="${x}" y="${y - 11}" width="11" height="11" fill="${language.color}" stroke="#171717" stroke-width="1"/>
      <text x="${x + 19}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#171717">${escapeXml(language.name)} <tspan fill="#77736A">${language.percent}%</tspan></text>`;
  })
  .join("");

const topLanguage = topLanguages[0]?.name ?? "Exploring";
const updated = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now).replaceAll("-", ".");
const firstRecent = recentDays[0]?.date.slice(5).replace("-", "/") ?? "—";
const lastRecent = recentDays.at(-1)?.date.slice(5).replace("-", "/") ?? "—";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="440" viewBox="0 0 1200 440" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(login)} live GitHub scoreboard</title>
  <desc id="description">A comic-inspired dashboard showing recent contributions, current streak, public repositories, and programming languages.</desc>
  <defs>
    <pattern id="halftone" width="12" height="12" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.5" fill="#171717" opacity="0.18"/>
    </pattern>
  </defs>

  <rect x="8" y="8" width="1184" height="424" fill="#F7D647" stroke="#171717" stroke-width="5"/>
  <path d="M8 8h1184v424H8z" fill="url(#halftone)"/>
  <rect x="18" y="18" width="1164" height="58" fill="#171717"/>
  <path d="M18 18h176l-22 58H18z" fill="#E33A32"/>
  <text x="42" y="54" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" letter-spacing="2" fill="#FFFDF7">ISSUE 001</text>
  <text x="214" y="58" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="30" font-weight="900" letter-spacing="1.5" fill="#FFFDF7">LIVE SCOREBOARD</text>
  <text x="1160" y="53" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" letter-spacing="2" fill="#F7D647" text-anchor="end">ZUYU // ${updated}</text>

  ${metric({ x: 28, width: 270, label: "365D CONTRIBUTIONS", value: calendar.totalContributions.toLocaleString("en-US"), accent: "#E33A32", note: "Every green square, counted" })}
  ${metric({ x: 316, width: 270, label: "CURRENT STREAK", value: `${currentStreak} DAYS`, accent: "#1D4ED8", note: "Active run through today" })}
  ${metric({ x: 604, width: 270, label: "PUBLIC BUILDS", value: repositories.totalCount, accent: "#F7D647", note: "Original repositories shipped" })}
  ${metric({ x: 892, width: 280, label: "PRIMARY LANGUAGE", value: topLanguage.toUpperCase(), accent: "#E33A32", note: "Measured across public source" })}

  <rect x="28" y="244" width="714" height="168" fill="#FFFDF7" stroke="#171717" stroke-width="4"/>
  <path d="M28 244h714v34H28z" fill="#1D4ED8"/>
  <text x="46" y="268" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="18" font-weight="900" letter-spacing="1.2" fill="#FFFDF7">THE LAST 28 DAYS</text>
  <text x="724" y="266" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" letter-spacing="2" fill="#FFFDF7" text-anchor="end">${totalRecent} TOTAL CONTRIBUTIONS</text>
  <line x1="46" y1="385" x2="724" y2="385" stroke="#171717" stroke-width="3"/>
  ${bars}
  <text x="48" y="402" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="700" letter-spacing="1" fill="#77736A">${firstRecent}</text>
  <text x="722" y="402" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="700" letter-spacing="1" fill="#77736A" text-anchor="end">${lastRecent}</text>

  <rect x="760" y="244" width="412" height="168" fill="#FFFDF7" stroke="#171717" stroke-width="4"/>
  <path d="M760 244h412v34H760z" fill="#E33A32"/>
  <text x="778" y="268" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="18" font-weight="900" letter-spacing="1.2" fill="#FFFDF7">LANGUAGE MIX</text>
  <rect x="784" y="293" width="374" height="22" fill="#FFFDF7" stroke="#171717" stroke-width="3"/>
  ${languageSegments}
  ${languageLegend}

  <path d="M1138 8h54v54z" fill="#1D4ED8"/>
  <path d="M8 378v54h54z" fill="#E33A32"/>
</svg>
`;

fs.mkdirSync("profile", { recursive: true });
fs.writeFileSync("profile/scoreboard.svg", svg);
console.log(`Generated profile/scoreboard.svg for ${login}.`);
