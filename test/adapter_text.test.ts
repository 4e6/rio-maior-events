// Port of the text adapter's own tests from tests/python/test_adapter_text.py (classes Follows and Parse); the
// parts that test adapters/common.py are in common_text.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdapterError, type Page } from "../src/adapters/common.ts";
import { text } from "../src/adapters/text.ts";
import type { ParseResult, Source } from "../src/adapters/types.ts";
import { ROOT, fixtureText } from "./helpers.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const req = (url: string) => ({ url, data: null });
const sources = (): Source[] => JSON.parse(readFileSync(join(ROOT, "sources.json"), "utf-8")).sources;

describe("Follows", () => {
  const source = { name: "s", url: "https://example.org/agenda", town: "T", adapter: "text", label: "", group: "",
    links: "^/e/[^/?]+$" } as Source;

  function parse(page: string, src: Source = source): ParseResult {
    const pages: Page[] = [{ url: "https://example.org/agenda", status: 200, body: enc(page), contentType: null }];
    return text.parse(src, pages, ["2026-10-20", "2026-12-01"]);
  }
  const page = (...slugs: string[]) =>
    `<p>${"evento ".repeat(40)}</p>` + slugs.map((s) => `<p><a href="/e/${s}">Titulo ${s}</a></p>`).join("");

  test("test_follow_lists_the_marked_pages_in_page_order_once_each", () => {
    const parsed = parse(page("b", "a", "b", "c"));
    expect(parsed.follow).toEqual([..."bac"].map((s) => req(`https://example.org/e/${s}`)));
    expect(parsed.text!.split("<https://example.org/e/b>").length - 1).toBe(2);
  });

  test("test_no_links_in_the_source_means_no_markers_and_no_follow", () => {
    const parsed = parse(page("a"), { ...source, links: undefined });
    expect("follow" in parsed).toBe(false);
    expect(parsed.text).not.toContain("<https");
  });

  test("test_a_page_without_matches_has_an_empty_follow", () => {
    expect(parse(page()).follow).toEqual([]);
  });

  test("test_links_are_resolved_against_the_page_url", () => {
    const parsed = parse(page("a"), { ...source, url: "https://example.org/agenda/" });
    expect(parsed.follow).toEqual([req("https://example.org/e/a")]);
  });

  test("test_every_sources_links_pattern_matches_its_event_pages_and_not_its_menus", () => {
    const byName = new Map(sources().map((s) => [s.name, s]));
    const examples: Record<string, string[]> = {
      "cineteatro": ["/pt/cinema/verity-1908", "/pt/diversos/estamos-de-volta-1421"],
      "portugalrunning-leiria": ["/eventos/crp-resistencia-trail/"],
      "santaremcultura": ["/index.php/programacao/1658-ana-bacalhau"],
      "mcr-caldas": ["/agenda/halloween-rollerdisco"],
      "cm-torresnovas": ["/index.php/comunicacao/agenda/exposicoes/exposicao-lancadeira-coletivo-249"],
      "cm-cartaxo": ["/informacao/agenda/feira-de-todos-os-santos-e-expocartaxo-2026"],
      "leiriagenda": ["/pt/agenda/wonderlandi"],
      "teatro-virginia": ["/index.php/as-aguias-da-republica/547"],
      "cm-tvedras-musica": ["/agenda/detalhes/256171"],
      "teatrocine-tvedras": ["/agenda/256055"],
      "cm-alcobaca": ["/84009/encontro-de-orquestras-31-anos-da-orquestra-ligeira-da-cela"],
      "cineteatro-alcobaca": ["/83938/de-gaulle-resistencia"],
      "ccc-caldas": ["/programacao/cinema/as-meninas-exemplares"],
      "agenda-obidos": ["/evento/feira-anual-de-santa-iria/"],
      "cm-portodemos": ["/pages/1290?event_id=4528"],
      "cm-alcanena": ["/index.php/comunicacao/agenda/exposicoes/colecionadores26"],
      "cm-almeirim": ["/informacoes/eventos/almeirim/feira-do-livro-usado-2026"],
      "cm-entroncamento": ["/index.php/agenda/cinema/heart-of-the-beast-ciclo-de-cinema"],
      "cm-peniche": ["/visitar/agenda-de-eventos/evento-36/burlas-contra-idosos-acoes-de-sensibilizacao-2026"],
      "cm-vnbarquinha": ["/index.php/viver/agenda/eventos-literarios/clube-de-leitura"],
    };
    const menus = ["/", "/agenda", "/agenda/", "/index.php/agenda", "/pt/agenda", "/pt/agenda/a-decorrer",
      "/programacao", "/index.php/programacao", "/index.php/programacao/calendario-de-eventos",
      "/index.php/comunicacao/agenda", "/index.php/comunicacao/agenda/cinema", "/informacao/agenda",
      "/index.php/tags/cinema/30", "/index.php/agenda/cinema", "/menu/1342/programacao",
      "/agenda/categoria/37", "/pages/1336", "/pages/364", "/eventos/", "/visitar/agenda-de-eventos",
      "/visitar/agenda-de-eventos/ambiente-saude-e-bem-estar", "/informacoes/eventos",
      "/index.php/viver/agenda", "/index.php/agenda/entroncamento/view-map?tmpl=component"];
    for (const [name, paths] of Object.entries(examples)) {
      const pattern = new RegExp(byName.get(name)!.links!);
      for (const path of paths) expect(pattern.test(path), `${name} ${path}`).toBe(true);
      for (const path of menus) expect(pattern.test(path), `${name} ${path}`).toBe(false);
    }
    const withLinks = [...byName.values()].filter((s) => "links" in s).map((s) => s.name).sort();
    expect(withLinks).toEqual([...Object.keys(examples), "portugalrunning-santarem", "portugalrunning-lisboa"].sort());
  });
});

describe("Parse", () => {
  const source = { name: "s", url: "https://example.org/", town: "T", adapter: "text", label: "", group: "" } as Source;
  const parse = (page: string, src: Source = source) =>
    text.parse(src, [{ url: "https://example.org/", status: 200, body: enc(page), contentType: null }],
      ["2026-10-20", "2026-12-01"]);

  test("test_empty_page_is_a_failure", () => {
    expect(() => parse("<html><body><p>Ola</p></body></html>")).toThrow(AdapterError);
    expect(() => parse("<html><body><p>Ola</p></body></html>")).toThrow("layout may have changed");
  });

  test("test_page_with_text_is_ok", () => {
    const parsed = parse(`<p>${"evento ".repeat(60)}</p>`);
    expect(parsed.items).toEqual([]);
    expect(parsed.note).toBeNull();
  });

  test("test_a_source_cap_overrides_the_default", () => {
    const parsed = parse(`<p>${"evento ".repeat(100)}</p>`, { ...source, cap: 250 });
    expect(parsed.text!.length).toBe(250);
    expect(parsed.truncated).toBe(true);
  });

  test("test_peniche_has_a_cap", () => {
    expect(sources().filter((s) => s.name === "cm-peniche").map((s) => s.cap)).toEqual([4000]);
  });

  test("santaremcultura's cap holds its whole programme page, the last card included", () => {
    // Santarém Acontece lists about seven weeks of cards on one page, with no paging: 21 cards and 39,458 characters
    // of text on 2026-11-03, cut at 31,700 (11 December) by the old cap. A hand-written page of that size and shape:
    // the venue filter first, then cards with a marker, the date line and a synopsis. Fixed dates, no saved page.
    const row = sources().find((s) => s.name === "santaremcultura")!;
    const venues = Array.from({ length: 90 }, (_, i) => `<li>Local ${i + 1} de Santarém</li>`).join("");
    const card = (n: number) => {
      const day = new Date(Date.UTC(2026, 9, 17 + n * 3));
      const date = `${day.getUTCDate()} ${["out", "nov", "dez"][day.getUTCMonth() - 9]}`;
      return `<div class="card"><p>${date}</p><p>21:30</p><p>Teatro Sá da Bandeira</p>` +
        `<a href="/index.php/programacao/${1600 + n}-evento-${n}">Evento ${n}</a><p>LER MAIS</p>` +
        `<p>Evento ${n} | ${date} | 21h30 | Teatro Sá da Bandeira</p><p>Sinopse: ${"Uma noite de música e palavra. ".repeat(55)}</p></div>`;
    };
    const cards = Array.from({ length: 21 }, (_, n) => card(n)).join("");
    const parsed = text.parse(row, [{ url: row.url, status: 200, body: enc(`<html><body><ul>${venues}</ul>${cards}</body></html>`),
      contentType: "text/html; charset=utf-8" }], ["2026-11-03", "2027-05-03"]);
    expect(parsed.text!.length).toBeGreaterThan(39458);
    expect(parsed.truncated).toBe(false);
    expect(parsed.text).toContain("Evento 20 | 16 dez | 21h30");
    expect(parsed.follow!.at(-1)!.url).toBe("https://www.santaremcultura.pt/index.php/programacao/1620-evento-20");
  });

  test("test_jsonld_events_come_with_the_text", () => {
    const parsed = parse(fixtureText("page.html"));
    expect(parsed.items.length).toBe(2);
    expect(parsed.text).toContain("Concerto");
  });
});

// A hand-written page in the shape of Portugal Running's cards (not a saved page: the corpus is private): a marker, the
// header with the date, "Tipo", "Local", a count and "Adiciona à tua lista", as every card of the three pages was printed on
// 2026-11-03. Fixed dates, no clock.
describe("card_dates portugalrunning", () => {
  const source: Source = { name: "pr", label: "PR", adapter: "text", town: "T", group: "regional", url: "https://pr.example/corridas/",
    links: "^/eventos/[^/?]+/$", follow: 8, horizon: "near", options: { card_dates: "portugalrunning" } };
  // 2026-11-22 is a Sunday; 2026-11-21 a Saturday; 2026-12-06 a Sunday; 2027-02-27 a Saturday
  const card = (slug: string, title: string, date: string, tail = "Dia") => {
    const [year, day, dd, mon] = date.split(" ");
    return `<div><a href="https://pr.example/eventos/${slug}/"><span>${title} ${year}</span>` +
      `<span class="blk"><span><em>${day}</em><em>${dd}</em><em>${mon}</em><em>${tail}</em></span></span></a>` +
      `<p>Tipo Corrida, Trail ${slug}</p><p>Local Portugal Lisboa e Centro ${slug}</p><p>7</p><p>Adiciona à tua lista</p></div>`;
  };
  const page = (...parts: string[]) => `<h1>Corridas</h1><p>${"calendario ".repeat(30)}</p>${parts.join("\n")}`;
  const parse = (html: string, window: [string, string] = ["2026-10-20", "2026-11-22"], src: Source = source): ParseResult =>
    text.parse(src, [{ url: src.url, status: 200, body: enc(html), contentType: null }], window);

  test("a card dated after the window end is dropped, with its link; one on the end and an earlier one stay", () => {
    const parsed = parse(page(
      card("a", "Trail A", "2026 sab 21 nov"),
      card("b", "Trail B", "2026 dom 22 nov", "0:00"),
      card("c", "Trail C", "2026 dom 06 dez"),
      card("d", "Trail D", "2027 sab 27 fev"),
    ));
    expect(parsed.text).toContain("Trail A 2026 sab 21 nov");
    expect(parsed.text).toContain("Trail B 2026 dom 22 nov 0:00");
    expect(parsed.text).not.toContain("Trail C");
    expect(parsed.text).not.toContain("Trail D");
    expect(parsed.text).not.toContain("/eventos/c/");
    expect(parsed.follow!.map((r) => r.url)).toEqual(["https://pr.example/eventos/a/", "https://pr.example/eventos/b/"]);
    expect(parsed.note).toBe("4 dated race cards, 2 after 2026-11-22 left out");
    expect(parsed.text).toContain("Corridas");
  });

  test("the year of the card is its own, and a trailing time or the (mon day) suffix still dates it", () => {
    const html = page(`<div><a href="https://pr.example/eventos/e/"><span>Trail E 2027</span><span><em>sab</em><em>27</em><em>fev</em>(fev 27)<em>0:00</em></span></a><p>Tipo Trail</p><p>Local Portugal e</p></div>`);
    expect(parse(html).text).not.toContain("Trail E");
    expect(parse(html, ["2026-10-20", "2027-03-01"]).text).toContain("Trail E 2027 sab 27 fev");
  });

  test("a card whose weekday does not match its date is kept, and so is an undated block", () => {
    const parsed = parse(page(
      card("f", "Trail F", "2026 seg 06 dez"), // 6 Dec 2026 is a Sunday
      `<div><a href="https://pr.example/eventos/g/"><span>Linhas de Torres 100</span></a><p>Janeiro</p></div>`,
      card("h", "Trail H", "2026 dom 06 dez"),
    ));
    expect(parsed.text).toContain("Trail F");
    expect(parsed.text).toContain("Linhas de Torres 100");
    expect(parsed.text).not.toContain("Trail H");
    expect(parsed.follow!.map((r) => r.url)).toEqual(["https://pr.example/eventos/f/", "https://pr.example/eventos/g/"]);
    // F looks like a card but its date is not read: kept, and the note says so (a partial layout change)
    expect(parsed.note).toBe("1 dated race cards, 1 after 2026-11-22 left out; 1 race card(s) the filter could not read were kept (layout may have changed)");
  });

  test("a dropped card ends at its own lines: what follows the last one, with no Mostrar mais, is kept", () => {
    const parsed = parse(page(card("a", "Trail A", "2026 sab 21 nov"), card("c", "Trail C", "2026 dom 06 dez"),
      `<h2>dezembro</h2><h2>Perguntas frequentes</h2><p>Quais são as corridas mais populares?</p><p>Contactos</p>`));
    expect(parsed.text).not.toContain("Trail C");
    expect(parsed.text).not.toContain("Local Portugal Lisboa e Centro c");
    for (const kept of ["dezembro", "Perguntas frequentes", "Quais são as corridas mais populares?", "Contactos"]) expect(parsed.text).toContain(kept);
  });

  test("a card is dated by its header only: a date further down a block, or an unmarked card after a dropped one, is kept", () => {
    const parsed = parse(page(
      // a guide-table block whose second line carries a late date: not a card header, so the block stays
      `<div><a href="https://pr.example/eventos/g/"><span>Linhas de Torres 100</span></a><p>Edição de 2027 sab 27 fev</p></div>`,
      card("c", "Trail C", "2026 dom 06 dez"),
      // an unmarked near card right after the dropped one: no longer swept into it
      `<div><span>Trail Sem Link 2026 sab 21 nov</span><p>Tipo Corrida</p><p>Local Portugal x</p></div>`,
    ));
    expect(parsed.text).toContain("Linhas de Torres 100\nEdição de 2027 sab 27 fev");
    expect(parsed.text).not.toContain("Trail C");
    expect(parsed.text).toContain("Trail Sem Link 2026 sab 21 nov\nTipo Corrida\nLocal Portugal x");
  });

  test("a late card whose lines are not a card's is kept whole and counted", () => {
    const parsed = parse(page(card("a", "Trail A", "2026 sab 21 nov"),
      `<div><a href="https://pr.example/eventos/z/"><span>Trail Z 2026 dom 06 dez</span></a><p>Tipo Corrida</p><p>Inscrições abertas</p></div>`));
    expect(parsed.text).toContain("Trail Z 2026 dom 06 dez\nTipo Corrida\nInscrições abertas");
    expect(parsed.note).toBe("2 dated race cards, 0 after 2026-11-22 left out; 1 race card(s) the filter could not read were kept (layout may have changed)");
  });

  test("a Mostrar mais line ends a card, and the lines after it are kept", () => {
    const parsed = parse(page(card("a", "Trail A", "2026 dom 06 dez"), `<p>Mostrar mais</p>`, `<h2>Perguntas frequentes</h2><p>${"faq ".repeat(10)}</p>`));
    expect(parsed.text).not.toContain("Trail A");
    expect(parsed.text).toContain("Mostrar mais");
    expect(parsed.text).toContain("Perguntas frequentes");
  });

  test("the cap is applied after the filter and follow keeps only the links that survive both", () => {
    const parts = [card("a", "Trail A", "2026 sab 21 nov"), card("far", "Trail Far", "2027 sab 27 fev"), card("b", "Trail B", "2026 dom 22 nov"), card("c", "Trail C", "2026 dom 22 nov")];
    const uncut = parse(page(...parts));
    expect(uncut.follow!.map((r) => r.url)).toEqual(["a", "b", "c"].map((s) => `https://pr.example/eventos/${s}/`));
    // a cap that holds the text up to card b's own marker line: c is cut by the cap, and the dropped card took no room
    const upToB = uncut.text!.indexOf("<https://pr.example/eventos/b/>") + "<https://pr.example/eventos/b/>".length;
    const capped = parse(page(...parts), ["2026-10-20", "2026-11-22"], { ...source, cap: upToB });
    expect(capped.truncated).toBe(true);
    expect(capped.follow!.map((r) => r.url)).toEqual(["a", "b"].map((s) => `https://pr.example/eventos/${s}/`));
  });

  test("a page with no dated card keeps everything and says so", () => {
    const html = page(`<div><a href="https://pr.example/eventos/a/"><span>Trail A</span></a><p>Em breve</p></div>`);
    const parsed = parse(html);
    expect(parsed.note).toBe("no dated race cards found (layout may have changed)");
    expect(parsed.text).toContain("Trail A");
    expect(parsed.follow!.length).toBe(1);
  });

  test("a source without card_dates is not date-filtered, and an unknown format fails the source", () => {
    const plain = { ...source, options: undefined, horizon: undefined };
    expect(parse(page(card("c", "Trail C", "2026 dom 06 dez")), ["2026-10-20", "2026-11-22"], plain).text).toContain("Trail C");
    expect(() => parse(page(card("c", "Trail C", "2026 dom 06 dez")), ["2026-10-20", "2026-11-22"], { ...source, options: { card_dates: "other" } })).toThrow(AdapterError);
  });
});
