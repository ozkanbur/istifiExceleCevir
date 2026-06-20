// xlsx-builder.js
// Şablon Excel dosyasını (TEMPLATE_XLSX_BASE64) açar, sheet1.xml içindeki satırları
// PDF'ten ayrıştırılan kayıtlarla doldurur. Hücre stilleri (s="..."), satır
// yükseklikleri, barkod fontu/formülü ve diğer tüm XML detayları şablondan
// birebir korunur; sadece <v> değerleri (ve gerektiğinde fazladan satır XML'i)
// değiştirilir/eklenir.

const TEMPLATE_FIRST_DATA_ROW = 3;   // A3:G3 ilk veri satırı
const TEMPLATE_LAST_ROW = 339;       // şablondaki son (en altta boş) satır
const TEMPLATE_BLANK_ROWS_START = 121; // 121'den itibaren tüm satırlar "boş" şablon

// Satır 3..120 arası kullanılan dolu-satır stil indeksleri (A,B,C,D-tam,D-ondalık,E,F,G)
const STYLE_FILLED = {
  A: '12', B: '12', C: '11', D_INT: '11', D_DEC: '12', E: '11', F: '10', G: '3'
};
// Satır 122..339 arası kullanılan boş-satır stil indeksleri
const STYLE_BLANK = {
  A: '6', B: '4', C: '4', D: '4', E: '5', F: '4', G: '3'
};
// Satır 121'e özgü (ilk boş satır) stil indeksleri
const STYLE_BLANK_FIRST = {
  A: '9', B: '7', C: '7', D: '7', E: '8', F: '7', G: '3'
};

function xmlEscape(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function base64ToUint8Array(b64){
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function buildFilledRowXml(rowIndex, record){
  const r = rowIndex;
  const dIsDecimal = record.boyIsDecimal;
  const dStyle = dIsDecimal ? STYLE_FILLED.D_DEC : STYLE_FILLED.D_INT;

  const aVal = xmlEscape(record.istifNo);
  const bVal = xmlEscape(record.barkod);
  const cVal = record.cap;
  const dVal = dIsDecimal ? record.boy.toFixed(1).replace(/\.0$/, '.5') : Math.round(record.boy);
  // boy ondalık ise gerçek değeri koru (örn. 3.5), tam ise tam sayı
  const dValFinal = dIsDecimal ? record.boy : Math.round(record.boy);
  const eVal = record.adet;
  const fVal = record.hacim;
  const gFormula = `"*"&amp;B${r}&amp;"*"`;
  const gCached = `*${xmlEscape(record.barkod)}*`;

  let dCell;
  if(dIsDecimal){
    dCell = `<c r="D${r}" s="${dStyle}" t="str"><v>${dValFinal}</v></c>`;
  } else {
    dCell = `<c r="D${r}" s="${dStyle}"><v>${dValFinal}</v></c>`;
  }

  return `<row r="${r}" spans="1:7" s="1" customFormat="1" ht="65.25" customHeight="1" x14ac:dyDescent="0.2">` +
    `<c r="A${r}" s="${STYLE_FILLED.A}" t="str"><v>${aVal}</v></c>` +
    `<c r="B${r}" s="${STYLE_FILLED.B}" t="str"><v>${bVal}</v></c>` +
    `<c r="C${r}" s="${STYLE_FILLED.C}"><v>${cVal}</v></c>` +
    dCell +
    `<c r="E${r}" s="${STYLE_FILLED.E}"><v>${eVal}</v></c>` +
    `<c r="F${r}" s="${STYLE_FILLED.F}"><v>${fVal}</v></c>` +
    `<c r="G${r}" s="${STYLE_FILLED.G}" t="str"><f>${gFormula}</f><v>${gCached}</v></c>` +
    `</row>`;
}

function buildBlankRowXml(rowIndex, isFirstBlank){
  const r = rowIndex;
  const st = isFirstBlank ? STYLE_BLANK_FIRST : STYLE_BLANK;
  const heightAttr = isFirstBlank ? ` ht="75.75"` : ` ht="75.75"`;
  const gFormula = `"*"&amp;B${r}&amp;"*"`;
  return `<row r="${r}" spans="1:7" s="1" customFormat="1"${heightAttr} x14ac:dyDescent="0.2">` +
    `<c r="A${r}" s="${st.A}"/>` +
    `<c r="B${r}" s="${st.B}"/>` +
    `<c r="C${r}" s="${st.C}"/>` +
    `<c r="D${r}" s="${st.D}"/>` +
    `<c r="E${r}" s="${st.E}"/>` +
    `<c r="F${r}" s="${st.F}"/>` +
    `<c r="G${r}" s="${st.G}" t="str"><f>${gFormula}</f><v>**</v></c>` +
    `</row>`;
}

async function buildWorkbook(records){
  const warnings = [];
  const zip = await JSZip.loadAsync(base64ToUint8Array(TEMPLATE_XLSX_BASE64));

  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(sheetPath).async('string');

  const totalAvailableTemplateRows = TEMPLATE_LAST_ROW - TEMPLATE_FIRST_DATA_ROW + 1; // 337
  let lastRow = TEMPLATE_FIRST_DATA_ROW + records.length - 1;
  let extraRowsNeeded = 0;
  if(records.length > totalAvailableTemplateRows){
    extraRowsNeeded = records.length - totalAvailableTemplateRows;
    lastRow = TEMPLATE_LAST_ROW + extraRowsNeeded;
    warnings.push(`Şablonda ${totalAvailableTemplateRows} satırlık yer vardı; veri bunu aştığı için ${extraRowsNeeded} satır otomatik olarak eklendi (aynı biçimle).`);
  }

  // --- 1) sheetData içeriğini yeniden inşa et ---
  const sheetDataStart = xml.indexOf('<sheetData>') + '<sheetData>'.length;
  const sheetDataEnd = xml.indexOf('</sheetData>');
  const beforeSheetData = xml.slice(0, sheetDataStart);
  const afterSheetDataRest = xml.slice(sheetDataEnd); // starts with </sheetData>...

  // Satır 1 ve 2 (başlık alanı) şablondan birebir alınır
  const row1Match = beforeSheetData; // not used directly; we re-extract from original xml below
  const origRow1 = (xml.match(/<row r="1"[^>]*>.*?<\/row>/) || [''])[0];
  const origRow2 = (xml.match(/<row r="2"[^>]*>.*?<\/row>/) || [''])[0];

  let rowsXml = origRow1 + origRow2;

  for(let i=0; i<records.length; i++){
    const rowNum = TEMPLATE_FIRST_DATA_ROW + i;
    rowsXml += buildFilledRowXml(rowNum, records[i]);
  }

  // Kalan boş satırlar (orijinal şablonda olduğu kadar, veya hiç -taşma varsa-)
  const lastFilledRow = TEMPLATE_FIRST_DATA_ROW + records.length - 1;
  const blankRangeEnd = Math.max(lastFilledRow, TEMPLATE_LAST_ROW + extraRowsNeeded);
  for(let r = lastFilledRow + 1; r <= blankRangeEnd; r++){
    const isFirstBlank = (r === TEMPLATE_BLANK_ROWS_START) && extraRowsNeeded === 0 && lastFilledRow < TEMPLATE_BLANK_ROWS_START;
    rowsXml += buildBlankRowXml(r, isFirstBlank);
  }
  // Özel durum: eğer kayıt sayısı azsa (orijinal şablon davranışı), 121. satır özel stille başlamalı
  // (yukarıdaki genel mantık zaten bunu r===121 koşuluyla kapsar)

  let newXml = beforeSheetData + rowsXml + afterSheetDataRest;

  // --- 2) dimension, autoFilter, sortState, conditionalFormatting referanslarını güncelle ---
  newXml = newXml.replace(/<dimension ref="A1:G\d+"\/>/, `<dimension ref="A1:G${blankRangeEnd}"/>`);
  newXml = newXml.replace(/<autoFilter ref="A2:G\d+"/, `<autoFilter ref="A2:G${blankRangeEnd}"`);
  newXml = newXml.replace(/<sortState ref="A3:G\d+"/, `<sortState ref="A3:G${blankRangeEnd}"`);
  newXml = newXml.replace(/<sortCondition ref="B2:B\d+"\/>/, `<sortCondition ref="B2:B${blankRangeEnd}"/>`);

  zip.file(sheetPath, newXml);

  // --- 3) İsteğe bağlı: başlık (A1) hücresini olduğu gibi koru — formül zaten =A3'ü gösteriyor ---

  const out = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { blob: out, warnings };
}
