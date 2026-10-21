// xlsx-builder.js
// Şablon Excel dosyasını (TEMPLATE_XLSX_BASE64) açar, sheet1.xml içindeki satırları
// PDF'ten ayrıştırılan kayıtlarla doldurur. Hücre stilleri, satır yükseklikleri,
// barkod fontu/formülü şablondan korunur; yalnızca değerler ve (gerekirse) fazladan
// satırlar eklenir.

const TEMPLATE_FIRST_DATA_ROW = 3;   // A3:G3 ilk veri satırı
const TEMPLATE_LAST_ROW = 339;       // şablondaki son satır

// Ondalıklı boy (3.5) şablondaki gibi METİN olarak yazılsın mı?
// true  = şablonla birebir aynı (D sütunu stili 12, metin)
// false = gerçek sayı olarak yaz (toplama/sıralama için)
const BOY_ONDALIK_METIN = true;

// Dolu satır stilleri (A,B,C,D-tam,D-ondalık,E,F,G)
const STYLE_FILLED = {
  A: '12', B: '12', C: '11', D_INT: '11', D_DEC: '12', E: '11', F: '10', G: '3'
};
// Verinin hemen altındaki ilk boş satır stili
const STYLE_BLANK_FIRST = {
  A: '9', B: '7', C: '7', D: '7', E: '8', F: '7', G: '3'
};
// Diğer boş satırlar
const STYLE_BLANK = {
  A: '6', B: '4', C: '4', D: '4', E: '5', F: '4', G: '3'
};

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Şablon baytlarını bir kez çöz, sonraki çağrılarda yeniden kullan (toplu işlemde hız)
let _templateBytes = null;
function getTemplateBytes() {
  if (!_templateBytes) _templateBytes = base64ToUint8Array(TEMPLATE_XLSX_BASE64);
  return _templateBytes;
}

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function buildFilledRowXml(r, rec) {
  const S = STYLE_FILLED;
  let dCell;
  if (rec.boyIsDecimal) {
    dCell = BOY_ONDALIK_METIN
      ? `<c r="D${r}" s="${S.D_DEC}" t="str"><v>${xmlEscape(String(rec.boy))}</v></c>`
      : `<c r="D${r}" s="${S.D_DEC}"><v>${rec.boy}</v></c>`;
  } else {
    dCell = `<c r="D${r}" s="${S.D_INT}"><v>${Math.round(rec.boy)}</v></c>`;
  }
  const gFormula = `"*"&amp;B${r}&amp;"*"`;
  return `<row r="${r}" spans="1:7" s="1" customFormat="1" ht="65.25" customHeight="1" x14ac:dyDescent="0.2">` +
    `<c r="A${r}" s="${S.A}" t="str"><v>${xmlEscape(rec.istifNo)}</v></c>` +
    `<c r="B${r}" s="${S.B}" t="str"><v>${xmlEscape(rec.barkod)}</v></c>` +
    `<c r="C${r}" s="${S.C}"><v>${rec.cap}</v></c>` +
    dCell +
    `<c r="E${r}" s="${S.E}"><v>${rec.adet}</v></c>` +
    `<c r="F${r}" s="${S.F}"><v>${rec.hacim}</v></c>` +
    `<c r="G${r}" s="${S.G}" t="str"><f>${gFormula}</f><v>*${xmlEscape(rec.barkod)}*</v></c>` +
    `</row>`;
}

function buildBlankRowXml(r, isFirstBlank) {
  const st = isFirstBlank ? STYLE_BLANK_FIRST : STYLE_BLANK;
  const gFormula = `"*"&amp;B${r}&amp;"*"`;
  return `<row r="${r}" spans="1:7" s="1" customFormat="1" ht="75.75" x14ac:dyDescent="0.2">` +
    `<c r="A${r}" s="${st.A}"/>` +
    `<c r="B${r}" s="${st.B}"/>` +
    `<c r="C${r}" s="${st.C}"/>` +
    `<c r="D${r}" s="${st.D}"/>` +
    `<c r="E${r}" s="${st.E}"/>` +
    `<c r="F${r}" s="${st.F}"/>` +
    `<c r="G${r}" s="${st.G}" t="str"><f>${gFormula}</f><v>**</v></c>` +
    `</row>`;
}

// <row r="n" .../> veya <row r="n"> ... </row>
function extractRow(xml, n) {
  const m = xml.match(new RegExp(`<row r="${n}"(?:[^>]*/>|[^>]*>[\\s\\S]*?</row>)`));
  return m ? m[0] : '';
}

// Şablonda 339 olarak geçen son satır referanslarını ($G$339, G339 vb.) yeni değerle değiştir
function bumpLastRow(text, newLast) {
  if (newLast === TEMPLATE_LAST_ROW) return text;
  return text.replace(/(:\$?[A-Z]{1,2}\$?)339\b/g, (_, p) => p + newLast);
}

// outType: 'blob' (tarayıcı indirme) veya 'uint8array' (ZIP'e eklemek için)
async function buildWorkbook(records, outType = 'blob') {
  if (typeof JSZip === 'undefined') throw new Error('JSZip yüklenemedi.');
  const warnings = [];
  const zip = await JSZip.loadAsync(getTemplateBytes());

  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error('Şablonda ' + sheetPath + ' bulunamadı.');
  const xml = await sheetFile.async('string');

  const sdTag = '<sheetData>';
  const sdStart = xml.indexOf(sdTag);
  const sdEnd = xml.indexOf('</sheetData>');
  if (sdStart < 0 || sdEnd < 0) throw new Error('Şablon sheetData bölümü beklenen biçimde değil.');

  const capacity = TEMPLATE_LAST_ROW - TEMPLATE_FIRST_DATA_ROW + 1; // 337
  const extraRows = Math.max(0, records.length - capacity);
  if (extraRows > 0) {
    warnings.push(`Şablonda ${capacity} satırlık yer vardı; veri bunu aştığı için ${extraRows} satır aynı biçimle eklendi.`);
  }

  const lastFilled = TEMPLATE_FIRST_DATA_ROW + records.length - 1;
  const lastRow = Math.max(lastFilled, TEMPLATE_LAST_ROW + extraRows);

  let rows = extractRow(xml, 1) + extractRow(xml, 2);
  if (!extractRow(xml, 1) || !extractRow(xml, 2)) {
    throw new Error('Şablonda 1. veya 2. başlık satırı bulunamadı.');
  }
  records.forEach((rec, i) => { rows += buildFilledRowXml(TEMPLATE_FIRST_DATA_ROW + i, rec); });
  for (let r = lastFilled + 1; r <= lastRow; r++) {
    rows += buildBlankRowXml(r, r === lastFilled + 1);
  }

  const head = xml.slice(0, sdStart + sdTag.length);
  let tail = xml.slice(sdEnd);

  let out = head + rows + tail;
  out = out.replace(/<dimension ref="A1:G\d+"\s*\/>/, `<dimension ref="A1:G${lastRow}"/>`);
  out = out.replace(/(<autoFilter ref="[A-Z]+\d+:[A-Z]+)\d+"/, `$1${lastRow}"`);
  out = out.replace(/(<sortState ref="[A-Z]+\d+:[A-Z]+)\d+"/, `$1${lastRow}"`);
  out = out.replace(/(<sortCondition [^>]*ref="[A-Z]+\d+:[A-Z]+)\d+"/, `$1${lastRow}"`);
  // conditionalFormatting, mergeCells, ignoredErrors, dataValidations vb. (sheetData'dan sonra)
  const cut = out.indexOf('</sheetData>');
  out = out.slice(0, cut) + bumpLastRow(out.slice(cut), lastRow);
  zip.file(sheetPath, out);

  // --- workbook.xml: filtre/yazdırma alanı + açılışta yeniden hesapla ---
  const wbFile = zip.file('xl/workbook.xml');
  if (wbFile) {
    let wb = await wbFile.async('string');
    wb = bumpLastRow(wb, lastRow);
    if (/<calcPr\b/.test(wb)) {
      if (!/fullCalcOnLoad=/.test(wb)) wb = wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
    } else {
      wb = wb.replace(/(<oleSize\b|<customWorkbookViews\b|<pivotCaches\b|<extLst\b|<\/workbook>)/,
        (m) => '<calcPr fullCalcOnLoad="1"/>' + m);
    }
    zip.file('xl/workbook.xml', wb);
  }

  // --- eski calcChain.xml'i kaldır (yeni formüllerle uyuşmaz; Excel yeniden kurar) ---
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const ctFile = zip.file('[Content_Types].xml');
    if (ctFile) {
      const ct = (await ctFile.async('string')).replace(/<Override[^>]*calcChain[^>]*\/>/g, '');
      zip.file('[Content_Types].xml', ct);
    }
    const relFile = zip.file('xl/_rels/workbook.xml.rels');
    if (relFile) {
      const rel = (await relFile.async('string')).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, '');
      zip.file('xl/_rels/workbook.xml.rels', rel);
    }
  }

  const blob = await zip.generateAsync({
    type: outType,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  return { blob, warnings };
}
