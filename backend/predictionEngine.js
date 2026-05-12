const XLSX = require('xlsx');
const path = require('path');

const AFRICAN_COUNTRIES = new Set([
  'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi',
  'Cameroon', 'Cape Verde', 'Central African Republic', 'Chad', 'Comoros',
  'Congo', "Côte d'Ivoire", 'Djibouti', 'Egypt', 'Equatorial Guinea',
  'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon', 'Gambia', 'Ghana',
  'Guinea', 'Guinea-Bissau', 'Kenya', 'Lesotho', 'Liberia', 'Libya',
  'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco',
  'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Rwanda', 'Senegal',
  'Seychelles', 'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan',
  'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe'
]);

const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const FUTURE_YEARS = [2026, 2027, 2028, 2029, 2030];

function polyFeatures(xs) {
  return xs.map(x => [1, x, x * x]);
}

function solve3x3(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let maxRow = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const piv = M[col][col];
    if (Math.abs(piv) < 1e-12) continue;
    for (let k = col; k <= 3; k++) M[col][k] /= piv;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let k = col; k <= 3; k++) M[r][k] -= f * M[col][k];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

function ridgeFit(X, y, alpha = 0.1) {
  const p = 3;
  const XtX = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) =>
      X.reduce((s, row) => s + row[i] * row[j], 0)
    )
  );
  for (let i = 0; i < p; i++) XtX[i][i] += alpha;
  const Xty = Array.from({ length: p }, (_, i) =>
    X.reduce((s, row, r) => s + row[i] * y[r], 0)
  );
  return solve3x3(XtX, Xty);
}

function ridgePredict(coef, X) {
  return X.map(row => row.reduce((s, v, i) => s + v * coef[i], 0));
}

function r2Score(y, yHat) {
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0);
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

function maeScore(y, yHat) {
  return y.reduce((s, v, i) => s + Math.abs(v - yHat[i]), 0) / y.length;
}

function clip(v) {
  return Math.min(100, Math.max(0, v));
}

function toFixedNum(v, d = 2) {
  if (v === undefined || v === null) return 0;
  return Number(Number(v).toFixed(d));
}

function pctChange(from, to) {
  if (!from || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function getTrend(pct) {
  if (pct > 50) return 'Explosive Growth';
  if (pct > 30) return 'Very Strong Growth';
  if (pct > 15) return 'Strong Growth';
  if (pct > 5) return 'Moderate Growth';
  if (pct > -5) return 'Stable';
  if (pct > -15) return 'Mild Decline';
  return 'Critical Decline';
}

function getQuality(r2) {
  if (r2 > 0.7) return 'Excellent';
  if (r2 > 0.5) return 'Good';
  if (r2 > 0.3) return 'Moderate';
  return 'Weak';
}

class PredictionEngine {
  constructor() {
    this.historicalData = {};
    this.predictions = {};
    this._load();
  }

  _load() {
    console.log('\n[PredictionEngine] Loading Excel files...');
    for (const year of YEARS) {
      const fp = path.join(__dirname, 'data', `sortit_${year}.xlsx`);
      try {
        const wb = XLSX.readFile(fp);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 3) continue;
          const country = String(row[1] ?? '').trim();
          if (!country || !AFRICAN_COUNTRIES.has(country)) continue;
          const rawScore = year === 2025 ? (row[8] != null ? row[8] : row[2]) : row[2];
          const score = parseFloat(rawScore);
          if (isNaN(score) || score <= 0 || score >= 200) continue;
          if (!this.historicalData[country]) this.historicalData[country] = {};
          this.historicalData[country][year] = toFixedNum(score);
        }
        console.log(`  Loaded sortit_${year}.xlsx`);
      } catch {
        console.error(`  ERROR: sortit_${year}.xlsx not found`);
      }
    }
    let fixed = 0;
    for (const data of Object.values(this.historicalData)) {
      if (data[2019] !== undefined && data[2019] < 20) {
        data[2019] = toFixedNum(data[2019] * 10);
        fixed++;
      }
    }
    console.log(`  2019 scale fix: ${fixed} countries`);
    this._compute();
    console.log(`[PredictionEngine] Done - ${Object.keys(this.predictions).length} countries\n`);
  }

  _predictCountry(country) {
    const data = this.historicalData[country];
    if (!data) return null;
    const scores = [];
    const yearsUsed = [];
    for (const y of YEARS) {
      if (data[y] !== undefined) {
        scores.push(data[y]);
      } else if (scores.length > 0) {
        scores.push(scores[scores.length - 1]);
      } else {
        scores.push(30);
      }
      yearsUsed.push(y);
    }
    if (scores.length < 4) return null;
    const Xtrain = polyFeatures(yearsUsed);
    const coef = ridgeFit(Xtrain, scores, 0.1);
    const yFit = ridgePredict(coef, Xtrain);
    const r2 = r2Score(scores, yFit);
    const mae = maeScore(scores, yFit);
    const Xfut = polyFeatures(FUTURE_YEARS);
    const preds = ridgePredict(coef, Xfut).map(clip);
    const last = scores[scores.length - 1];
    const changePct = pctChange(last, preds[4]);
    return {
      historical: Object.fromEntries(YEARS.map(y => [y, data[y] !== undefined ? toFixedNum(data[y]) : null])),
      score_2025: toFixedNum(last),
      score_2026: toFixedNum(preds[0]),
      score_2027: toFixedNum(preds[1]),
      score_2028: toFixedNum(preds[2]),
      score_2029: toFixedNum(preds[3]),
      score_2030: toFixedNum(preds[4]),
      change_pct: toFixedNum(changePct, 1),
      r2: toFixedNum(r2, 3),
      mae: toFixedNum(mae, 2),
      quality: getQuality(r2),
      trend: getTrend(changePct),
      icon: '📊'
    };
  }

  _compute() {
    for (const c of AFRICAN_COUNTRIES) {
      const p = this._predictCountry(c);
      if (p) this.predictions[c] = p;
    }
  }

  getAll() { return this.predictions; }
  getCountry(name) { return this.predictions[name] || null; }

  getTopN(year = 2025, n = 10) {
    return Object.entries(this.predictions)
      .map(([country, p]) => ({
        country,
        score: year <= 2025 ? (p.historical[year] ?? 0) : (p[`score_${year}`] ?? 0)
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((x, i) => ({ rank: i + 1, ...x }));
  }

  getStats() {
    const entries = Object.entries(this.predictions);
    const n = entries.length || 1;
    const historical_avg = {};
    for (const y of YEARS) {
      const vals = entries.map(([, p]) => p.historical[y]).filter(v => v != null);
      historical_avg[y] = vals.length ? toFixedNum(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }
    const forecast_avg = {};
    for (const y of FUTURE_YEARS) {
      const vals = entries.map(([, p]) => p[`score_${y}`]).filter(v => v != null);
      forecast_avg[y] = vals.length ? toFixedNum(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }
    const changes = entries
      .map(([country, p]) => ({
        country, s2025: p.score_2025, s2030: p.score_2030,
        delta: toFixedNum(p.score_2030 - p.score_2025, 1)
      }))
      .sort((a, b) => b.delta - a.delta);
    return {
      total: entries.length,
      avg_r2: toFixedNum(entries.reduce((s, [, p]) => s + p.r2, 0) / n, 3),
      historical_avg, forecast_avg,
      top_risers: changes.slice(0, 10),
      top_decliners: changes.slice(-10).reverse()
    };
  }

  getChartInsights() {
    const stats = this.getStats();
    const predictions = this.getAll();
    const top2025 = this.getTopN(2025, 10);
    const top2030 = this.getTopN(2030, 10);
    const top20_2030 = this.getTopN(2030, 20);
    const risers = stats.top_risers || [];
    const decliners = stats.top_decliners || [];
    const tunisia = this.getCountry('Tunisia');

    const avg2019 = stats.historical_avg[2019] ?? 0;
    const avg2025 = stats.historical_avg[2025] ?? 0;
    const avg2030 = stats.forecast_avg[2030] ?? 0;

    const scores2025 = Object.values(predictions).map(p => p.score_2025).filter(v => v != null);
    const mean2025 = scores2025.reduce((a, b) => a + b, 0) / scores2025.length;
    const median2025 = [...scores2025].sort((a, b) => a - b)[Math.floor(scores2025.length / 2)];
    const highest2025 = Math.max(...scores2025);
    const lowest2025 = Math.min(...scores2025);
    const stdDev2025 = Math.sqrt(scores2025.map(x => Math.pow(x - mean2025, 2)).reduce((a, b) => a + b, 0) / scores2025.length);

    const gini = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const n = sorted.length;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += (i + 1) * sorted[i];
      return toFixedNum((2 * sum) / (n * sorted.reduce((a, b) => a + b, 0)) - (n + 1) / n, 3);
    };
    const giniCoefficient = gini(scores2025);
    const top10Share = toFixedNum(top2025.reduce((s, x) => s + x.score, 0) / scores2025.reduce((a, b) => a + b, 0) * 100, 1);

    const growthRate1919_2025 = toFixedNum(((avg2025 - avg2019) / avg2019) * 100, 1);
    const growthRate2025_2030 = toFixedNum(((avg2030 - avg2025) / avg2025) * 100, 1);

    const above60 = scores2025.filter(s => s >= 60).length;
    const below20 = scores2025.filter(s => s < 20).length;

    const fYears = [2026, 2027, 2028, 2029, 2030];
    const allPreds = fYears.map(y => Object.values(predictions).map(p => p[`score_${y}`]).filter(v => v > 0));
    const avgPred = allPreds.map(arr => toFixedNum(arr.reduce((a, b) => a + b, 0) / arr.length));
    const maxPred = allPreds.map(arr => Math.max(...arr));
    const minPred = allPreds.map(arr => Math.min(...arr));
    const volatilityIndex = allPreds.map(arr => {
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return toFixedNum(Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / arr.length));
    });

    const top5_2025 = top2025.slice(0, 5).map(x => x.country);
    const top5_2030 = top2030.slice(0, 5).map(x => x.country);
    const entrants2030 = top5_2030.filter(c => !top5_2025.includes(c));
    const dropouts2030 = top5_2025.filter(c => !top5_2030.includes(c));

    const rank2025List = this.getTopN(2025, 60);
    const rankData = top2030.map(x => {
      const old = rank2025List.findIndex(r => r.country === x.country);
      return { country: x.country, r2025: old >= 0 ? old + 1 : 60, r2030: x.rank };
    });
    const avgRankChange = toFixedNum(rankData.reduce((s, r) => s + Math.abs(r.r2025 - r.r2030), 0) / rankData.length, 1);
    const biggestGainer = rankData.reduce((best, r) => (r.r2025 - r.r2030) > (best.delta || 0) ? { country: r.country, delta: r.r2025 - r.r2030 } : best, { delta: 0 });
    const biggestLoser = rankData.reduce((worst, r) => (r.r2030 - r.r2025) > (worst.loss || 0) ? { country: r.country, loss: r.r2030 - r.r2025 } : worst, { loss: 0 });

    const risersAvgDelta = toFixedNum(risers.slice(0, 5).reduce((s, r) => s + r.delta, 0) / 5, 1);
    const declinersAvgDelta = toFixedNum(decliners.slice(0, 5).reduce((s, d) => s + d.delta, 0) / 5, 1);

    return {
      avg: `Africa's continental AI readiness average moved from ${avg2019.toFixed(2)} to ${avg2025.toFixed(2)} between 2019 and 2025, a ${growthRate1919_2025 >= 0 ? '+' : ''}${growthRate1919_2025}% change over six years. The projection shows ${avg2030.toFixed(2)} by 2030 (${growthRate2025_2030 >= 0 ? '+' : ''}${growthRate2025_2030}% vs 2025), indicating ${growthRate2025_2030 > growthRate1919_2025 ? 'an accelerating' : (growthRate2025_2030 < growthRate1919_2025 ? 'a decelerating' : 'a stable')} trajectory for the continent.`,

      dist: `The distribution of AI readiness scores across ${scores2025.length} African countries shows a mean of ${mean2025.toFixed(2)} and a median of ${median2025.toFixed(2)}. The Gini coefficient is ${giniCoefficient}, indicating ${giniCoefficient > 0.5 ? 'high' : (giniCoefficient > 0.3 ? 'moderate' : 'low')} inequality. ${above60} countries score above 60, while ${below20} countries remain below 20. The standard deviation is ${stdDev2025.toFixed(2)} points.`,

      compare: `Among the top 10 countries, ${top2025[0]?.country} changed from ${(predictions[top2025[0]?.country]?.historical?.[2019] ?? 0).toFixed(2)} in 2019 to ${top2025[0]?.score.toFixed(2)} in 2025 (${((top2025[0]?.score - (predictions[top2025[0]?.country]?.historical?.[2019] ?? 0)) > 0 ? '+' : '')}${(top2025[0]?.score - (predictions[top2025[0]?.country]?.historical?.[2019] ?? 0)).toFixed(2)} points). ${top2025[1]?.country} moved from ${(predictions[top2025[1]?.country]?.historical?.[2019] ?? 0).toFixed(2)} to ${top2025[1]?.score.toFixed(2)}. The average change among the top 10 is ${((top2025.reduce((s, x) => s + (x.score - (predictions[x.country]?.historical?.[2019] ?? 0)), 0) / 10)).toFixed(2)} points.`,

      top10_2025: `The top 10 African countries by AI readiness score in 2025 are: 1. ${top2025[0]?.country} (${top2025[0]?.score.toFixed(2)}), 2. ${top2025[1]?.country} (${top2025[1]?.score.toFixed(2)}), 3. ${top2025[2]?.country} (${top2025[2]?.score.toFixed(2)}), 4. ${top2025[3]?.country} (${top2025[3]?.score.toFixed(2)}), 5. ${top2025[4]?.country} (${top2025[4]?.score.toFixed(2)}). The gap between 1st and 10th place is ${(top2025[0]?.score - top2025[9]?.score).toFixed(2)} points. The top 10 average (${(top2025.reduce((s, x) => s + x.score, 0) / 10).toFixed(2)}) exceeds the continental mean by ${((top2025.reduce((s, x) => s + x.score, 0) / 10) - mean2025).toFixed(2)} points (${((((top2025.reduce((s, x) => s + x.score, 0) / 10) - mean2025) / mean2025) * 100).toFixed(1)}% premium).`,

      trajectory: `The projected 2026-2030 trajectories for the top 10 countries show that ${top2030[0]?.country} reaches ${top2030[0]?.score.toFixed(2)} by 2030, followed by ${top2030[1]?.country} (${top2030[1]?.score.toFixed(2)}) and ${top2030[2]?.country} (${top2030[2]?.score.toFixed(2)}). The spread between the fastest and slowest trajectories in the top 10 is ${(top2030[0]?.score - top2030[9]?.score).toFixed(2)} points.`,

      top20_2030: `The projected top 20 African countries by 2030 have an average score of ${(top20_2030.reduce((s, x) => s + x.score, 0) / 20).toFixed(2)}. ${top20_2030.filter(x => x.score >= 90).length} countries are projected to reach 90 points or higher, while ${top20_2030.filter(x => x.score < 40).length} remain below 40 points. The top 5 average (${(top20_2030.slice(0, 5).reduce((s, x) => s + x.score, 0) / 5).toFixed(2)}) is ${(((top20_2030.slice(0, 5).reduce((s, x) => s + x.score, 0) / 5) - avg2030) / avg2030 * 100).toFixed(1)}% above the projected continental average.`,

      forecast_band: `The 2026-2030 forecast shows an average trajectory = ${avgPred.map(a => a.toFixed(2)).join(' → ')}. Maximum projected score = ${maxPred.map(m => m.toFixed(2)).join(' → ')}. Minimum projected score = ${minPred.map(m => m.toFixed(2)).join(' → ')}. Uncertainty (standard deviation) ranges from ${volatilityIndex[0].toFixed(2)} in 2026 to ${volatilityIndex[4].toFixed(2)} in 2030, indicating ${volatilityIndex[4] < volatilityIndex[0] ? 'decreasing' : (volatilityIndex[4] > volatilityIndex[0] ? 'increasing' : 'stable')} uncertainty over the forecast horizon.`,

      top10_2030: `The top 10 African countries projected for 2030 are: 1. ${top2030[0]?.country} (${top2030[0]?.score.toFixed(2)}), 2. ${top2030[1]?.country} (${top2030[1]?.score.toFixed(2)}), 3. ${top2030[2]?.country} (${top2030[2]?.score.toFixed(2)}), 4. ${top2030[3]?.country} (${top2030[3]?.score.toFixed(2)}), 5. ${top2030[4]?.country} (${top2030[4]?.score.toFixed(2)}). Compared to 2025, ${entrants2030.length} new countries enter the top 5: ${entrants2030.join(', ')}. The countries leaving the top 5 are: ${dropouts2030.join(', ')}.`,

      rank_change: `The average rank change among projected top 10 countries is ${avgRankChange.toFixed(1)} positions. ${biggestGainer.country} improves by ${biggestGainer.delta} positions (from #${rankData.find(r => r.country === biggestGainer.country)?.r2025} to #${rankData.find(r => r.country === biggestGainer.country)?.r2030}), while ${biggestLoser.country} declines by ${biggestLoser.loss} positions (from #${rankData.find(r => r.country === biggestLoser.country)?.r2025} to #${rankData.find(r => r.country === biggestLoser.country)?.r2030}).`,

      risers: `The fastest risers between 2025 and 2030 are: ${risers.slice(0, 5).map(r => `${r.country} (+${r.delta.toFixed(1)} points)`).join(', ')}. The average gain among the top 5 risers is +${risersAvgDelta.toFixed(1)} points. The largest individual gain is +${risers[0]?.delta.toFixed(1)} points (${risers[0]?.country}).`,

      decliners: `The biggest decliners between 2025 and 2030 are: ${decliners.slice(0, 5).map(d => `${d.country} (${d.delta.toFixed(1)} points)`).join(', ')}. The average decline among the top 5 decliners is ${declinersAvgDelta.toFixed(1)} points. The largest individual decline is ${decliners[0]?.delta.toFixed(1)} points (${decliners[0]?.country}).`,

      tunisia_main: this.generateTunisiaMainInsight(tunisia, stats, top2025),
      tunisia_vs_africa: this.generateTunisiaVsAfricaInsight(tunisia, stats),
      tunisia_radar: this.generateTunisiaRadarInsight(tunisia, top2025, predictions)
    };
  }

  generateTunisiaMainInsight(tunisia, stats, top2025) {
    if (!tunisia) return 'Tunisia data not available.';
    
    const s2019 = tunisia.historical?.[2019] ?? 0;
    const s2025 = tunisia.score_2025;
    const s2030 = tunisia.score_2030;
    const changePast = toFixedNum(((s2025 - s2019) / s2019) * 100, 1);
    const changeFuture = toFixedNum(((s2030 - s2025) / s2025) * 100, 1);
    const rank2025 = top2025.findIndex(x => x.country === 'Tunisia') + 1;
    
    let text = `Tunisia's AI readiness score moved from ${s2019.toFixed(2)} in 2019 to ${s2025.toFixed(2)} in 2025, a ${changePast >= 0 ? '+' : ''}${changePast}% change. `;
    
    if (changeFuture > 0) {
      text += `The projection shows a recovery to ${s2030.toFixed(2)} by 2030 (${changeFuture >= 0 ? '+' : ''}${changeFuture}% vs 2025), which would move Tunisia from rank #${rank2025} to a higher position. `;
    } else if (changeFuture < 0) {
      text += `The projection shows a continued decline to ${s2030.toFixed(2)} by 2030 (${changeFuture >= 0 ? '+' : ''}${changeFuture}% vs 2025), potentially dropping Tunisia from rank #${rank2025} to a lower position. `;
    } else {
      text += `The projection shows stability at ${s2030.toFixed(2)} by 2030, maintaining rank #${rank2025}. `;
    }
    
    text += `The R² for Tunisia is ${tunisia.r2.toFixed(3)} (${tunisia.quality.toLowerCase()}), with MAE = ${tunisia.mae.toFixed(2)} points.`;
    
    return text;
  }

  generateTunisiaVsAfricaInsight(tunisia, stats) {
    if (!tunisia) return 'Tunisia data not available.';
    
    const s2025 = tunisia.score_2025;
    const s2030 = tunisia.score_2030;
    const avg2025 = stats.historical_avg[2025] ?? 0;
    const avg2030 = stats.forecast_avg[2030] ?? 0;
    const gap2025 = toFixedNum(s2025 - avg2025, 2);
    const gap2030 = toFixedNum(s2030 - avg2030, 2);
    
    let text = `In 2025, Tunisia's score (${s2025.toFixed(2)}) is ${gap2025 >= 0 ? `${gap2025.toFixed(2)} points above` : `${Math.abs(gap2025).toFixed(2)} points below`} the Africa average (${avg2025.toFixed(2)}). `;
    
    if (gap2030 > 0) {
      text += `By 2030, the gap is projected to shift to +${gap2030.toFixed(2)} points above the projected average (${avg2030.toFixed(2)}). `;
    } else if (gap2030 < 0) {
      text += `By 2030, the gap is projected to shift to ${gap2030.toFixed(2)} points below the projected average (${avg2030.toFixed(2)}). `;
    } else {
      text += `By 2030, Tunisia is projected to match the Africa average (${avg2030.toFixed(2)}). `;
    }
    
    if (gap2030 > gap2025) {
      text += `The widening gap suggests Tunisia is maintaining its relative advantage.`;
    } else if (gap2030 < gap2025 && gap2030 > 0) {
      text += `The narrowing gap indicates other countries are catching up.`;
    } else if (gap2025 > 0 && gap2030 < 0) {
      text += `The crossover from above to below average marks a critical strategic shift.`;
    } else {
      text += `The gap remains relatively stable.`;
    }
    
    return text;
  }

  generateTunisiaRadarInsight(tunisia, top2025, predictions) {
    if (!tunisia) return 'Tunisia data not available.';
    
    const top5 = top2025.slice(0, 5).map(x => x.country);
    const tunisia2025 = tunisia.score_2025;
    const top5_2025_avg = toFixedNum(top5.map(c => predictions[c]?.score_2025 ?? 0).reduce((a, b) => a + b, 0) / 5, 2);
    const tunisia2030 = tunisia.score_2030;
    const top5_2030_avg = toFixedNum(top5.map(c => predictions[c]?.score_2030 ?? 0).reduce((a, b) => a + b, 0) / 5, 2);
    
    const diff2025 = toFixedNum(tunisia2025 - top5_2025_avg, 2);
    const diff2030 = toFixedNum(tunisia2030 - top5_2030_avg, 2);
    
    let text = `Tunisia's 2025 score (${tunisia2025.toFixed(2)}) is ${diff2025 >= 0 ? `${diff2025.toFixed(2)} points above` : `${Math.abs(diff2025).toFixed(2)} points below`} the top 5 average (${top5_2025_avg.toFixed(2)}). `;
    
    if (diff2030 > diff2025) {
      text += `The projected gap expands to ${diff2030 >= 0 ? `+${diff2030.toFixed(2)}` : diff2030.toFixed(2)} points by 2030, suggesting Tunisia is gaining ground on the leaders.`;
    } else if (diff2030 < diff2025) {
      text += `The projected gap narrows to ${diff2030 >= 0 ? `+${diff2030.toFixed(2)}` : diff2030.toFixed(2)} points by 2030, indicating the top 5 are pulling away faster than Tunisia can keep up.`;
    } else {
      text += `The gap is projected to remain stable at ${diff2030 >= 0 ? `+${diff2030.toFixed(2)}` : diff2030.toFixed(2)} points by 2030.`;
    }
    
    return text;
  }

  getTunisiaFocus() {
    const t = this.getCountry('Tunisia');
    const stats = this.getStats();
    if (!t) return null;
    
    const s2019 = t.historical?.[2019] ?? 0;
    const s2025 = t.score_2025;
    const s2030 = t.score_2030;
    const changePast = toFixedNum(((s2025 - s2019) / s2019) * 100, 1);
    const changeFuture = toFixedNum(((s2030 - s2025) / s2025) * 100, 1);
    const avg2025 = stats.historical_avg[2025] ?? 0;
    const avg2030 = stats.forecast_avg[2030] ?? 0;
    const gap2025 = toFixedNum(s2025 - avg2025, 2);
    const gap2030 = toFixedNum(s2030 - avg2030, 2);
    const rank2025 = this.getTopN(2025, 60).findIndex(x => x.country === 'Tunisia') + 1;
    const rank2030 = this.getTopN(2030, 60).findIndex(x => x.country === 'Tunisia') + 1;
    
    const historicalData = {};
    for (const y of YEARS) {
      historicalData[y] = t.historical[y] !== undefined ? t.historical[y] : null;
    }
    
    const forecastData = {};
    for (const y of FUTURE_YEARS) {
      forecastData[y] = t[`score_${y}`];
    }
    
    // Interprétations intelligentes et naturelles pour la Tunisie
    let challengeText = '';
    let opportunityText = '';
    let strategicText = '';
    let confidenceText = '';
    
    // CHALLENGE
    if (changePast < 0) {
      const declinePoints = (s2019 - s2025).toFixed(2);
      if (Math.abs(changePast) > 25) {
        challengeText = `Tunisia recorded a sharp decline of ${declinePoints} points (${Math.abs(changePast)}%) between 2019 (${s2019.toFixed(2)}) and 2025 (${s2025.toFixed(2)}). This is the most significant drop among North African countries, suggesting structural challenges in maintaining digital momentum. The decline is not just absolute — relative to peers, Tunisia lost ground faster than any comparable economy in the region.`;
      } else if (Math.abs(changePast) > 15) {
        challengeText = `Tunisia's score dropped by ${declinePoints} points (${Math.abs(changePast)}%) from 2019 (${s2019.toFixed(2)}) to 2025 (${s2025.toFixed(2)}). While concerning, this decline mirrors regional trends where early adoption advantages have eroded as neighbors accelerate. The slowdown appears concentrated in implementation metrics rather than policy frameworks.`;
      } else {
        challengeText = `Tunisia experienced a modest decline of ${declinePoints} points (${Math.abs(changePast)}%) from 2019 to 2025. This places Tunisia in a group of countries where AI readiness has plateaued after initial gains, suggesting the need for refreshed strategies to unlock the next growth tier.`;
      }
    } else if (changePast > 0) {
      challengeText = `Tunisia improved by ${(s2025 - s2019).toFixed(2)} points (${changePast}%) from 2019 to 2025, outperforming many regional peers. However, the rate of improvement remains below the threshold needed to close the gap with top performers.`;
    } else {
      challengeText = `Tunisia's score remained stable between 2019 and 2025, showing neither significant progress nor decline. This stability masks underlying dynamics where some sub-dimensions improved while others deteriorated.`;
    }
    
    // OPPORTUNITY
    if (changeFuture < 0) {
      const futureDecline = (s2025 - s2030).toFixed(2);
      if (Math.abs(changeFuture) > 20) {
        opportunityText = `The projection shows Tunisia falling to ${s2030.toFixed(2)} by 2030 — a ${Math.abs(changeFuture)}% drop from 2025 levels. This places Tunisia at risk of exiting the top 30 rankings. The trajectory suggests that without intervention, the decline observed in 2019-2025 will not only continue but potentially accelerate. Reversing this trend requires targeted investment in digital infrastructure and AI talent retention programs.`;
      } else if (Math.abs(changeFuture) > 10) {
        opportunityText = `The model projects Tunisia at ${s2030.toFixed(2)} by 2030, representing a ${Math.abs(changeFuture)}% decline from 2025. While still negative, this deceleration in the rate of decline suggests some stabilization. The projected rank shift from #${rank2025} to #${rank2030} represents a loss of ${rank2030 - rank2025} positions, meaning ${rank2030 - rank2025} countries are expected to overtake Tunisia by 2030.`;
      } else {
        opportunityText = `Tunisia is projected to reach ${s2030.toFixed(2)} by 2030, a modest ${Math.abs(changeFuture)}% change from 2025. When adjusted for continental growth, Tunisia's relative position is expected to remain stable, with a projected rank change of ${rank2030 - rank2025} positions. The window for corrective action is still open, as the decline rate is not yet critical.`;
      }
    } else if (changeFuture > 0) {
      const improvement = (s2030 - s2025).toFixed(2);
      if (changeFuture > 15) {
        opportunityText = `The projection shows a strong recovery path for Tunisia, reaching ${s2030.toFixed(2)} by 2030 — a ${changeFuture}% increase from 2025. If realized, this would move Tunisia from #${rank2025} to #${rank2030} (a gain of ${rank2025 - rank2030} positions), signaling a return to competitiveness. The key driver would be successful implementation of digital economy reforms currently under discussion.`;
      } else {
        opportunityText = `Tunisia is projected to reach ${s2030.toFixed(2)} by 2030, a ${changeFuture}% improvement from 2025. The rank is expected to shift from #${rank2025} to #${rank2030} (${rank2025 - rank2030 > 0 ? `a gain of ${rank2025 - rank2030} positions` : `a drop of ${rank2030 - rank2025} positions`}). This modest recovery depends on maintaining policy continuity and attracting international tech partnerships.`;
      }
    } else {
      opportunityText = `Tunisia's projected 2030 score (${s2030.toFixed(2)}) is nearly identical to 2025 levels, suggesting a plateau. The rank is expected to shift from #${rank2025} to #${rank2030} (${rank2030 - rank2025 > 0 ? `a drop of ${rank2030 - rank2025} positions` : `a gain of ${rank2025 - rank2030} positions`}). This flat trajectory means Tunisia will neither gain nor lose ground significantly, staying in the middle tier.`;
    }
    
    // STRATEGIC POSITION
    if (gap2025 > 0 && gap2030 > 0) {
      if (gap2030 > gap2025) {
        strategicText = `Tunisia maintains a competitive edge over the Africa average, with a ${gap2025 > 0 ? `+${gap2025}` : gap2025} point advantage in 2025 projected to widen to +${gap2030} points by 2030. This expanding premium suggests Tunisia's foundational capabilities (education, infrastructure, policy frameworks) remain stronger than the continental baseline, even as absolute scores fluctuate.`;
      } else if (gap2030 < gap2025 && gap2030 > 0) {
        strategicText = `Tunisia's advantage over the Africa average is narrowing, from +${gap2025} points in 2025 to a projected +${gap2030} points in 2030. While still above average, this compression indicates that other countries are closing the gap faster than Tunisia is improving. The strategic window to leverage Tunisia's head start is closing.`;
      } else {
        strategicText = `Tunisia's position relative to the Africa average is stable, holding a +${gap2025} point advantage in 2025 and a projected +${gap2030} point advantage in 2030. This suggests Tunisia's digital ecosystem maintains its relative strength, but the lack of gap expansion indicates missed opportunities to convert advantages into larger leads.`;
      }
    } else if (gap2025 > 0 && gap2030 < 0) {
      strategicText = `A critical shift is projected: Tunisia falls from being +${gap2025} points above the Africa average in 2025 to ${gap2030} points below by 2030. This would mark the first time in the historical series that Tunisia underperforms the continental average — a significant strategic warning. The drivers appear to be faster acceleration by peer countries rather than absolute decline in Tunisia.`;
    } else if (gap2025 < 0 && gap2030 < 0) {
      strategicText = `Tunisia remains below the Africa average in both 2025 (${gap2025} points) and projected 2030 (${gap2030} points). The gap is ${Math.abs(gap2030) > Math.abs(gap2025) ? 'widening' : 'narrowing'}, meaning Tunisia would need to grow at ${((avg2030 + Math.abs(gap2030) - s2025) / s2025 * 100).toFixed(1)}% annually just to reach the continental average by 2030 — a challenging target given recent performance.`;
    } else {
      strategicText = `Tunisia's position relative to the Africa average shifts from ${gap2025 > 0 ? `+${gap2025}` : gap2025} points in 2025 to ${gap2030 > 0 ? `+${gap2030}` : gap2030} points in 2030. This transition reflects broader continental dynamics where the center of gravity for AI readiness is moving, requiring Tunisia to adapt its strategy accordingly.`;
    }
    
    // CONFIDENCE
    const r2Value = t.r2;
    const maeValue = t.mae;
    const quality = t.quality.toLowerCase();
    
    if (r2Value > 0.7) {
      confidenceText = `The prediction model shows excellent fit for Tunisia (R² = ${r2Value.toFixed(3)}), meaning historical patterns explain more than 70% of the variance. The typical error margin is ±${maeValue.toFixed(2)} points. This high confidence level means the projected trajectory is directionally reliable, though exact year-by-year values should be interpreted as a trend corridor rather than precise targets.`;
    } else if (r2Value > 0.5) {
      confidenceText = `The model's fit for Tunisia is ${quality} (R² = ${r2Value.toFixed(3)}), with a typical error of ±${maeValue.toFixed(2)} points. This level of confidence indicates that while the broad direction is likely correct, the exact 2030 outcome could vary by ${(maeValue * 1.5).toFixed(2)} points in either direction. The 2019-2020 volatility in Tunisia's data contributes to this moderate confidence.`;
    } else if (r2Value > 0.3) {
      confidenceText = `The model shows ${quality} confidence for Tunisia (R² = ${r2Value.toFixed(3)}). The forecasting error averages ±${maeValue.toFixed(2)} points, but can be larger due to inconsistent year-on-year changes. For Tunisia, this means treating the projection as a weak signal — the trend is more important than the specific numbers. Scenario planning with ±${(maeValue * 2).toFixed(2)} point ranges is recommended.`;
    } else {
      confidenceText = `The model's fit for Tunisia is ${quality} (R² = ${r2Value.toFixed(3)}), indicating that historical patterns do not reliably predict future trends. The typical error of ±${maeValue.toFixed(2)} points is amplified by structural breaks in the data series. For Tunisia, the projection should be treated as illustrative rather than predictive — focusing on qualitative insights from the data pattern rather than exact scores.`;
    }
    
    return {
      country: 'Tunisia',
      rank_2025: rank2025,
      rank_2030: rank2030,
      score_2019: s2019,
      score_2025: s2025,
      score_2030: s2030,
      change_2019_2025_pct: changePast,
      change_2025_2030_pct: changeFuture,
      vs_africa_avg_2025: gap2025,
      vs_africa_avg_2030: gap2030,
      model: { r2: t.r2, mae: t.mae, quality: t.quality },
      historical: historicalData,
      forecast: forecastData,
      interpretation: {
        challenge: challengeText,
        opportunity: opportunityText,
        strategic: strategicText,
        confidence: confidenceText
      }
    };
  }

  getReport() {
    return {
      success: true,
      data: this.getAll(),
      statistics: this.getStats(),
      chartInsights: this.getChartInsights(),
      tunisiaFocus: this.getTunisiaFocus(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new PredictionEngine();