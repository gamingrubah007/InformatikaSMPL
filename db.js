// Lapisan data. Dua mode dengan antarmuka yang sama:
//  - "local"    : localStorage (coba-coba, tanpa server)
//  - "supabase" : database online lewat REST API Supabase (tanpa library tambahan)
(function () {
  const cfg = window.KUIS_CONFIG || {};
  const ONLINE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const BASE = (cfg.SUPABASE_URL || "").replace(/\/+$/, "");
  const ANON = cfg.SUPABASE_ANON_KEY || "";

  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function genCode(len = 6) {
    const a = new Uint32Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  }
  const safeJSON = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

  // ------------------------------------------------------------------
  // Penilaian (dipakai mode lokal; di mode online penilaian dilakukan SQL)
  // ------------------------------------------------------------------
  function gradeQuestion(q, ans) {
    if (q.type === "mc") {
      const ok = ans != null && String(ans) === String(q.answer);
      const idx = parseInt(q.answer, 10);
      return { ok, shown: String.fromCharCode(65 + idx) + ". " + (q.options[idx] ?? "") };
    }
    const accepted = String(q.answer).toLowerCase().split("|").map((s) => s.trim());
    const ok = ans != null && String(ans).trim() !== "" && accepted.includes(String(ans).trim().toLowerCase());
    return { ok, shown: String(q.answer).split("|").map((s) => s.trim()).join(" / ") };
  }

  // ------------------------------------------------------------------
  // MODE LOKAL
  // ------------------------------------------------------------------
  const LS_Q = "kuis_quizzes_v1", LS_A = "kuis_attempts_v1", LS_AUTH = "kuis_local_auth";
  const lq = () => safeJSON(localStorage.getItem(LS_Q), []);
  const la = () => safeJSON(localStorage.getItem(LS_A), []);
  const sq = (v) => localStorage.setItem(LS_Q, JSON.stringify(v));
  const sa = (v) => localStorage.setItem(LS_A, JSON.stringify(v));

  const Local = {
    mode: "local",
    async login(_email, password) {
      if (password !== cfg.LOCAL_ADMIN_PASSWORD) throw new Error("Kata sandi salah.");
      sessionStorage.setItem(LS_AUTH, "1");
    },
    async logout() { sessionStorage.removeItem(LS_AUTH); },
    isLoggedIn() { return sessionStorage.getItem(LS_AUTH) === "1"; },

    async listQuizzes() {
      const attempts = la();
      return lq().map((q) => ({
        ...q, questions: undefined,
        question_count: q.questions.length,
        attempt_count: attempts.filter((a) => a.quiz_id === q.id).length,
      })).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getQuiz(id) {
      const q = lq().find((x) => x.id === id);
      if (!q) throw new Error("Kuis tidak ditemukan.");
      return JSON.parse(JSON.stringify(q));
    },
    async saveQuiz(quiz) {
      const all = lq();
      const rec = { ...quiz };
      if (!rec.id) { rec.id = uuid(); rec.created_at = new Date().toISOString(); }
      if (!rec.code) rec.code = genCode();
      rec.code = rec.code.toUpperCase();
      if (all.some((x) => x.code === rec.code && x.id !== rec.id)) throw new Error("Kode kuis sudah dipakai.");
      rec.questions = (rec.questions || []).map((q) => ({ ...q, id: q.id || uuid() }));
      const i = all.findIndex((x) => x.id === rec.id);
      if (i >= 0) all[i] = rec; else all.push(rec);
      sq(all);
      return rec.id;
    },
    async deleteQuiz(id) {
      sq(lq().filter((x) => x.id !== id));
      sa(la().filter((a) => a.quiz_id !== id));
    },
    async listAttempts(quizId) {
      return la().filter((a) => a.quiz_id === quizId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async deleteAttempt(id) { sa(la().filter((a) => a.id !== id)); },

    async getQuizPublic(code) {
      const q = lq().find((x) => x.code === String(code).trim().toUpperCase() && x.is_active);
      if (!q) return null;
      return {
        id: q.id, code: q.code, title: q.title, description: q.description,
        time_limit_min: q.time_limit_min, shuffle_questions: q.shuffle_questions,
        shuffle_options: q.shuffle_options, show_result: q.show_result,
        questions: q.questions.map((x) => ({ id: x.id, type: x.type, text: x.text, options: x.options, points: x.points })),
      };
    },
    async submitAttempt(code, name, answers, duration) {
      const q = lq().find((x) => x.code === String(code).trim().toUpperCase() && x.is_active);
      if (!q) throw new Error("Kuis tidak ditemukan atau sudah ditutup.");
      if (!String(name || "").trim()) throw new Error("Nama wajib diisi.");
      let got = 0, tot = 0, nOk = 0;
      const review = q.questions.map((x) => {
        const g = gradeQuestion(x, answers[x.id]);
        tot += Number(x.points) || 0;
        if (g.ok) { got += Number(x.points) || 0; nOk++; }
        return { id: x.id, correct: g.ok, answer: g.shown, explanation: x.explanation || "" };
      });
      const pct = tot > 0 ? Math.round((got / tot) * 1000) / 10 : 0;
      const all = la();
      all.push({
        id: uuid(), quiz_id: q.id, student_name: String(name).trim().slice(0, 80),
        score: pct, correct: nOk, total: q.questions.length, answers, duration_sec: duration || 0,
        created_at: new Date().toISOString(),
      });
      sa(all);
      return { score: pct, correct: nOk, total: q.questions.length, show_result: q.show_result, review: q.show_result ? review : [] };
    },
  };

  // ------------------------------------------------------------------
  // MODE ONLINE (Supabase REST)
  // ------------------------------------------------------------------
  const LS_SESSION = "kuis_sb_session";
  const getSession = () => safeJSON(localStorage.getItem(LS_SESSION), null);
  const setSession = (s) => s ? localStorage.setItem(LS_SESSION, JSON.stringify(s)) : localStorage.removeItem(LS_SESSION);

  async function refreshIfNeeded() {
    const s = getSession();
    if (!s) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s;
    const r = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) { setSession(null); return null; }
    const j = await r.json();
    const ns = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600) };
    setSession(ns);
    return ns;
  }

  async function api(path, { method = "GET", body, admin = false, prefer, headers = {} } = {}) {
    let token = ANON;
    if (admin) {
      const s = await refreshIfNeeded();
      if (!s) throw new Error("Sesi admin berakhir. Silakan login kembali.");
      token = s.access_token;
    }
    const h = { apikey: ANON, Authorization: "Bearer " + token, ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (prefer) h.Prefer = prefer;
    let r;
    try {
      r = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error("Tidak bisa terhubung ke server. Periksa koneksi internet.");
    }
    const text = await r.text();
    const data = text ? safeJSON(text, null) : null;
    if (!r.ok) {
      const msg = (data && (data.message || data.error_description || data.msg || data.hint)) || r.statusText;
      throw new Error(msg);
    }
    return data;
  }

  const Online = {
    mode: "supabase",
    async login(email, password) {
      const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error_description || j.msg || "Email atau kata sandi salah.");
      setSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600) });
    },
    async logout() { setSession(null); },
    isLoggedIn() { return !!getSession(); },

    async listQuizzes() {
      const rows = await api("/rest/v1/quizzes?select=*,questions(count),attempts(count)&order=created_at.desc", { admin: true });
      return rows.map((q) => ({
        ...q,
        question_count: q.questions?.[0]?.count ?? 0,
        attempt_count: q.attempts?.[0]?.count ?? 0,
        questions: undefined, attempts: undefined,
      }));
    },
    async getQuiz(id) {
      const [q] = await api(`/rest/v1/quizzes?id=eq.${encodeURIComponent(id)}&select=*`, { admin: true });
      if (!q) throw new Error("Kuis tidak ditemukan.");
      q.questions = await api(`/rest/v1/questions?quiz_id=eq.${encodeURIComponent(id)}&order=position.asc&select=*`, { admin: true });
      return q;
    },
    async saveQuiz(quiz) {
      const row = {
        title: quiz.title, description: quiz.description || "",
        time_limit_min: quiz.time_limit_min || 0,
        shuffle_questions: !!quiz.shuffle_questions, shuffle_options: !!quiz.shuffle_options,
        show_result: quiz.show_result !== false, is_active: quiz.is_active !== false,
        code: (quiz.code || genCode()).toUpperCase(),
      };
      let id = quiz.id;
      if (id) {
        await api(`/rest/v1/quizzes?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: row, admin: true });
      } else {
        const res = await api("/rest/v1/quizzes", { method: "POST", body: row, admin: true, prefer: "return=representation" });
        id = res[0].id;
      }
      await api(`/rest/v1/questions?quiz_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", admin: true });
      const qs = (quiz.questions || []).map((q, i) => ({
        id: uuid(), quiz_id: id, position: i, type: q.type, text: q.text,
        options: q.type === "mc" ? q.options : [], answer: String(q.answer ?? ""),
        explanation: q.explanation || "", points: Number(q.points) || 1,
      }));
      if (qs.length) await api("/rest/v1/questions", { method: "POST", body: qs, admin: true });
      return id;
    },
    async deleteQuiz(id) { await api(`/rest/v1/quizzes?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", admin: true }); },
    async listAttempts(quizId) {
      return api(`/rest/v1/attempts?quiz_id=eq.${encodeURIComponent(quizId)}&order=created_at.desc&select=*`, { admin: true });
    },
    async deleteAttempt(id) { await api(`/rest/v1/attempts?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", admin: true }); },

    async getQuizPublic(code) { return api("/rest/v1/rpc/get_quiz", { method: "POST", body: { p_code: code } }); },
    async submitAttempt(code, name, answers, duration) {
      return api("/rest/v1/rpc/submit_attempt", {
        method: "POST", body: { p_code: code, p_name: name, p_answers: answers, p_duration: duration || 0 },
      });
    },
  };

  window.Db = Object.assign(ONLINE ? Online : Local, { genCode, uuid });
})();
