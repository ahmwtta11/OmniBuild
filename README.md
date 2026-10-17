# OmniBuild

**Android APK ve Windows uygulamalarını tek ekrandan derleyen, yapay zekâ destekli masaüstü stüdyosu.**

[![Sürüm](https://img.shields.io/badge/s%C3%BCr%C3%BCm-3.1.0-1ea7ff)](#)
[![Electron](https://img.shields.io/badge/Electron-31-47848f?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078d6?logo=windows&logoColor=white)](#gereksinimler)
[![Lisans](https://img.shields.io/badge/lisans-belirlenmedi-lightgrey)](#lisans)

[Özellikler](#-özellikler) · [Kurulum](#-kurulum) · [Kullanım](#-kullanım) · [AI](#-ai-sağlayıcıları) · [Katkı](#-katkıda-bulunma)

</div>

---

## ✨ Özellikler

- 🔍 **Otomatik proje algılama:** Capacitor, Cordova, native Gradle ve Electron projelerini tanır.
- ⚒ **Tek tıkla derleme:** Android APK (debug / release) veya Windows kurulum dosyası (`.exe`).
- 🖥 **Canlı konsol:** Derleme çıktısı anlık akar, yalnızca hataları filtreleyebilirsiniz.
- 🧠 **AI ajanı:** Projeyi tarar, hatayı bulur, düzeltir ve sonucu açıklar.
- 🔁 **Otomatik düzeltme:** Hata sonrası AI düzeltir ve derlemeyi yeniden dener. Deneme sayısı 1–5 arasında ayarlanabilir.
- 🧭 **Kurulum sihirbazı:** Gerekli araçları kontrol eder, eksikleri winget ile kurar.
- 🔐 **Güvenli anahtar saklama:** API anahtarları `safeStorage` ile şifrelenir.

## 📋 Gereksinimler

| Bileşen | Gerekli olduğu durum |
|---|---|
| Windows 10/11 (x64) | Uygulamanın kendisi, `.exe` üretimi |
| [Node.js LTS](https://nodejs.org/) | Electron projeleri ve geliştirici kurulumu |
| JDK 17 + Android SDK | Android APK derlemesi |
| winget | Eksik araçları otomatik kurmak (isteğe bağlı) |

> Eksik araçları **Kurulum Sihirbazı** üzerinden tek tıkla kurabilirsiniz.

## 🚀 Kurulum

### Hazır sürümü kullanmak

[Releases](../../releases) sayfasından en son `OmniBuild Setup x.x.x.exe` dosyasını indirip çalıştırın.

### Kaynak koddan çalıştırmak

```bash
git clone https://github.com/<kullanici-adiniz>/omnibuild.git
cd omnibuild
npm install
npm start
```

### Kurulum dosyası üretmek

```bash
npm run dist
```

Çıktı `release/` klasörüne düşer.

## 🧪 Kullanım

1. **📁 Proje klasörü seç** ile projenizi açın. Tür ve ad otomatik görünür.
2. **Hedef** seçin: Android APK (debug), APK (release, imzasız) veya Windows `.exe`.
3. **⚒ DERLE** düğmesine basın.
4. Bitince **Dosyayı aç** ya da **Klasörü aç** ile çıktıya ulaşın.

Hata oluşursa **Teşhis** sekmesi olası nedenleri listeler. **AI ile düzelt** ile ajanı devreye sokabilirsiniz.

## 🗂 Desteklenen proje türleri

| Tür | Algılama işareti | Android APK | Windows `.exe` |
|---|---|:-:|:-:|
| Capacitor | `capacitor.config.json` / `.ts` | ✅ | — |
| Cordova | `config.xml` + `package.json` | ✅ | — |
| Native Gradle | `build.gradle(.kts)`, `gradlew` | ✅ | — |
| Electron | `package.json` içinde `electron` | — | ✅ |

## 🤖 AI sağlayıcıları

| Sağlayıcı | Anahtar | Not |
|---|---|---|
| **Ollama** | Gerekmez | Yerel çalışır. `ollama pull gemma3:4b` veya `qwen2.5-coder:7b` |
| **GitHub Models** | GitHub token | “models” izni olan bir token |
| **Gemini API** | Google AI Studio anahtarı | İsteğe bağlı |

Otomatik modda sıra **Ollama → GitHub → Gemini** şeklindedir.

## 🔄 Otomatik düzeltme

1. Derleme başarısız olur.
2. AI log ve ilgili dosyaları inceler.
3. Düzeltmeyi uygular. Eski dosya `.bak` olarak yedeklenir.
4. Derlemeyi yeniden dener.

## 🏗 Proje yapısı

```
omnibuild/
├── main.js        Electron ana süreç: pencere, IPC, kurulum
├── preload.js     Güvenli köprü (window.forge)
├── renderer.js    Arayüz, sihirbaz, konsol, AI sohbeti
├── build.js       Proje algılama ve derleme planı
├── agent.js       AI sağlayıcıları ve düzeltme döngüsü
├── index.html     Ana arayüz
├── styles.css     Temel stil
├── assets/        Logo, monogram, tema (theme.css)
├── build/         Electron-builder ikonu
└── scripts/       Yardımcı betikler
```

## ⚠️ Bilinen sınırlamalar

- Release APK **imzasız** üretilir. Yayın için kendi keystore dosyanızla imzalamanız gerekir.
- Kurulum dosyası şu an yalnızca Windows x64 için üretilir.
- Android derlemesi için JDK 17 ve Android SDK gerekir.

## 🤝 Katkıda bulunma

1. Depoyu fork'layın.
2. Yeni bir dal açın: `git checkout -b ozellik/yeni-ozellik`
3. Değişikliklerinizi commit'leyin: `git commit -m "Yeni özellik eklendi"`
4. Dalı gönderin ve bir Pull Request açın.

Hata bildirmek veya öneride bulunmak için [Issues](../../issues) sayfasını kullanabilirsiniz.

## 📄 Lisans

Bu proje henüz bir lisansla yayımlanmamıştır. Yeniden dağıtım ve kullanım koşulları için sahibiyle iletişime geçin.

---