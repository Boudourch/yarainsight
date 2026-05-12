const API_URL = 'http://localhost:5001/api/predictions/africa/report';

const COLORS = {
  gold: '#E8B84B', blue: '#4F8EF7', green: '#34D399', red: '#F87171',
  purple: '#A78BFA', orange: '#FB923C', teal: '#2DD4BF',
  pink: '#F472B6', yellow: '#FACC15', lime: '#A3E635'
};

const PALETTE = [
  COLORS.gold, COLORS.blue, COLORS.green, COLORS.red, COLORS.purple,
  COLORS.orange, COLORS.teal, COLORS.pink, COLORS.yellow, COLORS.lime
];

Chart.defaults.color = '#9BA3BC';
Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
Chart.defaults.font.family = 'Inter';

function rgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function setStatus(type, text) {
  const el = document.getElementById('status');
  el.className = `status ${type}`;
  el.textContent = text;
  // Auto-hide on success
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 100);
  }
}

function topNFromData(data, year, n = 10) {
  return Object.entries(data)
    .map(([country, p]) => ({
      country,
      score: year <= 2025 ? (p.historical?.[year] ?? 0) : (p[`score_${year}`] ?? 0)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x, i) => ({ rank: i + 1, ...x }));
}

function fillOverview(stats, data) {
  // Hero meta — only total and R², no timestamp
  document.getElementById('meta-total').textContent = stats.total ?? '--';
  document.getElementById('meta-r2').textContent = String(stats.avg_r2 ?? '--');

  const top2025 = topNFromData(data, 2025, 1)[0];
  const avg2025 = stats.historical_avg?.[2025] ?? 0;
  const avg2030 = stats.forecast_avg?.[2030] ?? 0;
  const min2025 = Math.min(...Object.values(data).map((x) => x.score_2025 || 999));
  const max2025 = Math.max(...Object.values(data).map((x) => x.score_2025 || 0));

  document.getElementById('overview-kpis').innerHTML = `
    <div class="card kpi"><div class="kpi-val">${top2025 ? top2025.score.toFixed(2) : '--'}</div><div class="kpi-label">Highest Score 2025</div><div class="kpi-sub">${top2025 ? top2025.country : '--'}</div></div>
    <div class="card kpi"><div class="kpi-val">${avg2025.toFixed(2)}</div><div class="kpi-label">Africa Avg 2025</div><div class="kpi-sub">historical</div></div>
    <div class="card kpi"><div class="kpi-val">${avg2030.toFixed(2)}</div><div class="kpi-label">Africa Avg 2030</div><div class="kpi-sub">forecast</div></div>
    <div class="card kpi"><div class="kpi-val">${(max2025 - min2025).toFixed(2)}</div><div class="kpi-label">Score Gap 2025</div><div class="kpi-sub">max - min</div></div>
  `;
}

function fillTables(data, tunisia, stats) {
  const top2025 = topNFromData(data, 2025, 10);
  const top2030 = topNFromData(data, 2030, 10);

  document.getElementById('top10-2025-tbody').innerHTML = top2025.map((c) => `
    <tr><td>${c.rank}</td><td><strong>${c.country}</strong></td><td>${c.score.toFixed(2)}</td></tr>
  `).join('');

  document.getElementById('top10-2030-tbody').innerHTML = top2030.map((c) => {
    const s2025 = data[c.country]?.score_2025 ?? 0;
    const d = c.score - s2025;
    return `<tr><td>${c.rank}</td><td><strong>${c.country}</strong></td><td>${c.score.toFixed(2)}</td><td>${s2025.toFixed(2)}</td><td>${d >= 0 ? '+' : ''}${d.toFixed(2)}</td></tr>`;
  }).join('');

  document.getElementById('full-pred-tbody').innerHTML = Object.entries(data)
    .sort((a, b) => (b[1].score_2030 ?? 0) - (a[1].score_2030 ?? 0))
    .map(([country, p]) => {
      const d = (p.score_2030 ?? 0) - (p.score_2025 ?? 0);
      return `<tr>
        <td>${country}</td>
        <td>${(p.score_2025 ?? 0).toFixed(2)}</td>
        <td>${(p.score_2026 ?? 0).toFixed(2)}</td>
        <td>${(p.score_2027 ?? 0).toFixed(2)}</td>
        <td>${(p.score_2028 ?? 0).toFixed(2)}</td>
        <td>${(p.score_2029 ?? 0).toFixed(2)}</td>
        <td>${(p.score_2030 ?? 0).toFixed(2)}</td>
        <td>${d >= 0 ? '+' : ''}${d.toFixed(2)}</td>
        <td>${p.trend || '—'}</td>
      </tr>`;
    }).join('');

  if (!tunisia) return;

  document.getElementById('tunisia-kpis').innerHTML = `
    <div class="card kpi"><div class="kpi-val">${(tunisia.score_2025 ?? 0).toFixed(2)}</div><div class="kpi-label">Score 2025</div><div class="kpi-sub">#${tunisia.rank_2025 || '--'} in Africa</div></div>
    <div class="card kpi"><div class="kpi-val">${tunisia.change_2019_2025_pct ?? '--'}%</div><div class="kpi-label">Change 2019→2025</div><div class="kpi-sub">historical</div></div>
    <div class="card kpi"><div class="kpi-val">${(tunisia.score_2030 ?? 0).toFixed(2)}</div><div class="kpi-label">Predicted 2030</div><div class="kpi-sub">${tunisia.change_2025_2030_pct ?? '--'}%</div></div>
    <div class="card kpi"><div class="kpi-val">${((tunisia.model?.r2 ?? 0) * 100).toFixed(1)}%</div><div class="kpi-label">Model R²</div><div class="kpi-sub">${tunisia.model?.quality || '--'}</div></div>
  `;

  const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];
  document.getElementById('tunisia-table-body').innerHTML = years.map((y) => {
    const s = y <= 2025 ? (tunisia.historical?.[y] ?? null) : (tunisia.forecast?.[y] ?? null);
    const avg = y <= 2025 ? (stats.historical_avg?.[y] ?? null) : (stats.forecast_avg?.[y] ?? null);
    const d = s != null && avg != null ? (s - avg) : null;
    return `<tr>
      <td>${y}</td>
      <td>${s != null ? s.toFixed(2) : '--'}</td>
      <td>${y <= 2025 ? 'Historical' : 'Forecast'}</td>
      <td>${d != null ? (d >= 0 ? '+' : '') + d.toFixed(2) : '--'}</td>
    </tr>`;
  }).join('');

  document.getElementById('tunisia-i1').textContent = tunisia.interpretation?.challenge || '—';
  document.getElementById('tunisia-i2').textContent = tunisia.interpretation?.opportunity || '—';
  document.getElementById('tunisia-i3').textContent = tunisia.interpretation?.strategic || '—';
  document.getElementById('tunisia-i4').textContent = tunisia.interpretation?.confidence || '—';
}

function buildCharts(report) {
  const { data, statistics: stats, tunisiaFocus: tunisia } = report;
  const top2025  = topNFromData(data, 2025, 10);
  const top2030  = topNFromData(data, 2030, 10);
  const top20_2030 = topNFromData(data, 2030, 20);
  const years    = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

  new Chart(document.getElementById('avgChart'), {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        { label: 'Historical', data: years.map((y) => stats.historical_avg?.[y] ?? null), borderColor: COLORS.gold, tension: 0.35 },
        { label: 'Forecast',   data: years.map((y) => stats.forecast_avg?.[y] ?? null),   borderColor: COLORS.blue, borderDash: [6, 4], tension: 0.35 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const scores2025 = Object.values(data).map((p) => p.score_2025).filter((v) => typeof v === 'number');
  const bins  = [0,10,20,30,40,50,60,70,80,90,100];
  const counts = bins.slice(0,-1).map((b, i) => scores2025.filter((s) => s >= b && s < bins[i+1]).length);
  new Chart(document.getElementById('distChart'), {
    type: 'bar',
    data: { labels: bins.slice(0,-1).map((b,i) => `${b}-${bins[i+1]}`), datasets: [{ data: counts, backgroundColor: PALETTE }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  new Chart(document.getElementById('compareChart'), {
    type: 'bar',
    data: {
      labels: top2025.map((x) => x.country),
      datasets: [
        { label: '2019', data: top2025.map((x) => data[x.country]?.historical?.[2019] ?? null), backgroundColor: rgba(COLORS.purple, 0.6) },
        { label: '2025', data: top2025.map((x) => data[x.country]?.score_2025 ?? null),         backgroundColor: rgba(COLORS.gold,   0.8) }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  new Chart(document.getElementById('top10_2025Chart'), {
    type: 'bar',
    data: { labels: top2025.map((x) => x.country), datasets: [{ data: top2025.map((x) => x.score), backgroundColor: PALETTE }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
  });

  new Chart(document.getElementById('predTrajectoryChart'), {
    type: 'line',
    data: {
      labels: [2026, 2027, 2028, 2029, 2030],
      datasets: top2030.map((x, i) => ({
        label: x.country,
        data: [2026,2027,2028,2029,2030].map((y) => data[x.country]?.[`score_${y}`] ?? null),
        borderColor: PALETTE[i % PALETTE.length], tension: 0.35
      }))
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  new Chart(document.getElementById('pred2030BarChart'), {
    type: 'bar',
    data: {
      labels: top20_2030.map((x) => x.country),
      datasets: [{ data: top20_2030.map((x) => x.score), backgroundColor: top20_2030.map((_,i) => PALETTE[i % PALETTE.length]) }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
  });

  const allPreds = [2026,2027,2028,2029,2030].map((y) =>
    Object.values(data).map((p) => p[`score_${y}`]).filter((v) => typeof v === 'number')
  );
  new Chart(document.getElementById('forecastBandChart'), {
    type: 'line',
    data: {
      labels: [2026, 2027, 2028, 2029, 2030],
      datasets: [
        { label: 'Max',     data: allPreds.map((a) => Math.max(...a)),                        borderColor: rgba(COLORS.green, 0.7), borderDash: [4,2], tension: 0.35 },
        { label: 'Average', data: allPreds.map((a) => a.reduce((s,v)=>s+v,0)/a.length),       borderColor: COLORS.gold, borderWidth: 2.5, tension: 0.35 },
        { label: 'Min',     data: allPreds.map((a) => Math.min(...a)),                        borderColor: rgba(COLORS.red, 0.7), borderDash: [4,2], tension: 0.35 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  new Chart(document.getElementById('top10_2030Chart'), {
    type: 'bar',
    data: {
      labels: top2030.map((x) => x.country),
      datasets: [
        { label: '2025', data: top2030.map((x) => data[x.country]?.score_2025 ?? 0), backgroundColor: rgba(COLORS.purple, 0.5) },
        { label: '2030', data: top2030.map((x) => x.score),                          backgroundColor: rgba(COLORS.gold,   0.85) }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' }
  });

  const rank2025 = topNFromData(data, 2025, 60);
  const rankShift = top2030.map((x) => {
    const old = rank2025.findIndex((r) => r.country === x.country);
    return { country: x.country, r2025: old >= 0 ? old + 1 : 60, r2030: x.rank };
  });
  new Chart(document.getElementById('rankChangeChart'), {
    type: 'bar',
    data: {
      labels: rankShift.map((x) => x.country),
      datasets: [
        { label: 'Rank 2025', data: rankShift.map((x) => x.r2025), backgroundColor: rgba(COLORS.purple, 0.6) },
        { label: 'Rank 2030', data: rankShift.map((x) => x.r2030), backgroundColor: rgba(COLORS.gold, 0.8) }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { reverse: true, min: 1, max: 60 } } }
  });

  new Chart(document.getElementById('risersChart'), {
    type: 'bar',
    data: {
      labels: (stats.top_risers || []).slice(0,8).map((x) => x.country),
      datasets: [{ data: (stats.top_risers || []).slice(0,8).map((x) => x.delta), backgroundColor: rgba(COLORS.green, 0.75) }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  new Chart(document.getElementById('declinersChart'), {
    type: 'bar',
    data: {
      labels: (stats.top_decliners || []).slice(0,8).map((x) => x.country),
      datasets: [{ data: (stats.top_decliners || []).slice(0,8).map((x) => x.delta), backgroundColor: rgba(COLORS.red, 0.75) }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  if (!tunisia) return;

  const tunYears = [2019,2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,2030];
  const tunLine  = tunYears.map((y) => y <= 2025 ? (tunisia.historical?.[y] ?? null) : (tunisia.forecast?.[y] ?? null));
  const avgLine  = tunYears.map((y) => y <= 2025 ? (stats.historical_avg?.[y] ?? null) : (stats.forecast_avg?.[y] ?? null));

  new Chart(document.getElementById('tunisiaMainChart'), {
    type: 'line',
    data: {
      labels: tunYears,
      datasets: [
        { label: 'Tunisia',    data: tunLine, borderColor: COLORS.gold,   borderWidth: 3, tension: 0.35 },
        { label: 'Africa Avg', data: avgLine, borderColor: COLORS.purple, borderDash: [4,3], tension: 0.35 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  new Chart(document.getElementById('tunisiaVsAfricaChart'), {
    type: 'line',
    data: {
      labels: tunYears,
      datasets: [
        { label: 'Tunisia',    data: tunLine, borderColor: COLORS.gold,   tension: 0.35 },
        { label: 'Africa Avg', data: avgLine, borderColor: COLORS.purple, tension: 0.35 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const top5 = topNFromData(data, 2025, 5).map((x) => x.country);
  const radarCountries = [...top5, 'Tunisia'];
  const radarYears     = [2025, 2026, 2027, 2028, 2029, 2030];
  new Chart(document.getElementById('tunisiaVsTop5Chart'), {
    type: 'radar',
    data: {
      labels: radarYears.map((y) => `Score ${y}`),
      datasets: radarCountries.map((c, i) => ({
        label: c,
        data: radarYears.map((y) => y <= 2025
          ? (data[c]?.historical?.[y] ?? data[c]?.score_2025 ?? 0)
          : (data[c]?.[`score_${y}`] ?? 0)),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: rgba(PALETTE[i % PALETTE.length], 0.06),
        borderWidth: c === 'Tunisia' ? 3 : 1.5
      }))
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function writeChartInsights(report) {
  const ci = report.chartInsights || {};
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt || '—'; };
  set('insight-avg',              ci.avg);
  set('insight-dist',             ci.dist);
  set('insight-compare',          ci.compare);
  set('insight-top10-2025',       ci.top10_2025);
  set('insight-trajectory',       ci.trajectory);
  set('insight-top20-2030',       ci.top20_2030);
  set('insight-forecast-band',    ci.forecast_band);
  set('insight-top10-2030',       ci.top10_2030);
  set('insight-rank-change',      ci.rank_change);
  set('insight-risers',           ci.risers);
  set('insight-decliners',        ci.decliners);
  set('insight-tunisia-main',     ci.tunisia_main);
  set('insight-tunisia-vs-africa',ci.tunisia_vs_africa);
  set('insight-tunisia-radar',    ci.tunisia_radar);
}

async function init() {
  setStatus('loading', 'Loading predictions...');
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const report = await res.json();
    if (!report.success) throw new Error(report.error || 'Backend error');

    fillOverview(report.statistics, report.data);
    fillTables(report.data, report.tunisiaFocus, report.statistics);
    buildCharts(report);
    writeChartInsights(report);

    // Hide status bar completely on success
    setStatus('success', '');

  } catch (err) {
    console.error(err);
    setStatus('error', `Failed to load: ${err.message}`);
  }
}

init();