"""Data-only contract for the multilingual piggy-bank releases (26 non-Hungarian languages).

Additive next to piggy.py: the Hungarian single-trial restrictions stay untouched.
Two recipe families exist here:
- malacpersely-i18n-en-trial: the single non-Hungarian (English) trial, trial-only.
- malacpersely-i18n-continuation: the remaining 25 languages, anchored to the
  approved Hungarian v4 archive receipt and the completed English trial receipt.
"""
import json

from piggy import COUNTER, data, scene_frames

RENDERER = "piggy-bank-multilang-safe-v1"
SCENE = "piggy-bank-i18n-v1"
TRIAL_RECIPE = "malacpersely-i18n-en-trial"
TRIAL_LANGUAGE = "en"
CONTINUATION_RECIPE = "malacpersely-i18n-continuation"
VERSION = "v1"
# Additive: the continuation also accepts "v2" (full preserved trial receipts);
# v1 stays valid and unchanged, the single English trial remains v1-only.
CONTINUATION_VERSIONS = ("v1", "v2")
# The 26 approved non-Hungarian languages (English is the single trial language).
LANGUAGES = set("en de nl fr ja es pt it ko pl no sv cs tr sk sl da fi ar hi sr ru ro hr el zh".split())
RTL_LANGUAGES = {"ar"}
# Approved Hungarian v4 reference (owner approval); the continuation anchors to it.
HU_V4_JOB = "9abcc813-2454-441f-bbff-5b90ca695b0c"
HU_V4_SHA256 = "9d35ff828e2aaeb3366bbb970d2e563dba3e8ff7c40dbf0daea70757eba454e8"
# Fixed Hungarian strings that must never appear in a non-Hungarian video.
HU_STRINGS = {
    "Szemléltető előfizetési kosár. A tényleges díjak eltérhetnek.",
    "Több mint 100 USD/hó",
    "29,99 USD/hó",
    "Próbáld ki ingyen!",
    "14 napos ingyenes próba",
    "USD/hó",
}
OUTRO_URL = "kylo.study"
OUTRO_TAGLINE = "Your AI tutor"
COINS_KEY = "audio/coins-mp3"
BED_KEY = "audio/bed-mp3"

# Owner-approved fixed strings per language: counter unit, illustrative disclaimer,
# final truth statement, Kylo price and the 14-day free-trial call to action.
TRANSLATIONS = {
    "en": {"unit": "USD/mo.", "disclaimer": "Illustrative subscription basket. Actual fees may vary.", "truth": "Over 100 USD/mo.", "price": "29.99 USD/mo.", "cta": "Try it for free!", "supporting": "14-day free trial"},
    "de": {"unit": "USD/Monat", "disclaimer": "Beispielhaftes Abo-Paket. Die tatsächlichen Gebühren können abweichen.", "truth": "Über 100 USD/Monat", "price": "29,99 USD/Monat", "cta": "Jetzt kostenlos testen!", "supporting": "14 Tage kostenlos testen"},
    "nl": {"unit": "USD/maand", "disclaimer": "Voorbeeld van een abonnementenpakket. Werkelijke kosten kunnen afwijken.", "truth": "Meer dan 100 USD/maand", "price": "29,99 USD/maand", "cta": "Probeer het gratis!", "supporting": "14 dagen gratis proberen"},
    "fr": {"unit": "USD/mois", "disclaimer": "Panier d'abonnements illustratif. Les frais réels peuvent varier.", "truth": "Plus de 100 USD/mois", "price": "29,99 USD/mois", "cta": "Essayez gratuitement !", "supporting": "14 jours d'essai gratuit"},
    "ja": {"unit": "USD/月", "disclaimer": "これは例示のサブスクリプション一覧です。実際の料金は異なる場合があります。", "truth": "月額100 USD超", "price": "29.99 USD/月", "cta": "無料で試す！", "supporting": "14日間無料トライアル"},
    "es": {"unit": "USD/mes", "disclaimer": "Cesta de suscripciones ilustrativa. Las tarifas reales pueden variar.", "truth": "Más de 100 USD/mes", "price": "29,99 USD/mes", "cta": "¡Pruébalo gratis!", "supporting": "Prueba gratuita de 14 días"},
    "pt": {"unit": "USD/mês", "disclaimer": "Cesta de assinaturas ilustrativa. Os valores reais podem variar.", "truth": "Mais de 100 USD/mês", "price": "29,99 USD/mês", "cta": "Experimente grátis!", "supporting": "Teste grátis por 14 dias"},
    "it": {"unit": "USD/mese", "disclaimer": "Paniere di abbonamenti illustrativo. Le tariffe reali possono variare.", "truth": "Oltre 100 USD/mese", "price": "29,99 USD/mese", "cta": "Provalo gratis!", "supporting": "Prova gratuita di 14 giorni"},
    "ko": {"unit": "USD/월", "disclaimer": "예시 구독 바구니입니다. 실제 요금은 다를 수 있습니다.", "truth": "월 100 USD 초과", "price": "29.99 USD/월", "cta": "무료로 체험하기!", "supporting": "14일 무료 체험"},
    "pl": {"unit": "USD/mies.", "disclaimer": "Przykładowy koszyk subskrypcji. Rzeczywiste opłaty mogą się różnić.", "truth": "Ponad 100 USD/mies.", "price": "29,99 USD/mies.", "cta": "Wypróbuj za darmo!", "supporting": "14 dni darmowego testu"},
    "no": {"unit": "USD/mnd.", "disclaimer": "Eksempel på abonnementskurv. Faktiske priser kan variere.", "truth": "Over 100 USD/mnd.", "price": "29,99 USD/mnd.", "cta": "Prøv gratis!", "supporting": "14 dagers gratis prøveperiode"},
    "sv": {"unit": "USD/mån.", "disclaimer": "Exempel på prenumerationskorg. Faktiska avgifter kan variera.", "truth": "Över 100 USD/mån.", "price": "29,99 USD/mån.", "cta": "Prova gratis!", "supporting": "14 dagars gratis provperiod"},
    "cs": {"unit": "USD/měs.", "disclaimer": "Ilustrativní košík předplatného. Skutečné poplatky se mohou lišit.", "truth": "Více než 100 USD/měs.", "price": "29,99 USD/měs.", "cta": "Vyzkoušejte zdarma!", "supporting": "14denní zkušební verze zdarma"},
    "tr": {"unit": "USD/ay", "disclaimer": "Örnek abonelik sepeti. Gerçek ücretler farklılık gösterebilir.", "truth": "Ayda 100 USD'den fazla", "price": "29,99 USD/ay", "cta": "Ücretsiz dene!", "supporting": "14 gün ücretsiz deneme"},
    "sk": {"unit": "USD/mes.", "disclaimer": "Ilustračný košík predplatného. Skutočné poplatky sa môžu líšiť.", "truth": "Viac ako 100 USD/mes.", "price": "29,99 USD/mes.", "cta": "Vyskúšajte zadarmo!", "supporting": "14-dňová skúšobná verzia zadarmo"},
    "sl": {"unit": "USD/mes.", "disclaimer": "Prikazna košarica naročnin. Dejanski zneski se lahko razlikujejo.", "truth": "Več kot 100 USD/mes.", "price": "29,99 USD/mes.", "cta": "Preizkusite brezplačno!", "supporting": "14-dnevno brezplačno preizkušanje"},
    "da": {"unit": "USD/md.", "disclaimer": "Eksempel på abonnementskurv. Faktiske priser kan variere.", "truth": "Over 100 USD/md.", "price": "29,99 USD/md.", "cta": "Prøv det gratis!", "supporting": "14 dages gratis prøveperiode"},
    "fi": {"unit": "USD/kk", "disclaimer": "Esimerkki tilauskorista. Todelliset hinnat voivat vaihdella.", "truth": "Yli 100 USD/kk", "price": "29,99 USD/kk", "cta": "Kokeile ilmaiseksi!", "supporting": "14 päivän ilmainen kokeilu"},
    "ar": {"unit": "USD شهريًا", "disclaimer": "سلة اشتراكات توضيحية. قد تختلف الرسوم الفعلية.", "truth": "أكثر من 100 USD شهريًا", "price": "29.99 USD شهريًا", "cta": "جرّبه مجانًا!", "supporting": "تجربة مجانية لمدة 14 يومًا"},
    "hi": {"unit": "USD/माह", "disclaimer": "उदाहरण स्वरूप सब्सक्रिप्शन टोकरी। वास्तविक शुल्क अलग हो सकते हैं।", "truth": "100 USD/माह से अधिक", "price": "29.99 USD/माह", "cta": "मुफ़्त आज़माएं!", "supporting": "14 दिन का मुफ़्त ट्रायल"},
    "sr": {"unit": "USD/мес.", "disclaimer": "Илустративна корпа претплата. Стварне накнаде могу да се разликују.", "truth": "Преко 100 USD/мес.", "price": "29,99 USD/мес.", "cta": "Пробај бесплатно!", "supporting": "14 дана бесплатног пробног периода"},
    "ru": {"unit": "USD/мес.", "disclaimer": "Иллюстративная корзина подписок. Фактические тарифы могут отличаться.", "truth": "Более 100 USD/мес.", "price": "29,99 USD/мес.", "cta": "Попробуй бесплатно!", "supporting": "14 дней бесплатного пробного периода"},
    "ro": {"unit": "USD/lună", "disclaimer": "Coș ilustrativ de abonamente. Tarifele reale pot varia.", "truth": "Peste 100 USD/lună", "price": "29,99 USD/lună", "cta": "Încearcă gratuit!", "supporting": "14 zile de probă gratuită"},
    "hr": {"unit": "USD/mj.", "disclaimer": "Prikazna košarica pretplata. Stvarne naknade mogu se razlikovati.", "truth": "Više od 100 USD/mj.", "price": "29,99 USD/mj.", "cta": "Isprobaj besplatno!", "supporting": "14 dana besplatnog probnog razdoblja"},
    "el": {"unit": "USD/μήνα", "disclaimer": "Ενδεικτικό καλάθι συνδρομών. Οι πραγματικές χρεώσεις ενδέχεται να διαφέρουν.", "truth": "Πάνω από 100 USD/μήνα", "price": "29,99 USD/μήνα", "cta": "Δοκίμασέ το δωρεάν!", "supporting": "14 ημέρες δωρεάν δοκιμής"},
    "zh": {"unit": "USD/月", "disclaimer": "示意性订阅组合。实际费用可能有所不同。", "truth": "超过 100 USD/月", "price": "29.99 USD/月", "cta": "免费试用！", "supporting": "14 天免费试用"},
}
assert set(TRANSLATIONS) == LANGUAGES

TEXT_FIELDS = {"heading", "disclaimer", "truth", "price", "unit", "steps", "counter_values", "labels", "outro_url", "outro_tagline"}


def targeted(raw):
    videos = raw.get("videos")
    return raw.get("recipe_id") in {TRIAL_RECIPE, CONTINUATION_RECIPE} or raw.get("renderer") == RENDERER or any(
        isinstance(v, dict) and v.get("scene") == SCENE for v in (videos if isinstance(videos, list) else []))


def audio_key(language):
    return "audio/vo-%s-mp3" % language


def master_key(language):
    return "data/scene-frames-%s-json" % language


def _timing_frames(timing, duration_ms):
    if not isinstance(timing, list) or len(timing) != 7:
        raise ValueError("piggy_invalid_scene_frames")
    end, frames = 0, []
    for t in timing:
        if not isinstance(t, dict) or set(t) != {"start_ms", "end_ms"} or type(t["start_ms"]) is not int or type(t["end_ms"]) is not int or t["start_ms"] != end:
            raise ValueError("piggy_invalid_timing")
        # Millisecond boundaries must be nearest-ms representations of exact 30fps frames.
        a, b = round(t["start_ms"] * 30 / 1000), round(t["end_ms"] * 30 / 1000)
        if abs(t["start_ms"] - a * 1000 / 30) > 0.501 or abs(t["end_ms"] - b * 1000 / 30) > 0.501:
            raise ValueError("piggy_invalid_timing")
        frames.append(b - a)
        end = t["end_ms"]
    scene_frames(frames)
    if end != duration_ms:
        raise ValueError("piggy_invalid_timing")
    return frames


def _subtitles(value, timing):
    subtitles = data(value, {"subs"})["subs"]
    if not isinstance(subtitles, list) or len(subtitles) > 2000:
        raise ValueError("piggy_invalid_subtitles")
    last = 0
    for s in subtitles:
        if (not isinstance(s, dict) or set(s) != {"start_ms", "end_ms", "text"} or type(s["start_ms"]) is not int or type(s["end_ms"]) is not int
                or not last <= s["start_ms"] < s["end_ms"] <= timing[5]["end_ms"] or not isinstance(s["text"], str) or not s["text"].strip() or len(s["text"]) > 180):
            raise ValueError("piggy_invalid_subtitles")
        # No Hungarian fixed string may survive inside a non-Hungarian video.
        if any(hu in s["text"] for hu in HU_STRINGS):
            raise ValueError("piggy_i18n_hungarian_text")
        last = s["end_ms"]
    return subtitles


def _video(video, names):
    language = video.get("language")
    if language not in LANGUAGES or video.get("scene") != SCENE or (video.get("width"), video.get("height")) != (1080, 1920) or "font" in video:
        raise ValueError("piggy_i18n_invalid_scene")
    fixed = TRANSLATIONS[language]
    text = data(video.get("text"), TEXT_FIELDS)
    for key in ("heading", "disclaimer", "truth", "price", "unit", "outro_url", "outro_tagline"):
        if not isinstance(text[key], str) or not text[key].strip() or len(text[key]) > 180:
            raise ValueError("piggy_invalid_text")
    if text["counter_values"] != COUNTER:
        raise ValueError("piggy_invalid_offer")
    for key, count in (("steps", 4), ("labels", 5)):
        if not isinstance(text[key], list) or len(text[key]) != count or any(not isinstance(s, str) or not s.strip() or len(s) > 100 for s in text[key]):
            raise ValueError("piggy_invalid_text")
    # Fixed values are pinned to the approved per-language translations.
    if (text["disclaimer"], text["truth"], text["price"], text["unit"]) != (fixed["disclaimer"], fixed["truth"], fixed["price"], fixed["unit"]):
        raise ValueError("piggy_i18n_translation_required")
    if (text["outro_url"], text["outro_tagline"]) != (OUTRO_URL, OUTRO_TAGLINE):
        raise ValueError("piggy_i18n_brand_immutable")
    if any(text[key] in HU_STRINGS for key in ("heading", "disclaimer", "truth", "price", "unit")):
        raise ValueError("piggy_i18n_hungarian_text")
    cta = data(video.get("cta"), {"text", "supporting_text", "trial_days"})
    if cta != {"text": fixed["cta"], "supporting_text": fixed["supporting"], "trial_days": 14}:
        raise ValueError("piggy_i18n_invalid_cta")
    frames = _timing_frames(video.get("timing"), video.get("duration_ms"))
    _subtitles(video.get("subtitle"), video["timing"])
    # Narration and coin impacts are separate inputs; a pre-mixed full track is rejected.
    if video.get("audio") != audio_key(language) or video.get("master") != master_key(language):
        raise ValueError("piggy_i18n_invalid_media")
    if not {video["audio"], video["master"], COINS_KEY} <= names:
        raise ValueError("piggy_i18n_invalid_input_list")
    return frames


def validate(raw):
    if (raw.get("schema_version") != 1 or raw.get("renderer") != RENDERER or raw.get("series") != "other"
            or not isinstance(raw.get("videos"), list) or not raw["videos"]):
        raise ValueError("piggy_i18n_unknown_recipe")
    recipe_id = raw.get("recipe_id")
    languages = raw.get("languages")
    names = {f["key"] for f in raw["files"]}
    if recipe_id == TRIAL_RECIPE:
        if raw.get("version") != VERSION or languages != [TRIAL_LANGUAGE] or "continuation" in raw or len(raw["videos"]) != 1:
            raise ValueError("piggy_i18n_single_en_trial_only")
    elif recipe_id == CONTINUATION_RECIPE:
        expected = sorted(LANGUAGES - {TRIAL_LANGUAGE})
        if raw.get("version") != VERSION or languages != expected or len(raw["videos"]) != len(expected):
            raise ValueError("piggy_i18n_continuation_languages")
        continuation = raw.get("continuation")
        if not isinstance(continuation, dict) or continuation.get("trial_recipe_id") != TRIAL_RECIPE or continuation.get("trial_version") != VERSION:
            raise ValueError("piggy_i18n_continuation_anchor")
        if continuation.get("blocked_languages"):
            raise ValueError("piggy_i18n_blocked_languages")
        completed = continuation.get("completed")
        if not isinstance(completed, list) or {item.get("language") for item in completed if isinstance(item, dict)} != {"hu", TRIAL_LANGUAGE}:
            raise ValueError("piggy_i18n_continuation_anchor")
        receipts = {item["language"]: item["receipt"] for item in completed}
        # The continuation is bound to the approved Hungarian v4 archive receipt.
        if receipts["hu"].get("sha256") != HU_V4_SHA256:
            raise ValueError("piggy_i18n_hu_reference_receipt")
    else:
        raise ValueError("piggy_i18n_unknown_recipe")
    covered = set()
    for video in raw["videos"]:
        _video(video, names)
        if video["language"] in covered:
            raise ValueError("piggy_i18n_duplicate_language")
        covered.add(video["language"])
    if covered != set(languages):
        raise ValueError("piggy_i18n_missing_language_video")
    allowed = {audio_key(lang) for lang in languages} | {master_key(lang) for lang in languages} | {COINS_KEY, BED_KEY}
    if names - allowed:
        raise ValueError("piggy_i18n_invalid_input_list")
    return raw
