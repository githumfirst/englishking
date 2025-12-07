// ✅ 여기에 네 Supabase 값 넣기 (Project Settings → API에서 복사)
const SUPABASE_URL = "https://ftljwkzfiewcbigytojz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_jT7s93y7wDUTvPj3VCGsyA_9exhREW7";

// supabase-js v2
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -----------------------
   Supabase <-> rows sync
------------------------ */

// 로그인 유저 가져오기
async function getAuthedUser() {
  const { data, error } = await supa.auth.getUser();
  if (error) {
    console.error("getUser error:", error);
    return null;
  }
  return data.user ?? null;
}

// DB에서 내 rows 불러오기
async function loadRowsFromSupabase() {
  const user = await getAuthedUser();
  if (!user) return null;

  const { data, error } = await supa
    .from("sentences")
    .select("id, user_id, no, ko_text, en_text, history, count, review_day, created_at")
    .order("no", { ascending: true });

  if (error) {
    console.error("loadRowsFromSupabase error:", error);
    return null;
  }

  // DB row -> 앱 row 형태로 변환
  const rows = (data ?? []).map((r) => ({
    // 앱이 쓰는 id는 row 식별자. 여기서는 DB의 uuid(id)를 그대로 사용
    id: r.id,
    no: r.no ?? 0,
    ko: r.ko_text ?? "",
    en: r.en_text ?? "",
    history: Array.isArray(r.history) ? r.history : [],
    count: r.count ?? 0,
    reviewDay: r.review_day ?? "",
  }));

  return rows;
}

// DB에 새 row 삽입
async function insertRowToSupabase(appRow) {
  const user = await getAuthedUser();
  if (!user) throw new Error("로그인이 필요합니다.");

  const payload = {
    user_id: user.id,
    no: appRow.no,
    ko_text: appRow.ko ?? "",
    en_text: appRow.en ?? "",
    history: Array.isArray(appRow.history) ? appRow.history : [],
    count: appRow.count ?? 0,
    review_day: appRow.reviewDay ?? "",
  };

  // id는 DB가 생성하도록 두고, 생성된 uuid를 다시 받아서 앱 row.id에 넣을 것
  const { data, error } = await supa
    .from("sentences")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

// DB row 업데이트
async function updateRowToSupabase(appRow) {
  const user = await getAuthedUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  if (!appRow.id) throw new Error("row id가 없습니다.");

  const payload = {
    no: appRow.no,
    ko_text: appRow.ko ?? "",
    en_text: appRow.en ?? "",
    history: Array.isArray(appRow.history) ? appRow.history : [],
    count: appRow.count ?? 0,
    review_day: appRow.reviewDay ?? "",
  };

  const { error } = await supa
    .from("sentences")
    .update(payload)
    .eq("id", appRow.id)
    .eq("user_id", user.id); // 안전장치(정책 + 이중 체크)

  if (error) throw error;
}

// DB row 삭제
async function deleteRowFromSupabase(appRowId) {
  const user = await getAuthedUser();
  if (!user) throw new Error("로그인이 필요합니다.");

  const { error } = await supa
    .from("sentences")
    .delete()
    .eq("id", appRowId)
    .eq("user_id", user.id);

  if (error) throw error;
}

// no(번호) 재정렬이 필요할 때 DB에 반영 (간단히 전부 업데이트)
async function syncAllNosToSupabase() {
  const user = await getAuthedUser();
  if (!user) return;

  // 너무 자주 호출하면 비효율적이라, 삭제/삽입 직후에만 호출 추천
  const updates = state.rows.map((r) => ({
    id: r.id,
    user_id: user.id,
    no: r.no,
  }));

  // upsert로 no만 맞춰줌 (id 기준)
  const { error } = await supa
    .from("sentences")
    .upsert(updates, { onConflict: "id" });

  if (error) console.error("syncAllNosToSupabase error:", error);
}

/* -----------------------
   State + Persistence
------------------------ */
const STORAGE_KEY = "nativeEnglishApp:v1";
const $ = (sel) => document.querySelector(sel);

function maskEmail(email) {
  if (!email || typeof email !== "string") return "";
  const at = email.indexOf("@");
  if (at < 0) return email;

  const name = email.slice(0, at);
  const domain = email.slice(at); // '@gmail.com' 포함

  const visible = name.slice(0, 3);
  const masked = "*".repeat(Math.max(0, name.length - 3));

  return `${visible}${masked}${domain}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseISODate(s) {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffDaysInclusive(startISO, endISO) {
  const a = parseISODate(startISO);
  const b = parseISODate(endISO);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? days : 0;
}

function daysFromStartToTodayInclusive(startISO) {
  const start = parseISODate(startISO);
  if (!start) return 0;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startD = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  const ms = today.getTime() - startD.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1; // inclusive
}

function uid() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function emptyState() {
  const today = todayISO();
  return {
    meta: {
      title: "1만 문장으로 원어민 되기",
      start: today,
      end: today,
      goal: 10000,
    },
    rows: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const obj = JSON.parse(raw);
    if (!obj.meta) obj.meta = emptyState().meta;
    if (!Array.isArray(obj.rows)) obj.rows = [];
    return obj;
  } catch {
    return emptyState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

/* -----------------------
   Navigation
------------------------ */
function showPage(page) {
  const dash = $("#pageDashboard");
  const prac = $("#pagePractice");
  if (!dash || !prac) return;

  if (page === "practice") {
    dash.classList.add("hidden");
    prac.classList.remove("hidden");
  } else {
    prac.classList.add("hidden");
    dash.classList.remove("hidden");
  }
}

/* -----------------------
   Dashboard (meta + stats)
------------------------ */
function computeStats() {
  const { start, end, goal } = state.meta;

  const duration = diffDaysInclusive(start, end);
  const safeGoal = Number(goal) > 0 ? Number(goal) : 0;
  const daily = duration > 0 ? safeGoal / duration : 0;

  const count = state.rows.length;
  const percent = safeGoal > 0 ? (count / safeGoal) * 100 : 0;

  return {
    duration,
    daily,
    count,
    percent: clamp(percent, 0, 100),
  };
}

function renderDashboard() {
  const titleEl = $("#dashTitle");
  const startEl = $("#dashStart");
  const endEl = $("#dashEnd");
  const goalEl = $("#dashGoal");

  if (titleEl) titleEl.value = state.meta.title ?? "";
  if (startEl) startEl.value = state.meta.start ?? "";
  if (endEl) endEl.value = state.meta.end ?? "";
  if (goalEl) goalEl.value = String(state.meta.goal ?? 0);

  const s = computeStats();

  const durationEl = $("#dashDuration");
  const dailyEl = $("#dashDaily");
  const countEl = $("#dashCount");
  const goalMirrorEl = $("#dashGoalMirror");
  const percentEl = $("#dashPercent");
  const fillEl = $("#progressFill");

  if (durationEl) durationEl.textContent = `${s.duration}`;
  if (dailyEl) dailyEl.textContent = s.duration ? `${Math.ceil(s.daily)}` : "-";
  if (countEl) countEl.textContent = `${s.count}`;
  if (goalMirrorEl) goalMirrorEl.textContent = `${Number(state.meta.goal || 0).toLocaleString()}`;
  if (percentEl) percentEl.textContent = `${s.percent.toFixed(1)}`;
  if (fillEl) fillEl.style.width = `${s.percent}%`;

  // ✅ 오늘까지 누계 목표(계획) 가이드선 표시
  const markerEl = $("#todayMarker");
  const todayTargetTextEl = $("#todayTargetText");
  if (markerEl) {
    const goal = Number(state.meta.goal || 0);
    const duration = diffDaysInclusive(state.meta.start, state.meta.end);
    const daily = duration > 0 ? goal / duration : 0;

    let elapsed = daysFromStartToTodayInclusive(state.meta.start);
    elapsed = clamp(elapsed, 0, duration);

    const cumTarget = daily * elapsed;                 // 오늘까지 누계 목표(문장)
    const markerPct = goal > 0 ? clamp((cumTarget / goal) * 100, 0, 100) : 0;

    markerEl.style.left = `${markerPct}%`;
    markerEl.title = `오늘까지 누계 목표: 약 ${Math.round(cumTarget)}문장`;

    if (todayTargetTextEl) {
      const delta = s.count - Math.round(cumTarget);   // +면 앞섬, -면 뒤처짐
      const sign = delta >= 0 ? "+" : "";
      todayTargetTextEl.textContent =
        `오늘까지 누계 목표: ${Math.round(cumTarget).toLocaleString()} / ${goal.toLocaleString()} 문장 (현재 ${sign}${delta} 문장)`;
    }
  }
}

function bindDashboard() {
  const titleEl = $("#dashTitle");
  const startEl = $("#dashStart");
  const endEl = $("#dashEnd");
  const goalEl = $("#dashGoal");
  const gotoPractice = $("#gotoPractice");

  titleEl?.addEventListener("input", () => {
    state.meta.title = titleEl.value;
    saveState();
    renderDashboard();
  });

  startEl?.addEventListener("change", () => {
    state.meta.start = startEl.value;
    saveState();
    renderDashboard();
  });

  endEl?.addEventListener("change", () => {
    state.meta.end = endEl.value;
    saveState();
    renderDashboard();
  });

  goalEl?.addEventListener("input", () => {
    const n = Number(goalEl.value);
    state.meta.goal = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    saveState();
    renderDashboard();
  });

  gotoPractice?.addEventListener("click", () => {
    showPage("practice");
    renderPractice();
  });
}

/* -----------------------
   Practice Rows
------------------------ */
function sortRows() {
  state.rows.sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
}

function renumberRows() {
  sortRows();
  state.rows.forEach((r, idx) => (r.no = idx + 1));
}

async function addRow() {
  const row = {
    id: null,                 // DB에서 insert 후 uuid 받음
    no: state.rows.length + 1,
    ko: "",
    en: "",
    history: [],
    count: 0,
    reviewDay: "",
  };

  // 화면엔 먼저 추가(UX), DB 저장 실패하면 롤백
  state.rows.push(row);
  renumberRows();
  saveState();
  renderPractice();
  renderDashboard();

  try {
    const newId = await insertRowToSupabase(row);
    row.id = newId;
    saveState();
  } catch (e) {
    alert("DB 저장 실패: " + (e?.message ?? e));
    // 롤백
    state.rows = state.rows.filter((r) => r !== row);
    renumberRows();
    saveState();
    renderPractice();
    renderDashboard();
  }
}

async function updateRow(id, patch) {
  const row = state.rows.find((r) => r.id === id);
  if (!row) return;
  Object.assign(row, patch);

  saveState();
  renderDashboard();

  // DB 반영
  try {
    // id가 아직 null이면(방금 추가된 row insert 전) 업데이트 스킵
    if (row.id) await updateRowToSupabase(row);
  } catch (e) {
    console.error("updateRow DB error:", e);
  }
}

async function pushResult(id, value) {
  const row = state.rows.find((r) => r.id === id);
  if (!row) return;

  row.history = Array.isArray(row.history) ? row.history : [];
  row.history.push(value);
  row.history = row.history.slice(-5);

  row.count = (row.count ?? 0) + 1;
  row.reviewDay = todayISO();

  saveState();
  renderPractice();
  renderDashboard();

  try {
    if (row.id) await updateRowToSupabase(row);
  } catch (e) {
    console.error("pushResult DB error:", e);
  }
}

async function deleteRow(id) {
  const row = state.rows.find((r) => r.id === id);
  if (!row) return;

  // UI 먼저 삭제
  state.rows = state.rows.filter((r) => r.id !== id);
  renumberRows();
  saveState();
  renderPractice();
  renderDashboard();

  // DB 삭제
  try {
    if (row.id) await deleteRowFromSupabase(row.id);
    // 번호(no)도 DB에 맞춰주기
    await syncAllNosToSupabase();
  } catch (e) {
    alert("DB 삭제 실패: " + (e?.message ?? e));
    // 실패 시 다시 로드가 제일 안전
    const rows = await loadRowsFromSupabase();
    if (rows) {
      state.rows = rows;
      renumberRows();
      saveState();
      renderPractice();
      renderDashboard();
    }
  }
}

function symbolFrom(v) {
  if (v === "O") return "ㅇ";
  if (v === "X") return "x";
  return "△";
}

function renderPractice() {
  const body = $("#practiceBody");
  if (!body) return;

  body.innerHTML = "";
  renumberRows();

  for (const row of state.rows) {
    const tr = document.createElement("tr");

    const tdNo = document.createElement("td");
    tdNo.className = "td-no";
    tdNo.textContent = String(row.no ?? "");
    tr.appendChild(tdNo);

    const tdKo = document.createElement("td");
    const ko = document.createElement("textarea");
    ko.className = "cell-input";
    ko.rows = 2;
    ko.placeholder = "한글 문장을 입력하세요";
    ko.value = row.ko || "";
    ko.addEventListener("input", () => updateRow(row.id, { ko: ko.value }));
    tdKo.appendChild(ko);
    tr.appendChild(tdKo);

    const tdEn = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "english-wrap";

    const en = document.createElement("textarea");
    en.className = "cell-input";
    en.rows = 2;
    en.placeholder = "영어 문장을 입력하세요 (기본 숨김)";
    en.value = row.en || "";

    en.addEventListener("input", () => updateRow(row.id, { en: en.value }));

    en.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        en.blur();
      }
    });

    wrap.appendChild(en);
    tdEn.appendChild(wrap);
    tr.appendChild(tdEn);

    const tdRes = document.createElement("td");
    tdRes.className = "td-result";

    const btnO = document.createElement("button");
    btnO.className = "chip";
    btnO.type = "button";
    btnO.textContent = "ㅇ";
    btnO.addEventListener("click", () => pushResult(row.id, "O"));

    const btnX = document.createElement("button");
    btnX.className = "chip";
    btnX.type = "button";
    btnX.textContent = "x";
    btnX.addEventListener("click", () => pushResult(row.id, "X"));

    const btnT = document.createElement("button");
    btnT.className = "chip";
    btnT.type = "button";
    btnT.textContent = "△";
    btnT.addEventListener("click", () => pushResult(row.id, "T"));

    tdRes.append(btnO, btnX, btnT);
    tr.appendChild(tdRes);

    const tdHist = document.createElement("td");
    tdHist.className = "td-history";
    const hist = (row.history || []).map(symbolFrom).join(" ");
    tdHist.textContent = hist || "-";
    tr.appendChild(tdHist);

    const tdCount = document.createElement("td");
    tdCount.className = "td-count";
    tdCount.textContent = String(row.count ?? 0);
    tr.appendChild(tdCount);

    const tdDay = document.createElement("td");
    tdDay.className = "td-day";
    tdDay.textContent = row.reviewDay || "-";
    tr.appendChild(tdDay);

    const tdDel = document.createElement("td");
    const del = document.createElement("button");
    del.className = "btn-danger";
    del.type = "button";
    del.textContent = "삭제";
    del.addEventListener("click", async () => deleteRow(row.id));
    tdDel.appendChild(del);
    tr.appendChild(tdDel);

    body.appendChild(tr);
  }
}

function bindPractice() {
  const addBtn = $("#addRow");
  const gotoDash = $("#gotoDashboard");

  addBtn?.addEventListener("click", async () => {
    await addRow();
    renderPractice();
    renderDashboard();
  });

  gotoDash?.addEventListener("click", () => {
    showPage("dashboard");
    renderDashboard();
  });
}

/* -----------------------
   Import / Export (file-like)
------------------------ */
function bindImportExport() {
  const btnExport = $("#btnExport");
  const fileImport = $("#fileImport");

  btnExport?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `engapp-data-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  fileImport?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== "object") throw new Error("invalid");
      state = obj;
      if (!state.meta) state.meta = emptyState().meta;
      if (!Array.isArray(state.rows)) state.rows = [];
      renumberRows();
      saveState();
      renderDashboard();
      renderPractice();
      alert("가져오기 완료!");
    } catch {
      alert("JSON 파일이 올바르지 않습니다.");
    } finally {
      e.target.value = "";
    }
  });
}

/* -----------------------
   Boot
------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  showPage("dashboard");

  bindDashboard();
  bindPractice();
  bindImportExport();

  renderDashboard();
  renderPractice();

async function refreshAuthUI() {
  const { data } = await supa.auth.getSession();
  const session = data.session;

  const status = document.querySelector("#authStatus");
  const btnLogin = document.querySelector("#btnLogin");
  const btnLogout = document.querySelector("#btnLogout");

  if (session?.user) {
    if (status) status.textContent = `로그인됨: ${maskEmail(session.user.email)}`;
    if (btnLogin) btnLogin.disabled = true;
    if (btnLogout) btnLogout.disabled = false;
  } else {
    if (status) status.textContent = `로그아웃 상태`;
    if (btnLogin) btnLogin.disabled = false;
    if (btnLogout) btnLogout.disabled = true;
  }
}

async function initFromSession() {
  await refreshAuthUI(); // 상태 글자/버튼 활성화 갱신

  const user = await getAuthedUser();
  if (!user) return; // 로그아웃이면 DB 로드 안 함

  const rows = await loadRowsFromSupabase();
  if (rows) {
    state.rows = rows;
    renumberRows();
    saveState();       // 로컬 캐시(옵션)
    renderPractice();
    renderDashboard();
  }
}
   
async function handleLogin() {
  const email = document.querySelector("#authEmail")?.value?.trim();
  const password = document.querySelector("#authPass")?.value ?? "";

  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) {
    alert("로그인 실패: " + error.message);
    return;
  }

  // ✅ 로그인 후: DB에서 내 데이터 로드
  const rows = await loadRowsFromSupabase();
  if (rows) {
    state.rows = rows;
    renumberRows();
    saveState(); // 로컬 캐시도 업데이트(선택)
    renderPractice();
    renderDashboard();
  }

  await refreshAuthUI();
}


async function handleLogout() {
  await supa.auth.signOut();
  await refreshAuthUI();
}


document.querySelector("#btnLogin")?.addEventListener("click", handleLogin);
document.querySelector("#btnLogout")?.addEventListener("click", handleLogout);

// 세션 변화(자동 로그인/로그아웃) 감지
supa.auth.onAuthStateChange(() => {
  initFromSession();
});

// 페이지 처음 열릴 때 상태 반영
initFromSession();

});

