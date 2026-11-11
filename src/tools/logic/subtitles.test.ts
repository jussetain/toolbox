import { describe, expect, it } from "vitest";
import { activeAt, assColor, DEFAULT_STYLE, group, spread, toAss, toSrt, wordsFromSrt, wordsFromWhisper } from "./subtitles";

const tok = (text: string, from: number, to: number) => ({ text, offsets: { from, to } });

describe("sources", () => {
  it("aligne jetons et mots, accents compris", () => {
    const words = wordsFromWhisper({
      transcription: [{
        text: " Bonjour à l'été",
        offsets: { from: 0, to: 2000 },
        // « à » et « été » coupés en jetons illisibles : seuls les espaces comptent.
        tokens: [tok("[_BEG_]", 0, 0), tok(" Bon", 0, 300), tok("jour", 300, 600), tok(" �", 700, 800), tok(" l", 900, 1000), tok("'�", 1000, 1200), tok("t�", 1200, 1500), tok("[_TT_75]", 1500, 1500)],
      }],
    });
    expect(words.map((w) => w.text)).toEqual(["Bonjour", "à", "l'été"]);
    expect(words[0]).toMatchObject({ start: 0, end: 0.6 });
    expect(words[2]).toMatchObject({ start: 0.9, end: 1.5 });
  });

  it("répartit au prorata si l'alignement échoue", () => {
    const words = wordsFromWhisper({ transcription: [{ text: " un deux", offsets: { from: 1000, to: 3000 }, tokens: [tok(" undeux", 1000, 3000)] }] });
    expect(words.map((w) => w.text)).toEqual(["un", "deux"]);
    expect(words[0].start).toBe(1);
    expect(words[1].end).toBeCloseTo(3);
  });

  it("lit un SRT", () => {
    const words = wordsFromSrt("1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>Salut</i> tout\r\nle monde\r\n\r\n2\n00:00:04,500 --> 00:00:05,000\nFin.\n");
    expect(words.map((w) => w.text)).toEqual(["Salut", "tout", "le", "monde", "Fin."]);
    expect(words[0].start).toBe(1);
    expect(words[4]).toMatchObject({ start: 4.5, end: 5 });
  });

  it("spread couvre l'intervalle", () => {
    const w = spread(["a", "bbb"], 0, 6);
    expect(w[0].end).toBe(w[1].start);
    expect(w[1].end).toBe(6);
  });
});

describe("découpage", () => {
  const words = spread("Il fait beau aujourd'hui. On va à la plage cet après-midi".split(" "), 0, 10);

  it("N mots par ligne, coupe en fin de phrase", () => {
    const cues = group(words, { maxWords: 3, maxChars: 40 });
    expect(cues.map((c) => c.words.map((w) => w.text).join(" "))).toEqual(["Il fait beau", "aujourd'hui.", "On va à", "la plage cet", "après-midi"]);
    // Enchaînement continu.
    cues.slice(0, -1).forEach((c, i) => expect(c.end).toBe(cues[i + 1].start));
  });

  it("phrases, et coupe sur un silence", () => {
    const ws = [...spread(["Un", "deux"], 0, 1), ...spread(["trois"], 3, 4)];
    const cues = group(ws, { maxWords: 0, maxChars: 80 });
    expect(cues).toHaveLength(2);
    expect(cues[0].end).toBe(1);
  });

  it("limite de caractères", () => {
    const cues = group(spread("aaaa bbbb cccc dddd".split(" "), 0, 4), { maxWords: 0, maxChars: 9 });
    expect(cues.map((c) => c.words.length)).toEqual([2, 2]);
  });
});

describe("export", () => {
  const cues = group(spread(["Salut", "{tout}", "le", "monde"], 1, 3), { maxWords: 2, maxChars: 40 });

  it("couleurs ASS", () => {
    expect(assColor("#FFD400")).toBe("&H0000D4FF");
    expect(assColor("#000000", 60)).toBe("&H66000000");
  });

  it("ASS avec style, échappement et décalage", () => {
    const ass = toAss(cues, { ...DEFAULT_STYLE, font: "Impact", size: 10, upper: true, position: "middle", offset: 0.5 }, 1080, 1920);
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toMatch(/Style: Default,Impact,192,.*,5,\d+,\d+,0,1$/m);
    expect(ass).toContain("Dialogue: 0,0:00:01.50,");
    expect(ass).toContain("SALUT (TOUT)");
  });

  it("surlignage mot à mot", () => {
    const ass = toAss(cues, { ...DEFAULT_STYLE, highlight: "#FFD400" }, 1920, 1080);
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue"));
    expect(events).toHaveLength(4);
    expect(events[0]).toContain("{\\c&H0000D4FF}Salut{\\c&H00FFFFFF} (tout)");
  });

  it("SRT et mot actif", () => {
    expect(toSrt(cues, { offset: 0, upper: false })).toMatch(/^1\n00:00:01,000 --> 00:00:02,\d{3}\nSalut \{tout\}\n/);
    const a = activeAt(cues, cues[0].words[1].start + 0.01);
    expect(a?.word).toBe(1);
    expect(activeAt(cues, 10)).toBeNull();
  });
});
