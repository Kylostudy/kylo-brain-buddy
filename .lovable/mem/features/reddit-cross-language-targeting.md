---
name: Reddit kereszt-nyelvű célzás
description: Minden Reddit fiók IDEGEN nyelvű nyelvtanuló subredditeket melegít/figyel, sosem a saját anyanyelvét tanulókat
type: feature
---

Szabály: egy adott nyelvű (IP/proxy szerinti) Reddit fiók **nem** nézi a saját nyelvét tanulók
subredditjét (egy angol fiók nem olvas r/EnglishLearning-et — ő már tud angolul), hanem
másik nyelv tanulói közösségét.

Jelenlegi kiosztás (warmup + diskurzus-figyelés):
- DE/CH → EnglishLearning, learnenglish, learnspanish
- EN/AU → LearnJapanese, ChineseLanguage
- EN/SG → ChineseLanguage, SpeakChinese, LearnJapanese
- EN/NZ → LearnGerman, German
- EN általános → LearnGerman, German, learnspanish, Spanish
- EN/IE → learnspanish, learnportuguese, Portuguese
- EN/NL → learndutch, LearnGerman
- EN/AskReddit → LearnJapanese, learnportuguese, Portuguese
- ES → EnglishLearning, LearnGerman
- HU → LearnGerman, EnglishLearning
- PL → LearnGerman, EnglishLearning
- TR → LearnGerman, EnglishLearning

A helyi/földrajzi subredditek (pl. r/hungary, r/australia) maradnak, mert azok adják a
természetes „hazai” hírfolyamot. Az r/languagelearning mindenkinél megmarad közös kapocsnak.
A diskurzus-elemző (reddit_readonly_watches) a teljes kereszt-nyelvű készletet figyeli.
