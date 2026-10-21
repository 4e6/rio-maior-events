"""Write test/fixtures/url-vectors.json: synthetic URL cases with Python's answers (run with python3.14)."""
import json, os, sys, urllib.parse as up
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(root, "scripts"))
from adapters.common import clean_url, same_site

def run(f, *a):
    try:
        return f(*a)
    except Exception as e:
        return "EXC"

base = "http://a/b/c/d;p?q"
rfc = ["g:h", "g", "./g", "g/", "/g", "//g", "?y", "g?y", "#s", "g#s", "g?y#s", ";x", "g;x", "", ".", "./", "..", "../",
       "../g", "../..", "../../", "../../g", "../../../g", "../../../../g", "/./g", "/../g", "g.", ".g", "g..", "..g",
       "./../g", "./g/.", "g/./h", "g/../h", "g;x=1/./y", "g;x=1/../y", "http:g", "http://x/y", "HTTP://X/Y"]
bases = ["https://ex.pt/a/b?x=1", "https://www.example.pt/agenda/lista/", "https://ex.pt", "https://ex.pt/", "https://ex.pt/a/b#f"]
hrefs = ["\\\\evil.com/x", "https://EX.PT/É", "https://ex.pt/a b?c d", "/p/'q'", "/p/%7e", "/p/%zz", "/p?a=é&b=ç",
         "../../../x", "https://ex.pt:8443/x", "https://ex.pt:abc/", "https://[::1]/x", "https://[::1/x", "//other.pt", "HTTPS://ex.pt/x",
         "https://münchen.de/x", "/x/./y/../z", "?", "#frag", "https://ex.pt/a|b^c`d{e}", "https://ex.pt/%E9", " \t/e/1\n",
         "https://ex.pt:443/x", "http://ex.pt:80/x", "http://ex.pt:443/x", "https://ex.pt:80/x", "https://ex.pt:/x", "https://u:p@ex.pt:443/x",
         "mailto:a@b.pt", "javascript:void(0)", "tel:123", "ftp://ex.pt/x", "  ", "", "/e/café — x", "/e/q?a=1&b=é",
         "/a;b=c/../d", "x//y", "//", "///x", "https:///x", "https://ex.pt?q=1", "https://ex.pt#f", "/\U0001f600", " /x ", "\x1f/x\x1f"]
joins = [[b, r] for b in [base] + bases for r in rfc + hrefs]
clean = [[b, h] for b in bases + [None, ""] for h in hrefs] + [[None, 5], [None, None], ["https://ex.pt/", None]]
quotes = [[s, safe] for s in ["a b", "é—", "/a/b", "a+b=c&d", "~-._", "%41", "\U0001f600", ""] for safe in ["/", "", "/%:@!$&'()*+,;=~-._?", " "]]
unquotes = ["a%20b", "%C3%A9", "%E9", "%", "%4", "%zz", "a%2Fb", "%F0%9F%98%80", "%F0%9F", "%EF%BB%BFx", "é%C3%A9", "x%41%42y%", "BEGIN%3AVEVENT%0D%0A"]
encodes = [[("a", "b")], [("a b", "c&d=e"), ("\u00e9", "~*")], [("start", "2026-10-20"), ("end", "2026-12-01 23:59:59")], []]
sites = [["https://www.ex.pt/a", "https://ex.pt/b"], ["https://ex.pt", "https://WWW.ex.pt"], ["https://www.ex.pt", "https://www2.ex.pt"], ["https://ex.pt", "/x"], ["https://wwwex.pt", "https://ex.pt"]]
hosts = ["https://EX.pt/a", "https://www.ex.pt:8080/", "https://[::1]:80/", "/rel", "https://u@ex.pt/", "https://ex.pt:abc/", "http://a b/"]
out = {
    "urljoin": [[b, r, run(up.urljoin, b, r)] for b, r in joins],
    "clean": [[b, h, run(clean_url, b, h)] for b, h in clean],
    "quote": [[s, safe, up.quote(s, safe=safe)] for s, safe in quotes],
    "unquote": [[s, up.unquote(s)] for s in unquotes],
    "urlencode": [[[list(t) for t in p], up.urlencode(p)] for p in encodes],
    "same_site": [[a, b, same_site(a, b)] for a, b in sites],
    "host": [[u, run(lambda u: up.urlsplit(u).hostname, u)] for u in hosts],
}
path = os.path.join(root, "test", "fixtures", "url-vectors.json")
json.dump(out, open(path, "w"), ensure_ascii=False, indent=1)
print({k: len(v) for k, v in out.items()}, file=sys.stderr)
