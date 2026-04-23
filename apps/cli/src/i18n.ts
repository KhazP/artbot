export const APP_LOCALES = ["en", "tr"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

type MessageKey =
  | "cli.setup.description"
  | "cli.setup.disabled"
  | "cli.doctor.description"
  | "cli.tui.disabled"
  | "cli.onboarding.title"
  | "cli.onboarding.subtitle"
  | "setup.summary.llm"
  | "setup.summary.api"
  | "setup.summary.localBackend"
  | "setup.summary.config"
  | "setup.summary.discovery"
  | "setup.summary.searxng"
  | "setup.summary.firecrawl"
  | "setup.summary.authProfiles"
  | "setup.summary.sessions"
  | "setup.summary.healthy"
  | "setup.summary.offline"
  | "setup.summary.enabled"
  | "setup.summary.disabled"
  | "setup.summary.none"
  | "setup.issues.none"
  | "setup.auth.table.profile"
  | "setup.auth.table.mode"
  | "setup.auth.table.sources"
  | "setup.auth.table.state"
  | "setup.auth.table.risk"
  | "setup.provider.openaiCompatible"
  | "setup.provider.localLmStudio"
  | "setup.provider.nvidia"
  | "setup.provider.custom"
  | "tui.status.llm"
  | "tui.status.api"
  | "tui.status.auth"
  | "tui.status.operator"
  | "tui.shell.readyTitle"
  | "tui.shell.readySubtitle"
  | "tui.shell.startPrompt"
  | "tui.shell.quickActions"
  | "tui.shell.setupTitle"
  | "tui.shell.setupSubtitle"
  | "tui.shell.setupNext"
  | "tui.shell.setupRefresh"
  | "tui.shell.setupGuided"
  | "tui.shell.helpTitle"
  | "tui.shell.helpSubtitle"
  | "tui.shell.helpCommands"
  | "tui.shell.helpShortcuts"
  | "tui.command.idle"
  | "tui.command.running"
  | "tui.command.setup"
  | "tui.commandHint.research"
  | "tui.commandHint.work"
  | "tui.commandHint.setup"
  | "tui.commandHint.auth"
  | "tui.commandHint.doctor"
  | "tui.commandHint.runs"
  | "tui.overlay.settings.title"
  | "tui.overlay.settings.subtitle"
  | "tui.settings.language"
  | "tui.settings.theme"
  | "tui.settings.density"
  | "tui.settings.secondaryPane"
  | "tui.settings.value.enabled"
  | "tui.settings.value.disabled"
  | "tui.language.english"
  | "tui.language.turkish"
  | "onboarding.step.language"
  | "onboarding.step.runtime"
  | "onboarding.step.llm"
  | "onboarding.step.backend"
  | "onboarding.step.discovery"
  | "onboarding.step.auth"
  | "onboarding.step.review"
  | "onboarding.action.next"
  | "onboarding.action.back"
  | "onboarding.action.apply"
  | "onboarding.action.edit"
  | "onboarding.action.continue"
  | "onboarding.provider.lmStudio"
  | "onboarding.provider.nvidia"
  | "onboarding.provider.custom"
  | "onboarding.runtime.local"
  | "onboarding.runtime.remote"
  | "onboarding.field.language"
  | "onboarding.field.provider"
  | "onboarding.field.baseUrl"
  | "onboarding.field.apiKey"
  | "onboarding.field.model"
  | "onboarding.field.browseModels"
  | "onboarding.field.stagehand"
  | "onboarding.field.apiMode"
  | "onboarding.field.apiBaseUrl"
  | "onboarding.field.optionalProbes"
  | "onboarding.field.licensed"
  | "onboarding.field.reportSurface"
  | "onboarding.explainer.discovery.title"
  | "onboarding.explainer.discovery.summary"
  | "onboarding.explainer.discovery.recommendation"
  | "onboarding.explainer.discovery.details"
  | "onboarding.explainer.licensed.title"
  | "onboarding.explainer.licensed.summary"
  | "onboarding.explainer.licensed.recommendation"
  | "onboarding.explainer.licensed.details"
  | "onboarding.explainer.reportSurface.title"
  | "onboarding.explainer.reportSurface.summary"
  | "onboarding.explainer.reportSurface.recommendation"
  | "onboarding.explainer.reportSurface.details"
  | "onboarding.review.applySummary"
  | "onboarding.validation.baseUrlRequired"
  | "onboarding.validation.apiBaseUrlRequired"
  | "onboarding.validation.modelRequired"
  | "onboarding.message.modelsOpened"
  | "onboarding.message.modelsOpenFailed"
  | "onboarding.hint.controls"
  | "onboarding.hint.selected"
  | "onboarding.hint.details"
  | "onboarding.label.recommended";

type MessageCatalog = Record<MessageKey, string>;

const EN_MESSAGES: MessageCatalog = {
  "cli.setup.description": "Guided onboarding for OpenAI-compatible LLMs, backend services, and auth profiles",
  "cli.setup.disabled":
    'Setup is interactive and disabled by --no-tui or ARTBOT_NO_TUI. Use "artbot backend start" to bootstrap locally, then run "artbot doctor".',
  "cli.doctor.description": "Inspect local setup and health status",
  "cli.tui.disabled": "TUI launch is disabled by --no-tui or ARTBOT_NO_TUI. Remove it to open the interactive UI.",
  "cli.onboarding.title": "ArtBot Setup",
  "cli.onboarding.subtitle": "OpenAI-compatible local-first onboarding",
  "setup.summary.llm": "OpenAI-Compatible LLM",
  "setup.summary.api": "ArtBot API",
  "setup.summary.localBackend": "Local Backend",
  "setup.summary.config": "Config",
  "setup.summary.discovery": "Discovery Profile",
  "setup.summary.searxng": "SearXNG",
  "setup.summary.firecrawl": "Firecrawl",
  "setup.summary.authProfiles": "Auth Profiles",
  "setup.summary.sessions": "Sessions",
  "setup.summary.healthy": "healthy",
  "setup.summary.offline": "offline",
  "setup.summary.enabled": "enabled",
  "setup.summary.disabled": "disabled",
  "setup.summary.none": "none",
  "setup.issues.none": "No setup issues detected.",
  "setup.auth.table.profile": "Profile",
  "setup.auth.table.mode": "Mode",
  "setup.auth.table.sources": "Matched Sources",
  "setup.auth.table.state": "Storage State",
  "setup.auth.table.risk": "Risk",
  "setup.provider.openaiCompatible": "OpenAI-compatible endpoint",
  "setup.provider.localLmStudio": "LM Studio",
  "setup.provider.nvidia": "NVIDIA endpoint",
  "setup.provider.custom": "Custom endpoint",
  "tui.status.llm": "LLM",
  "tui.status.api": "API",
  "tui.status.auth": "Auth",
  "tui.status.operator": "Operator",
  "tui.shell.readyTitle": "Operator Cockpit",
  "tui.shell.readySubtitle": "Compact command-first workspace for onboarding, diagnostics, and runs.",
  "tui.shell.startPrompt": "Start with an artist, inspect readiness, or open guided setup.",
  "tui.shell.quickActions": "Quick actions",
  "tui.shell.setupTitle": "Setup Snapshot",
  "tui.shell.setupSubtitle": "Blocking issues, optional improvements, and next action",
  "tui.shell.setupNext": "Next action",
  "tui.shell.setupRefresh": "Refresh diagnostics with /setup",
  "tui.shell.setupGuided": "Launch full onboarding with artbot setup",
  "tui.shell.helpTitle": "Operator Help",
  "tui.shell.helpSubtitle": "Commands, shortcuts, and workflow entrypoints",
  "tui.shell.helpCommands": "Commands",
  "tui.shell.helpShortcuts": "Shortcuts",
  "tui.command.idle": "Type /research <artist> or plain artist text. /help for commands.",
  "tui.command.running": "Running research pipeline...",
  "tui.command.setup": "Setup mode - review readiness and launch onboarding",
  "tui.commandHint.research": "Start artist price research",
  "tui.commandHint.work": "Start work-specific research",
  "tui.commandHint.setup": "Review setup, backend, and auth readiness",
  "tui.commandHint.auth": "Inspect or capture browser session state",
  "tui.commandHint.doctor": "Run a local environment health check",
  "tui.commandHint.runs": "Inspect recent or active runs",
  "tui.overlay.settings.title": "Settings",
  "tui.overlay.settings.subtitle": "Theme, language, density, and layout preferences",
  "tui.settings.language": "Language",
  "tui.settings.theme": "Theme",
  "tui.settings.density": "Density",
  "tui.settings.secondaryPane": "Secondary pane",
  "tui.settings.value.enabled": "Enabled",
  "tui.settings.value.disabled": "Disabled",
  "tui.language.english": "English",
  "tui.language.turkish": "Turkish",
  "onboarding.step.language": "Language",
  "onboarding.step.runtime": "Runtime",
  "onboarding.step.llm": "LLM",
  "onboarding.step.backend": "Backend",
  "onboarding.step.discovery": "Discovery",
  "onboarding.step.auth": "Access",
  "onboarding.step.review": "Review",
  "onboarding.action.next": "Next",
  "onboarding.action.back": "Back",
  "onboarding.action.apply": "Apply Setup",
  "onboarding.action.edit": "Edit",
  "onboarding.action.continue": "Continue",
  "onboarding.provider.lmStudio": "LM Studio (local server)",
  "onboarding.provider.nvidia": "NVIDIA OpenAI-compatible endpoint",
  "onboarding.provider.custom": "Custom OpenAI-compatible endpoint",
  "onboarding.runtime.local": "Use local ArtBot backend on this machine",
  "onboarding.runtime.remote": "Use an already running remote ArtBot API",
  "onboarding.field.language": "Interface language",
  "onboarding.field.provider": "LLM provider preset",
  "onboarding.field.baseUrl": "Base URL",
  "onboarding.field.apiKey": "API key",
  "onboarding.field.model": "Model",
  "onboarding.field.browseModels": "Browse NVIDIA models",
  "onboarding.field.stagehand": "Browser automation mode",
  "onboarding.field.apiMode": "API mode",
  "onboarding.field.apiBaseUrl": "ArtBot API base URL",
  "onboarding.field.optionalProbes": "Expanded discovery sources",
  "onboarding.field.licensed": "Use account or license-backed sources",
  "onboarding.field.reportSurface": "Finished report view",
  "onboarding.explainer.discovery.title": "Expanded discovery sources",
  "onboarding.explainer.discovery.summary": "Adds Artsy, MutualArt, and askART to widen coverage beyond the lean default search path.",
  "onboarding.explainer.discovery.recommendation": "Recommended if you want broader market coverage.",
  "onboarding.explainer.discovery.details":
    "These sources can surface extra comparable works, but some may need an account and can be less consistent than the default path. Leave this off if you want the simplest setup first.",
  "onboarding.explainer.licensed.title": "Account or license-backed sources",
  "onboarding.explainer.licensed.summary": "Includes sources like Sanatfiyat that only help when you already have lawful access, a subscription, or a license.",
  "onboarding.explainer.licensed.recommendation": "Only recommended if you already have legitimate access.",
  "onboarding.explainer.licensed.details":
    "This does not sign you in for you. You still need to capture browser sessions or configure credentials later before these sources will help.",
  "onboarding.explainer.reportSurface.title": "Finished report view",
  "onboarding.explainer.reportSurface.summary": "Controls how ArtBot shows completed runs after research finishes.",
  "onboarding.explainer.reportSurface.recommendation": "Ask after each run is the safest default while you learn the workflow.",
  "onboarding.explainer.reportSurface.details":
    "Choose CLI to stay fully in the terminal, Web to always open the browser report, or Ask if you want to decide per completed run.",
  "onboarding.review.applySummary": "Review the detected environment and apply the generated configuration.",
  "onboarding.validation.baseUrlRequired": "A base URL is required.",
  "onboarding.validation.apiBaseUrlRequired": "An ArtBot API base URL is required.",
  "onboarding.validation.modelRequired": "A model ID is required.",
  "onboarding.message.modelsOpened": "Opened the NVIDIA model catalog in your browser.",
  "onboarding.message.modelsOpenFailed": "Could not open the model catalog. Open {url} manually.",
  "onboarding.hint.controls": "Enter selects. Language and Runtime continue immediately. Up/Down move · Left/Right step · Ctrl+C cancel",
  "onboarding.hint.selected": "The > cursor shows focus. Choice rows keep a ● marker after selection.",
  "onboarding.hint.details": "Press i for more detail about the focused setup choice.",
  "onboarding.label.recommended": "Recommended"
};

const TR_MESSAGES: MessageCatalog = {
  "cli.setup.description": "OpenAI uyumlu LLM, backend servisleri ve yetkili profiller icin yonlendirmeli kurulum",
  "cli.setup.disabled":
    'Kurulum etkilesimlidir ve --no-tui veya ARTBOT_NO_TUI ile kapatildi. Yerel baslatma icin "artbot backend start", sonra "artbot doctor" kullanin.',
  "cli.doctor.description": "Yerel kurulum ve saglik durumunu denetle",
  "cli.tui.disabled": "TUI, --no-tui veya ARTBOT_NO_TUI nedeniyle kapali. Etkilesimli arayuz icin bu secenegi kaldirin.",
  "cli.onboarding.title": "ArtBot Kurulum",
  "cli.onboarding.subtitle": "OpenAI uyumlu yerel-oncelikli baslangic akisi",
  "setup.summary.llm": "OpenAI Uyumlu LLM",
  "setup.summary.api": "ArtBot API",
  "setup.summary.localBackend": "Yerel Backend",
  "setup.summary.config": "Yapilandirma",
  "setup.summary.discovery": "Kesif Profili",
  "setup.summary.searxng": "SearXNG",
  "setup.summary.firecrawl": "Firecrawl",
  "setup.summary.authProfiles": "Yetki Profilleri",
  "setup.summary.sessions": "Oturumlar",
  "setup.summary.healthy": "hazir",
  "setup.summary.offline": "kapali",
  "setup.summary.enabled": "acik",
  "setup.summary.disabled": "kapali",
  "setup.summary.none": "yok",
  "setup.issues.none": "Kurulum sorunu bulunmuyor.",
  "setup.auth.table.profile": "Profil",
  "setup.auth.table.mode": "Mod",
  "setup.auth.table.sources": "Eslesen Kaynaklar",
  "setup.auth.table.state": "Depolama Durumu",
  "setup.auth.table.risk": "Risk",
  "setup.provider.openaiCompatible": "OpenAI uyumlu uç nokta",
  "setup.provider.localLmStudio": "LM Studio",
  "setup.provider.nvidia": "NVIDIA uç noktasi",
  "setup.provider.custom": "Ozel uç nokta",
  "tui.status.llm": "LLM",
  "tui.status.api": "API",
  "tui.status.auth": "Yetki",
  "tui.status.operator": "Operator",
  "tui.shell.readyTitle": "Operator Kokpiti",
  "tui.shell.readySubtitle": "Kurulum, teshis ve calistirmalar icin kompakt komut-oncelikli alan.",
  "tui.shell.startPrompt": "Sanatci girin, hazirligi inceleyin veya yonlendirmeli kurulumu acin.",
  "tui.shell.quickActions": "Hizli islemler",
  "tui.shell.setupTitle": "Kurulum Ozeti",
  "tui.shell.setupSubtitle": "Engelleyen sorunlar, istege bagli iyilestirmeler ve sonraki adim",
  "tui.shell.setupNext": "Siradaki adim",
  "tui.shell.setupRefresh": "/setup ile teshisleri yenile",
  "tui.shell.setupGuided": "Tam kurulum icin artbot setup calistir",
  "tui.shell.helpTitle": "Operator Yardim",
  "tui.shell.helpSubtitle": "Komutlar, kisayollar ve is akisina girisler",
  "tui.shell.helpCommands": "Komutlar",
  "tui.shell.helpShortcuts": "Kisayollar",
  "tui.command.idle": " /research <artist> veya dogrudan sanatci yazin. Komutlar icin /help kullanin.",
  "tui.command.running": "Arastirma hattı calisiyor...",
  "tui.command.setup": "Kurulum modu - hazirligi incele ve yonlendirmeli akisi baslat",
  "tui.commandHint.research": "Sanatci fiyat arastirmasi baslat",
  "tui.commandHint.work": "Eser odakli arastirma baslat",
  "tui.commandHint.setup": "Kurulum, backend ve yetki hazirligini incele",
  "tui.commandHint.auth": "Tarayici oturum durumunu incele veya yakala",
  "tui.commandHint.doctor": "Yerel ortam sagligini denetle",
  "tui.commandHint.runs": "Son veya aktif kosulari incele",
  "tui.overlay.settings.title": "Ayarlar",
  "tui.overlay.settings.subtitle": "Tema, dil, yogunluk ve yerlesim tercihleri",
  "tui.settings.language": "Dil",
  "tui.settings.theme": "Tema",
  "tui.settings.density": "Yogunluk",
  "tui.settings.secondaryPane": "Ikinci panel",
  "tui.settings.value.enabled": "Acik",
  "tui.settings.value.disabled": "Kapali",
  "tui.language.english": "Ingilizce",
  "tui.language.turkish": "Turkce",
  "onboarding.step.language": "Dil",
  "onboarding.step.runtime": "Calisma ortami",
  "onboarding.step.llm": "LLM",
  "onboarding.step.backend": "Backend",
  "onboarding.step.discovery": "Kesif",
  "onboarding.step.auth": "Erisim",
  "onboarding.step.review": "Gozden gecir",
  "onboarding.action.next": "Ileri",
  "onboarding.action.back": "Geri",
  "onboarding.action.apply": "Kurulumu Uygula",
  "onboarding.action.edit": "Duzenle",
  "onboarding.action.continue": "Devam",
  "onboarding.provider.lmStudio": "LM Studio (yerel sunucu)",
  "onboarding.provider.nvidia": "NVIDIA OpenAI uyumlu uç nokta",
  "onboarding.provider.custom": "Ozel OpenAI uyumlu uç nokta",
  "onboarding.runtime.local": "Bu makinedeki yerel ArtBot backend'i kullan",
  "onboarding.runtime.remote": "Halihazirda calisan uzak ArtBot API'yi kullan",
  "onboarding.field.language": "Arayuz dili",
  "onboarding.field.provider": "LLM saglayici hazir ayari",
  "onboarding.field.baseUrl": "Temel URL",
  "onboarding.field.apiKey": "API anahtari",
  "onboarding.field.model": "Model",
  "onboarding.field.browseModels": "NVIDIA modellerini ac",
  "onboarding.field.stagehand": "Tarayici otomasyon modu",
  "onboarding.field.apiMode": "API modu",
  "onboarding.field.apiBaseUrl": "ArtBot API temel URL",
  "onboarding.field.optionalProbes": "Genisletilmis kesif kaynaklari",
  "onboarding.field.licensed": "Hesap veya lisans destekli kaynaklari kullan",
  "onboarding.field.reportSurface": "Tamamlanan rapor gorunumu",
  "onboarding.explainer.discovery.title": "Genisletilmis kesif kaynaklari",
  "onboarding.explainer.discovery.summary":
    "Varsayilan yalın arama yolunun otesine gecmek icin Artsy, MutualArt ve askART kaynaklarini ekler.",
  "onboarding.explainer.discovery.recommendation": "Daha genis pazar kapsami istiyorsaniz onerilir.",
  "onboarding.explainer.discovery.details":
    "Bu kaynaklar ek emsal eserler bulabilir, ancak bazilari hesap gerektirebilir ve varsayilan yola gore daha degisken olabilir. Ilk kurulumda en basit akis icin bunu kapali birakabilirsiniz.",
  "onboarding.explainer.licensed.title": "Hesap veya lisans destekli kaynaklar",
  "onboarding.explainer.licensed.summary":
    "Sanatfiyat gibi ancak zaten yasal erisiminiz, aboneliginiz veya lisansiniz varsa fayda saglayan kaynaklari icerir.",
  "onboarding.explainer.licensed.recommendation": "Yalnizca zaten gecerli erisiminiz varsa onerilir.",
  "onboarding.explainer.licensed.details":
    "Bu secenek sizin yerinize giris yapmaz. Bu kaynaklardan faydalanmak icin daha sonra tarayici oturumu yakalamaniz veya kimlik bilgileri ayarlamaniz gerekir.",
  "onboarding.explainer.reportSurface.title": "Tamamlanan rapor gorunumu",
  "onboarding.explainer.reportSurface.summary":
    "Arastirma bittiginde ArtBot'un tamamlanan kosulari nasil gosterecegini belirler.",
  "onboarding.explainer.reportSurface.recommendation": "Akisi ogrenirken her kosudan sonra sormasi en guvenli varsayilandir.",
  "onboarding.explainer.reportSurface.details":
    "Tum islemleri terminalde tutmak icin CLI, tarayici raporunu hep acmak icin Web, her tamamlanan kosuda secmek icin Sor secenegini kullanin.",
  "onboarding.review.applySummary": "Algilanan ortami gozden gecirin ve olusturulan yapilandirmayi uygulayin.",
  "onboarding.validation.baseUrlRequired": "Temel URL gerekli.",
  "onboarding.validation.apiBaseUrlRequired": "ArtBot API temel URL gerekli.",
  "onboarding.validation.modelRequired": "Model kimligi gerekli.",
  "onboarding.message.modelsOpened": "NVIDIA model katalogu tarayicida acildi.",
  "onboarding.message.modelsOpenFailed": "Model katalogu acilamadi. {url} adresini elle acin.",
  "onboarding.hint.controls":
    "Enter secer. Dil ve Calisma ortami adimlari hemen devam eder. Yukari/Asagi hareket · Sol/Sag adim · Ctrl+C iptal",
  "onboarding.hint.selected": "> imleci odagi gosterir. Secim satirlari secildikten sonra ● isaretini korur.",
  "onboarding.hint.details": "Odaktaki kurulum secenegi hakkinda daha fazla bilgi icin i tusuna basin.",
  "onboarding.label.recommended": "Onerilen"
};

const CATALOGS: Record<AppLocale, MessageCatalog> = {
  en: EN_MESSAGES,
  tr: TR_MESSAGES
};

export function normalizeAppLocale(value: string | null | undefined): AppLocale {
  return value?.trim().toLowerCase() === "tr" ? "tr" : "en";
}

export function translate(
  locale: AppLocale,
  key: MessageKey,
  replacements: Record<string, string | number> = {}
): string {
  let text = CATALOGS[locale][key] ?? EN_MESSAGES[key];
  for (const [token, value] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`\\{${token}\\}`, "g"), String(value));
  }
  return text;
}
