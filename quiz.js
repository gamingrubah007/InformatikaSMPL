(function () {
  "use strict";
  const CFG = window.KUIS_CONFIG || {};
  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const code = (new URLSearchParams(location.search).get("kode") || "").trim().toUpperCase();
  if (!code) { location.replace("index.html"); return; }

  const KEY = "kuis_run_" + code;
  const loadRun = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
  const saveRun = () => { try { sessionStorage.setItem(KEY, JSON.stringify(run)); } catch { /* abaikan */ } };

  let quiz = null;      // data kuis (tanpa kunci)
  let run = null;       // {name, startedAt, order[], optOrder{}, answers{}, idx}
  let timerId = null, submitting = false, submitted = false;

  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const qById = (id) => quiz.questions.find((q) => q.id === id);
  const header = (right = "") => `<header class="topbar"><div class="wrap"><span class="brand"><span class="logo">K</span>${esc(CFG.APP_NAME || "KuisKu")}</span><div class="row">${right}</div></div></header>`;

  window.addEventListener("beforeunload", (e) => { if (run && !submitted) { e.preventDefault(); e.returnValue = ""; } });

  // ------------------------------------------------------------ muat
  async function init() {
    try { quiz = await Db.getQuizPublic(code); }
    catch (e) { return fail("Tidak bisa memuat kuis", e.message); }
    if (!quiz) return fail("Kuis tidak ditemukan", "Kode <b>" + esc(code) + "</b> tidak cocok dengan kuis yang sedang dibuka. Periksa lagi kodenya atau tanya gurumu.");
    if (!quiz.questions.length) return fail("Kuis belum berisi soal", "Silakan hubungi gurumu.");
    document.title = quiz.title + " - " + (CFG.APP_NAME || "KuisKu");
    const saved = loadRun();
    if (saved && saved.name && saved.order && saved.order.every((id) => qById(id))) { run = saved; return renderQuestion(); }
    renderIntro();
  }

  function fail(title, html) {
    app.innerHTML = header() + `<main class="wrap narrow" style="padding-top:40px"><div class="card empty"><div class="big">😕</div><h2>${esc(title)}</h2><p>${html}</p><a class="btn btn-primary" href="index.html">Kembali</a></div></main>`;
  }

  // ------------------------------------------------------------ pembuka
  function renderIntro() {
    const lastName = localStorage.getItem("kuis_last_name") || "";
    app.innerHTML = header() + `
      <main class="wrap narrow" style="padding-top:32px"><form class="card stack" id="f">
        <span class="code" style="align-self:flex-start">${esc(quiz.code)}</span>
        <h1 style="margin:0">${esc(quiz.title)}</h1>
        ${quiz.description ? `<p style="white-space:pre-wrap;margin:0">${esc(quiz.description)}</p>` : ""}
        <div class="row"><span class="chip">${quiz.questions.length} soal</span>${quiz.time_limit_min ? `<span class="chip">⏱ ${quiz.time_limit_min} menit</span>` : `<span class="chip off">Tanpa batas waktu</span>`}</div>
        <label class="field"><span>Nama lengkap</span><input type="text" id="name" maxlength="80" required autocomplete="name" value="${esc(lastName)}" placeholder="Tulis namamu"></label>
        <button class="btn btn-primary btn-block btn-lg">Mulai mengerjakan</button>
      </form></main>`;
    document.getElementById("f").onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById("name").value.trim();
      if (!name) return;
      try { localStorage.setItem("kuis_last_name", name); } catch { /* abaikan */ }
      const ids = quiz.questions.map((q) => q.id);
      run = {
        name, startedAt: Date.now(), idx: 0, answers: {},
        order: quiz.shuffle_questions ? shuffle(ids) : ids,
        optOrder: Object.fromEntries(quiz.questions.filter((q) => q.type === "mc").map((q) => {
          const o = q.options.map((_, i) => i); return [q.id, quiz.shuffle_options ? shuffle(o) : o];
        })),
      };
      saveRun(); renderQuestion();
    };
  }

  // ------------------------------------------------------------ soal
  const remaining = () => quiz.time_limit_min ? Math.max(0, quiz.time_limit_min * 60 - Math.floor((Date.now() - run.startedAt) / 1000)) : null;
  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  function renderQuestion() {
    const n = run.order.length;
    run.idx = Math.min(Math.max(run.idx, 0), n - 1);
    const q = qById(run.order[run.idx]);
    const ans = run.answers[q.id];
    const answered = (id) => { const a = run.answers[id]; return a !== undefined && String(a).trim() !== ""; };
    const doneCount = run.order.filter(answered).length;
    const rem = remaining();

    app.innerHTML = header(rem !== null ? `<span class="timer ${rem <= 60 ? "low" : ""}" id="timer" role="timer" aria-label="Sisa waktu">${fmtTime(rem)}</span>` : "") + `
      <main class="qwrap">
        <div class="row between small muted" style="margin-bottom:6px"><span>Soal ${run.idx + 1} dari ${n}</span><span>${doneCount} terjawab · ${esc(run.name)}</span></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${doneCount}"><i style="width:${(doneCount / n) * 100}%"></i></div>
        <div class="card" style="margin-top:16px">
          <div class="qtext">${esc(q.text)}</div>
          ${q.type === "mc"
            ? run.optOrder[q.id].map((orig, k) => `<button class="opt ${String(ans) === String(orig) ? "sel" : ""}" data-o="${orig}" aria-pressed="${String(ans) === String(orig)}"><span class="badge">${String.fromCharCode(65 + k)}</span><span>${esc(q.options[orig])}</span></button>`).join("")
            : `<label class="field"><span>Jawabanmu</span><input type="text" id="short" autocomplete="off" autocapitalize="off" value="${esc(ans ?? "")}" placeholder="Ketik jawaban singkat"></label>`}
        </div>
        <div class="pal" aria-label="Navigasi soal">${run.order.map((id, i) => `<button data-go="${i}" class="${answered(id) ? "done" : ""} ${i === run.idx ? "cur" : ""}" aria-label="Soal ${i + 1}${answered(id) ? ", sudah dijawab" : ""}">${i + 1}</button>`).join("")}</div>
      </main>
      <div class="navbar"><div class="in">
        <button class="btn btn-lg" id="prev" ${run.idx === 0 ? "disabled" : ""}>← Sebelumnya</button>
        ${run.idx === n - 1 ? `<button class="btn btn-primary btn-lg" id="finish">Selesai ✓</button>` : `<button class="btn btn-primary btn-lg" id="next">Lanjut →</button>`}
      </div></div>`;

    app.querySelectorAll(".opt").forEach((b) => b.onclick = () => {
      run.answers[q.id] = b.dataset.o; saveRun(); renderQuestion();
    });
    const sh = document.getElementById("short");
    if (sh) sh.oninput = () => { run.answers[q.id] = sh.value; saveRun(); };
    app.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => { run.idx = +b.dataset.go; saveRun(); renderQuestion(); });
    document.getElementById("prev").onclick = () => { run.idx--; saveRun(); renderQuestion(); };
    const nx = document.getElementById("next"); if (nx) nx.onclick = () => { run.idx++; saveRun(); renderQuestion(); window.scrollTo(0, 0); };
    const fin = document.getElementById("finish");
    if (fin) fin.onclick = () => {
      const left = run.order.filter((id) => !answered(id)).length;
      if (left && !confirm(`Masih ada ${left} soal yang belum dijawab. Kumpulkan sekarang?`)) return;
      if (!left && !confirm("Kumpulkan jawabanmu sekarang?")) return;
      submit();
    };
    startTimer();
  }

  function startTimer() {
    clearInterval(timerId);
    if (quiz.time_limit_min === 0 || submitted) return;
    timerId = setInterval(() => {
      const r = remaining();
      const el = document.getElementById("timer");
      if (el) { el.textContent = fmtTime(r); el.classList.toggle("low", r <= 60); }
      if (r <= 0) { clearInterval(timerId); submit(true); }
    }, 1000);
  }

  // ------------------------------------------------------------ kirim
  async function submit(auto) {
    if (submitting || submitted) return;
    submitting = true; clearInterval(timerId);
    app.innerHTML = header() + `<main class="wrap narrow" style="padding-top:60px"><div class="card empty"><div class="big">⏳</div><h2>${auto ? "Waktu habis. " : ""}Mengirim jawabanmu…</h2></div></main>`;
    const duration = Math.floor((Date.now() - run.startedAt) / 1000);
    const cap = quiz.time_limit_min ? quiz.time_limit_min * 60 : duration;
    try {
      const res = await Db.submitAttempt(code, run.name, run.answers, Math.min(duration, cap));
      submitted = true; submitting = false;
      const answers = run.answers, name = run.name;
      try { sessionStorage.removeItem(KEY); } catch { /* abaikan */ }
      renderResult(res, answers, name);
    } catch (e) {
      submitting = false;
      app.innerHTML = header() + `<main class="wrap narrow" style="padding-top:40px"><div class="card empty"><div class="big">⚠️</div><h2>Jawaban belum terkirim</h2><p>${esc(e.message)}</p><p class="muted small">Jawabanmu masih tersimpan di perangkat ini. Periksa koneksi internet lalu coba lagi.</p><button class="btn btn-primary btn-lg" id="retry">Kirim ulang</button></div></main>`;
      document.getElementById("retry").onclick = () => submit();
    }
  }

  // ------------------------------------------------------------ hasil
  function renderResult(res, answers, name) {
    const score = Number(res.score);
    const msg = score >= 80 ? "Hebat sekali! 🎉" : score >= 60 ? "Bagus, terus semangat! 👍" : "Jangan menyerah, ayo coba lagi nanti! 💪";
    const review = Array.isArray(res.review) ? res.review : [];
    const byId = Object.fromEntries(review.map((r) => [r.id, r]));
    const mine = (q) => {
      const a = answers[q.id];
      if (a === undefined || String(a).trim() === "") return "(tidak dijawab)";
      return q.type === "mc" ? `${String.fromCharCode(65 + (+a))}. ${q.options[+a] ?? ""}` : String(a);
    };
    app.innerHTML = header() + `
      <main class="wrap narrow" style="padding-top:28px">
        <div class="card" style="text-align:center">
          <p class="muted" style="margin:0">${esc(name)}</p>
          <div class="score-ring" style="--p:${Math.max(0, Math.min(100, score))}"><span>${String(score).replace(".", ",")}</span></div>
          <h2 style="margin-bottom:4px">${msg}</h2>
          <p class="muted">${res.correct} dari ${res.total} soal benar</p>
          ${res.show_result ? "" : `<p class="muted small">Jawabanmu sudah tercatat. Pembahasan tidak ditampilkan untuk kuis ini.</p>`}
          <a class="btn btn-primary" href="index.html">Selesai</a>
        </div>
        ${res.show_result && review.length ? `<h2 style="margin:24px 0 8px">Pembahasan</h2>` + quiz.questions.map((q, i) => {
          const r = byId[q.id]; if (!r) return "";
          return `<div class="review-item ${r.correct ? "ok" : "no"}">
            <div class="row between"><b>Soal ${i + 1}</b><span class="chip ${r.correct ? "ok" : "bad"}">${r.correct ? "Benar" : "Salah"}</span></div>
            <div style="white-space:pre-wrap;margin:6px 0">${esc(q.text)}</div>
            <div class="small">Jawabanmu: <b>${esc(mine(q))}</b></div>
            ${r.correct ? "" : `<div class="small">Jawaban benar: <b>${esc(r.answer)}</b></div>`}
            ${r.explanation ? `<div class="exp">💡 ${esc(r.explanation)}</div>` : ""}
          </div>`;
        }).join("") : ""}
      </main>`;
    window.scrollTo(0, 0);
  }

  init();
})();
