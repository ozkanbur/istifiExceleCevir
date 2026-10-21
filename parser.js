/* parser.js — ORBİS "İstif Ebat Listesi" PDF ayrıştırıcı (tarayıcı + Node)
 *
 * Gerçek PDF'lerden öğrenilenler:
 *  - Satır: "2026 / 738 A02606564 21 3.5 1 0,121"
 *  - Boy noktalı (3.5), Hacim virgüllü (0,121)
 *  - Sayfa geçişlerinde bazı satırlarda sütunlar birleşebiliyor ("24 4 1" -> "2441",
 *    "25 3.5 1" -> "253.51"). Hacim = π/4 · çap² · boy · adet formülüyle doğrulanır,
 *    böylece birleşik sütunlar güvenle yeniden ayrılır.
 *  - Son satır: "GENEL TOPLAM 153 28,472" -> sonuçla karşılaştırılır.
 */
(function (root) {
  'use strict';

  const START_RE = /(\d{4})\s*\/\s*(\d+)\s+([A-Za-z][A-Za-z0-9]{5,14})(?=\s|$)/g;
  const DEC_RE = /\d+[.,]\d+/g;
  const VOL_TOL_ACCEPT = 0.003; // birleşik sütun ayrıştırmada kabul toleransı
  const VOL_TOL_WARN = 0.002;   // bunun üstü "kontrol edin" uyarısı

  const num = s => parseFloat(String(s).replace(',', '.'));
  const expectedVolume = (cap, boy, adet) =>
    Math.PI / 4 * Math.pow(cap / 100, 2) * boy * adet;

  // ---- 1) PDF -> satırlar --------------------------------------------------
  async function extractLines(pdf) {
    const lines = [];
    let itemCount = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (typeof it.str !== 'string') continue;
        const s = it.str.trim();
        if (!s) continue;
        itemCount++;
        items.push({
          s,
          x: it.transform[4],
          y: it.transform[5],
          h: Math.abs(it.height) || Math.abs(it.transform[3]) || 8
        });
      }
      items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
      const pageLines = [];
      for (const it of items) {
        const last = pageLines[pageLines.length - 1];
        const tol = Math.max(2, it.h * 0.4); // yazı boyutuna bağlı tolerans
        if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
        else pageLines.push({ y: it.y, items: [it] });
      }
      for (const l of pageLines) {
        l.items.sort((a, b) => a.x - b.x);
        lines.push({
          page: p,
          text: l.items.map(i => i.s).join(' ').replace(/\s+/g, ' ').trim()
        });
      }
    }
    return { lines, itemCount };
  }

  // ---- 2) "çap boy adet" parçasını çöz --------------------------------------
  function solveMiddle(middle, hacim) {
    const tokens = middle.split(/\s+/).filter(Boolean);
    if (
      tokens.length === 3 &&
      /^\d{1,3}$/.test(tokens[0]) &&
      /^\d+([.,]\d+)?$/.test(tokens[1]) &&
      /^\d{1,4}$/.test(tokens[2])
    ) {
      return { cap: +tokens[0], boy: num(tokens[1]), adet: +tokens[2], merged: false };
    }
    // Birleşik sütun: tüm olası bölünmeleri dene, hacme en uyanı seç
    const J = tokens.join('');
    if (!/^[\d.,]+$/.test(J)) return null;
    let best = null;
    for (let cl = 1; cl <= 3; cl++) {
      const capS = J.slice(0, cl);
      if (!/^\d+$/.test(capS)) continue;
      const R = J.slice(cl);
      for (let bl = 1; bl < R.length; bl++) {
        const boyS = R.slice(0, bl);
        const adetS = R.slice(bl);
        if (!/^\d+([.,]\d+)?$/.test(boyS) || !/^[1-9]\d{0,3}$/.test(adetS)) continue;
        const cand = { cap: +capS, boy: num(boyS), adet: +adetS };
        if (cand.boy <= 0 || cand.boy > 30) continue;
        const dev = Math.abs(expectedVolume(cand.cap, cand.boy, cand.adet) - hacim);
        if (dev <= VOL_TOL_ACCEPT && (!best || dev < best.dev)) {
          best = { ...cand, dev, merged: true };
        }
      }
    }
    return best;
  }

  // ---- 3) satırlar -> kayıtlar ---------------------------------------------
  function parseLines(lines) {
    const records = [];
    const unparsed = [];
    for (const line of lines) {
      const starts = [...line.text.matchAll(START_RE)];
      for (let i = 0; i < starts.length; i++) {
        const m = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].index : line.text.length;
        const chunk = line.text.slice(m.index, end);
        const rest = chunk.slice(m[0].length).trim();
        const decs = [...rest.matchAll(DEC_RE)];
        if (!decs.length) { unparsed.push(chunk); continue; }
        const hm = decs[decs.length - 1];
        const hacim = num(hm[0]);
        const sol = solveMiddle(rest.slice(0, hm.index).trim(), hacim);
        if (!sol || Number.isNaN(hacim)) { unparsed.push(chunk); continue; }
        const dev = Math.abs(expectedVolume(sol.cap, sol.boy, sol.adet) - hacim);
        records.push({
          istifNo: `${m[1]} / ${m[2]}`,
          barkod: m[3],
          cap: sol.cap,
          boy: sol.boy,
          boyIsDecimal: !Number.isInteger(sol.boy),
          adet: sol.adet,
          hacim,
          merged: sol.merged,
          volWarn: dev > VOL_TOL_WARN,
          page: line.page
        });
      }
    }
    return { records, unparsed };
  }

  function parseHeader(lines) {
    const text = lines.map(l => l.text).join('\n');
    const dateM = text.match(/İstif Tarihi\s*:\s*([0-9./]+)/);
    const totM = text.match(/GENEL\s+TOPLAM\s+(\d+)\s+(\d+[.,]\d+)/i);
    return {
      date: dateM ? dateM[1] : null,
      totals: totM ? { adet: parseInt(totM[1], 10), hacim: num(totM[2]) } : null
    };
  }

  // PDF'in "GENEL TOPLAM" satırı ile okunan kayıtları karşılaştır
  function checkTotals(res) {
    const adetSum = res.records.reduce((s, r) => s + r.adet, 0);
    const hacimSum = Math.round(res.records.reduce((s, r) => s + r.hacim, 0) * 1000) / 1000;
    if (!res.totals) return { status: 'missing', adetSum, hacimSum };
    // her satır 3 hanede yuvarlandığı için toplamda küçük fark normaldir
    const tol = Math.max(0.002, res.records.length * 0.0005);
    const ok = adetSum === res.totals.adet && Math.abs(hacimSum - res.totals.hacim) <= tol;
    return {
      status: ok ? 'ok' : 'mismatch',
      adetSum, hacimSum,
      expectedAdet: res.totals.adet,
      expectedHacim: res.totals.hacim
    };
  }

  // ---- 4) tek giriş noktası --------------------------------------------------
  async function parsePdf(pdfjsLib, arrayBuffer) {
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('PDF şifreli; şifresiz bir kopya yükleyin.');
      if (e && e.name === 'InvalidPDFException') throw new Error('Dosya geçerli bir PDF değil veya bozuk.');
      throw e;
    }
    const { lines, itemCount } = await extractLines(pdf);
    if (itemCount === 0) {
      return { scanned: true, records: [], unparsed: [], pageCount: pdf.numPages, totals: null, date: null };
    }
    const { records, unparsed } = parseLines(lines);
    const head = parseHeader(lines);
    return {
      scanned: false, records, unparsed,
      pageCount: pdf.numPages, totals: head.totals, date: head.date
    };
  }

  const api = { parsePdf, parseLines, parseHeader, checkTotals, solveMiddle, expectedVolume };
  root.IstifParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
