#!/usr/bin/env node
/**
 * Generate streak.svg and activity-graph.svg from the GitHub contribution
 * calendar (GraphQL contributionsCollection -> contributionCalendar).
 *
 * One API call feeds both cards. Replaces streak-stats.demolab.com and
 * github-readme-activity-graph.vercel.app, both of which return HTTP 402.
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

// ── Tokyo Night palette ──────────────────────────────────────────────────
const C = {
  bg: "#1a1b26",
  text: "#c0caf5",
  dim: "#565f89",
  fire: "#f7768e",
  star: "#e0af68",
  blue: "#7aa2f7",
  line: "#70a5fd",
};

function graphql(variables) {
  const body = JSON.stringify({ query: QUERY, variables });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/graphql",
        method: "POST",
        headers: {
          "User-Agent": "profile-card-generator",
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

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Streak card ──────────────────────────────────────────────────────────

/** days: [{date:"YYYY-MM-DD", contributionCount:n}] ascending. */
function calculateStreaks(days) {
  const total = days.reduce((s, d) => s + d.contributionCount, 0);

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

  // A zero on TODAY doesn't break the streak (day isn't over); earlier zeros do.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      current += 1;
    } else if (i === days.length - 1) {
      continue;
    } else {
      break;
    }
  }

  return { current, longest, total };
}

function streakSVG({ current, longest, total }) {
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
    <text x="${cx}" y="140" font-size="13" fill="${C.text}"
          text-anchor="middle" font-family="Segoe UI, Ubuntu, sans-serif">${label}</text>
  </g>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="6" fill="${C.bg}"/>
${cell(0, total, "Total Contributions", C.blue, "\u{1F4CA}")}
${cell(1, current, "Current Streak", C.fire, "\u{1F525}")}
${cell(2, longest, "Longest Streak", C.star, "\u2B50")}
  <line x1="${col}" y1="35" x2="${col}" y2="${H - 35}" stroke="${C.dim}" stroke-width="1"/>
  <line x1="${col * 2}" y1="35" x2="${col * 2}" y2="${H - 35}" stroke="${C.dim}" stroke-width="1"/>
  <text x="${W - 10}" y="${H - 8}" font-size="9" fill="${C.dim}" text-anchor="end"
        font-family="Segoe UI, Ubuntu, sans-serif">self-hosted \u00B7 last 365 days</text>
</svg>`;
}

// ── Activity graph ───────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Round up to a clean axis maximum: 1,2,5 x 10^n. */
function niceMax(v) {
  if (v <= 5) return Math.max(v, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

function activityGraphSVG(days, username) {
  const W = 880;
  const H = 300;
  const padL = 50;
  const padR = 24;
  const padT = 60;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = days.length;
  const peak = Math.max(1, ...days.map((d) => d.contributionCount));
  const yMax = niceMax(peak);

  const x = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = (v) => padT + plotH - (v / yMax) * plotH;

  // Y gridlines + labels
  const ticks = 4;
  let grid = "";
  for (let t = 0; t <= ticks; t++) {
    const val = (yMax / ticks) * t;
    const gy = y(val);
    grid += `
  <line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}"
        stroke="${C.dim}" stroke-width="1" opacity="0.25"/>
  <text x="${padL - 10}" y="${(gy + 4).toFixed(1)}" font-size="11" fill="${C.dim}"
        text-anchor="end" font-family="Segoe UI, Ubuntu, sans-serif">${Math.round(val)}</text>`;
  }

  // X month labels: first occurrence of each month
  let xlabels = "";
  let lastMonth = -1;
  days.forEach((d, i) => {
    const m = parseInt(d.date.slice(5, 7), 10) - 1;
    if (m !== lastMonth) {
      lastMonth = m;
      const px = x(i);
      if (px > padL + 12 && px < W - padR - 12) {
        xlabels += `
  <text x="${px.toFixed(1)}" y="${H - padB + 20}" font-size="11" fill="${C.dim}"
        text-anchor="middle" font-family="Segoe UI, Ubuntu, sans-serif">${MONTHS[m]}</text>`;
      }
    }
  });

  const pts = days
    .map((d, i) => `${x(i).toFixed(1)},${y(d.contributionCount).toFixed(1)}`)
    .join(" ");
  const areaPts = `${padL},${padT + plotH} ${pts} ${(padL + plotW).toFixed(1)},${padT + plotH}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.line}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${C.line}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" rx="6" fill="${C.bg}"/>

  <text x="${padL}" y="34" font-size="17" font-weight="600" fill="${C.text}"
        font-family="Segoe UI, Ubuntu, sans-serif">${esc(username)}'s contribution graph</text>
${grid}
  <polygon points="${areaPts}" fill="url(#area)"/>
  <polyline points="${pts}" fill="none" stroke="${C.line}" stroke-width="1.8"
            stroke-linejoin="round" stroke-linecap="round"/>
${xlabels}
  <text x="${W - padR}" y="${H - 10}" font-size="9" fill="${C.dim}" text-anchor="end"
        font-family="Segoe UI, Ubuntu, sans-serif">self-hosted \u00B7 peak ${peak}/day</text>
</svg>`;
}

// ── Main ─────────────────────────────────────────────────────────────────

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

  fs.writeFileSync("streak.svg", streakSVG(stats));
  console.log("Wrote streak.svg");

  fs.writeFileSync("activity-graph.svg", activityGraphSVG(days, USERNAME));
  console.log("Wrote activity-graph.svg");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { calculateStreaks, streakSVG, activityGraphSVG, niceMax };
module.exports = { calculateStreaks, generateSVG };

