import { mkdir, writeFile } from "node:fs/promises";

const username = "tyhallcsu";
const displayName = "sharmanhall";
const token = process.env.GITHUB_TOKEN ?? "";
const apiBase = "https://api.github.com";
const excludedLanguageLabels = new Set(["PostScript"]);

const colors = {
  background: "#0D1117",
  border: "#30363D",
  foreground: "#F0F6FC",
  text: "#C9D1D9",
  muted: "#8B949E",
  blue: "#58A6FF",
  violet: "#8B5CF6",
};

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const formatNumber = (value) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const checkedCount = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`GitHub returned an invalid ${field} value.`);
  }

  return value;
};

const requestJson = async (path, authenticated = true, attempt = 1) => {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "tyhallcsu-profile-cards",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (authenticated && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${apiBase}${path}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (attempt < 3) {
      await sleep(1_000 * 2 ** (attempt - 1));
      return requestJson(path, authenticated, attempt + 1);
    }

    throw new Error(`GitHub API network failure for ${path}: ${error.message}`);
  }

  if (response.status === 403 && authenticated && token) {
    return requestJson(path, false);
  }

  if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(1_000 * 2 ** (attempt - 1));
    return requestJson(path, authenticated, attempt + 1);
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status}) for ${path}: ${details}`
    );
  }

  return response.json();
};

const fetchPublicRepositories = async () => {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const batch = await requestJson(
      `/users/${username}/repos?type=owner&sort=updated&per_page=100&page=${page}`
    );

    if (!Array.isArray(batch)) {
      throw new TypeError("GitHub returned an invalid repository response.");
    }

    repositories.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  if (repositories.length === 0) {
    throw new Error("GitHub returned no public repositories.");
  }

  const unexpectedRepository = repositories.some(
    (repository) =>
      repository.private !== false ||
      repository.visibility !== "public" ||
      repository.owner?.login?.toLowerCase() !== username ||
      typeof repository.fork !== "boolean"
  );

  if (unexpectedRepository) {
    throw new Error(
      "Refusing repository data with unexpected ownership or visibility."
    );
  }

  return repositories;
};

const renderStatsCard = ({ followers, forks, repositories, stars }) => {
  const metrics = [
    ["Public projects", repositories],
    ["Stars earned", stars],
    ["Repository forks", forks],
    ["Followers", followers],
  ];

  const metricMarkup = metrics
    .map(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = column === 0 ? 28 : 270;
      const y = row === 0 ? 91 : 155;

      return `
    <g transform="translate(${x} ${y})">
      <text class="value" x="0" y="0">${escapeXml(formatNumber(value))}</text>
      <text class="label" x="0" y="24">${escapeXml(label)}</text>
    </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 495 190" width="495" height="190" role="img" aria-labelledby="stats-title stats-desc">
  <title id="stats-title">${escapeXml(displayName)} GitHub stats</title>
  <desc id="stats-desc">Public source repositories, stars, forks, and followers for ${escapeXml(
    displayName
  )}.</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
    .title { fill: ${colors.blue}; font-size: 20px; font-weight: 700; }
    .value { fill: ${colors.foreground}; font-size: 24px; font-weight: 700; }
    .label { fill: ${colors.muted}; font-size: 13px; font-weight: 500; }
  </style>
  <rect x="0.5" y="0.5" width="494" height="189" rx="6" fill="${
    colors.background
  }" stroke="${colors.border}"/>
  <text class="title" x="25" y="35">${escapeXml(
    displayName
  )}&apos;s GitHub Stats</text>
  <path d="M25 52H470" stroke="${colors.border}"/>
  <path d="M247.5 67V170" stroke="${
    colors.border
  }" stroke-opacity=".7"/>${metricMarkup}
</svg>
`;
};

const renderLanguagesCard = (languages) => {
  const topLanguages = languages.slice(0, 6);
  const total = topLanguages.reduce((sum, language) => sum + language.count, 0);
  const accents = [
    colors.blue,
    "#6D8BFF",
    "#7C6FF6",
    colors.violet,
    "#4E9FD1",
    "#7AA2F7",
  ];

  const rows = topLanguages
    .map((language, index) => {
      const y = 88 + index * 27;
      const width =
        total === 0 ? 0 : Math.max(6, (language.count / total) * 250);

      return `
  <g transform="translate(25 ${y})">
    <text class="language" x="0" y="0">${escapeXml(language.name)}</text>
    <rect x="145" y="-9" width="250" height="9" rx="4.5" fill="${
      colors.border
    }"/>
    <rect x="145" y="-9" width="${width.toFixed(
      2
    )}" height="9" rx="4.5" fill="${accents[index]}"/>
    <text class="count" x="445" y="0" text-anchor="end">${language.count}</text>
  </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 495 245" width="495" height="245" role="img" aria-labelledby="languages-title languages-desc">
  <title id="languages-title">Top public repository languages for ${escapeXml(
    displayName
  )}</title>
  <desc id="languages-desc">Primary languages ranked by number of public source repositories.</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
    .title { fill: ${colors.blue}; font-size: 20px; font-weight: 700; }
    .subtitle { fill: ${colors.muted}; font-size: 12px; }
    .language { fill: ${colors.text}; font-size: 14px; font-weight: 600; }
    .count { fill: ${colors.muted}; font-size: 13px; font-weight: 600; }
  </style>
  <rect x="0.5" y="0.5" width="494" height="244" rx="6" fill="${
    colors.background
  }" stroke="${colors.border}"/>
  <text class="title" x="25" y="34">Top Public Repo Languages</text>
  <text class="subtitle" x="25" y="54">Primary language by source repository</text>${rows}
</svg>
`;
};

const main = async () => {
  const [account, repositories] = await Promise.all([
    requestJson(`/users/${username}`),
    fetchPublicRepositories(),
  ]);

  const sourceRepositories = repositories.filter(
    (repository) => !repository.fork
  );
  const languageCounts = new Map();

  for (const repository of sourceRepositories) {
    // GitHub can classify document assets as PostScript; that is not a profile
    // stack signal, so omit it from this language visualization.
    if (
      !repository.language ||
      excludedLanguageLabels.has(repository.language)
    ) {
      continue;
    }

    languageCounts.set(
      repository.language,
      (languageCounts.get(repository.language) ?? 0) + 1
    );
  }

  const languages = [...languageCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    );

  const stats = {
    followers: checkedCount(account.followers, "followers"),
    forks: sourceRepositories.reduce(
      (sum, repository) =>
        sum + checkedCount(repository.forks_count, "forks_count"),
      0
    ),
    repositories: sourceRepositories.length,
    stars: sourceRepositories.reduce(
      (sum, repository) =>
        sum + checkedCount(repository.stargazers_count, "stargazers_count"),
      0
    ),
  };

  await mkdir("profile", { recursive: true });
  await Promise.all([
    writeFile("profile/stats.svg", renderStatsCard(stats), "utf8"),
    writeFile("profile/top-langs.svg", renderLanguagesCard(languages), "utf8"),
  ]);
};

await main();
