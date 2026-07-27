#!/usr/bin/env node
/**
 * Generate streak.svg from GitHub contribution data.
 * Self-hosted replacement for external streak-stats service.
 *
 * Fetches recent commits via GitHub API and calculates:
 * - Current streak (consecutive days with contributions)
 * - Longest streak (best streak in the past year)
 * - Total contributions
 */

const https = require("https");
const fs = require("fs");

const TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.USERNAME;

console.log(`📊 Generating streak stats for @${USERNAME}`);

if (!TOKEN || !USERNAME) {
  console.error("❌ Missing GITHUB_TOKEN or USERNAME env vars");
  console.error(`   GITHUB_TOKEN: ${TOKEN ? "set" : "MISSING"}`);
  console.error(`   USERNAME: ${USERNAME ? "set" : "MISSING"}`);
  process.exit(1);
}

/**
 * Make HTTPS request with error handling.
 */
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          console.error(`❌ HTTP ${res.statusCode}`);
          console.error(`   Response: ${data.substring(0, 200)}`);
          reject(
            new Error(
              `HTTP ${res.statusCode}: ${data.substring(0, 100)}`
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          console.error("❌ JSON parse error");
          console.error(`   Response: ${data.substring(0, 200)}`);
          reject(e);
        }
      });
    });

    req.on("error", (err) => {
      console.error("❌ Network error:", err.message);
      reject(err);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Fetch user's commits from the past year via GitHub API.
 */
async function fetchCommits() {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const since = oneYearAgo.toISOString();

  const query = new URLSearchParams({
    q: `author:${USERNAME} committer-date:>=${since}`,
    sort: "committer-date",
    order: "desc",
    per_page: 100,
  });

  const options = {
    hostname: "api.github.com",
    path: `/search/commits?${query}`,
    method: "GET",
    headers: {
      "User-Agent": "GitHub-Streak-Generator/1.0",
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  };

  console.log(`   Fetching commits since ${since}...`);
  const data = await httpsRequest(options);
  
  if (data.items) {
    console.log(`   ✅ Found ${data.items.length} commits`);
    return data.items;
  }
  
  console.warn(`   ⚠️  No items in response, using empty array`);
  return [];
}

/**
 * Extract unique commit dates and calculate streaks.
 */
function calculateStreaks(commits) {
  // Get unique dates with commits (UTC midnight)
  const datesWithCommits = new Set();
  
  commits.forEach((commit) => {
    try {
      if (commit.commit && commit.commit.committer && commit.commit.committer.date) {
        const date = new Date(commit.commit.committer.date);
        const dateStr = date.toISOString().split("T")[0];
        datesWithCommits.add(dateStr);
      }
    } catch (e) {
      console.warn(`   ⚠️  Skipped malformed commit`, e.message);
    }
  });

  const sortedDates = Array.from(datesWithCommits)
    .sort()
    .reverse(); // Most recent first

  if (sortedDates.length === 0) {
    console.warn("   ⚠️  No commits found, using zeros");
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalContributions: 0,
      lastCommitDate: null,
    };
  }

  // Calculate current streak
  let currentStreak = 0;
  let today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < sortedDates.length; i++) {
    const date = new Date(sortedDates[i]);
    const daysAgo = Math.floor((today - date) / (1000 * 60 * 60 * 24));

    if (daysAgo === i) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Calculate longest streak
  let longestStreak = 1;
  let currentRunStreak = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Date(sortedDates[i - 1]);
    const currDate = new Date(sortedDates[i]);
    const diffDays = Math.floor((prevDate - currDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      currentRunStreak++;
      longestStreak = Math.max(longestStreak, currentRunStreak);
    } else {
      currentRunStreak = 1;
    }
  }

  console.log(
    `   📈 Current: ${currentStreak} | Longest: ${longestStreak} | Total: ${sortedDates.length}`
  );

  return {
    currentStreak,
    longestStreak,
    totalContributions: sortedDates.length,
    lastCommitDate: sortedDates[0],
  };
}

/**
 * Generate SVG with Tokyo Night theme colors.
 */
function generateSVG(stats) {
  const { currentStreak, longestStreak, totalContributions } = stats;

  // Tokyo Night theme colors
  const bgDark = "#1a1b26";
  const bgLight = "#2d2e42";
  const textPrimary = "#c0caf5";
  const textSecondary = "#9ca3af";
  const accentFire = "#f7768e";
  const accentSuccess = "#9ece6a";

  const width = 360;
  const height = 180;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bgLight};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${bgDark};stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" rx="10" fill="url(#bgGradient)" stroke="${textSecondary}" stroke-width="2" opacity="0.3"/>

  <!-- Current Streak Section -->
  <g>
    <!-- Icon placeholder (🔥) -->
    <text x="25" y="50" font-size="32" text-anchor="middle" fill="${accentFire}">🔥</text>
    
    <!-- Streak number -->
    <text x="70" y="52" font-size="36" font-weight="700" fill="${textPrimary}" font-family="'Courier New', monospace">${currentStreak}</text>
    
    <!-- Label -->
    <text x="70" y="72" font-size="12" fill="${textSecondary}" font-family="system-ui">Current Streak</text>
  </g>

  <!-- Longest Streak Section -->
  <g>
    <!-- Icon placeholder (⭐) -->
    <text x="205" y="50" font-size="32" text-anchor="middle" fill="${accentSuccess}">⭐</text>
    
    <!-- Streak number -->
    <text x="250" y="52" font-size="36" font-weight="700" fill="${textPrimary}" font-family="'Courier New', monospace">${longestStreak}</text>
    
    <!-- Label -->
    <text x="250" y="72" font-size="12" fill="${textSecondary}" font-family="system-ui">Longest Streak</text>
  </g>

  <!-- Total Contributions Section -->
  <g>
    <!-- Icon placeholder (📊) -->
    <text x="25" y="130" font-size="32" text-anchor="middle" fill="#7aa2f7">📊</text>
    
    <!-- Count -->
    <text x="70" y="132" font-size="36" font-weight="700" fill="${textPrimary}" font-family="'Courier New', monospace">${totalContributions}</text>
    
    <!-- Label -->
    <text x="70" y="152" font-size="12" fill="${textSecondary}" font-family="system-ui">Contributions</text>
  </g>

  <!-- Bottom text: self-hosted note -->
  <text x="${width - 10}" y="${height - 8}" font-size="9" fill="${textSecondary}" text-anchor="end" font-family="system-ui">Self-hosted</text>
</svg>`;
}

/**
 * Main entry point.
 */
async function main() {
  try {
    const commits = await fetchCommits();
    const stats = calculateStreaks(commits);

    const svg = generateSVG(stats);
    fs.writeFileSync("streak.svg", svg);
    console.log("✅ streak.svg written successfully");
    console.log("");
  } catch (error) {
    console.error("\n❌ Generation failed:", error.message);
    process.exit(3);
  }
}

main();

