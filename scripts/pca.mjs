// First two principal components of a standardised matrix (power iteration with deflation).
export function pca2(Z) {
  const n = Z.length, d = Z[0].length;
  let C = [...Array(d)].map((_, i) => [...Array(d)].map((_, j) => Z.reduce((t, z) => t + z[i] * z[j], 0) / n));
  const total = C.reduce((t, r, i) => t + r[i], 0), comps = [];
  for (let c = 0; c < 2; c++) {
    let v = [...Array(d)].map((_, i) => 1 / (i + 1 + c)), val = 0;
    for (let it = 0; it < 2000; it++) {
      const w = C.map(r => r.reduce((t, x, j) => t + x * v[j], 0)); val = Math.hypot(...w); v = w.map(x => x / val);
    }
    if (v[v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs)))] < 0) v = v.map(x => -x); // fixed sign: biggest loading positive
    comps.push({ vec: v, share: val / total });
    C = C.map((r, i) => r.map((x, j) => x - val * v[i] * v[j]));
  }
  return { comps, points: Z.map(z => comps.map(c => z.reduce((t, x, j) => t + x * c.vec[j], 0))) };
}
