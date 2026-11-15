// Small deterministic k-means (k-means++ seeding, best of many restarts) plus silhouette score.
// Missing values (null) are allowed: a distance is taken over the features both points have and scaled up
// to the full feature count, and a centroid averages only the values that exist. A gap therefore neither
// pulls a market towards a group nor pushes it away.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const d2 = (a, b) => { let t = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { t += (a[i] - b[i]) ** 2; n++; }
  return n ? t * a.length / n : 0; };
export function kmeans(X, k, { restarts = 200, seed = 7 } = {}) {
  const rand = rng(seed); let best = null;
  for (let r = 0; r < restarts; r++) {
    const C = [X[Math.floor(rand() * X.length)]];
    while (C.length < k) {
      const w = X.map(x => Math.min(...C.map(c => d2(x, c)))); let t = rand() * w.reduce((a, b) => a + b, 0), i = 0;
      while (i < X.length - 1 && (t -= w[i]) > 0) i++;
      C.push(X[i]);
    }
    let cent = C.map(c => [...c]), lab = [];
    for (let it = 0; it < 100; it++) {
      const nl = X.map(x => { let bi = 0; cent.forEach((c, i) => { if (d2(x, c) < d2(x, cent[bi])) bi = i; }); return bi; });
      if (nl.every((v, i) => v === lab[i])) break;
      lab = nl;
      cent = cent.map((c, i) => { const m = X.filter((_, j) => lab[j] === i); if (!m.length) return c;
        return c.map((old, f) => { const v = m.map(x => x[f]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : old; }); });
    }
    const inertia = X.reduce((t, x, i) => t + d2(x, cent[lab[i]]), 0);
    if (!best || inertia < best.inertia - 1e-9) best = { labels: lab, centroids: cent, inertia };
  }
  return best;
}
export function silhouette(X, labels) {
  const k = Math.max(...labels) + 1;
  return X.reduce((tot, x, i) => {
    const mean = c => { const m = X.filter((_, j) => labels[j] === c && j !== i); return m.length ? m.reduce((t, y) => t + Math.sqrt(d2(x, y)), 0) / m.length : 0; };
    const a = mean(labels[i]); const b = Math.min(...[...Array(k).keys()].filter(c => c !== labels[i]).map(mean));
    return tot + (Math.max(a, b) ? (b - a) / Math.max(a, b) : 0);
  }, 0) / X.length;
}
