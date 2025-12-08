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

  const rows = (data ?? []).map((r) => ({
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

// DB에 새 row 삽입 (review_day는 "마지막 학습일"이라서 생성 시에는 null로 넣는 게 맞음)
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
    review_day: null, // ✅ 처음 생성 시 "아직 학습 안 함"
  };

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
    review_day: appRow.reviewDay || null,
  };

  const { error } = await supa
    .from("sentences")
    .update(payload)
    .eq("id", appRow.id)
    .eq("user_id", user.id);

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

// no(번호) 재정렬이 필요할 때 DB에 반영
async function syncAllNosToSupabase() {
  const user = await getAuthedUser();
  if (!user) return;

  const updates = state.rows
    .filter((r) => r.id) // id 없는 임시 row 제외
    .map((r) => ({ id: r.id, user_id: user.id, no: r.no }));

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
  const domain = email.slice(at);
  return `${name.slice(0, 3)}${"*".repeat(Math.max(0, name.length - 3))}${domain}`;
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
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
}

function emptyState() {
  const today = todayISO();
  return {
    meta: { title: "1만 문장으로 원어민 되기", start: today, end: today, goal: 10000 },
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
  const auth = $("#topbarAuth"); // ✅ 추가

  if (!dash || !prac) return;

  if (page === "practice") {
    dash.classList.add("hidden");
    prac.classList.remove("hidden");
    auth?.classList.add("hidden");   // ✅ practice에서는 숨김
  } else {
    prac.classList.add("hidden");
    dash.classList.remove("hidden");
    auth?.classList.remove("hidden"); // ✅ dashboard에서는 표시
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

  return { duration, daily, count, percent: clamp(percent, 0, 100) };
}

function renderDashboard() {
  const s = computeStats();

  // input 값 반영
  const startEl = $("#dashStart");
  const endEl = $("#dashEnd");
  const goalEl = $("#dashGoal");
  if (startEl) startEl.value = state.meta.start ?? "";
  if (endEl) endEl.value = state.meta.end ?? "";
  if (goalEl) goalEl.value = String(state.meta.goal ?? 0);

  // 진행률 바
  $("#progressFill").style.width = `${s.percent}%`;

  // 오늘까지 누계 목표 계산
  const goal = Number(state.meta.goal || 0);
  const duration = diffDaysInclusive(state.meta.start, state.meta.end);
  const daily = duration > 0 ? goal / duration : 0;

  let elapsed = daysFromStartToTodayInclusive(state.meta.start);
  elapsed = clamp(elapsed, 0, duration);

  const cumTarget = daily * elapsed;            // 오늘까지 목표 누계 (소수 1자리)
  const cumTarget1 = Number(cumTarget.toFixed(1));
  const delta1 = Number((s.count - cumTarget1).toFixed(1));
  const sign = delta1 >= 0 ? "+" : "";

  // marker (선택: 유지하고 싶으면)
  const markerEl = $("#todayMarker");
  if (markerEl) {
    const markerPct = goal > 0 ? clamp((cumTarget / goal) * 100, 0, 100) : 0;
    markerEl.style.left = `${markerPct}%`;
  }

  // ✅ KPI 채우기
  const durationEl = document.querySelector("#kpiDuration");
  const dailyEl = document.querySelector("#kpiDaily");
  const cumEl = document.querySelector("#kpiCumTarget");
  const doneEl = document.querySelector("#kpiDone");
  const pctEl = document.querySelector("#kpiPercent");
  const deltaEl = document.querySelector("#kpiDelta");

  if (durationEl) durationEl.textContent = `${s.duration}일`;
  if (dailyEl) dailyEl.textContent = `${daily.toFixed(1)}문장`;
  if (cumEl) cumEl.textContent = `${cumTarget1.toFixed(1)}문장`;
  if (doneEl) doneEl.textContent = `${s.count}문장`;
  if (pctEl) pctEl.textContent = `${s.percent.toFixed(1)}%`;

  // ✅ “오늘까지 누계목표” 문장을 아래에 또 출력하지 않고,
  //    “현재까지 공부한 문장 3문장 (현재 -10.3문장)”처럼 붙여주기
  if (deltaEl) deltaEl.textContent = ` (현재 ${sign}${delta1.toFixed(1)}문장)`;
}

function bindDashboard() {
  $("#dashTitle")?.addEventListener("input", (e) => {
    state.meta.title = e.target.value;
    saveState(); renderDashboard();
  });
  $("#dashStart")?.addEventListener("change", (e) => {
    state.meta.start = e.target.value;
    saveState(); renderDashboard();
  });
  $("#dashEnd")?.addEventListener("change", (e) => {
    state.meta.end = e.target.value;
    saveState(); renderDashboard();
  });
  $("#dashGoal")?.addEventListener("input", (e) => {
    const n = Number(e.target.value);
    state.meta.goal = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    saveState(); renderDashboard();
  });

  $("#gotoPractice")?.addEventListener("click", () => {
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
    id: null,
    no: state.rows.length + 1,
    ko: "",
    en: "",
    history: [],
    count: 0,
    reviewDay: "",
  };

  state.rows.push(row);
  renumberRows();
  saveState();
  renderPractice();
  renderDashboard();

 // auto scrolling
 requestAnimationFrame(() => {
   const btn = document.getElementById("addRow");
   if (btn) btn.scrollIntoView({ behavior: "smooth", block: "end" });
 });

  try {
    const newId = await insertRowToSupabase(row);
    row.id = newId;
    saveState();
  } catch (e) {
    alert("DB 저장 실패: " + (e?.message ?? e));
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

  try {
    if (row.id) await updateRowToSupabase(row);
  } catch (e) {
    console.error("updateRow DB error:", e);
  }
}

async function pushResult(id, value) {
  const row = state.rows.find((r) => r.id === id);
  if (!row) return;

  row.history = Array.isArray(row.history) ? row.history : [];
  row.history.push(symbolFrom(value));   // value: "O"|"X"|"T"  → "ㅇ"|"x"|"△"
  row.history = row.history.slice(-5);

  row.count = (row.count ?? 0) + 1;
  row.reviewDay = todayISO(); // ✅ "마지막 학습일"

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

  state.rows = state.rows.filter((r) => r.id !== id);
  renumberRows();
  saveState();
  renderPractice();
  renderDashboard();

  try {
    if (row.id) await deleteRowFromSupabase(row.id);
    await syncAllNosToSupabase();
  } catch (e) {
    alert("DB 삭제 실패: " + (e?.message ?? e));
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
  if (v === "O") return "O";
  if (v === "X") return "X";
  return "△";
}

function renderPractice() {
  const body = $("#practiceBody");
  if (!body) return;

  body.innerHTML = "";
  renumberRows();

  for (const row of state.rows) {
    const tr = document.createElement("tr");

    // no
    const tdNo = document.createElement("td");
    tdNo.className = "td-no";
    tdNo.textContent = String(row.no ?? "");
    tr.appendChild(tdNo);

    // ko
    const tdKo = document.createElement("td");
    tdKo.className = "td-ko";
    const ko = document.createElement("textarea");
    ko.className = "cell-input";
    ko.rows = 1;
    ko.placeholder = "한글 문장을 입력하세요";
    ko.value = row.ko || "";
    ko.addEventListener("input", () => updateRow(row.id, { ko: ko.value }));
    tdKo.appendChild(ko);
    tr.appendChild(tdKo);

    // result (chips in a row)
    const tdRes = document.createElement("td");
    tdRes.className = "td-result";

    const chipRow = document.createElement("div");
    chipRow.className = "chip-row";

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

    chipRow.append(btnO, btnX, btnT);
    tdRes.appendChild(chipRow);
    tr.appendChild(tdRes);

    // last5
   const tdHist = document.createElement("td");
   tdHist.className = "td-history";

    const hist = (row.history || []).join(" "); // 이미 ㅇ/x/△로 저장되어 있으니 그대로 출력
    tdHist.textContent = hist || "-";

    tr.appendChild(tdHist);

    // count
    const tdCount = document.createElement("td");
    tdCount.className = "td-count";

    const countVal = document.createElement("span");
    countVal.className = "td-value";
    countVal.textContent = String(row.count ?? 0);

    tdCount.appendChild(countVal);
    tr.appendChild(tdCount);

    // day
    const tdDay = document.createElement("td");
    tdDay.className = "td-day";

    const dayVal = document.createElement("span");
    dayVal.className = "td-value";
    dayVal.textContent = row.reviewDay || "-";

    tdDay.appendChild(dayVal);
    tr.appendChild(tdDay);

    // del
    const tdDel = document.createElement("td");
    tdDel.className = "td-del";
    const del = document.createElement("button");
    del.className = "btn-danger";
    del.type = "button";
    del.textContent = "삭제";
    del.addEventListener("click", async () => deleteRow(row.id));
    tdDel.appendChild(del);
    tr.appendChild(tdDel);

    // en (2nd row area)
    const tdEn = document.createElement("td");
    tdEn.className = "td-en";
    const wrap = document.createElement("div");
    wrap.className = "english-wrap";

    const en = document.createElement("textarea");
    en.className = "cell-input";
    en.rows = 1;
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

    body.appendChild(tr);
  }
}

function bindPractice() {
  $("#addRow")?.addEventListener("click", async () => {
    await addRow();
  });

  $("#gotoDashboard")?.addEventListener("click", () => {
    showPage("dashboard");
    renderDashboard();
  });
}

/* -----------------------
   Import / Export
------------------------ */
function bindImportExport() {
  $("#btnExport")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `engapp-data-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#fileImport")?.addEventListener("change", async (e) => {
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
   Auth UI
------------------------ */
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
  await refreshAuthUI();

  const user = await getAuthedUser();
  if (!user) return;

  const rows = await loadRowsFromSupabase();
  if (rows) {
    state.rows = rows;
    renumberRows();
    saveState();
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
  await initFromSession();
}

async function handleLogout() {
  await supa.auth.signOut();
  await refreshAuthUI();
}

document.addEventListener("DOMContentLoaded", () => {
  showPage("dashboard");

  bindDashboard();
  bindPractice();
  bindImportExport();

  renderDashboard();
  renderPractice();

  document.querySelector("#btnLogin")?.addEventListener("click", handleLogin);
  document.querySelector("#btnLogout")?.addEventListener("click", handleLogout);

  supa.auth.onAuthStateChange(() => {
    initFromSession();
  });

  initFromSession();
});






