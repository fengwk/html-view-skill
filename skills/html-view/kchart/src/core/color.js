// sRGB 混色与 WCAG 对比度供主题和图形共用；
// CIEDE2000 按 CIE 标准实现；红/绿弱视模拟使用 Machado 等人的线性 RGB 矩阵。
KChart.define('core/color', () => {
  const isHex = (value) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function mix(colorA, colorB, ratio) {
    if (!isHex(colorA) || !isHex(colorB)) throw new TypeError('mix 需要 #RRGGBB 颜色');
    const amount = Number(ratio);
    if (!Number.isFinite(amount)) throw new TypeError('mix 比例必须是有限数');
    const t = clamp(amount, 0, 1);
    const channel = (hex, shift) => parseInt(hex.slice(1 + shift, 3 + shift), 16);
    return `#${[0, 2, 4].map((shift) => Math.round(channel(colorA, shift) * (1 - t) + channel(colorB, shift) * t).toString(16).padStart(2, '0')).join('')}`;
  }

  function luminance(hex) {
    if (!isHex(hex)) throw new TypeError('颜色必须是 #RRGGBB');
    const [r, g, b] = linearRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const contrast = (colorA, colorB) => {
    const [high, low] = [luminance(colorA), luminance(colorB)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };

  // 保留 core.js 的旧实现：在 gamma 编码 sRGB 中量化混色，并二分到最小推进量。
  function pushContrast(color, toward, against, min) {
    if (contrast(color, against) >= min) return color;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 12; i += 1) {
      const middle = (low + high) / 2;
      if (contrast(mix(color, toward, middle), against) >= min) high = middle;
      else low = middle;
    }
    return mix(color, toward, high);
  }

  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const linearRgb = (hex) => hexToRgb(hex).map((v) => toLin(v / 255));
  const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  const labOf = (hex) => {
    const [r, g, b] = linearRgb(hex);
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };

  function deltaE2000(x, y) {
    const [L1, a1, b1] = labOf(x);
    const [L2, a2, b2] = labOf(y);
    const rad = Math.PI / 180;
    const C1 = Math.hypot(a1, b1); const C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
    const a1p = (1 + G) * a1; const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1); const C2p = Math.hypot(a2p, b2);
    let h1p = Math.atan2(b1, a1p) / rad; let h2p = Math.atan2(b2, a2p) / rad;
    if (h1p < 0) h1p += 360; if (h2p < 0) h2p += 360;
    const dLp = L2 - L1; const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
    const Lbar = (L1 + L2) / 2; const CbarP = (C1p + C2p) / 2;
    let hbar = h1p + h2p;
    if (C1p * C2p !== 0) hbar = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
    const T = 1 - 0.17 * Math.cos((hbar - 30) * rad) + 0.24 * Math.cos(2 * hbar * rad)
      + 0.32 * Math.cos((3 * hbar + 6) * rad) - 0.20 * Math.cos((4 * hbar - 63) * rad);
    const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
    const RC = 2 * Math.sqrt(CbarP ** 7 / (CbarP ** 7 + 25 ** 7));
    const SL = 1 + 0.015 * (Lbar - 50) ** 2 / Math.sqrt(20 + (Lbar - 50) ** 2);
    const SC = 1 + 0.045 * CbarP; const SH = 1 + 0.015 * CbarP * T;
    const RT = -Math.sin(2 * dTheta * rad) * RC;
    return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
  }

  const CVD = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  };
  function simulateCvd(hex, type) {
    if (!isHex(hex)) throw new TypeError('颜色必须是 #RRGGBB');
    const matrix = CVD[type];
    if (!matrix) return hex;
    const linear = linearRgb(hex);
    return rgbToHex(matrix.map((row) => fromLin(clamp(row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2], 0, 1)) * 255));
  }

  return { isHex, mix, luminance, contrast, pushContrast, deltaE2000, simulateCvd };
});
