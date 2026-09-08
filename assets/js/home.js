// 홈 — 부서 전체 한 주 현황. 이름 박스를 누르는 것이 곧 사용자 선택이다.

import { h, clear, today, weekMeta, metaFromId, shiftWeeks } from './util.js?v=20260904143923';
import { summarize, isEmptyReport } from './model.js?v=20260904143923';
import { store } from './store.js?v=20260904143923';
import { renderDoc } from './form.js?v=20260904143923';
import { app, openWeek } from './main.js?v=20260904143923';

const short = (iso) => {
  const p = String(iso).split('-');
  return p.length === 3 ? `${+p[1]}/${+p[2]}` : iso;
};

// ── 홈 (부서 전체) ────────────────────────────────────────────

export function renderHome() {
  const wrap = h('div.home');
  let cursor = app.report ? (metaFromId(app.report.id) || weekMeta(today())) : weekMeta(today());

  const title = h('h2', '');
  const range = h('span.home-range', '');
  const prev = h('button.btn', { type: 'button', title: '이전 주' }, '◀');
  const next = h('button.btn', { type: 'button', title: '다음 주' }, '▶');
  const mine = h('button.btn-primary', { type: 'button' }, '내 보고서 작성');

  const head = h('div.home-head',
    h('div.home-week', prev, h('div', title, range), next),
    h('span.grow'),
    mine,
  );
  wrap.append(head);

  const body = h('div.home-list');
  wrap.append(body);

  prev.addEventListener('click', () => { cursor = weekMeta(shiftWeeks(cursor.friday, -1)); load(); });
  next.addEventListener('click', () => { cursor = weekMeta(shiftWeeks(cursor.friday, 1)); load(); });
  mine.addEventListener('click', () => openWeek(cursor.id, { slug: app.me }));

  async function load() {
    title.textContent = `${cursor.year}년 ${cursor.label}`;
    range.textContent = `${short(cursor.weekStart)} ~ ${short(cursor.friday)}`;
    clear(body).append(h('p.home-loading', '불러오는 중…'));

    const rows = await Promise.all(app.members.map(async (m) => {
      let rep = null, failed = false;
      try { rep = await store.load(m.slug, cursor.id); } catch { failed = true; }
      const draft = store.loadDraft(m.slug, cursor.id);
      if (!rep && draft) rep = draft;
      // 내용을 다 지운 보고서는 안 쓴 것과 같다
      const state = (!rep || isEmptyReport(rep)) ? (failed ? 'error' : 'none')
        : (rep.submittedAt ? 'done' : 'draft');
      // 서버와 어긋나 있으면 — 여기서 보는 모습과 남이 보는 모습이 다르다
      const sync = await store.syncState(m.slug, cursor.id);
      // 빈 보고서는 카드에서도 없는 것으로 다룬다
      return { m, rep: state === 'none' ? null : rep, state, sync };
    }));

    clear(body);
    for (const { m, rep, state, sync } of rows) {
      body.append(memberCard(m, rep, state, cursor, sync));
    }
  }

  load();
  return wrap;
}

const STATE = {
  done:  { label: '제출 완료', cls: 'is-done' },
  draft: { label: '작성 중',   cls: 'is-draft' },
  none:  { label: '미작성',    cls: 'is-none' },
  error: { label: '불러오기 실패', cls: 'is-none' },
};

/* 서버에 아직 반영되지 않아 남의 자리에서는 다르게 보이는 상태.
   웹서버 쓰기가 열리면 다시 제출·삭제하는 것으로 풀린다. */
const SYNC = {
  local:   '⚠ 이 브라우저에만 — 다른 자리에서는 안 보입니다',
  pending: '⚠ 여기서만 지웠습니다 — 다른 자리에는 아직 남아 있습니다',
};

function memberCard(m, rep, state, cursor, sync = 'ok') {
  const st = STATE[state];
  const card = h('section.mcard', { class: st.cls });

  const badge = h('span.mstate', { class: st.cls }, h('span.mdot'), st.label);
  const headBits = [h('span.mname', m.name), badge, h('span.grow')];

  // 서버에 반영되지 않은 상태는 감추지 않는다 — 남의 자리에서는 다르게 보인다
  if (sync !== 'ok') headBits.push(h('span.msync', SYNC[sync]));

  if (rep) {
    const s = summarize(rep);
    headBits.push(h('span.mstat',
      `업무 ${s.items}건 · 완료 ${s.done}건 · 지원 ${s.support}건 · 차주 ${s.plan}건`));
  } else {
    headBits.push(h('span.mstat.is-muted', '이 주차에 작성된 보고서가 없습니다.'));
  }

  const open = rep ? h('button.linkbtn.mopen', { type: 'button' }, '자세히') : null;
  if (open) headBits.push(open);

  // 박스를 누르면 그 사람의 그 주 보고서 작성화면으로 간다
  const headEl = h('button.mcard-head', {
    type: 'button', title: `${m.name} 보고서 열기`,
    onclick: () => openWeek(cursor.id, { slug: m.slug, asMe: true }),
  }, ...headBits);
  card.append(headEl);

  if (rep) {
    const detail = h('div.mcard-body', { style: { display: 'none' } });
    let built = false;
    open.addEventListener('click', (e) => {
      e.stopPropagation();          // 카드 클릭(작성화면 이동)과 겹치지 않게
      const isOpen = detail.style.display !== 'none';
      detail.style.display = isOpen ? 'none' : 'block';
      open.textContent = isOpen ? '자세히' : '접기';
      if (!built) { detail.append(renderDoc(rep, { readOnly: true })); built = true; }
    });
    card.append(detail);
  }
  return card;
}
