export const round = (x, d = 2) => {
  const p = 10 ** d;
  return Math.round((x ?? 0) * p) / p;
};

// 밀도(명/㎡) → 혼잡 히트 색상(연녹 → 황 → 적). ρ_cap 기준 정규화.
export function heatColor(density, rhoCap = 5.0) {
  const t = Math.max(0, Math.min(1, (density ?? 0) / rhoCap));
  // 0: 연녹(220,252,231) → 0.5: 황(254,240,138) → 1: 적(220,38,38)
  let r, g, b;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(220 + (254 - 220) * u);
    g = Math.round(252 + (240 - 252) * u);
    b = Math.round(231 + (138 - 231) * u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(254 + (220 - 254) * u);
    g = Math.round(240 + (38 - 240) * u);
    b = Math.round(138 + (38 - 138) * u);
  }
  return `rgb(${r},${g},${b})`;
}

export function downloadBlob(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
