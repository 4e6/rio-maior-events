// Port of the parts of tests/python/test_adapter_text.py that test adapters/common.py (JSON-LD, visible text,
// link markers). The text adapter's own tests (Follows, Parse) are T8's.
import { describe, expect, test } from "bun:test";
import { cpLen } from "../src/py/str.ts";
import { cleanUrl, extractJsonldEvents, markupLine, visibleText, visibleTextLinks } from "../src/adapters/common.ts";
import { WINDOW, fixtureText } from "./helpers.ts";

describe("JsonLd", () => {
  const page = fixtureText("page.html");

  test("test_flattens_item_lists_and_graphs", () => {
    expect(extractJsonldEvents(page).map((e) => e.name)).toEqual(["Trail & Serra", "Past gig", "Long fair"]);
  });

  test("test_event_fields", () => {
    const event = extractJsonldEvents(page)[0]!;
    expect(event.location).toBe("Pavilhão");
    expect(event.addressLocality).toBe("Rio Maior");
    expect(event.price).toBe("12");
    expect(event.url).toBe("https://example.org/trail");
  });

  test("test_window_keeps_events_still_running", () => {
    expect(extractJsonldEvents(page, WINDOW).map((e) => e.name)).toEqual(["Trail & Serra", "Long fair"]);
  });

  test("test_description_is_cut", () => {
    const html = `<script type="application/ld+json">{"@type":"Event","name":"x","description":"${"a".repeat(500)}"}</script>`;
    expect(extractJsonldEvents(html)[0]!.description!.length).toBe(300);
  });
});

describe("VisibleText", () => {
  test("test_drops_chrome_and_collapses_whitespace", () => {
    const { text, truncated } = visibleText(fixtureText("page.html"));
    expect(truncated).toBe(false);
    for (const gone of ["Site header", "Menu", "Footer text", "hidden", "color:red"]) expect(text).not.toContain(gone);
    expect(text).toContain("Sáb 24 out & mais\nConcerto às 21:30");
    expect(text).toContain("Item um\nItem dois");
  });

  test("test_a_card_keeps_its_header_inside_an_article", () => {
    const { text } = visibleText(fixtureText("page.html"));
    expect(text).toContain("Cartao Titulo\n24 out");
    expect(text).toContain("Cartao rodape");
    expect(text).not.toContain("Site header");
    expect(text).not.toContain("Footer text");
  });

  test("test_a_page_header_after_an_article_is_still_dropped", () => {
    const { text } = visibleText("<article><p>Card</p></article><header>Top</header><main><p>Body</p></main>");
    expect(text).toBe("Card\nBody");
  });

  test("test_cap_sets_truncated", () => {
    const { text, truncated } = visibleText(`<p>${"a".repeat(100)}</p>`, 40);
    expect([cpLen(text), truncated]).toEqual([40, true]);
  });

  test("the cap counts code points, not UTF-16 units", () => {
    const { text, truncated } = visibleText(`<p>${"😀".repeat(50)}</p>`, 40);
    expect([cpLen(text), truncated]).toEqual([40, true]);
  });
});

describe("InlineText", () => {
  const text = (page: string) => visibleText(`<p>${page}</p>`).text;

  test("test_fields_in_spans_are_kept_apart", () => {
    expect(text("<span>Trail 2026</span><span>dom</span><span>15</span><span>nov</span>")).toBe("Trail 2026 dom 15 nov");
  });

  test("test_fields_in_adjacent_ems_are_kept_apart", () => {
    expect(text("<em>sab</em><em>24</em><em>out</em><em>Dia</em>")).toBe("sab 24 out Dia");
  });

  test("test_markup_inside_a_word_or_number_joins", () => {
    expect(text("Sá<b>b</b> 6<sup>ª</sup>")).toBe("Sáb 6ª");
    expect(text("<span>21</span>:<span>30</span> €<span>8</span>")).toBe("21:30 €8");
    expect(text("<a href=x>Concerto</a>, hoje")).toBe("Concerto, hoje");
  });
});

describe("TextCapAndMarkup", () => {
  test("test_office_xml_spread_over_lines_is_dropped_but_less_than_survives", () => {
    const page = "<p>Agenda</p><p>&lt;18 anos: entrada gratuita</p>" +
      "<p>&lt;w:LsdException Locked=\"false\" Priority=\"9\"</p>" +
      "<p>UnhideWhenUsed=\"true\" QFormat=\"true\" Name=\"heading 2\"/&gt;</p>" +
      "<p>SemiHidden=\"false\" Name=\"x\" Priority=\"1\"</p>" +
      "<p>&lt;!--[if gte mso 9]&gt;&lt;xml&gt;</p><p>&lt;![endif]--&gt;</p>" +
      "<p>&lt;/w:LatentStyles&gt;</p><p>Concerto &lt;b&gt; &gt; dia 3</p>";
    expect(visibleText(page).text).toBe("Agenda\n<18 anos: entrada gratuita\nConcerto <b> > dia 3");
  });

  test("test_markup_lines_are_dropped", () => {
    expect(visibleText(fixtureText("markup.html")).text).toBe("Agenda de eventos\nConcerto no sábado < 18h");
  });
});

const BASE = "https://www.example.pt/agenda/";
const EVENTS = /^\/agenda\/detalhes\/\d+$/;
const marked = (page: string, links: RegExp | null = EVENTS, base = BASE, cap = 10 ** 6) =>
  visibleTextLinks(page, cap, base, links);
const D = "https://www.example.pt/agenda/detalhes";

describe("Markers", () => {
  test("test_a_marker_line_stands_where_the_anchor_starts", () => {
    const { text, urls } = marked('<h2>Fado</h2><p>Sab 24 out</p>' +
      '<div><a href="/agenda/detalhes/12"><h3>Concerto</h3><p>21h30</p></a></div>');
    expect(text).toBe(`Fado\nSab 24 out\n<${D}/12>\nConcerto\n21h30`);
    expect(urls).toEqual([`${D}/12`]);
  });

  test("test_a_marker_in_the_middle_of_a_line_gets_a_line_of_its_own", () => {
    const { text } = marked('<p>Antes <a href="/agenda/detalhes/12">titulo</a> depois</p>');
    expect(text).toBe(`Antes\n<${D}/12>\ntitulo depois`);
  });

  test("test_nothing_is_marked_without_links", () => {
    const { text, urls } = visibleTextLinks('<a href="/agenda/detalhes/12">Concerto</a>', 1000, BASE, null);
    expect([text, urls]).toEqual(["Concerto", []]);
  });

  test("test_a_strict_regex_leaves_menus_and_category_pages_out", () => {
    const page = '<p><a href="/agenda/categoria/37">Musica</a> <a href="/agenda/detalhes/12?x=1">Com query</a>' +
      ' <a href="/agenda/detalhes/12">Bom</a> <a href="/agenda/detalhes/x">Letras</a>' +
      ' <a href="https://www.example.pt/sobre">Sobre</a></p>';
    expect(marked(page).urls).toEqual([`${D}/12`]);
  });

  test("test_the_query_is_part_of_what_a_regex_sees", () => {
    const links = /^\/pages\/\d+\?event_id=\d+$/;
    const page = '<a href="/pages/1336?event_id=77">Gala</a><a href="/pages/1336">Lista</a>';
    expect(marked(page, links).urls).toEqual(["https://www.example.pt/pages/1336?event_id=77"]);
  });

  test("test_empty_and_digit_only_anchors_without_a_title_are_skipped", () => {
    const page = '<a href="/agenda/detalhes/1"><img src="x.png"></a><a href="/agenda/detalhes/2"> 27 </a>' +
      '<a href="/agenda/detalhes/3"><span>2</span> <span>8</span></a>' +
      '<a href="/agenda/detalhes/4">Titulo 4</a>';
    const { text, urls } = marked(page);
    expect(urls).toEqual([`${D}/4`]);
    expect(text).toBe(`27 2 8\n<${D}/4>\nTitulo 4`);
  });

  test("test_a_digit_only_or_empty_anchor_with_a_title_is_marked_with_its_title", () => {
    const page = '<td><a href="/agenda/detalhes/28" title="Música // Banda  da Armada "><span>28</span></a></td>' +
      '<td><a href="/agenda/detalhes/29" title="Cinema"><img src="x.png"></a></td>' +
      '<td><a href="/agenda/detalhes/30" title="  "><span>30</span></a></td>' +
      '<td><a href="/agenda/categoria/9" title="Outro"><span>9</span></a></td>';
    const { text, urls } = marked(page);
    expect(text).toBe(`<${D}/28>\nMúsica // Banda da Armada\n28\n<${D}/29>\nCinema\n30\n9`);
    expect(urls).toEqual([`${D}/28`, `${D}/29`]);
  });

  test("test_a_text_anchor_ignores_its_title", () => {
    expect(marked('<a href="/agenda/detalhes/5" title="Outro">Fado</a>').text).toBe(`<${D}/5>\nFado`);
  });

  test("test_a_card_whose_image_link_comes_first_is_marked_at_its_titled_link", () => {
    const page = '<div><a href="/agenda/detalhes/9"><img src="x.png"></a>' +
      '<h3><a href="/agenda/detalhes/9">Titulo</a></h3></div>';
    expect(marked(page).text).toBe(`<${D}/9>\nTitulo`);
  });

  test("test_a_marker_repeated_later_is_kept", () => {
    const page = '<a href="/agenda/detalhes/9">A</a><p>C</p><a href="/agenda/detalhes/9">Saber mais</a>';
    const { text, urls } = marked(page);
    const marker = `<${D}/9>`;
    expect(text).toBe(`${marker}\nA\nC\n${marker}\nSaber mais`);
    expect(urls.length).toBe(1);
  });

  test("test_a_marker_equal_to_the_line_before_it_is_dropped", () => {
    // The text between the two anchors is leftover markup, so no line of it remains.
    const page = '<a href="/agenda/detalhes/9">&lt;br/&gt;</a><a href="/agenda/detalhes/9">Titulo</a>';
    expect(marked(page).text).toBe(`<${D}/9>\nTitulo`);
  });

  test("test_page_chrome_gets_no_markers_but_a_card_header_in_an_article_does", () => {
    const page = '<header><a href="/agenda/detalhes/1">Destaque</a></header><nav><a href="/agenda/detalhes/2">Menu</a></nav>' +
      '<article><header><a href="/agenda/detalhes/3">Cartao</a></header></article>' +
      '<footer><a href="/agenda/detalhes/4">Rodape</a></footer>';
    expect(marked(page).urls).toEqual([`${D}/3`]);
  });

  test("test_script_and_template_links_get_no_markers", () => {
    const page = '<template><a href="/agenda/detalhes/1">T</a></template><script>x</script><a href="/agenda/detalhes/2">Ok</a>';
    expect(marked(page).urls).toEqual([`${D}/2`]);
  });

  test("test_hrefs_are_resolved_cleaned_and_encoded", () => {
    const base = "https://www.example.pt/agenda/lista/";
    const page = '<a href="../../e/rel">a</a><a href="/e/abs#topo">b</a><a href="//www.example.pt/e/proto">c</a>' +
      '<a href="https://example.pt/e/bare-host">d</a><a href="/e/café — x">e</a>' +
      '<a href="/e/a%20b">f</a><a href="/e/q?a=1&amp;b=é">g</a>' +
      '<a href="https://www.example.pt:443/e/port">h</a><a href="https://other.example/e/off">i</a>' +
      '<a href="mailto:x@example.pt">j</a><a href="javascript:void(0)">k</a><a href="#e/x">l</a>';
    expect(marked(page, /\/e\//, base).urls).toEqual([
      "https://www.example.pt/e/rel", "https://www.example.pt/e/abs", "https://www.example.pt/e/proto",
      "https://example.pt/e/bare-host", "https://www.example.pt/e/caf%C3%A9%20%E2%80%94%20x",
      "https://www.example.pt/e/a%20b", "https://www.example.pt/e/q?a=1&b=%C3%A9",
      "https://www.example.pt/e/port"]);
  });

  test("test_clean_url_gives_none_for_what_is_not_a_page", () => {
    for (const href of [null, "", "  ", "mailto:a@b.pt", "javascript:void(0)", "tel:123"]) {
      expect(cleanUrl(BASE, href)).toBeNull();
    }
  });

  test("test_markers_survive_the_markup_line_filter", () => {
    // A URL can look like markup to the filter: attributes, mso- styles.
    const urls = ['https://www.example.pt/agenda/a="b" c="d">', "https://www.example.pt/mso-x/e1",
      "https://www.example.pt/agenda/w:Lsd/e2"];
    const page = urls.map((u, n) => `<a href="${u}">T${n}</a>`).join("");
    const { text, urls: found } = marked(page, /./);
    expect(found.length).toBe(3);
    expect(markupLine(`<${found[1]}>`)).toBe(true);
    for (const url of found) expect(text).toContain(`<${url}>`);
  });

  test("test_page_text_that_looks_like_a_marker_is_still_filtered", () => {
    expect(marked('<p>&lt;html lang="pt"&gt;</p><p>Ola</p>').text).toBe("Ola");
  });

  test("test_a_private_use_character_in_the_page_cannot_forge_a_marker", () => {
    const { text, urls } = marked("<p>https://evil.example/x</p>");
    expect(urls).toEqual([]);
    expect(text).not.toContain("<https");
  });

  test("test_the_cap_cuts_markers_and_urls_together", () => {
    const page = Array.from({ length: 39 }, (_, i) => `<p><a href="/agenda/detalhes/${i + 1}">Titulo ${i + 1}</a></p>`).join("");
    const { text, truncated, urls } = marked(page, EVENTS, BASE, 400);
    expect(truncated).toBe(true);
    expect(cpLen(text)).toBe(400);
    expect(urls).toEqual([...text.matchAll(/<(https:\/\/[^>]+)>/g)].map((m) => m[1]!));
    expect(urls.length).toBeGreaterThan(0);
  });

  test("test_an_unclosed_anchor_is_still_marked", () => {
    const { text, urls } = marked('<a href="/agenda/detalhes/5">Fim');
    expect(urls).toEqual([`${D}/5`]);
    expect(text).toBe(`<${D}/5>\nFim`);
  });

  test("test_visible_text_is_unchanged_by_links_that_do_not_match", () => {
    const page = fixtureText("page.html");
    const { text, truncated } = marked(page, /^\/nothing$/);
    expect({ text, truncated }).toEqual(visibleText(page));
  });
});
