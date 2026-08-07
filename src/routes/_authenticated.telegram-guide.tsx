import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/telegram-guide")({
  component: TelegramGuidePage,
  head: () => ({
    meta: [
      { title: "Telegram közös nyelv — Kylo Brain" },
      {
        name: "description",
        content:
          "Mit írhatsz válaszként a Telegram értesítésekre, és a rendszer mit csinál vele: jóváhagyás, saját válasz, kihagyás, kérdés.",
      },
      { property: "og:title", content: "Telegram közös nyelv — Kylo Brain" },
      {
        property: "og:description",
        content: "A Telegram válaszparancsok listája egy helyen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Cmd = {
  words: string[];
  what: string;
  detail: string;
  tone: "ok" | "skip" | "own" | "ask";
};

const COMMANDS: Cmd[] = [
  {
    tone: "ok",
    words: ["mehet", "ok", "oké", "rendben", "igen", "jó", "jöhet", "küldd", "szuper", "👍", "✅", "+1"],
    what: "Elfogadod az általam javasolt választ",
    detail:
      "Nem ezt a szót fordítom le, hanem a javaslatomat: lefordítom angolra és elmentem jóváhagyott válaszként. Visszaírom a magyar és az angol változatot is.",
  },
  {
    tone: "own",
    words: ["bármilyen magyar mondat", "válasz: ..."],
    what: "A saját szövegedet küldjük",
    detail:
      "Amit magyarul írsz, azt fordítom angolra és azt mentem jóváhagyott válasznak. Ha a szöveged kérdőjelre végződne, de mégis ez a válasz, írd elé: „válasz:”.",
  },
  {
    tone: "skip",
    words: ["nem", "skip", "kihagy", "hagyd", "hagyjuk", "nem kell", "-", "x"],
    what: "Kihagyjuk ezt a posztot / kommentet",
    detail: "Semmit nem küldünk, a tétel „kihagyva” státuszba kerül, és nem zaklat többet.",
  },
  {
    tone: "ask",
    words: ["bármi, ami ?-re végződik"],
    what: "Kérdésnek értem — visszakérdezek",
    detail:
      "Ilyenkor NEM mentek el semmit válaszvázlatként, nehogy véletlenül a kérdésed menjen ki Redditre.",
  },
];

const toneClass: Record<Cmd["tone"], string> = {
  ok: "border-l-4 border-l-primary",
  own: "border-l-4 border-l-accent",
  skip: "border-l-4 border-l-muted-foreground/40",
  ask: "border-l-4 border-l-destructive/60",
};

function TelegramGuidePage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Telegram közös nyelv</h1>
        <p className="text-sm text-muted-foreground">
          Ez a lap egy puska: mit írhatsz <strong>válaszként</strong> egy Telegram
          értesítésre, és mit csinálok vele. Fontos: mindig arra a <em>buborékra</em>{" "}
          válaszolj (Telegram „Reply”), amelyikre vonatkozik — így tudom, melyik posztról
          van szó.
        </p>
      </header>

      <div className="space-y-3">
        {COMMANDS.map((c) => (
          <Card key={c.what} className={toneClass[c.tone]}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{c.what}</CardTitle>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {c.words.map((w) => (
                  <Badge key={w} variant="secondary" className="font-mono text-xs">
                    {w}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{c.detail}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Amit az üzenet fejlécében látsz</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p className="font-mono text-xs text-foreground">
            🟠 REDDIT · r/IELTS · fiók: u/…
          </p>
          <p>
            Az első sor mindig megmondja, melyik platform, melyik subreddit és melyik saját
            fiókunk érintett. A visszaigazoló üzenet is ugyanezt a fejlécet viseli.
          </p>
          <p>
            <span className="mr-1">⚪</span> jelölés = szerintem ide nem érdemes válaszolni,
            de felülbírálhatod: ha mégis írsz rá, kezelem rendes válaszként.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Jó tudni</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• A javaslataimat mindig magyarul kapod; az angol fordítás a jóváhagyás után készül.</p>
          <p>• A visszaigazolásban a magyar ÉS az angol szöveg is ott van, hogy másolható legyen.</p>
          <p>• Ha régi üzenetre válaszolsz, szólok, hogy nem találom — válaszolj friss értesítésre.</p>
        </CardContent>
      </Card>
    </div>
  );
}
