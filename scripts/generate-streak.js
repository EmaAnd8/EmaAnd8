#!/usr/bin/env node
/**
 * Generate streak.svg from the GitHub contribution calendar (GraphQL).
 *
 * Uses the same data source as streak-stats: contributionsCollection ->
 * contributionCalendar. This counts ALL contributions (commits, PRs, issues,
 * reviews), not just commits indexed by the REST search API.
 */

const https = require("https");
const fs = require("fs");

const TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.USERNAME;

const QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount }
        }
      }
    }
  }
}`;

function graphql(variables) {
  const body = JSON.stringify({ query: QUERY, variables });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/graphql",
        method: "POST",
        headers: {
          "User-Agent": "streak-generator",
          Authorization: `bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(
              new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`)
            );
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            return reject(new Error(`Bad JSON: ${data.slice(0, 300)}`));
          }
          if (parsed.errors) {
            return reject(
              new Error(
                `GraphQL: ${JSON.stringify(parsed.errors).slice(0, 300)}`
              )
            );
          }
          resolve(parsed.data);
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * days: [{ date: "YYYY-MM-DD", contributionCount: n }] in ascending date order.
 */
function calculateStreaks(days) {
  const total = days.reduce((s, d) => s + d.contributionCount, 0);

  // Longest streak: forward scan.
  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d.contributionCount > 0) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  // Current streak: backward scan from the most recent day.
  // A zero on TODAY does not break the streak (the day isn't over yet);
  // a zero on any earlier day does.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      current += 1;
    } else if (i === days.length - 1) {
      continue; // today, still open
    } else {
      break;
    }
  }

  return { current, longest, total };
}

function generateSVG({ current, longest, total }) {
  const bg = "#1a1b26";
  const text = "#c0caf5";
  const dim = "#565f89";
  const fire = "#f7768e";
  const star = "#e0af68";
  const blue = "#7aa2f7";

  const W = 495;
  const H = 195;
  const col = W / 3;

  const cell = (i, value, label, color, glyph) => {
    const cx = col * i + col / 2;
    return `
  <g>
    <text x="${cx}" y="58" font-size="28" text-anchor="middle">${glyph}</text>
    <text x="${cx}" y="112" font-size="38" font-weight="700" fill="${color}"
          text-anchor="middle" font-family="Segoe UI, Ubuntu, sans-serif">${value}</text>
    <text x="${cx}" y="140" font-size="13" fill="${text}"
          text-anchor="middle" font-family="Segoe UI, Ubuntu, sans-serif">${label}</text>
  </g>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="6" fill="${bg}"/>
${cell(0, total, "Total Contributions", blue, "\u{1F4CA}")}
${cell(1, current, "Current Streak", fire, "\u{1F525}")}
${cell(2, longest, "Longest Streak", star, "\u2B50")}
  <line x1="${col}" y1="35" x2="${col}" y2="${H - 35}" stroke="${dim}" stroke-width="1"/>
  <line x1="${col * 2}" y1="35" x2="${col * 2}" y2="${H - 35}" stroke="${dim}" stroke-width="1"/>
  <text x="${W - 10}" y="${H - 8}" font-size="9" fill="${dim}" text-anchor="end"
        font-family="Segoe UI, Ubuntu, sans-serif">self-hosted \u00B7 last 365 days</text>
</svg>`;
}

async function main() {
  if (!TOKEN || !USERNAME) {
    console.error("Missing env vars.");
    console.error(`  GITHUB_TOKEN: ${TOKEN ? "set" : "MISSING"}`);
    console.error(`  USERNAME:     ${USERNAME || "MISSING"}`);
    process.exit(1);
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  from.setUTCDate(from.getUTCDate() + 1); // API caps the window at 1 year

  console.log(`Querying contribution calendar for ${USERNAME}`);
  console.log(`  window: ${from.toISOString()} -> ${to.toISOString()}`);

  const data = await graphql({
    login: USERNAME,
    from: from.toISOString(),
    to: to.toISOString(),
  });

  const cal = data.user.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w) => w.contributionDays);
  days.sort((a, b) => a.date.localeCompare(b.date));

  console.log(`  days returned: ${days.length}`);

  const stats = calculateStreaks(days);
  console.log(
    `  total=${stats.total} current=${stats.current} longest=${stats.longest}`
  );

  fs.writeFileSync("streak.svg", generateSVG(stats));
  console.log("Wrote streak.svg");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { calculateStreaks, generateSVG };

