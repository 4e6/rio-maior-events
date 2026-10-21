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
const sources = (): Source[] => JSON.parse(readFileSync(join(ROOT, "scripts", "sources.json"), "utf-8")).sources;

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

  test("test_jsonld_events_come_with_the_text", () => {
    const parsed = parse(fixtureText("page.html"));
    expect(parsed.items.length).toBe(2);
    expect(parsed.text).toContain("Concerto");
  });
});
