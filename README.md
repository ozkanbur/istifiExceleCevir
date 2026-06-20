https://ozkanbur.github.io/istifiExceleCevir/


# İstif Ebat Listesi — PDF → Excel Dönüştürücü

"İstif Ebat Listesi" PDF'lerini, gönderdiğiniz Excel şablonuyla **birebir aynı**
biçimde (yazı tipleri, kenarlıklar, sayı formatları, barkod fontu ve formülleri)
Excel dosyasına çeviren, tamamen tarayıcıda çalışan statik bir web uygulamasıdır.

## GitHub Pages ile yayımlama

1. Bu klasördeki üç dosyayı (`index.html`, `xlsx-builder.js`, `template-data.js`)
   bir GitHub deposuna yükleyin (kök dizine veya `/docs` klasörüne).
2. Depo **Settings → Pages** bölümünden, yayımlanacak branch/klasörü seçin.
3. Birkaç dakika içinde `https://kullanici-adiniz.github.io/depo-adi/` adresinden
   erişilebilir olacaktır.

Üç dosya da aynı klasörde olmalıdır; başka bir kurulum veya build adımı gerekmez.

## Nasıl çalışır?

- PDF, tarayıcıda **PDF.js** ile metne dönüştürülür.
- Barkod numarası içeren her satır (İstif No, Barkod No, Çap, Boy, Adet, Hacim)
  ayrıştırılır.
- `template-data.js` içinde gömülü olan orijinal Excel şablonu **JSZip** ile açılır;
  şablonun iç XML yapısındaki hücre stilleri, satır yükseklikleri, barkod fontu
  ("Code 3 de 9") ve `="*"&B#&"*"` barkod formülü korunarak veri satırları
  yeniden oluşturulur.
- Şablonda 339 satıra kadar (337 veri satırı) yer ayrılmıştır. Veri bunu aşarsa
  ek satırlar otomatik olarak aynı biçimle eklenir.
- Hiçbir dosya bir sunucuya gönderilmez; tüm işlem kullanıcının tarayıcısında
  gerçekleşir.

## Şablonu güncellemek isterseniz

`template-data.js` dosyasındaki `TEMPLATE_XLSX_BASE64` değişkeni, orijinal
Excel dosyasının base64 koduyla doludur. Şablonu değiştirmek isterseniz:

```bash
base64 -w0 yeni_sablon.xlsx
```

çıktısını bu değişkenin içine yapıştırmanız yeterlidir. Ancak satır/sütun
yapısı (A–G sütunları, 3. satırdan başlayan veri, barkod formülü) değişirse
`xlsx-builder.js` içindeki stil indeksleri (`STYLE_FILLED`, `STYLE_BLANK`) ve
satır numaraları da buna göre güncellenmelidir.
