(function () {
  "use strict";
  const CFG = window.KUIS_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const quizLink = (code) => new URL("quiz.html?kode=" + encodeURIComponent(code), location.href).href;
  const fmtDate = (iso) => new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, "0")}`;

  let toastTimer;
  function toast(msg) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Tautan disalin"); }
    catch { window.prompt("Salin tautan ini:", text); }
  }

  const S = { quiz: null, dirty: false, pending: null };
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  // ------------------------------------------------------------ kerangka
  function shell(inner) {
    const local = Db.mode === "local";
    app.innerHTML = `
      ${local ? `<div class="banner">Mode coba-coba: data hanya tersimpan di browser ini. Siswa di perangkat lain belum bisa mengakses. Lihat PANDUAN.md untuk mengaktifkan mode online.</div>` : ""}
      <header class="topbar"><div class="wrap">
        <a class="brand" href="#/"><span class="logo">K</span>${esc(CFG.APP_NAME || "KuisKu")} <span class="chip">Admin</span></a>
        <div class="row"><a class="btn btn-sm" href="index.html" target="_blank" rel="noopener">Halaman siswa</a><button class="btn btn-sm" id="logout">Keluar</button></div>
      </div></header>
      <main class="wrap" style="padding-top:20px">${inner}</main>`;
    $("#logout").onclick = async () => { await Db.logout(); renderLogin(); };
  }

  function showError(e) {
    if (/Sesi admin/.test(e.message)) { Db.logout(); renderLogin(e.message); return; }
    shell(`<div class="card"><h2>Terjadi masalah</h2><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Muat ulang</button></div>`);
  }

  // ------------------------------------------------------------ login
  function renderLogin(msg) {
    const online = Db.mode === "supabase";
    app.innerHTML = `
      <div class="wrap narrow" style="padding-top:64px"><form class="card stack" id="f">
        <div class="brand"><span class="logo">K</span>${esc(CFG.APP_NAME || "KuisKu")}</div>
        <h1 style="font-size:1.5rem">Masuk Admin</h1>
        ${online ? "" : `<p class="muted small">Mode coba-coba. Kata sandi bawaan: <b>${esc(CFG.LOCAL_ADMIN_PASSWORD)}</b> (ubah di js/config.js).</p>`}
        ${online ? `<label class="field"><span>Email</span><input type="email" id="em" autocomplete="username" required></label>` : ""}
        <label class="field"><span>Kata sandi</span><input type="password" id="pw" autocomplete="current-password" required></label>
        <div class="errlist ${msg ? "" : "hidden"}" id="err">${esc(msg || "")}</div>
        <button class="btn btn-primary btn-block btn-lg" id="go">Masuk</button>
      </form></div>`;
    $("#f").onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $("#go"); btn.disabled = true; btn.textContent = "Memeriksa…";
      try {
        await Db.login(online ? $("#em").value.trim() : "", $("#pw").value);
        route();
      } catch (e) {
        $("#err").textContent = e.message; $("#err").classList.remove("hidden");
        btn.disabled = false; btn.textContent = "Masuk";
      }
    };
  }

  // ------------------------------------------------------------ daftar kuis
  async function renderList() {
    S.dirty = false;
    shell(`<div class="empty">Memuat…</div>`);
    const quizzes = await Db.listQuizzes();
    shell(`
      <div class="row between" style="margin-bottom:16px">
        <h1 style="margin:0">Kuis Saya</h1>
        <div class="row">
          <button class="btn" id="imp">📄 Import dari Word</button>
          <a class="btn btn-primary" href="#/edit/new">+ Kuis baru</a>
        </div>
      </div>
      ${quizzes.length ? quizzes.map((q) => `
        <div class="card quiz-item" data-id="${esc(q.id)}">
          <div>
            <h3>${esc(q.title)}</h3>
            <div class="meta">
              <span class="code">${esc(q.code)}</span>
              <span class="chip">${q.question_count} soal</span>
              <span class="chip">${q.attempt_count} peserta</span>
              <span class="chip ${q.is_active ? "ok" : "off"}">${q.is_active ? "Dibuka" : "Ditutup"}</span>
              ${q.time_limit_min ? `<span class="chip">${q.time_limit_min} menit</span>` : ""}
            </div>
          </div>
          <div class="row">
            <button class="btn btn-sm" data-act="link">🔗 Salin tautan</button>
            <a class="btn btn-sm" href="#/hasil/${esc(q.id)}">Hasil</a>
            <a class="btn btn-sm" href="#/edit/${esc(q.id)}">Edit</a>
            <button class="btn btn-sm btn-danger" data-act="del">Hapus</button>
          </div>
        </div>`).join("") : `
        <div class="card empty"><div class="big">📝</div><h2>Belum ada kuis</h2>
          <p>Buat kuis baru, atau import soal langsung dari file Word.</p>
          <div class="row" style="justify-content:center"><button class="btn" id="imp2">📄 Import dari Word</button><a class="btn btn-primary" href="#/edit/new">+ Kuis baru</a></div>
        </div>`}`);
    const doImport = () => openImport({
      addLabel: "Buat kuis dari soal ini",
      onAdd: (qs, fileName) => { S.pending = { questions: qs, title: fileName }; location.hash = "#/edit/new"; },
    });
    if ($("#imp")) $("#imp").onclick = doImport;
    if ($("#imp2")) $("#imp2").onclick = doImport;
    app.querySelectorAll(".quiz-item").forEach((el) => {
      const q = quizzes.find((x) => x.id === el.dataset.id);
      el.querySelector('[data-act="link"]').onclick = () => copy(quizLink(q.code));
      el.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`Hapus kuis "${q.title}" beserta semua hasil siswa? Tindakan ini tidak bisa dibatalkan.`)) return;
        try { await Db.deleteQuiz(q.id); toast("Kuis dihapus"); renderList(); } catch (e) { toast(e.message); }
      };
    });
  }

  // ------------------------------------------------------------ editor
  const blankQ = () => ({ id: null, type: "mc", text: "", options: ["", "", "", ""], answer: "", explanation: "", points: 1 });
  const fromImport = (q) => ({ id: null, type: q.type, text: q.text, options: q.options.slice(), answer: q.answer, explanation: q.explanation, points: q.points || 1, _warn: q.warnings });

  async function renderEdit(id) {
    shell(`<div class="empty">Memuat…</div>`);
    let quiz;
    if (id === "new" || !id) {
      const p = S.pending; S.pending = null;
      quiz = {
        title: p ? p.title : "", description: "", time_limit_min: 0, shuffle_questions: false, shuffle_options: false,
        show_result: true, is_active: true, code: Db.genCode(), questions: p ? p.questions.map(fromImport) : [blankQ()],
      };
    } else {
      quiz = await Db.getQuiz(id);
      quiz.questions = quiz.questions.map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options : [], answer: String(q.answer ?? "") }));
    }
    S.quiz = quiz; S.dirty = !!(quiz.questions.some((q) => q._warn) && !quiz.id);

    shell(`
      <div class="row between" style="margin-bottom:12px">
        <button class="btn btn-sm" id="back">← Kembali</button>
        <h1 style="margin:0;font-size:1.4rem">${quiz.id ? "Edit kuis" : "Kuis baru"}</h1>
      </div>
      <div class="card stack">
        <label class="field"><span>Judul kuis</span><input type="text" data-s="title" maxlength="120" placeholder="Contoh: Ulangan Harian IPA Bab 3"></label>
        <label class="field"><span>Deskripsi / petunjuk (opsional)</span><textarea data-s="description" style="min-height:60px" placeholder="Petunjuk pengerjaan untuk siswa"></textarea></label>
        <div class="grid2">
          <label class="field"><span>Kode kuis (dipakai siswa untuk masuk)</span><input type="text" data-s="code" maxlength="10" style="text-transform:uppercase;font-weight:800;letter-spacing:.1em"></label>
          <label class="field"><span>Batas waktu (menit, 0 = tanpa batas)</span><input type="number" data-s="time_limit_min" min="0" max="600"></label>
        </div>
        <div class="stack">
          <label class="check"><input type="checkbox" data-s="shuffle_questions"><span>Acak urutan soal</span></label>
          <label class="check"><input type="checkbox" data-s="shuffle_options"><span>Acak urutan pilihan jawaban</span></label>
          <label class="check"><input type="checkbox" data-s="show_result"><span>Tampilkan kunci jawaban dan pembahasan setelah siswa selesai</span></label>
          <label class="check"><input type="checkbox" data-s="is_active"><span>Kuis dibuka (siswa bisa mengerjakan)</span></label>
        </div>
      </div>
      <div class="row between" style="margin:22px 0 8px"><h2 style="margin:0">Soal <span class="muted" id="qcount"></span></h2>
        <button class="btn" id="imp">📄 Import dari Word</button></div>
      <div id="errs" class="errlist hidden" role="alert"></div>
      <div id="qlist"></div>
      <div class="row" style="margin-top:16px"><button class="btn" id="addq">+ Tambah soal</button></div>
      <div style="height:90px"></div>
      <div class="savebar"><div class="wrap">
        <span class="muted small" id="savehint">${quiz.id ? "" : "Kuis belum disimpan"}</span>
        <button class="btn btn-primary btn-lg" id="save">Simpan kuis</button>
      </div></div>`);

    // pengaturan
    app.querySelectorAll("[data-s]").forEach((el) => {
      const k = el.dataset.s;
      if (el.type === "checkbox") el.checked = !!quiz[k]; else el.value = quiz[k] ?? "";
      const upd = () => {
        quiz[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Math.max(0, parseInt(el.value, 10) || 0) : el.value;
        S.dirty = true;
      };
      el.addEventListener(el.type === "checkbox" ? "change" : "input", upd);
    });
    $("#back").onclick = () => { if (!S.dirty || confirm("Perubahan belum disimpan. Tetap keluar?")) { S.dirty = false; location.hash = "#/"; } };
    $("#addq").onclick = () => { quiz.questions.push(blankQ()); S.dirty = true; renderQuestions(); const c = app.querySelectorAll(".qcard"); c[c.length - 1].scrollIntoView({ behavior: "smooth", block: "center" }); };
    $("#imp").onclick = () => openImport({
      addLabel: "Tambahkan ke kuis ini",
      onAdd: (qs) => {
        const only = quiz.questions.length === 1 && !quiz.questions[0].text.trim() && !quiz.questions[0].options.some((o) => o.trim());
        if (only) quiz.questions = [];
        quiz.questions.push(...qs.map(fromImport));
        S.dirty = true; renderQuestions(); toast(`${qs.length} soal ditambahkan`);
      },
    });
    $("#save").onclick = save;
    $("#qlist").addEventListener("input", onQInput);
    $("#qlist").addEventListener("change", onQChange);
    $("#qlist").addEventListener("click", onQClick);
    renderQuestions();
  }

  function qHtml(q, i, n) {
    const mc = q.type === "mc";
    return `
    <div class="card qcard" data-i="${i}" id="q${i}">
      <div class="qhead">
        <span class="no">Soal ${i + 1}</span>
        <select data-f="type" aria-label="Jenis soal"><option value="mc" ${mc ? "selected" : ""}>Pilihan ganda</option><option value="short" ${!mc ? "selected" : ""}>Isian singkat</option></select>
        <label class="row small muted" style="gap:6px">Skor <input type="number" min="0" step="0.5" data-f="points" value="${esc(q.points)}"></label>
        <span class="grow"></span>
        <button class="btn btn-sm btn-ghost" data-act="up" ${i === 0 ? "disabled" : ""} title="Naik" aria-label="Naikkan soal">↑</button>
        <button class="btn btn-sm btn-ghost" data-act="down" ${i === n - 1 ? "disabled" : ""} title="Turun" aria-label="Turunkan soal">↓</button>
        <button class="btn btn-sm btn-danger" data-act="del" title="Hapus soal" aria-label="Hapus soal">Hapus</button>
      </div>
      <textarea data-f="text" placeholder="Tulis pertanyaan di sini…" aria-label="Pertanyaan">${esc(q.text)}</textarea>
      ${mc ? `
        <div class="muted small" style="margin:10px 0 2px">Pilih bulatan di samping jawaban yang benar</div>
        ${q.options.map((o, k) => `
          <div class="optrow ${String(k) === String(q.answer) ? "correct" : ""}">
            <input type="radio" name="c${i}" data-f="correct" data-o="${k}" ${String(k) === String(q.answer) ? "checked" : ""} aria-label="Jawaban benar ${String.fromCharCode(65 + k)}">
            <span class="letter">${String.fromCharCode(65 + k)}</span>
            <input type="text" data-f="opt" data-o="${k}" value="${esc(o)}" placeholder="Pilihan ${String.fromCharCode(65 + k)}" aria-label="Pilihan ${String.fromCharCode(65 + k)}">
            ${q.options.length > 2 ? `<button class="btn btn-sm btn-ghost" data-act="delopt" data-o="${k}" title="Hapus pilihan" aria-label="Hapus pilihan ${String.fromCharCode(65 + k)}">✕</button>` : ""}
          </div>`).join("")}
        ${q.options.length < 8 ? `<button class="btn btn-sm" data-act="addopt" style="margin-top:6px">+ Tambah pilihan</button>` : ""}`
      : `
        <label class="field" style="margin-top:10px"><span>Jawaban benar <span class="muted" style="font-weight:400">(jika ada beberapa jawaban yang diterima, pisahkan dengan tanda |)</span></span>
          <input type="text" data-f="answer" value="${esc(q.answer)}" placeholder="Contoh: Jakarta | DKI Jakarta"></label>`}
      <label class="field" style="margin-top:10px"><span>Pembahasan (opsional)</span><input type="text" data-f="explanation" value="${esc(q.explanation)}" placeholder="Penjelasan singkat yang muncul setelah kuis selesai"></label>
      ${q._warn && q._warn.length ? `<div class="warnbox">⚠ ${q._warn.map(esc).join(" ")}</div>` : ""}
    </div>`;
  }

  function renderQuestions() {
    const qs = S.quiz.questions;
    $("#qlist").innerHTML = qs.length ? qs.map((q, i) => qHtml(q, i, qs.length)).join("") :
      `<div class="card empty">Belum ada soal. Klik "Tambah soal" atau "Import dari Word".</div>`;
    $("#qcount").textContent = `(${qs.length})`;
  }

  function cardOf(el) { const c = el.closest(".qcard"); return c ? { c, i: +c.dataset.i, q: S.quiz.questions[+c.dataset.i] } : null; }
  function touch(ctx) {
    S.dirty = true; ctx.c.classList.remove("invalid");
    if (ctx.q._warn) { delete ctx.q._warn; const w = ctx.c.querySelector(".warnbox"); if (w) w.remove(); }
  }
  function onQInput(e) {
    const ctx = cardOf(e.target); if (!ctx) return;
    const f = e.target.dataset.f; if (!f) return;
    if (f === "text") ctx.q.text = e.target.value;
    else if (f === "explanation") ctx.q.explanation = e.target.value;
    else if (f === "answer") ctx.q.answer = e.target.value;
    else if (f === "points") ctx.q.points = parseFloat(e.target.value) || 0;
    else if (f === "opt") ctx.q.options[+e.target.dataset.o] = e.target.value;
    touch(ctx);
  }
  function onQChange(e) {
    const ctx = cardOf(e.target); if (!ctx) return;
    const f = e.target.dataset.f;
    if (f === "type") {
      ctx.q.type = e.target.value; ctx.q.answer = "";
      if (ctx.q.type === "mc" && ctx.q.options.length < 2) ctx.q.options = ["", "", "", ""];
      touch(ctx); renderQuestions();
    } else if (f === "correct") {
      ctx.q.answer = e.target.dataset.o;
      ctx.c.querySelectorAll(".optrow").forEach((r, k) => r.classList.toggle("correct", String(k) === ctx.q.answer));
      touch(ctx);
    }
  }
  function onQClick(e) {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const ctx = cardOf(b); if (!ctx) return;
    const qs = S.quiz.questions, act = b.dataset.act;
    if (act === "up" && ctx.i > 0) [qs[ctx.i - 1], qs[ctx.i]] = [qs[ctx.i], qs[ctx.i - 1]];
    else if (act === "down" && ctx.i < qs.length - 1) [qs[ctx.i + 1], qs[ctx.i]] = [qs[ctx.i], qs[ctx.i + 1]];
    else if (act === "del") { if (!confirm(`Hapus soal ${ctx.i + 1}?`)) return; qs.splice(ctx.i, 1); }
    else if (act === "addopt") ctx.q.options.push("");
    else if (act === "delopt") {
      const o = +b.dataset.o; ctx.q.options.splice(o, 1);
      if (ctx.q.answer !== "") { const a = +ctx.q.answer; ctx.q.answer = a === o ? "" : String(a > o ? a - 1 : a); }
    }
    S.dirty = true; renderQuestions();
  }

  function validate() {
    const q = S.quiz, errs = [];
    if (!q.title.trim()) errs.push({ msg: "Judul kuis wajib diisi." });
    if (!/^[A-Za-z0-9]{4,10}$/.test(q.code || "")) errs.push({ msg: "Kode kuis harus 4-10 huruf atau angka, tanpa spasi." });
    if (!q.questions.length) errs.push({ msg: "Tambahkan minimal satu soal." });
    q.questions.forEach((x, i) => {
      const n = i + 1;
      if (!x.text.trim()) errs.push({ i, msg: `Soal ${n}: pertanyaan masih kosong.` });
      if (x.type === "mc") {
        if (x.options.length < 2 || x.options.some((o) => !o.trim())) errs.push({ i, msg: `Soal ${n}: semua pilihan harus diisi (hapus pilihan yang tidak dipakai).` });
        else if (x.answer === "" || +x.answer >= x.options.length) errs.push({ i, msg: `Soal ${n}: pilih jawaban yang benar.` });
      } else if (!String(x.answer).split("|").some((a) => a.trim())) errs.push({ i, msg: `Soal ${n}: isi jawaban yang benar.` });
      if (!(x.points > 0)) errs.push({ i, msg: `Soal ${n}: skor harus lebih dari 0.` });
    });
    return errs;
  }

  async function save() {
    const quiz = S.quiz;
    quiz.code = (quiz.code || "").trim().toUpperCase();
    const errs = validate();
    const box = $("#errs");
    app.querySelectorAll(".qcard").forEach((c) => c.classList.remove("invalid"));
    if (errs.length) {
      box.classList.remove("hidden");
      box.innerHTML = "<b>Mohon perbaiki dulu:</b><ul style='margin:6px 0 0;padding-left:18px'>" + errs.map((e) => `<li>${esc(e.msg)}</li>`).join("") + "</ul>";
      errs.forEach((e) => { if (e.i != null) { const c = $("#q" + e.i); if (c) c.classList.add("invalid"); } });
      const first = errs.find((e) => e.i != null);
      (first ? $("#q" + first.i) : box).scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    box.classList.add("hidden");
    const btn = $("#save"); btn.disabled = true; btn.textContent = "Menyimpan…";
    try {
      const payload = {
        ...quiz,
        questions: quiz.questions.map((q) => ({
          id: q.id, type: q.type, text: q.text.trim(),
          options: q.type === "mc" ? q.options.map((o) => o.trim()) : [],
          answer: q.type === "mc" ? String(q.answer) : String(q.answer).split("|").map((s) => s.trim()).filter(Boolean).join("|"),
          explanation: (q.explanation || "").trim(), points: Number(q.points) || 1,
        })),
      };
      const id = await Db.saveQuiz(payload);
      S.dirty = false;
      toast("Kuis tersimpan ✓");
      if (!quiz.id) location.hash = "#/edit/" + id;
      else { btn.disabled = false; btn.textContent = "Simpan kuis"; }
    } catch (e) {
      btn.disabled = false; btn.textContent = "Simpan kuis";
      if (/Sesi admin/.test(e.message)) { showError(e); return; }
      box.classList.remove("hidden");
      box.textContent = /duplicate|unique|sudah dipakai/i.test(e.message) ? "Kode kuis sudah dipakai kuis lain. Ganti kodenya." : "Gagal menyimpan: " + e.message;
    }
  }

  // ------------------------------------------------------------ import Word
  function openImport({ onAdd, addLabel }) {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="Import soal dari Word">
        <div class="row between"><h2 style="margin:0">Import soal dari Word</h2><button class="btn btn-sm btn-ghost" id="x" aria-label="Tutup">✕</button></div>
        <p class="muted small">Unggah file <b>.docx</b>. Soal bernomor (1., 2., …), pilihan berhuruf (A., B., …), lalu baris <b>Jawaban: B</b>. Penomoran otomatis Word juga terbaca.</p>
        <label class="drop" id="drop" for="file" tabindex="0">📄 Klik untuk memilih file .docx, atau seret ke sini<input type="file" id="file" accept=".docx" class="hidden"></label>
        <details style="margin:12px 0"><summary class="small" style="cursor:pointer;font-weight:600">Lihat contoh format di Word</summary>
<pre class="fmt">1. Planet terbesar di tata surya adalah...
A. Bumi
B. Jupiter
C. Mars
D. Venus
Jawaban: B
Pembahasan: Jupiter adalah planet terbesar.

2. Ibu kota Prancis adalah...   (isian singkat)
Jawaban: Paris | paris
Skor: 2</pre>
          <p class="small muted">Alternatif penanda jawaban benar: tebalkan/garis bawahi/highlight seluruh teks pilihan yang benar, atau akhiri dengan tanda *. Gambar dan rumus equation tidak ikut terimpor. <a href="template_soal.docx" download>Unduh template Word</a></p></details>
        <details style="margin:12px 0"><summary class="small" style="cursor:pointer;font-weight:600">Atau tempel teks soal</summary>
          <textarea id="paste" style="margin-top:8px" placeholder="Tempel soal dari Word / PDF di sini…"></textarea>
          <button class="btn btn-sm" id="readpaste" style="margin-top:6px">Baca teks</button></details>
        <div id="prev"></div>
        <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="cancel">Batal</button><button class="btn btn-primary" id="ok" disabled>${esc(addLabel)}</button></div>
      </div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    let result = null, fileName = "";
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    document.addEventListener("keydown", function esc_(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc_); } });
    $("#x", bg).onclick = $("#cancel", bg).onclick = close;

    const show = (r, name) => {
      result = r; fileName = name || "";
      const bad = r.questions.filter((q) => q.warnings.length).length;
      $("#prev", bg).innerHTML = `
        <div class="row" style="margin:6px 0"><span class="chip ok">${r.questions.length} soal terdeteksi</span>${bad ? `<span class="chip bad">${bad} perlu dicek</span>` : ""}</div>
        ${r.warnings.map((w) => `<div class="warnbox">⚠ ${esc(w)}</div>`).join("")}
        ${r.questions.slice(0, 60).map((q) => `
          <div class="preview-q"><b>${q.number}.</b> ${esc(q.text.length > 160 ? q.text.slice(0, 160) + "…" : q.text)}
            ${q.type === "mc" ? `<div class="small muted" style="margin-top:4px">${q.options.map((o, k) => String(k) === q.answer ? `<span class="ok">${String.fromCharCode(65 + k)}. ${esc(o)} ✓</span>` : `${String.fromCharCode(65 + k)}. ${esc(o)}`).join(" &nbsp;·&nbsp; ")}</div>`
        : `<div class="small muted" style="margin-top:4px">Isian singkat: <span class="ok">${esc(q.answer || "—")}</span></div>`}
            ${q.warnings.map((w) => `<div class="warnbox">⚠ ${esc(w)}</div>`).join("")}</div>`).join("")}
        ${r.questions.length > 60 ? `<p class="muted small">…dan ${r.questions.length - 60} soal lainnya.</p>` : ""}`;
      $("#ok", bg).disabled = !r.questions.length;
      $("#ok", bg).textContent = r.questions.length ? `${addLabel} (${r.questions.length})` : addLabel;
    };
    const readFile = async (file) => {
      if (!file) return;
      if (/\.doc$/i.test(file.name)) { $("#prev", bg).innerHTML = `<div class="errlist">Format .doc lama tidak didukung. Buka di Word lalu Simpan Sebagai .docx.</div>`; return; }
      $("#prev", bg).innerHTML = `<p class="muted">Membaca ${esc(file.name)}…</p>`;
      try { show(await DocxImport.parseDocx(file), file.name.replace(/\.docx$/i, "")); }
      catch (e) { $("#prev", bg).innerHTML = `<div class="errlist">${esc(e.message)}</div>`; $("#ok", bg).disabled = true; }
    };
    $("#file", bg).onchange = (e) => readFile(e.target.files[0]);
    const drop = $("#drop", bg);
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => readFile(e.dataTransfer.files[0]));
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file", bg).click(); } });
    $("#readpaste", bg).onclick = () => show(DocxImport.parseText($("#paste", bg).value), "");
    $("#ok", bg).onclick = () => { if (result && result.questions.length) { close(); onAdd(result.questions, fileName); } };
  }

  // ------------------------------------------------------------ hasil
  async function renderResults(id) {
    S.dirty = false;
    shell(`<div class="empty">Memuat…</div>`);
    const [quiz, att] = await Promise.all([Db.getQuiz(id), Db.listAttempts(id)]);
    const scores = att.map((a) => Number(a.score));
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const fmt = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");
    shell(`
      <div class="row between" style="margin-bottom:12px"><a class="btn btn-sm" href="#/">← Kembali</a>
        <div class="row"><button class="btn btn-sm" id="csv" ${att.length ? "" : "disabled"}>⬇ Unduh CSV</button><a class="btn btn-sm" href="#/edit/${esc(id)}">Edit kuis</a></div></div>
      <h1 style="margin-bottom:4px">${esc(quiz.title)}</h1>
      <p class="muted">Kode <span class="code">${esc(quiz.code)}</span> · <a href="#" id="lnk">salin tautan</a></p>
      <div class="stats">
        <div class="stat"><span class="muted small">Peserta</span><b>${att.length}</b></div>
        <div class="stat"><span class="muted small">Rata-rata</span><b>${att.length ? fmt(avg) : "-"}</b></div>
        <div class="stat"><span class="muted small">Tertinggi</span><b>${att.length ? fmt(Math.max(...scores)) : "-"}</b></div>
        <div class="stat"><span class="muted small">Terendah</span><b>${att.length ? fmt(Math.min(...scores)) : "-"}</b></div>
      </div>
      <div class="card" style="padding:0">${att.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Nama</th><th>Nilai</th><th>Benar</th><th>Durasi</th><th>Waktu</th><th></th></tr></thead>
        <tbody>${att.map((a) => `<tr data-id="${esc(a.id)}"><td><b>${esc(a.student_name)}</b></td><td>${fmt(Number(a.score))}</td><td>${a.correct}/${a.total}</td><td>${fmtDur(a.duration_sec)}</td><td>${esc(fmtDate(a.created_at))}</td><td><button class="btn btn-sm btn-danger" data-del>Hapus</button></td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="empty">Belum ada siswa yang mengerjakan.</div>`}</div>`);
    $("#lnk").onclick = (e) => { e.preventDefault(); copy(quizLink(quiz.code)); };
    if (att.length) {
      $("#csv").onclick = () => {
        const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
        const rows = [["Nama", "Nilai", "Benar", "Total soal", "Durasi (mm:ss)", "Waktu"], ...att.map((a) => [a.student_name, a.score, a.correct, a.total, fmtDur(a.duration_sec), fmtDate(a.created_at)])];
        const blob = new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `hasil-${quiz.code}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      app.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
        const tr = b.closest("tr");
        if (!confirm("Hapus hasil siswa ini?")) return;
        try { await Db.deleteAttempt(tr.dataset.id); renderResults(id); } catch (e) { toast(e.message); }
      });
    }
  }

  // ------------------------------------------------------------ routing
  async function route() {
    if (!Db.isLoggedIn()) return renderLogin();
    const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
    try {
      if (page === "edit") await renderEdit(arg);
      else if (page === "hasil") await renderResults(arg);
      else await renderList();
    } catch (e) { showError(e); }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();
})();
