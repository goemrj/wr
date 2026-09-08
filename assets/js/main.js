// 앱 셸 — 사용자 선택 → 홈(부서 전체) → 작성

import { h, clear, toast, debounce, today, weekMeta, metaFromId, shiftWeeks } from './util.js?v=20260904143923';
import { emptyReport, carryRepeatPlan, seedPlan, compact, isEmptyReport, DEFAULT_MEMBERS } from './model.js?v=20260904143923';
import { store, cfg } from './store.js?v=20260904143923';
import { renderDoc, applyColW } from './form.js?v=20260904143923';
import { renderCounts, renderPeople } from './counts.js?v=20260904143923';
import { renderHome } from './home.js?v=20260904143923';
import { renderArchive } from './archive.js?v=20260904143923';
import { renderStats } from './stats.js?v=20260904143923';
import { renderSettings } from './settings.js?v=20260904143923';

export const app = {
  members: DEFAULT_MEMBERS,
  me: '',            // 내가 누구인지 (브라우저에 기억)
  slug: '',
  report: null,
  dirty: false,
  submitted: false,
  savedAt: null,
  savedKind: 'auto',   // 'auto' = 자동 저장, 'draft' = 임시저장 버튼
  view: 'home',
  busy: false,
  index: [],
};

const $ = (id) => document.getElementById(id);

export function member(slug = app.slug) {
  return app.members.find((m) => m.slug === slug) || app.members[0] || { name: '', slug: '' };
}

/** 내 신원. 남의 보고서를 열어봐도 이 값은 바뀌지 않는다. */
export function me() {
  return app.members.find((m) => m.slug === app.me) || app.members[0] || { name: '', slug: '' };
}

const short = (iso) => {
  const p = String(iso).split('-');
  return p.length === 3 ? `${+p[1]}/${+p[2]}` : iso;
};

// ── 상단 바 ───────────────────────────────────────────────────

/** 화면에 따라 상단 바 구성요소를 켜고 끈다 */
function paintChrome() {
  const isWrite = app.view === 'write';

  $('saved').style.display = isWrite ? '' : 'none';
  $('btn-submit').style.display = isWrite ? '' : 'none';
  $('btn-draft').style.display = isWrite ? '' : 'none';
  $('viewbar').style.display = isWrite ? '' : 'none';

  $('whoami-name').textContent = me().name || '사용자 선택';
  document.querySelectorAll('.linkbtn[data-view]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === app.view));
}

function paintStatus() {
  const saved = $('saved');
  const text = $('saved-text');
  if (app.busy) {
    saved.className = 'saved is-busy'; text.textContent = '제출 중…';
  } else if (app.dirty) {
    saved.className = 'saved is-dirty'; text.textContent = '저장 안 된 변경사항';
  } else if (app.savedAt) {
    saved.className = 'saved';
    const at = new Date(app.savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    text.textContent = `${app.savedKind === 'draft' ? '임시저장됨' : '자동 저장됨'} · ${at}`;
  } else {
    saved.className = 'saved'; text.textContent = '변경사항 없음';
  }

  const chip = $('chip-status');
  const done = app.submitted && !app.dirty;
  chip.className = `chip${done ? ' is-done' : ''}`;
  $('chip-text').textContent = done ? '제출 완료' : '작성 중';
  $('btn-submit').textContent = done ? '제출 완료' : '제출';
}

function paintViewbar() {
  const rep = app.report;
  if (!rep) return;
  const weekSel = $('sel-week');

  // 실제로 작성된 주차 + 이번 주 + 지금 열어둔 주차만 목록에 올린다.
  // 빈 과거 주차를 늘어놓아 봐야 고를 일이 없다 — 그 주차는 옆 달력으로 간다.
  const written = new Set(app.index.filter((r) => r.slug === app.slug).map((r) => r.id));
  const ids = new Set([...written, weekMeta(today()).id, rep.id]);
  const opts = [...ids].map(metaFromId).filter(Boolean)
    .sort((a, b) => (a.friday < b.friday ? 1 : -1));

  clear(weekSel);
  for (const m of opts) {
    weekSel.append(h('option', { value: m.id, selected: m.id === rep.id },
      `${m.year}년 ${m.label} (${short(m.weekStart)} ~ ${short(m.friday)})${written.has(m.id) ? ' · 작성됨' : ''}`));
  }

  $('sel-date').value = rep.writtenOn;

  const authorSel = $('sel-author');
  clear(authorSel);
  for (const m of app.members) {
    authorSel.append(h('option', { value: m.slug, selected: m.slug === app.slug }, m.name));
  }

  const m = metaFromId(rep.id);
  $('week-range').textContent = m ? `${short(m.weekStart)} ~ ${short(m.friday)}` : '';
}

// ── 화면 전환 ─────────────────────────────────────────────────

export async function go(view) {
  app.view = view;
  paintChrome();

  const el = clear($('view'));
  if (view === 'home') el.append(renderHome());
  else if (view === 'write') el.append(writeView());
  else if (view === 'archive') el.append(await renderArchive());
  else if (view === 'stats') el.append(await renderStats());
  else if (view === 'settings') el.append(renderSettings());

  if (view === 'write') { paintStatus(); paintViewbar(); }
  window.scrollTo(0, 0);
}

// ── 보고서 열기 ───────────────────────────────────────────────

/**
 * 그 주차보다 앞선 것 중 가장 최근에 쓴 보고서.
 * 제출한 것뿐 아니라 아직 초안뿐인 주차도 본다 — '매주'만 체크하고 제출은
 * 안 한 경우에도 다음 주로 넘어와야 하기 때문이다.
 */
async function latestBefore(slug, meta) {
  // 색인이 아직 안 왔으면 여기서 한 번 더 시도한다 — 없으면 넘겨줄 게 없다
  if (!app.index.length) await refreshIndex();

  const ids = new Set([
    ...app.index.filter((r) => r.slug === slug).map((r) => r.id),
    ...store.draftIndex().filter((r) => r.slug === slug).map((r) => r.id),
  ]);
  const prior = [...ids]
    .map((id) => ({ id, meta: metaFromId(id) }))
    .filter((r) => r.meta && r.meta.friday < meta.friday)
    .sort((a, b) => (a.meta.friday < b.meta.friday ? 1 : -1));

  for (const p of prior) {
    let rep = null;
    try { rep = await store.load(slug, p.id); } catch { /* 무시하고 다음 후보로 */ }
    const draft = store.loadDraft(slug, p.id);
    if (draft && (!rep || draft.updatedAt > rep.updatedAt)) rep = draft;
    if (rep) return rep;
  }
  return null;
}

const normTitle = (s) => String(s || '').trim();

/**
 * 지난 보고서의 '매주' 항목 중 이번 주에 없는 것을 채워 넣는다.
 * 새로 만든 주차뿐 아니라 이미 쓰고 있던 주차에도 넣어야 한다 —
 * 그러지 않으면 먼저 열어둔 다음 주 보고서에는 영영 안 나타난다.
 *
 * 지나간 주차만 건드리지 않는다. 제출 여부로 가르지 않는 이유는,
 * 한 번 제출한 뒤에도 그 주 보고서는 계속 고쳐 쓰기 때문이다.
 */
function mergeRepeatPlan(rep, prev, meta) {
  if (!prev) return 0;
  if (meta.friday < weekMeta(today()).friday) return 0;
  const haveTitle = new Set(rep.plan.map((p) => normTitle(p.title)));
  const haveTpl = new Set(rep.plan.map((p) => p.tpl).filter(Boolean));
  const add = carryRepeatPlan(prev, meta)
    .filter((p) => !haveTitle.has(normTitle(p.title)) && !(p.tpl && haveTpl.has(p.tpl)));
  rep.plan.push(...add);
  return add.length;
}

export async function openWeek(id, { slug = app.slug, force = false, asMe = false } = {}) {
  if (!force && app.dirty && !confirm('저장하지 않은 변경사항이 있습니다. 그대로 이동할까요?')) {
    paintViewbar();
    return false;
  }

  const meta = metaFromId(id) || weekMeta(today());
  let rep = null;
  try { rep = await store.load(slug, meta.id); } catch (e) { toast(e.message, 'err'); }
  app.submitted = Boolean(rep?.submittedAt);

  const draft = store.loadDraft(slug, meta.id);
  if (draft && (!rep || draft.updatedAt > rep.updatedAt)) {
    if (!rep || confirm('저장하지 않은 작성 중인 내용이 있습니다. 이어서 작성할까요?')) rep = draft;
  }

  // '매주' 체크해둔 차주 예정업무는 주차를 열 때마다 알아서 따라온다
  const prev = await latestBefore(slug, meta);

  if (!rep) {
    rep = emptyReport(member(slug).name, meta.friday);
    rep.plan = prev ? carryRepeatPlan(prev, meta) : seedPlan(meta.friday, slug);
    app.submitted = false;
  } else if (mergeRepeatPlan(rep, prev, meta)) {
    toast('지난 보고서의 \'매주\' 항목을 차주 예정업무에 채웠습니다.');
  }

  rep.author = member(slug).name;
  app.report = rep;
  app.slug = slug;
  // 홈에서 이름을 골라 들어온 경우엔 그 사람이 곧 '나'가 된다
  if (asMe) { app.me = slug; cfg.write({ me: slug }); }
  app.dirty = false;
  app.savedAt = null;
  await go('write');
  return true;
}

// ── 작성 화면 ─────────────────────────────────────────────────

function markDirty() {
  app.dirty = true;
  paintStatus();
  queueDraft();
}

/** 변경 후 600ms 디바운스로 자동 저장 (브라우저 임시 보관) */
const queueDraft = debounce(() => {
  if (!app.report) return;
  store.saveDraft(app.slug, app.report);
  app.savedAt = Date.now();
  app.savedKind = 'auto';
  app.dirty = false;
  paintStatus();
}, 600);

function writeView() {
  const wrap = h('div.workspace');
  const rep = app.report;
  if (!rep) { wrap.append(h('div.panel', '불러오는 중…')); return wrap; }

  const docWrap = h('div', { style: { minWidth: '0', display: 'flex', flexDirection: 'column', gap: '20px' } });
  const mount = () => {
    clear(docWrap);
    docWrap.append(renderDoc(app.report, { onChange: markDirty }));
    docWrap.append(actionsRow());
  };
  mount();

  const side = h('aside.side-col');
  side.append(renderCounts(rep, { onChange: markDirty }));
  side.append(renderPeople(app.members, {
    weekLabel: `${rep.year}년 ${rep.label}`,
    current: app.slug,
    statusOf: (slug) => weekStatus(slug, rep.id),
    // 남의 보고서를 보러 갈 뿐이므로 '내가 누구인지'는 그대로 둔다
    onPick: (m) => openWeek(rep.id, { slug: m.slug }),
  }));

  wrap.append(docWrap, side);

  document.removeEventListener('wwr:rerender', document._wwrRerender || (() => {}));
  document._wwrRerender = mount;
  document.addEventListener('wwr:rerender', mount);

  requestAnimationFrame(applyColW);
  return wrap;
}

function actionsRow() {
  return h('div.actions',
    h('span.note', '입력 내용은 주차·작성자별로 자동 저장됩니다. 표 머리글의 열 경계를 끌면 열 너비를 조절할 수 있습니다 (두 번 누르면 기본값).'),
    h('span.grow'),
    h('button.btn', { type: 'button', onclick: doDraftSave }, '임시저장'),
    h('button.btn-primary', { type: 'button', onclick: doSubmit }, '제출'),
  );
}

/**
 * 그 사람의 그 주차 보고서 상태. 옆 명단에 표시하려고 서버에서 읽는다.
 * 홈 화면과 같은 기준을 쓴다 — 내용을 다 지운 보고서는 안 쓴 것으로 본다.
 */
async function weekStatus(slug, id) {
  let rep = null;
  try { rep = await store.load(slug, id); } catch { return { label: '확인 실패', cls: '' }; }
  if (!rep) rep = store.loadDraft(slug, id);
  if (!rep || isEmptyReport(rep)) return { label: '미작성', cls: '' };
  return rep.submittedAt
    ? { label: '제출 완료', cls: 'is-done' }
    : { label: '작성 중', cls: 'is-draft' };
}

// ── 동작 ──────────────────────────────────────────────────────

/**
 * 임시저장 — 지금 이 순간의 내용을 이 브라우저에 바로 붙잡아 둔다.
 * 자동 저장은 0.6초 디바운스라 마지막 타이핑이 아직 안 들어갔을 수 있어,
 * 대기 중인 자동 저장을 기다리지 않고 즉시 쓴다.
 * 저장소에는 올라가지 않는다 — 그건 '제출'이 한다.
 */
async function doDraftSave() {
  if (!app.report || app.busy) return;
  app.busy = true; paintStatus();
  try {
    // 임시저장은 '아직 제출 안 한 상태'로 웹서버에 올린다.
    // 제출을 눌렀다가 다시 임시저장하면 '작성 중'으로 되돌아온다.
    app.report.submittedAt = null;
    const res = await store.save(app.report, app.slug);
    store.saveDraft(app.slug, app.report);   // 서버가 막혀도 내용은 남는다
    app.submitted = false;
    app.dirty = false;
    app.savedAt = Date.now();
    app.savedKind = 'draft';
    await refreshIndex();
    if (res.mode === 'server') {
      toast('임시저장했습니다. 부서원에게는 ‘작성 중’으로 보입니다.', 'ok');
    } else {
      toast(`${res.reason} 이 브라우저에는 저장돼 있습니다.`, 'err');
    }
    await go('write');
  } finally {
    app.busy = false; paintStatus();
  }
}

export async function doSubmit() {
  if (!app.report || app.busy) return;

  // 내용을 다 지운 채로 제출하면 '제출된 빈 보고서'가 남는 게 아니라 아예 지운다.
  // 그래야 홈에서 다시 '미작성'으로 돌아간다.
  if (isEmptyReport(app.report)) return doSubmitEmpty();

  app.busy = true; paintStatus();
  try {
    compact(app.report);
    app.report.submittedAt = new Date().toISOString();
    const res = await store.save(app.report, app.slug);
    store.clearDraft(app.slug, app.report.id);
    app.dirty = false;
    app.submitted = true;
    app.savedAt = Date.now();
    await refreshIndex();
    if (res.mode === 'server') {
      toast('보고서를 제출했습니다. 부서원 모두가 볼 수 있습니다.', 'ok');
    } else {
      // 내용은 브라우저에 남아 있다. 서버가 열리면 다시 제출하면 올라간다.
      toast(`${res.reason} 이 브라우저에는 저장돼 있으니 서버가 열린 뒤 다시 제출해주세요.`, 'err');
    }
    await go('write');
  } catch (e) {
    toast(`제출 실패 — ${e.message}`, 'err');
  } finally {
    app.busy = false; paintStatus();
  }
}

/** 내용이 하나도 없는 보고서를 제출한 경우 — 저장본을 지워 '미작성'으로 되돌린다 */
async function doSubmitEmpty() {
  const m = metaFromId(app.report.id);
  const week = m ? `${m.year}년 ${m.label}` : '이 주차';
  if (!confirm(`${week} 보고서에 내용이 없습니다.\n제출하면 저장된 보고서를 지우고 '미작성' 상태로 되돌립니다. 계속할까요?`)) return;

  app.busy = true; paintStatus();
  try {
    const res = await store.remove(app.slug, app.report.id);
    store.clearDraft(app.slug, app.report.id);
    app.report.submittedAt = null;
    app.submitted = false;
    app.dirty = false;
    app.savedAt = null;
    await refreshIndex();
    if (res.mode === 'server') {
      toast('보고서를 지웠습니다. 홈에서 미작성으로 표시됩니다.', 'ok');
    } else {
      // 이 브라우저에서는 지워졌다. 서버에 남은 파일만 손대지 못한 상황이다.
      toast(`이 브라우저에서는 지웠습니다. ${res.reason}`, 'err');
    }
    await go('write');
  } finally {
    app.busy = false; paintStatus();
  }
}


export async function refreshIndex() {
  try { app.index = await store.index(); } catch { app.index = store.localIndex(); }
}

// ── 시작 ──────────────────────────────────────────────────────

async function boot() {
  $('btn-submit').addEventListener('click', doSubmit);
  $('btn-draft').addEventListener('click', doDraftSave);
  $('btn-thisweek').addEventListener('click', () => openWeek(weekMeta(today()).id));
  $('sel-week').addEventListener('change', (e) => openWeek(e.target.value));
  // 달력에서 아무 날짜나 고르면 그 날이 속한 주의 보고서로 간다 (앞뒤 주 제한 없음)
  $('sel-date').addEventListener('change', (e) => {
    if (e.target.value) openWeek(weekMeta(e.target.value).id);
  });
  // 한 주씩 앞뒤로 — ▶ 로 다음 주 보고서를 미리 열어 쓸 수 있다
  const stepWeek = (n) => {
    if (!app.report) return;
    openWeek(weekMeta(shiftWeeks(app.report.writtenOn, n)).id);
  };
  $('btn-prev-week').addEventListener('click', () => stepWeek(-1));
  $('btn-next-week').addEventListener('click', () => stepWeek(1));
  $('sel-author').addEventListener('change', (e) => openWeek(app.report.id, { slug: e.target.value }));
  $('whoami').addEventListener('click', () => go('home'));
  $('btn-logo').addEventListener('click', () => go('home'));

  // Ctrl+S 로 임시저장. 브라우저의 '페이지 저장' 창이 뜨지 않게 가로챈다.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 's' && e.key !== 'S') return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (app.view !== 'write' || !app.report) return;   // 작성 화면에서만 가로챈다
    e.preventDefault();
    doDraftSave();
  });

  document.querySelectorAll('.linkbtn[data-view]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.view;
      // 작성은 보고서를 먼저 불러와야 한다
      if (v === 'write' && !app.report) return openWeek(weekMeta(today()).id);
      go(v);
    });
  });

  window.addEventListener('beforeunload', (e) => {
    if (app.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && app.view === 'write') {
      e.preventDefault(); doSubmit();
    }
  });

  applyColW();

  try { app.members = await store.loadMembers(); } catch { app.members = DEFAULT_MEMBERS; }
  if (!app.members.length) app.members = DEFAULT_MEMBERS;

  await refreshIndex();

  // 사용자 선택은 홈 화면에서 한다 — 시작할 때 따로 묻지 않는다
  const saved = cfg.read().me;
  app.me = app.members.some((m) => m.slug === saved) ? saved : app.members[0].slug;
  app.slug = app.me;
  await go('home');
}

boot();
