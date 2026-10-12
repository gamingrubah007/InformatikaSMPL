// Pembaca soal dari Microsoft Word (.docx) - tanpa library tambahan.
//
// Format yang dikenali (semua opsional kecuali teks soal dan jawaban):
//   1. Teks soal                      <- nomor boleh ketikan manual ATAU penomoran otomatis Word
//   A. pilihan                        <- huruf boleh ketikan manual ATAU daftar huruf otomatis Word
//   B. pilihan
//   Jawaban: B                        <- atau "Kunci: B"; untuk isian singkat: "Jawaban: Jakarta"
//   Pembahasan: penjelasan singkat
//   Skor: 2
// Penanda jawaban benar alternatif pada pilihan: huruf TEBAL / digarisbawahi / di-highlight
// seluruhnya, atau diakhiri tanda bintang (*).
(function (root) {
  "use strict";

  // ---------------- ZIP ----------------
  function readZipIndex(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("File ini bukan dokumen Word (.docx) yang valid.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries[name] = { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), loff: dv.getUint32(p + 42, true) };
      p += 46 + nlen + elen + clen;
    }
    return { u8, dv, entries };
  }

  async function readZipText(z, name) {
    const e = z.entries[name];
    if (!e) return null;
    const n = z.dv.getUint16(e.loff + 26, true), m = z.dv.getUint16(e.loff + 28, true);
    const start = e.loff + 30 + n + m;
    const data = z.u8.subarray(start, start + e.csize);
    if (e.method === 0) return new TextDecoder().decode(data);
    if (e.method !== 8) throw new Error("Metode kompresi dokumen tidak didukung.");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }

  // ---------------- XML -> baris ----------------
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
      e = e.toLowerCase();
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    });
  }

  function parseNumbering(xml) {
    // hasil: fmt[numId][ilvl] = "decimal" | "lowerLetter" | "bullet" | ...
    const abs = {};
    if (!xml) return {};
    for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
      const lv = {};
      for (const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
        const f = l[2].match(/<w:numFmt\s[^>]*w:val="([^"]+)"/);
        lv[l[1]] = f ? f[1] : "decimal";
      }
      abs[m[1]] = lv;
    }
    const fmt = {};
    for (const m of xml.matchAll(/<w:num\s[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
      const a = m[2].match(/<w:abstractNumId\s[^>]*w:val="(\d+)"/);
      if (a && abs[a[1]]) fmt[m[1]] = abs[a[1]];
    }
    return fmt;
  }

  function parseStyleNumbering(xml) {
    // styleId -> { numId, ilvl } untuk gaya yang membawa penomoran (mis. "List Number")
    const map = {};
    if (!xml) return map;
    for (const m of xml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
      const np = m[2].match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
      if (!np) continue;
      const numId = (np[1].match(/<w:numId\s[^>]*w:val="(\d+)"/) || [])[1];
      const ilvl = (np[1].match(/<w:ilvl\s[^>]*w:val="(\d+)"/) || [])[1] || "0";
      if (numId) map[m[1]] = { numId, ilvl };
    }
    return map;
  }

  function runFlags(rPr) {
    if (!rPr) return false;
    const b = rPr.match(/<w:b(\s[^>]*)?\/?>/);
    if (b) {
      const v = b[1] && b[1].match(/w:val="([^"]*)"/);
      if (!(v && /^(0|false|off)$/.test(v[1]))) return true;
    }
    const u = rPr.match(/<w:u\s[^>]*w:val="([^"]*)"/);
    if (u && u[1] !== "none") return true;
    const h = rPr.match(/<w:highlight\s[^>]*w:val="([^"]*)"/);
    if (h && h[1] !== "none") return true;
    return false;
  }

  function paragraphToLines(pXml, numFmt, styleNum) {
    // 1) jenis daftar (penomoran otomatis, langsung di paragraf atau lewat gaya)
    let kind = "p";
    let numId, ilvl;
    const numPr = pXml.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
    if (numPr) {
      numId = (numPr[1].match(/<w:numId\s[^>]*w:val="(\d+)"/) || [])[1];
      ilvl = (numPr[1].match(/<w:ilvl\s[^>]*w:val="(\d+)"/) || [])[1] || "0";
    } else {
      const ps = (pXml.match(/<w:pStyle\s[^>]*w:val="([^"]+)"/) || [])[1];
      if (ps && styleNum[ps]) ({ numId, ilvl } = styleNum[ps]);
    }
    {
      if (numId && numId !== "0") {
        const f = (numFmt[numId] && numFmt[numId][ilvl]) || "decimal";
        if (/Letter$/.test(f) || f === "bullet" || f === "none") kind = "opt";
        else kind = ilvl === "0" ? "q" : "opt";
      }
    }
    // 2) isi teks per baris (pecah di <w:br/>)
    const lines = [];
    let cur = { text: "", total: 0, marked: 0 };
    const flush = () => { lines.push(cur); cur = { text: "", total: 0, marked: 0 }; };
    for (const r of pXml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const run = r[0];
      const rPr = (run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1];
      const marked = runFlags(rPr);
      for (const t of run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/?>|<w:cr\s*\/>/g)) {
        if (t[0].startsWith("<w:t>") || t[0].startsWith("<w:t ")) {
          const s = decodeEntities(t[1]);
          cur.text += s;
          const visible = s.replace(/\s/g, "").length;
          cur.total += visible;
          if (marked) cur.marked += visible;
        } else if (t[0].startsWith("<w:tab")) {
          cur.text += " ";
        } else {
          flush();
        }
      }
    }
    flush();
    return lines
      .map((l, i) => ({ text: l.text.replace(/[ \t ]+/g, " ").trim(), kind: i === 0 ? kind : "p", marked: l.total > 0 && l.marked === l.total }))
      .filter((l) => l.text);
  }

  async function extractLines(input) {
    let buf = input;
    if (typeof Blob !== "undefined" && input instanceof Blob) buf = await input.arrayBuffer();
    const z = readZipIndex(buf);
    const docXml = await readZipText(z, "word/document.xml");
    if (!docXml) throw new Error("Isi dokumen tidak ditemukan. Pastikan file berformat .docx (bukan .doc lama).");
    const numFmt = parseNumbering(await readZipText(z, "word/numbering.xml"));
    const styleNum = parseStyleNumbering(await readZipText(z, "word/styles.xml"));
    const lines = [];
    for (const p of docXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) lines.push(...paragraphToLines(p[0], numFmt, styleNum));
    const notes = [];
    const nImg = (docXml.match(/<w:drawing\b|<w:pict\b/g) || []).length;
    const nMath = (docXml.match(/<m:oMath\b/g) || []).length;
    if (nImg) notes.push(`Dokumen berisi ${nImg} gambar. Gambar tidak ikut diimpor, tambahkan secara manual bila perlu.`);
    if (nMath) notes.push(`Dokumen berisi ${nMath} rumus matematika (equation). Rumus tidak terbaca, silakan ketik ulang sebagai teks.`);
    return { lines, notes };
  }

  // ---------------- baris -> soal ----------------
  const RE_ANS = /^(?:kunci(?:\s+jawaban)?|jawaban(?:\s+(?:yang\s+)?benar)?|answer|key)\s*[:=\-–]\s*(.*)$/i;
  const RE_EXP = /^(?:pembahasan|penjelasan|explanation|alasan)\s*[:=\-–]\s*(.*)$/i;
  const RE_PTS = /^(?:skor|poin|bobot|points?)\s*[:=]\s*(\d+(?:[.,]\d+)?)\s*$/i;
  const RE_Q1 = /^(?:soal|no\.?|nomor)?\s*(\d{1,3})\s*[.):]\s+(\S.*)$/i;
  const RE_Q2 = /^(\d{1,3})[.)](?=[^\d\s])(\S.*)$/;
  const RE_OPT = /^\(?([A-Ha-h])(?:[.)]\s+|\)\s*)(\S.*)$/;

  const matchQ = (t) => { const m = t.match(RE_Q1) || t.match(RE_Q2); return m ? m[2].trim() : null; };
  const letterIdx = (ch) => ch.toUpperCase().charCodeAt(0) - 65;

  function cleanOption(raw) {
    let text = raw, star = false;
    if (/^\*\s*\S/.test(text)) { star = true; text = text.replace(/^\*\s*/, ""); }
    if (/\s*[*✓✔]\s*$/.test(text) && text.replace(/[*✓✔\s]/g, "").length) { star = true; text = text.replace(/\s*[*✓✔]\s*$/, ""); }
    return { text: text.trim(), star };
  }

  function parseLines(lines) {
    const out = [];
    let cur = null;
    const start = (text, fromKind) => {
      cur = { text, options: [], marks: [], stars: [], answerRaw: undefined, explanation: "", points: 1, last: "text", fromKind };
      out.push(cur);
    };
    const addOption = (raw, marked, letter) => {
      const { text, star } = cleanOption(raw);
      cur.options.push(text);
      cur.marks.push(!!marked);
      cur.stars.push(star);
      cur.last = "option";
    };

    for (const ln of lines) {
      const t = ln.text;
      let m;

      if (cur && (m = t.match(RE_ANS))) { cur.answerRaw = m[1].trim(); cur.last = "answer"; continue; }
      if (cur && (m = t.match(RE_EXP))) { cur.explanation = m[1].trim(); cur.last = "explanation"; continue; }
      if (cur && (m = t.match(RE_PTS))) { cur.points = parseFloat(m[1].replace(",", ".")) || 1; cur.last = "points"; continue; }

      if (ln.kind === "q") {
        start(matchQ(t) ?? t, "q");
        continue;
      }
      if (ln.kind === "opt") {
        if (!cur) continue;
        const om = t.match(RE_OPT);
        addOption(om ? om[2] : t, ln.marked);
        continue;
      }

      // paragraf biasa
      const qText = matchQ(t);
      if (qText !== null) { start(qText, "p"); continue; }

      if (cur && (m = t.match(RE_OPT)) && letterIdx(m[1]) === cur.options.length && cur.answerRaw === undefined) {
        addOption(m[2], ln.marked);
        continue;
      }
      if (!cur) continue; // judul / petunjuk sebelum soal pertama
      if (cur.last === "explanation") { cur.explanation += (cur.explanation ? "\n" : "") + t; continue; }
      if (cur.answerRaw !== undefined) { start(t, "p"); continue; } // soal tanpa nomor setelah soal lengkap
      if (cur.options.length) {
        const i = cur.options.length - 1;
        cur.options[i] += " " + t;
        continue;
      }
      cur.text += "\n" + t;
    }

    return out.map((q, i) => finalize(q, i + 1)).filter(Boolean);
  }

  function finalize(q, no) {
    const warnings = [];
    const text = q.text.trim();
    if (!text) return null;
    let options = q.options.filter((o, i) => o.length || (q.marks[i] = false));
    const stars = q.stars, marks = q.marks;
    let type, answer = "";

    if (options.length >= 2) {
      type = "mc";
      const n = options.length;
      const raw = q.answerRaw;
      if (raw) {
        const first = raw.split(/[,;&\/]|\s+dan\s+/i)[0].trim();
        if (/[,;&]|\s+dan\s+/i.test(raw)) warnings.push("Ada lebih dari satu jawaban benar; hanya yang pertama dipakai.");
        let idx = -1;
        const lm = first.match(/^\(?([A-Ha-h])(?:[.)]|\s|$)/);
        if (lm) idx = letterIdx(lm[1]);
        else if (/^\d{1,2}$/.test(first)) idx = parseInt(first, 10) - 1;
        else idx = options.findIndex((o) => o.toLowerCase() === first.toLowerCase());
        if (idx >= 0 && idx < n) answer = String(idx);
        else warnings.push(`Kunci "${raw}" tidak cocok dengan pilihan yang ada. Pilih jawaban yang benar.`);
      } else {
        const starIdx = stars.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
        const markIdx = marks.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
        if (starIdx.length) answer = String(starIdx[0]);
        else if (markIdx.length && markIdx.length < n) answer = String(markIdx[0]);
        else warnings.push("Kunci jawaban tidak ditemukan. Pilih jawaban yang benar.");
        if ((starIdx.length > 1) || (!starIdx.length && markIdx.length > 1 && markIdx.length < n)) warnings.push("Ada lebih dari satu pilihan bertanda benar; hanya yang pertama dipakai.");
      }
    } else {
      type = "short";
      if (options.length === 1) {
        warnings.push("Hanya ada 1 pilihan, soal dijadikan isian singkat.");
        options = [];
      }
      if (q.answerRaw) answer = q.answerRaw.split("|").map((s) => s.trim()).filter(Boolean).join("|");
      else warnings.push("Kunci jawaban tidak ditemukan. Isi jawaban yang benar.");
    }

    return {
      id: null, type, text, options: type === "mc" ? options : [], answer,
      explanation: q.explanation.trim(), points: q.points || 1, warnings, number: no,
    };
  }

  async function parseDocx(input) {
    const { lines, notes } = await extractLines(input);
    const questions = parseLines(lines);
    const warnings = [...notes];
    if (!questions.length) warnings.push("Tidak ada soal yang terdeteksi. Pastikan soal bernomor (1., 2., ...) dan pilihan berhuruf (A., B., ...). Lihat template.");
    return { questions, warnings };
  }

  function parseText(str) {
    const lines = String(str).split(/\r?\n/).map((s) => s.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).map((text) => ({ text, kind: "p", marked: false }));
    const questions = parseLines(lines);
    const warnings = questions.length ? [] : ["Tidak ada soal yang terdeteksi. Pastikan soal bernomor (1., 2., ...) dan pilihan berhuruf (A., B., ...)."];
    return { questions, warnings };
  }

  const api = { parseDocx, parseText, parseLines, extractLines };
  root.DocxImport = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
