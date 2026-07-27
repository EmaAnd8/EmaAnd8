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

if (!TOKEN || !USERNAME) {
  console.error("❌ Missing GITHUB_TOKEN or USERNAME env vars");
  process.exit(1);
}

/**
 * Fetch user's commits from the past year via GitHub API.
 */
async function fetchCommits() {
  return new Promise((resolve, reject) => {
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
        "User-Agent": "GitHub-Streak-Generator",
        Authorization: `token ${TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    };

    https
      .request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `GitHub API error: ${res.statusCode} ${data.substring(0, 100)}`
              )
            );
            return;
          }
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.items || []);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject)
      .end();
  });
}

/**
 * Extract unique commit dates and calculate streaks.
 */
function calculateStreaks(commits) {
  // Get unique dates with commits (UTC midnight)
  const datesWithCommits = new Set();
  commits.forEach((commit) => {
    if (commit.commit && commit.commit.committer && commit.commit.committer.date) {
      const date = new Date(commit.commit.committer.date);
      const dateStr = date.toISOString().split("T")[0];
      datesWithCommits.add(dateStr);
    }
  });

  const sortedDates = Array.from(datesWithCommits)
    .sort()
    .reverse(); // Most recent first

  if (sortedDates.length === 0) {
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
    console.log(`📊 Fetching contributions for @${USERNAME}...`);
    const commits = await fetchCommits();
    console.log(`✅ Found ${commits.length} commits in the past year`);

    const stats = calculateStreaks(commits);
    console.log(
      `   🔥 Current streak: ${stats.currentStreak} days | ⭐ Longest: ${stats.longestStreak} days | 📊 Total: ${stats.totalContributions}`
    );

    const svg = generateSVG(stats);
    fs.writeFileSync("streak.svg", svg);
    console.log("✅ streak.svg generated successfully");
  } catch (error) {
    console.error("❌ Generation failed:", error.message);
    process.exit(1);
  }
}

main();
