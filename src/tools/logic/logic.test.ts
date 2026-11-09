import { describe, expect, it } from "vitest";
import {
  base64ToBytes, cleanLink, decodeBase64Text, decodeJwt, encodeBase64Text, formatJson, guessUnit, haversine,
  inspectChars, inspectUuid, parseCoord, sanitizeText, timestampToDate, toDms, uuidV4, uuidV7, verifyJwtHmac,
} from "./dev";
import { convertCase, formatMinutes, lorem, mulberry32, splitWords, textStats } from "./text";

describe("JSON", () => {
  it("formate et minifie", () => {
    const r = formatJson('{"b":1,"a":[1,2]}', 2, true);
    expect(r).toEqual({ ok: true, output: '{\n  "a": [\n    1,\n    2\n  ],\n  "b": 1\n}', lines: 7 });
    expect(formatJson('{ "a" : 1 }', 0)).toMatchObject({ ok: true, output: '{"a":1}' });
  });
  it("signale une erreur", () => {
    const r = formatJson('{\n  "a": 1,\n}', 2);
    expect(r.ok).toBe(false);
  });
});

describe("Base64", () => {
  it("aller-retour UTF-8", () => {
    expect(encodeBase64Text("héllo ✓")).toBe("aMOpbGxvIOKckw==");
    expect(decodeBase64Text("aMOpbGxvIOKckw==")).toBe("héllo ✓");
  });
  it("variante URL et sans padding", () => {
    expect(encodeBase64Text("??>", true)).toBe("Pz8-");
    expect(decodeBase64Text("Pz8-")).toBe("??>");
    expect([...base64ToBytes("AQ")]).toEqual([1]);
  });
  it("refuse l'invalide", () => expect(() => base64ToBytes("a$b")).toThrow());
});

describe("UUID", () => {
  it("v4 et v7 bien formés", () => {
    const zero = (b: Uint8Array) => b.fill(0xff);
    expect(uuidV4(zero)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    const v7 = uuidV7(1700000000000, (b) => b.fill(0));
    expect(v7).toBe("018bcfe5-6800-7000-8000-000000000000");
    const info = inspectUuid(v7);
    expect(info.version).toBe(7);
    expect(info.date?.getTime()).toBe(1700000000000);
  });
  it("inspecte", () => {
    expect(inspectUuid("pas un uuid").valid).toBe(false);
    expect(inspectUuid("{00000000-0000-0000-0000-000000000000}").nil).toBe(true);
    expect(inspectUuid(uuidV4()).version).toBe(4);
  });
});

describe("JWT", () => {
  // jwt.io : HS256, secret « your-256-bit-secret »
  const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  it("décode", () => {
    const j = decodeJwt("Bearer " + token);
    expect(j.header.alg).toBe("HS256");
    expect(j.payload.name).toBe("John Doe");
  });
  it("vérifie la signature HMAC", async () => {
    expect(await verifyJwtHmac(decodeJwt(token), "your-256-bit-secret")).toBe(true);
    expect(await verifyJwtHmac(decodeJwt(token), "mauvais")).toBe(false);
  });
});

describe("Timestamps", () => {
  it("devine l'unité", () => {
    expect(guessUnit("1700000000")).toBe("s");
    expect(guessUnit("1700000000000")).toBe("ms");
    expect(guessUnit("1700000000000000")).toBe("us");
    expect(guessUnit("1700000000000000000")).toBe("ns");
    expect(timestampToDate("1700000000", "s").toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });
});

describe("Liens", () => {
  it("retire les traceurs", () => {
    const r = cleanLink("https://exemple.fr/a?id=3&utm_source=x&utm_medium=y&fbclid=z");
    expect(r.cleaned).toBe("https://exemple.fr/a?id=3");
    expect(r.removed).toEqual(["utm_source", "utm_medium", "fbclid"]);
  });
  it("déballe les redirections", () => {
    const r = cleanLink("https://www.google.com/url?q=https%3A%2F%2Fsite.com%2Fp%3Futm_campaign%3Da&sa=D");
    expect(r.cleaned).toBe("https://site.com/p");
    expect(r.unwrapped).toBe(1);
  });
  it("ne retire « si » que sur YouTube/Spotify", () => {
    expect(cleanLink("https://youtu.be/abc?si=XYZ&t=10").cleaned).toBe("https://youtu.be/abc?t=10");
    expect(cleanLink("https://exemple.fr/?si=1").cleaned).toBe("https://exemple.fr/?si=1");
  });
});

describe("Coordonnées", () => {
  it("lit les formats courants", () => {
    expect(parseCoord("https://www.google.com/maps/place/Paris/@48.8566,2.3522,12z")).toMatchObject({ lat: 48.8566, lng: 2.3522 });
    expect(parseCoord("https://www.openstreetmap.org/#map=15/45.7640/4.8357")).toMatchObject({ lat: 45.764, lng: 4.8357 });
    expect(parseCoord("https://www.bing.com/maps?cp=43.2965~5.3698&lvl=12")).toMatchObject({ lat: 43.2965, lng: 5.3698 });
    expect(parseCoord("48,8566 2,3522")).toMatchObject({ lat: 48.8566, lng: 2.3522 });
    const d = parseCoord(`48°51'24"N 2°21'03"E`)!;
    expect(d.lat).toBeCloseTo(48.8567, 3);
    expect(d.lng).toBeCloseTo(2.3508, 3);
    expect(parseCoord("33°52′S 151°12′E")!.lat).toBeCloseTo(-33.8667, 3);
    expect(parseCoord("bonjour")).toBeNull();
  });
  it("distance Paris–Lyon ≈ 391,5 km", () => {
    const d = haversine({ lat: 48.8566, lng: 2.3522, source: "" }, { lat: 45.764, lng: 4.8357, source: "" });
    expect(d / 1000).toBeCloseTo(391.5, 1);
  });
  it("DMS", () => expect(toDms(48.8566, "N", "S")).toBe("48°51′23.8″N"));
});

describe("Unicode", () => {
  it("repère invisibles et sosies", () => {
    const c = inspectChars("pаy​pal");
    expect(c[1]).toMatchObject({ flag: "confusable", looksLike: "a", script: "cyrillique" });
    expect(c[3]).toMatchObject({ flag: "invisible", hex: "U+200B" });
    expect(sanitizeText("pаy​pal !")).toBe("paypal !");
  });
});

describe("Texte", () => {
  it("compte", () => {
    const s = textStats("Bonjour le monde. Ça va ?\n\nOui !");
    expect(s).toMatchObject({ words: 6, sentences: 3, paragraphs: 2 });
    expect(formatMinutes(1.5)).toBe("1 min 30 s");
  });
  it("découpe et convertit", () => {
    expect(splitWords("parseHTTPResponse_code-v2")).toEqual(["parse", "HTTP", "Response", "code", "v2"]);
    expect(convertCase("Mon super titre", "camel")).toBe("monSuperTitre");
    expect(convertCase("monSuperTitre", "snake")).toBe("mon_super_titre");
    expect(convertCase("mon_super_titre", "pascal")).toBe("MonSuperTitre");
    expect(convertCase("été à paris", "constant")).toBe("ÉTÉ_À_PARIS");
    expect(convertCase("bonjour. ça va ? oui", "sentence")).toBe("Bonjour. Ça va ? Oui");
    expect(convertCase("l'été de jean-paul", "title")).toBe("L'Été De Jean-Paul");
  });
  it("lorem", () => {
    const t = lorem(2, "paragraphs", "html", true, mulberry32(1));
    expect(t.startsWith("<p>Lorem ipsum dolor sit amet")).toBe(true);
    expect(t.split("<p>").length - 1).toBe(2);
    expect(lorem(3, "words", "text", true)).toBe("Lorem ipsum dolor");
  });
});
