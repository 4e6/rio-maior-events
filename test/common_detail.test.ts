// Port of tests/python/test_detail.py: common.extractDetail and the XML guards.
import { describe, expect, test } from "bun:test";
import { AdapterError, EXCERPT_CAP, defaultDetails, extractDetail, xmlRoot, type Page } from "../src/adapters/common.ts";
import { quote } from "../src/url.ts";

const URL = "https://www.example.pt/agenda/evento/fado";
const enc = (s: string) => new TextEncoder().encode(s);

function page(head = "", body = "", url = URL): Page {
  const html = `<!doctype html><html><head><title>Fado</title>${head}</head><body>${body}</body></html>`;
  return { url, status: 200, body: enc(html), contentType: "text/html; charset=utf-8" };
}
const og = (title: string) => `<meta property="og:title" content="${title}" />`;
const atc = (start: string, end = "", location = "", title = "Fado") =>
  `<var class="atc_event rs_skip"><var class="atc_date_start">${start}</var>` +
  `<var class="atc_date_end">${end}</var><var class="atc_timezone">Europe/Lisbon</var>` +
  `<var class="atc_title">${title}</var><var class="atc_location">${location}</var></var>`;
const ical = (text: string) =>
  `<a href="data:text/calendar;charset=utf8,${quote(text.replaceAll("\n", "\r\n"), "")}">Apple / ICS</a>`;
const bare = (html: string, contentType: string | null = null): Page => ({ url: URL, status: 200, body: enc(html), contentType });
const triple = (d: { start: string | null; end: string | null; venue: string | null }) => [d.start, d.end, d.venue];

describe("Title", () => {
  test("test_og_title_is_the_title_unescaped_and_trimmed", () => {
    expect(extractDetail(page(og("Cave &amp; Co.  "))).title).toBe("Cave & Co.");
  });

  test("test_the_title_tag_is_the_fallback_without_its_site_suffix", () => {
    expect(extractDetail(bare("<title>Ana Bacalhau | Santarém</title>")).title).toBe("Ana Bacalhau");
  });

  test("test_a_bare_category_word_is_no_title", () => {
    for (const word of ["CONCERTO ", "Cinema", "teatro", "Dança", "EXPOSIÇÃO", "Música", "Evento"]) {
      expect(extractDetail(page(og(word))).title).toBeNull();
    }
  });

  test("test_a_title_that_only_starts_with_a_category_word_is_kept", () => {
    expect(extractDetail(page(og("Concerto de Natal"))).title).toBe("Concerto de Natal");
  });

  test("test_the_url_is_the_pages_final_url", () => {
    expect(extractDetail(page("", "", "https://www.example.pt/final")).url).toBe("https://www.example.pt/final");
  });
});

describe("Dates", () => {
  test("test_atc_elements_give_start_end_and_venue", () => {
    const found = extractDetail(page("", atc("2026-10-30 18:00:00", "2026-10-30 23:00:00", "Biblioteca Municipal")));
    expect(triple(found)).toEqual(["2026-10-30 18:00", "2026-10-30 23:00", "Biblioteca Municipal"]);
  });

  test("test_atc_classes_on_spans_work_too", () => {
    const body = '<span class="atc_date_start">2026-11-02 21:30:00</span><span class="atc_location">Cine</span>';
    expect(triple(extractDetail(page("", body)))).toEqual(["2026-11-02 21:30", null, "Cine"]);
  });

  test("test_an_end_equal_to_the_start_is_no_end", () => {
    const found = extractDetail(page("", atc("2026-10-31 21:00:00", "2026-10-31 21:00:00")));
    expect([found.start, found.end]).toEqual(["2026-10-31 21:00", null]);
  });

  test("test_midnight_is_a_date_without_a_time", () => {
    let found = extractDetail(page("", atc("2026-11-28 00:00:00", "2026-11-28 00:00:00")));
    expect([found.start, found.end]).toEqual(["2026-11-28", null]);
    found = extractDetail(page("", atc("2026-11-28 00:00", "2026-11-29 00:00")));
    expect([found.start, found.end]).toEqual(["2026-11-28", "2026-11-29"]);
  });

  test("test_a_placeholder_venue_is_none", () => {
    for (const venue of ["Evento", "evento", ""]) {
      expect(extractDetail(page("", atc("2026-10-18 17:00:00", "", venue))).venue).toBeNull();
    }
  });

  test("test_json_ld_event_comes_first", () => {
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[' +
      '{"@type":"BreadcrumbList","itemListElement":[]},' +
      '{"@type":"SportsEvent","name":"20 Kms","startDate":"2026-10-25",' +
      '"location":{"@type":"Place","name":"Avenida 25 de Abril, Almeirim"}}]}</script>';
    const found = extractDetail(page(ld, atc("2026-01-01 10:00:00")));
    expect(triple(found)).toEqual(["2026-10-25", null, "Avenida 25 de Abril, Almeirim"]);
  });

  test("test_json_ld_without_a_start_is_passed_over", () => {
    const ld = '<script type="application/ld+json">{"@type":"Event","name":"x"}</script>';
    expect(extractDetail(page(ld, atc("2026-10-18 17:00:00"))).start).toBe("2026-10-18 17:00");
  });

  test("test_a_json_ld_time_with_an_offset_keeps_its_own_clock", () => {
    const ld = '<script type="application/ld+json">{"@type":"MusicEvent","startDate":"2026-11-07T21:30:00+00:00"}</script>';
    expect(extractDetail(page(ld)).start).toBe("2026-11-07 21:30");
  });

  test("test_the_venue_may_come_from_a_later_source", () => {
    const ld = '<script type="application/ld+json">{"@type":"Event","startDate":"2026-10-25"}</script>';
    const found = extractDetail(page(ld, atc("2026-10-25 10:00:00", "", "Pavilhao")));
    expect([found.start, found.venue]).toEqual(["2026-10-25", "Pavilhao"]);
  });

  test("test_nothing_structured_gives_no_dates", () => {
    expect(triple(extractDetail(page(og("Fado"), "<p>Sab 24 out</p>")))).toEqual([null, null, null]);
  });
});

describe("Ical", () => {
  test("test_a_percent_encoded_ical_in_utc_is_read_in_lisbon_time", () => {
    const winter = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261110T210000Z\nDTEND:20261110T223000Z\nLOCATION:Sala B\nEND:VEVENT\nEND:VCALENDAR";
    expect(triple(extractDetail(page("", ical(winter))))).toEqual(["2026-11-10 21:00", "2026-11-10 22:30", "Sala B"]);
    const summer = winter.replaceAll("20261110", "20260810");
    expect(extractDetail(page("", ical(summer))).start).toBe("2026-08-10 22:00");
  });

  test("test_utc_late_in_the_day_moves_to_the_next_lisbon_day", () => {
    const text = "BEGIN:VEVENT\nDTSTART:20260810T233000Z\nEND:VEVENT";
    expect(extractDetail(page("", ical(text))).start).toBe("2026-08-11 00:30");
  });

  test("test_the_day_of_the_clock_change_is_read_by_the_rule", () => {
    // 01:00 UTC on the last Sunday of October is the change back to UTC+0.
    for (const [stamp, shown] of [["20261025T003000Z", "2026-10-25 01:30"], ["20261025T013000Z", "2026-10-25 01:30"]]) {
      const text = `BEGIN:VEVENT\nDTSTART:${stamp}\nEND:VEVENT`;
      expect(extractDetail(page("", ical(text))).start).toBe(shown!);
    }
  });

  test("test_a_local_ical_time_with_entities_is_kept_as_is", () => {
    const raw = "BEGIN:VCALENDAR%0AVERSION:2.0%0ABEGIN:VEVENT%0ADTSTART:20261024T223000%0ADTEND:20261024T223000%0ASUMMARY:WonderLandi%0ADESCRIPTION:propõe &otilde; e&aacute;%0ALOCATION:Teatro José Lúcio da Silva%0AEND:VEVENT";
    const found = extractDetail(page("", `<a href="data:text/calendar;charset=utf8,${raw}">ics</a>`));
    expect(triple(found)).toEqual(["2026-10-24 22:30", null, "Teatro José Lúcio da Silva"]);
  });

  test("test_an_empty_location_and_a_date_value_are_handled", () => {
    const text = "BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261124\nLOCATION:\nEND:VEVENT";
    expect(triple(extractDetail(page("", ical(text))))).toEqual(["2026-11-24", null, null]);
  });

  test("test_escaped_commas_in_the_location_are_unescaped", () => {
    const text = "BEGIN:VEVENT\nDTSTART:20261124T200000\nLOCATION:Rua A\\, 5\\, Lisboa\nEND:VEVENT";
    expect(extractDetail(page("", ical(text))).venue).toBe("Rua A, 5, Lisboa");
  });

  test("test_an_ical_without_a_readable_start_is_passed_over", () => {
    const text = "BEGIN:VEVENT\nDTSTART:soon\nEND:VEVENT";
    expect(extractDetail(page("", ical(text) + atc("2026-10-18 17:00:00"))).start).toBe("2026-10-18 17:00");
  });
});

describe("Excerpt", () => {
  const body = (title = "Fado") =>
    "<nav><a href='/'>Menu</a></nav><ul><li>Inicio</li><li>Agenda</li></ul>" +
    `<main><h1>${title}</h1><p>Sab 24 out, 21h30</p><p>${"A noite canta. ".repeat(100)}</p></main><footer>Rodape</footer>`;

  test("test_it_starts_at_the_first_mention_of_the_title_after_the_title_line", () => {
    const found = extractDetail(page(og("Fado"), body()));
    expect(found.excerpt!.startsWith("Fado\nSab 24 out, 21h30\nA noite canta.")).toBe(true);
    expect(found.excerpt).not.toContain("Inicio");
    expect(found.excerpt).not.toContain("Fado\nFado");
  });

  test("test_it_is_about_800_characters_cut_between_words", () => {
    const excerpt = extractDetail(page(og("Fado"), body())).excerpt!;
    expect(excerpt.length > 700 && excerpt.length <= EXCERPT_CAP).toBe(true);
    expect(["A", "noite", "canta."]).toContain(excerpt.split(/\s+/).at(-1)!);
  });

  test("test_matching_is_case_sensitive_and_falls_back_to_the_text_after_the_title_line", () => {
    const found = extractDetail(page(og("FADO"), "<p>Inicio</p>" + body()));
    expect(found.excerpt!.startsWith("Inicio")).toBe(true);
  });

  test("test_the_part_of_the_title_before_a_separator_is_tried", () => {
    let found = extractDetail(page(og("Fado - Teatro Municipal"), "<p>Inicio</p>" + body()));
    expect(found.excerpt!.startsWith("Fado\nSab")).toBe(true);
    found = extractDetail(page(og("Fado | Agenda ‹ Cidade"), "<p>Inicio</p>" + body()));
    expect(found.excerpt!.startsWith("Fado\nSab")).toBe(true);
  });

  test("test_a_short_page_gives_all_its_text", () => {
    const found = extractDetail(page(og("Fado"), "<main><h1>Fado</h1><p>So isto.</p></main>"));
    expect(found.excerpt).toBe("Fado\nSo isto.");
  });

  test("test_a_mention_that_leads_into_a_mini_calendar_is_skipped", () => {
    const days = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"].concat(Array.from({ length: 31 }, (_, i) => String(i + 1)));
    const calendar = days.map((d) => `<li>${d}</li>`).join("");
    const html = `<main><a href='/e' title='Fado'>Ir</a><ul><li>Pesquisar</li><li>Calendario</li>${calendar}</ul>` +
      "<h1>Fado</h1><p>Noite de fado, 21h30, no teatro.</p></main>";
    const found = extractDetail(page(og("Fado"), html));
    expect(found.excerpt!.startsWith("Fado\nNoite de fado, 21h30")).toBe(true);
  });

  test("test_a_title_that_is_the_only_mention_is_kept_even_before_short_lines", () => {
    const found = extractDetail(page(og("Fado"), "<main><h1>Fado</h1>" + "<p>1</p>".repeat(10) + "</main>"));
    expect(found.excerpt!.startsWith("Fado\n1\n1")).toBe(true);
  });

  test("test_the_title_is_not_said_twice_when_the_title_line_runs_on", () => {
    const html = "<!doctype html><html><head><title>Corrida 2026 - Inscricoes</title>" +
      '<meta property="og:title" content="Corrida 2026" /></head><body>' +
      "<main><p>Corrida 2026 - Inscricoes Pular para o conteudo</p><h1>Corrida 2026 dom 25 out</h1>" +
      "<p>Tipo Corrida</p></main></body></html>";
    expect(extractDetail(bare(html, "text/html")).excerpt).toBe("Corrida 2026 dom 25 out\nTipo Corrida");
  });

  test("test_a_page_with_no_text_has_no_excerpt", () => {
    expect(extractDetail(bare("<html><head></head><body></body></html>")).excerpt).toBeNull();
  });
});

describe("Details", () => {
  test("test_default_details_reads_every_page_and_skips_the_unreadable", () => {
    const broken = { url: "u", contentType: null, body: null, status: 200 } as unknown as Page;
    const source = {} as never;
    const found = defaultDetails(source, [page(og("Um")), broken, page(og("Dois"))], ["", ""]);
    expect(found.map((d) => d.title)).toEqual(["Um", "Dois"]);
  });

  test("test_the_keys_are_the_documented_ones", () => {
    expect(Object.keys(extractDetail(page())).sort()).toEqual(["end", "excerpt", "start", "title", "url", "venue"]);
  });
});

describe("XmlGuards", () => {
  test("test_a_safe_feed_is_parsed", () => {
    expect(xmlRoot(enc("<rss><channel/></rss>")).tag).toBe("rss");
  });

  test("test_utf16_doctype_entity_and_bad_xml_are_refused", () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...[..."<rss/>"].flatMap((c) => [c.charCodeAt(0), 0])]);
    const cases: [Uint8Array, string][] = [
      [utf16, "UTF-16"],
      [enc("<!DOCTYPE rss [<!ENTITY a 'b'>]><rss/>"), "DOCTYPE"],
      [enc("<!doctype rss><rss/>"), "DOCTYPE"],
      [enc("<rss><!ENTITY a 'b'></rss>"), "DOCTYPE"],
      [enc("<rss><channel></rss>"), "not valid XML"],
    ];
    for (const [body, message] of cases) {
      let error: unknown;
      try { xmlRoot(body); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as Error).message).toContain(message);
    }
  });
});
