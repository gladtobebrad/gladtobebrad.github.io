// Extract the REAL escapeHtml/safeUrl source from js/ui/escape.js and unit-test it.
import { readFileSync } from "node:fs";
const src = readFileSync("js/ui/escape.js", "utf8");
const grab = (name) => {
  const m = src.match(new RegExp(`export function ${name}\\s*\\([\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return m[0].replace(/^export /, "");
};
// eval the real implementations in this scope
const mod = {};
new Function("exports", `${grab("escapeHtml")}\n${grab("safeUrl")}\nexports.escapeHtml=escapeHtml;exports.safeUrl=safeUrl;`)(mod);
const { escapeHtml, safeUrl } = mod;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`❌ ${label}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};

// escapeHtml — neutralizes tag/attribute breakouts
eq("escape <img onerror>", escapeHtml('<img src=x onerror=alert(1)>'),
   '&lt;img src=x onerror=alert(1)&gt;');
eq("escape attr breakout", escapeHtml('" onmouseover="evil()'),
   '&quot; onmouseover=&quot;evil()');
eq("escape ampersand+quote", escapeHtml(`a&b'c`), 'a&amp;b&#39;c');
eq("escape null/undefined → ''", escapeHtml(undefined), '');
eq("escape number coerces", escapeHtml(42), '42');

// safeUrl — only http(s) absolute or scheme-less relative
eq("safe https", safeUrl('https://i.imgur.com/a.png'), 'https://i.imgur.com/a.png');
eq("safe http", safeUrl('http://x.com/p.jpg'), 'http://x.com/p.jpg');
eq("safe relative photo", safeUrl('data/photos/al_c.png'), 'data/photos/al_c.png');
eq("block javascript:", safeUrl('javascript:alert(1)'), '');
eq("block JaVaScRiPt: (case)", safeUrl('JaVaScRiPt:alert(1)'), '');
eq("block data: html", safeUrl('data:text/html,<script>alert(1)</script>'), '');
eq("block protocol-relative //", safeUrl('//evil.com/x.png'), '');
eq("block vbscript:", safeUrl('vbscript:msgbox(1)'), '');
eq("strip ctrl-char scheme split", safeUrl('java\tscript:alert(1)'), ''); // tab removed → javascript: → blocked
eq("block leading-space javascript", safeUrl('   javascript:alert(1)'), '');
eq("empty → ''", safeUrl(''), '');
eq("null → ''", safeUrl(null), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
