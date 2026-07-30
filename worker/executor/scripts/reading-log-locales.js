// worker/executor/scripts/reading-log-locales.js
//
// Ország-konzisztens teszt olvasónapló témák.
//
// Miért kell: az olvasónapló funkció tesztjénél nem mindegy, milyen könyvet
// kérünk. Magyar IP-ről magyar kötelező olvasmányt (Egri csillagok), UK IP-ről
// angol nyelvűt stb. Így a teszt életszerű, és a generált tartalom nyelve is
// stimmel a proxy országával.
//
// Ugyanaz a logika, mint a billing-locales.js-nél: az IP/nyelv alapján
// választunk profilt, azon belül pedig véletlenszerűen egy könyvet.

const PROFILES = {
  HU: {
    country: "HU",
    language: "hu",
    languageName: "magyar",
    books: [
      { title: "Egri csillagok", author: "Gárdonyi Géza" },
      { title: "A Pál utcai fiúk", author: "Molnár Ferenc" },
      { title: "Légy jó mindhalálig", author: "Móricz Zsigmond" },
      { title: "Kőszívű ember fiai", author: "Jókai Mór" },
      { title: "Abigél", author: "Szabó Magda" },
    ],
  },
  GB: {
    country: "GB",
    language: "en",
    languageName: "English",
    books: [
      { title: "Harry Potter and the Goblet of Fire", author: "J. K. Rowling" },
      { title: "Lord of the Flies", author: "William Golding" },
      { title: "Animal Farm", author: "George Orwell" },
      { title: "Great Expectations", author: "Charles Dickens" },
      { title: "Of Mice and Men", author: "John Steinbeck" },
    ],
  },
  IE: {
    country: "IE",
    language: "en",
    languageName: "English",
    books: [
      { title: "Dubliners", author: "James Joyce" },
      { title: "The Old Man and the Sea", author: "Ernest Hemingway" },
      { title: "Animal Farm", author: "George Orwell" },
      { title: "Wuthering Heights", author: "Emily Brontë" },
    ],
  },
  US: {
    country: "US",
    language: "en",
    languageName: "English",
    books: [
      { title: "To Kill a Mockingbird", author: "Harper Lee" },
      { title: "The Great Gatsby", author: "F. Scott Fitzgerald" },
      { title: "Of Mice and Men", author: "John Steinbeck" },
      { title: "The Catcher in the Rye", author: "J. D. Salinger" },
      { title: "Fahrenheit 451", author: "Ray Bradbury" },
    ],
  },
  CA: {
    country: "CA",
    language: "en",
    languageName: "English",
    books: [
      { title: "The Giver", author: "Lois Lowry" },
      { title: "To Kill a Mockingbird", author: "Harper Lee" },
      { title: "Anne of Green Gables", author: "Lucy Maud Montgomery" },
      { title: "Lord of the Flies", author: "William Golding" },
    ],
  },
  AU: {
    country: "AU",
    language: "en",
    languageName: "English",
    books: [
      { title: "Storm Boy", author: "Colin Thiele" },
      { title: "Animal Farm", author: "George Orwell" },
      { title: "To Kill a Mockingbird", author: "Harper Lee" },
      { title: "Macbeth", author: "William Shakespeare" },
    ],
  },
  NZ: {
    country: "NZ",
    language: "en",
    languageName: "English",
    books: [
      { title: "The Whale Rider", author: "Witi Ihimaera" },
      { title: "Lord of the Flies", author: "William Golding" },
      { title: "Of Mice and Men", author: "John Steinbeck" },
    ],
  },
  DE: {
    country: "DE",
    language: "de",
    languageName: "Deutsch",
    books: [
      { title: "Die Verwandlung", author: "Franz Kafka" },
      { title: "Der Vorleser", author: "Bernhard Schlink" },
      { title: "Faust I", author: "Johann Wolfgang von Goethe" },
      { title: "Die Welle", author: "Morton Rhue" },
    ],
  },
  AT: {
    country: "AT",
    language: "de",
    languageName: "Deutsch",
    books: [
      { title: "Die Verwandlung", author: "Franz Kafka" },
      { title: "Schachnovelle", author: "Stefan Zweig" },
      { title: "Der Vorleser", author: "Bernhard Schlink" },
    ],
  },
  CH: {
    country: "CH",
    language: "de",
    languageName: "Deutsch",
    books: [
      { title: "Homo faber", author: "Max Frisch" },
      { title: "Der Besuch der alten Dame", author: "Friedrich Dürrenmatt" },
      { title: "Die Verwandlung", author: "Franz Kafka" },
    ],
  },
  FR: {
    country: "FR",
    language: "fr",
    languageName: "français",
    books: [
      { title: "Le Petit Prince", author: "Antoine de Saint-Exupéry" },
      { title: "L'Étranger", author: "Albert Camus" },
      { title: "Candide", author: "Voltaire" },
      { title: "Les Misérables", author: "Victor Hugo" },
    ],
  },
  IT: {
    country: "IT",
    language: "it",
    languageName: "italiano",
    books: [
      { title: "I promessi sposi", author: "Alessandro Manzoni" },
      { title: "Il fu Mattia Pascal", author: "Luigi Pirandello" },
      { title: "Se questo è un uomo", author: "Primo Levi" },
    ],
  },
  ES: {
    country: "ES",
    language: "es",
    languageName: "español",
    books: [
      { title: "Don Quijote de la Mancha", author: "Miguel de Cervantes" },
      { title: "La casa de Bernarda Alba", author: "Federico García Lorca" },
      { title: "Lazarillo de Tormes", author: "Anónimo" },
    ],
  },
  PT: {
    country: "PT",
    language: "pt",
    languageName: "português",
    books: [
      { title: "Os Lusíadas", author: "Luís de Camões" },
      { title: "Memorial do Convento", author: "José Saramago" },
      { title: "Os Maias", author: "Eça de Queirós" },
    ],
  },
  BR: {
    country: "BR",
    language: "pt",
    languageName: "português",
    books: [
      { title: "Dom Casmurro", author: "Machado de Assis" },
      { title: "Vidas Secas", author: "Graciliano Ramos" },
      { title: "O Cortiço", author: "Aluísio Azevedo" },
    ],
  },
  NL: {
    country: "NL",
    language: "nl",
    languageName: "Nederlands",
    books: [
      { title: "Het achterhuis", author: "Anne Frank" },
      { title: "De aanslag", author: "Harry Mulisch" },
      { title: "Max Havelaar", author: "Multatuli" },
    ],
  },
  SE: {
    country: "SE",
    language: "sv",
    languageName: "svenska",
    books: [
      { title: "Ronja Rövardotter", author: "Astrid Lindgren" },
      { title: "Röde Orm", author: "Frans G. Bengtsson" },
      { title: "Doktor Glas", author: "Hjalmar Söderberg" },
    ],
  },
  PL: {
    country: "PL",
    language: "pl",
    languageName: "polski",
    books: [
      { title: "Pan Tadeusz", author: "Adam Mickiewicz" },
      { title: "Quo Vadis", author: "Henryk Sienkiewicz" },
      { title: "Lalka", author: "Bolesław Prus" },
    ],
  },
  MX: {
    country: "MX",
    language: "es",
    languageName: "español",
    books: [
      { title: "Pedro Páramo", author: "Juan Rulfo" },
      { title: "El llano en llamas", author: "Juan Rulfo" },
      { title: "Don Quijote de la Mancha", author: "Miguel de Cervantes" },
    ],
  },
  TW: {
    country: "TW",
    language: "zh-TW",
    languageName: "繁體中文",
    books: [
      { title: "背影", author: "朱自清" },
      { title: "老人與海", author: "海明威" },
      { title: "西遊記", author: "吳承恩" },
    ],
  },
};

const LANG_TO_COUNTRY = {
  "en-us": "US",
  "en-gb": "GB",
  "en-ie": "IE",
  "en-ca": "CA",
  "en-au": "AU",
  "en-nz": "NZ",
  "de-de": "DE",
  "de-at": "AT",
  "de-ch": "CH",
  "fr-fr": "FR",
  "fr-ch": "CH",
  "it-it": "IT",
  "es-es": "ES",
  "es-mx": "MX",
  "pt-pt": "PT",
  "pt-br": "BR",
  "nl-nl": "NL",
  "sv-se": "SE",
  "pl-pl": "PL",
  "hu-hu": "HU",
  "zh-tw": "TW",
  en: "GB",
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
  pt: "PT",
  nl: "NL",
  sv: "SE",
  pl: "PL",
  hu: "HU",
};

export function resolveReadingCountry(lang, country) {
  const cc = String(country || "").trim().toUpperCase();
  if (cc && PROFILES[cc]) return cc;
  const l = String(lang || "").trim().toLowerCase();
  if (LANG_TO_COUNTRY[l]) return LANG_TO_COUNTRY[l];
  const short = l.split("-")[0];
  if (LANG_TO_COUNTRY[short]) return LANG_TO_COUNTRY[short];
  return "US";
}

/**
 * Az adott IP-hez / nyelvhez illő olvasónapló teszt-témát adja vissza.
 * @returns {{country:string, language:string, languageName:string, title:string, author:string, prompt:string}}
 */
export function readingLogTopic(lang, country, seed) {
  const cc = resolveReadingCountry(lang, country);
  const p = PROFILES[cc];
  const idx =
    typeof seed === "number"
      ? Math.abs(Math.floor(seed)) % p.books.length
      : Math.floor(Math.random() * p.books.length);
  const book = p.books[idx];
  return {
    country: p.country,
    language: p.language,
    languageName: p.languageName,
    title: book.title,
    author: book.author,
    prompt: `${book.title} — ${book.author}`,
  };
}

export const READING_LOG_PROFILES = PROFILES;
