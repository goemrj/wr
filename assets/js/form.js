// 보고서 문서 렌더러 (design_handoff_weekly_report 기준)
//
//  - 표는 <table>이 아니라 CSS grid 행이다. 업무내용 열이 minmax(0,1fr)로
//    남는 폭을 흡수하므로 화면이 좁아져도 가로 스크롤이 생기지 않는다.
//  - 각 표는 마지막에 항상 빈 행 1개를 유지하고, 거기에 입력하면 아래에 새 빈 행이 생긴다.
//  - 내용이 없는 섹션은 접힌 채로 시작한다.
//  - 열 너비는 헤더 경계를 끌어 조절한다. 업무내용에 최소 폭을 남겨 넘치지 않게 잡아둔다.

import { h, autoGrow, weekMeta } from './util.js?v=20260904143923';
import { SECTION_DEFS, emptyItem, hasContent, expandTokens } from './model.js?v=20260904143923';

/** 표 구성별 헤더. v는 열 너비 변수(--c-*) 종류. */
const HEADERS = {
  work: [
    { id: 'no',    label: 'No',                         v: 'no',   center: true },
    { id: 'body',  label: '업무내용'                    , v: null },
    { id: 'start', label: '업무발생일',                   v: 'start' },
    { id: 'due',   label: '완료예정일',                   v: 'due' },
    { id: 'pct',   label: '진행율',                      v: 'pct' },
    { id: 'done',  label: '완료',                        v: 'chk',  center: true },
    { id: 'note',  label: '비고',                        v: 'note' },
    { id: 'del',   label: '',                           v: 'del' },
  ],
  plan: [
    { id: 'no',    label: 'No',        v: 'no', center: true },
    { id: 'body',  label: '업무내용',   v: null },
    { id: 'start', label: '업무발생일', v: 'start' },
    { id: 'due',   label: '완료예정일', v: 'due' },
    { id: 'pct',   label: '목표진행율', v: 'pct' },
    { id: 'rep',   label: '매주',       v: 'chk', center: true },
    { id: 'note',  label: '비고',      v: 'note' },
    { id: 'del',   label: '',          v: 'del' },
  ],
  shared: [
    { id: 'no',     label: 'No',      v: 'no', center: true },
    { id: 'body',   label: '내용',     v: null },
    { id: 'start',  label: '발생일자', v: 'start' },
    { id: 'meet',   label: '회의',     v: 'chk', center: true },
    { id: 'notice', label: '공지',     v: 'chk', center: true },
    { id: 'note',   label: '비고',    v: 'note' },
    { id: 'del',    label: '',        v: 'del' },
  ],
};

/* 열 너비 변수와 최소값 — 조절값은 브라우저에 남는다.
   업무발생일과 완료예정일은 따로 움직여야 해서 변수를 나눠 뒀다. */
const VARS = {
  no: '--c-no', start: '--c-start', due: '--c-due',
  pct: '--c-pct', chk: '--c-chk', note: '--c-note', del: '--c-del',
};
const VAR_MIN = { no: 30, start: 120, due: 120, pct: 76, chk: 40, note: 80, del: 28 };
const COLW_KEY = 'wwr:colw';
const BODY_MIN = 240;   // 업무내용 열에 항상 남겨둘 최소 폭

function loadColW() {
  try { return JSON.parse(localStorage.getItem(COLW_KEY)) || {}; } catch { return {}; }
}
function saveColW(map) {
  try { localStorage.setItem(COLW_KEY, JSON.stringify(map)); } catch { /* noop */ }
}
/* CSS 변수 이름 → 최소 폭. 저장된 값이 최소보다 작으면 끌어올린다. */
const MIN_BY_PROP = Object.fromEntries(
  Object.entries(VARS).map(([k, prop]) => [prop, VAR_MIN[k] || 40])
);

/**
 * 저장해둔 열 너비를 문서 전체에 적용.
 * 예전에 좁게 잡아둔 값이 남아 있으면 날짜가 잘리므로 최소 폭으로 올려준다.
 */
export function applyColW() {
  const map = loadColW();
  let fixed = false;
  for (const [prop, px] of Object.entries(map)) {
    if (!Number.isFinite(px)) continue;
    const min = MIN_BY_PROP[prop] || 40;
    if (px < min) { map[prop] = min; fixed = true; }
    document.documentElement.style.setProperty(prop, `${map[prop]}px`);
  }
  if (fixed) saveColW(map);
}

// ── 문서 ──────────────────────────────────────────────────────

export function renderDoc(report, opts = {}) {
  const ctx = {
    ro: Boolean(opts.readOnly),
    changed: () => { if (opts.onChange) opts.onChange(report); },
  };

  const col = h('div.doc-col');
  col.append(metaCard(report, ctx));

  const seen = new Set();
  for (const def of SECTION_DEFS) {
    if (seen.has(def.key)) continue;
    if (def.group) {
      const group = SECTION_DEFS.filter((d) => d.group === def.group);
      group.forEach((d) => seen.add(d.key));
      col.append(section(report, def.title, group, ctx));
    } else {
      seen.add(def.key);
      col.append(section(report, def.title, [def], ctx));
    }
  }
  return col;
}

function metaCard(report, ctx) {
  const dateEl = ctx.ro
    ? h('span.meta-value', report.writtenOn)
    : h('input.meta-date', {
        type: 'date', value: report.writtenOn,
        onchange: (e) => { if (e.target.value) { report.writtenOn = e.target.value; ctx.changed(); } },
      });

  return h('div.meta-card',
    h('div.meta-cell', h('span.meta-label', '작성일자'), dateEl),
    h('div.meta-cell', h('span.meta-label', '작성자'), h('span.meta-value', report.author || '—')),
    h('div.meta-cell', h('span.meta-label', '보고주차'), h('span.meta-value', `${report.year}년 ${report.label}`)),
  );
}

// ── 섹션 ──────────────────────────────────────────────────────

function section(report, title, defs, ctx) {
  const total = () => defs.reduce((a, d) => a + report[d.key].length, 0);
  const sub = defs.length > 1 ? defs.map((d) => d.sub).join(' · ') : defs[0].sub;

  const chev = h('span.sec-chev', '▾');
  const count = h('span.sec-count', String(total()));
  const head = h('button.sec-head', { type: 'button' },
    chev, h('h2', title), sub ? h('span.sec-sub', sub) : null,
    h('span.grow'), count,
  );
  const body = h('div.sec-body');
  const card = h('section.sec', head, body);

  const refreshCount = () => {
    const n = total();
    count.textContent = String(n);
    count.classList.toggle('is-zero', n === 0);
  };
  refreshCount();

  let built = false;
  let open = total() > 0;
  const paint = () => {
    card.classList.toggle('is-collapsed', !open);
    chev.textContent = open ? '▾' : '▸';
    head.setAttribute('aria-expanded', String(open));
    if (open && !built) {
      built = true;
      body.append(headerRow(defs[0], ctx));
      for (const d of defs) {
        if (defs.length > 1) body.append(h('div.grp', d.sub));
        body.append(rowsFor(report, d, ctx, refreshCount));
      }
    }
  };
  head.addEventListener('click', () => { open = !open; paint(); });
  paint();

  return card;
}

// ── 헤더 행 ───────────────────────────────────────────────────

function headerRow(def, ctx) {
  const row = h('div', { class: `rw rw-head cols-${def.cols}` });
  const spec = HEADERS[def.cols];
  spec.forEach((c, i) => {
    const label = c.id === 'done' ? (def.flagLabel || c.label) : c.label;
    const cell = h('div', { class: c.center ? 'c' : '' }, label);
    if (!ctx.ro && c.v && i < spec.length - 1) {
      const grip = h('span.rz', { title: '끌어서 열 너비 조절 (두 번 누르면 기본값)' });
      grip.addEventListener('mousedown', (e) => startResize(e, c.v, row));
      grip.addEventListener('dblclick', () => {
        const map = loadColW(); delete map[VARS[c.v]]; saveColW(map);
        document.documentElement.style.removeProperty(VARS[c.v]);
      });
      cell.append(grip);
    }
    row.append(cell);
  });
  return row;
}

/**
 * 열 너비 조절.
 * 업무내용 열이 1fr이라 남는 폭을 흡수하지만, 고정 열이 계속 커지면 결국 넘친다.
 * 업무내용에 BODY_MIN 만큼은 항상 남기도록 잡아 가로 스크롤이 생기지 않게 한다.
 */
function startResize(e, varKey, row) {
  e.preventDefault();
  const prop = VARS[varKey];
  const startX = e.clientX;
  const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(prop)) || 100;
  const bodyCell = row.children[1];

  document.body.classList.add('is-resizing');
  const move = (ev) => {
    const delta = ev.clientX - startX;
    const room = bodyCell.getBoundingClientRect().width - BODY_MIN;
    const capped = delta > 0 ? Math.min(delta, Math.max(0, room)) : delta;
    const w = Math.max(VAR_MIN[varKey] || 40, Math.round(startW + capped));
    document.documentElement.style.setProperty(prop, `${w}px`);
  };
  const up = () => {
    document.body.classList.remove('is-resizing');
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    const map = loadColW();
    map[prop] = parseFloat(document.documentElement.style.getPropertyValue(prop));
    saveColW(map);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ── 행 목록 ───────────────────────────────────────────────────

function rowsFor(report, def, ctx, refreshCount) {
  // 드래그로 순서를 바꿀 때 어느 구분의 목록인지 알아야 해서 표시해 둔다
  const holder = h('div.rw-group', { dataset: { key: def.key, cols: def.cols } });
  const list = report[def.key];

  const renumber = () => {
    [...holder.children].forEach((r, i) => {
      const n = r.querySelector('.cell-no');
      if (n) n.textContent = String(i + 1);
    });
    refreshCount();
  };
  holder._renumber = renumber;

  function add(item, isDraft) {
    let draft = isDraft;
    const row = buildRow(report, def, item, ctx, {
      promote: () => {
        if (!draft) return;
        draft = false;
        row.classList.remove('is-draft');
        list.push(item);
        add(emptyItem(), true);
        renumber();
      },
      remove: () => {
        if (draft) return;
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
        row.remove();
        if (!holder.children.length) add(emptyItem(), true);   // 비면 빈 행 하나를 다시
        renumber();
        ctx.changed();
      },
      isDraft: () => draft,
    });
    if (draft) row.classList.add('is-draft');
    row._item = item;              // 드롭 후 DOM 순서대로 목록을 다시 만들 때 쓴다
    row._isDraft = () => draft;
    holder.append(row);
  }

  list.forEach((it) => add(it, false));
  if (!ctx.ro) add(emptyItem(), true);
  renumber();
  return holder;
}

// ── 한 행 ─────────────────────────────────────────────────────

function buildRow(report, def, item, ctx, row) {
  const spec = HEADERS[def.cols];
  // 제목 + 상세 2줄 구조인 섹션만 상단 정렬 여백을 키운다
  const split = def.cols === 'work' && !def.singleBody;
  const el = h('div', { class: `rw rw-body cols-${def.cols}${split ? ' tall' : ''}` });
  // 사용자가 이 행을 건드리면 '앱이 깔아준 행' 표시를 푼다 —
  // 그 순간부터 진짜 내용이라 빈 보고서 판정에 들어간다
  const touch = () => { item.auto = false; if (hasContent(item)) row.promote(); ctx.changed(); };

  // 서로 연동되는 칸들 — 업무발생일 → 완료예정일, 완료 ↔ 진행율
  const ctl = {};
  // 완료예정일이 아직 "따라가는" 상태인가.
  // 비어 있거나 업무발생일과 같으면 따라가고, 사용자가 다른 날짜를 고르면 풀린다.
  let dueFollows = !item.dueDate || item.dueDate === item.startDate;

  for (const c of spec) {
    if (c.id === 'no') { el.append(h('div.cell-no', '')); continue; }

    if (c.id === 'body') {
      const cell = h('div.cell-body');
      if (ctx.ro) {
        cell.append(h('div.ro-title', expandTokens(item.title, weekMeta(report.writtenOn)) || ''));
        if (item.detail) cell.append(h('div.ro-detail', item.detail));
      } else if (split) {
        cell.append(area(item, 'title', touch, '제목 / 룰 코드', 'f-title'));
        cell.append(area(item, 'detail', touch, '상세 내용 · 조건', 'f-detail'));
      } else {
        const ph = def.cols === 'shared' ? '공유·요청 내용' : '업무내용을 입력하세요';
        cell.append(area(item, 'title', touch, ph, 'f-task'));
      }
      if (!ctx.ro && item.carried) cell.append(h("span.badge", "이월"));
      if (!ctx.ro) typeAnywhere(cell);
      el.append(cell);
      continue;
    }

    if (c.id === 'start' || c.id === 'due') {
      const key = c.id === 'start' ? 'startDate' : 'dueDate';
      const cell = h('div.cell-pad');
      if (ctx.ro) {
        cell.append(h('div.ro-plain', item[key] || ''));
      } else {
        const input = h('input.f-date', { type: 'date', value: item[key] || '' });
        ctl[c.id] = input;
        const write = () => {
          item[key] = input.value;
          if (c.id === 'start') {
            // 완료예정일이 아직 비었거나 업무발생일을 따라가는 중이면 같이 옮긴다
            if (dueFollows && ctl.due) { item.dueDate = input.value; ctl.due.value = input.value; }
          } else {
            dueFollows = !input.value || input.value === item.startDate;
          }
          touch();
        };
        input.addEventListener('change', write);
        input.addEventListener('input', write);
        cell.append(input);
      }
      el.append(cell);
      continue;
    }

    if (c.id === 'pct') {
      const cell = h('div.cell-pct');
      if (ctx.ro) {
        cell.append(h('div.ro-plain', `${clamp(item.progress)}%`));
      } else {
        const input = h('input.f-pct', { type: 'number', min: '0', max: '100', step: '5', value: String(clamp(item.progress)) });
        ctl.pct = input;
        input.addEventListener('input', () => {
          item.progress = clamp(input.value);
          // 100%가 되면 완료도 같이 체크 (되돌리면 풀린다)
          if (ctl.done) { item.done = item.progress >= 100; ctl.done.checked = item.done; }
          touch();
        });
        input.addEventListener('focus', () => input.select());
        cell.append(h('div.pct-row', input, h('span.pct-sign', '%')));
      }
      el.append(cell);
      continue;
    }

    if (c.v === 'chk') {
      const key = { done: 'done', rep: 'repeat', meet: 'meeting', notice: 'notice' }[c.id];
      const cell = h('div.cell-chk');
      if (ctx.ro) {
        cell.append(h('span', { style: { color: 'var(--bit-blue-600)', fontWeight: '700' } }, item[key] ? '✓' : ''));
      } else {
        const box = h('input.f-chk', { type: 'checkbox', checked: Boolean(item[key]) });
        if (c.id === 'done') ctl.done = box;
        box.addEventListener('change', () => {
          item[key] = box.checked;
          if (c.id === 'done' && ctl.pct) {
            // 완료를 켜면 100%, 끄면 100%였던 것만 0으로 되돌린다
            if (box.checked) item.progress = 100;
            else if (clamp(item.progress) >= 100) item.progress = 0;
            ctl.pct.value = String(clamp(item.progress));
          }
          touch();
        });
        cell.append(box);
      }
      el.append(cell);
      continue;
    }

    if (c.id === 'note') {
      const cell = h('div.cell-pad');
      cell.append(ctx.ro ? h('div.ro-detail', item.note || '') : area(item, 'note', touch, '', 'f-note'));
      if (!ctx.ro) typeAnywhere(cell);
      el.append(cell);
      continue;
    }

    if (c.id === 'del') {
      const cell = h('div.cell-del');
      if (!ctx.ro) {
        const grip = h('button.f-drag', {
          type: 'button', 'aria-label': '끌어서 순서 변경',
          title: '끌어서 순서 변경 (다른 구분으로도 옮길 수 있습니다)',
        }, '⇅');
        grip.addEventListener('mousedown', (e) => startRowDrag(e, el, report, ctx));
        grip.addEventListener('click', (e) => e.preventDefault());
        cell.append(grip);
        cell.append(h('button.f-del', { type: 'button', 'aria-label': '행 삭제', onclick: () => row.remove() }, '×'));
      }
      el.append(cell);
      continue;
    }
  }
  return el;
}

/**
 * 행 끌어 옮기기.
 * 손잡이를 누른 채 움직이면 반투명 사본이 커서를 따라오고, 원래 행이 놓일 자리로 미리 옮겨진다.
 * 같은 구분 안에서는 순서가 바뀌고, 표 구성이 같은 다른 구분(업무 섹션끼리) 위에 놓으면 그쪽으로 옮겨간다.
 */
function startRowDrag(e, rowEl, report, ctx) {
  if (e.button !== 0) return;
  if (rowEl._isDraft && rowEl._isDraft()) return;   // 마지막 빈 줄은 옮길 게 없다
  e.preventDefault();

  const fromHolder = rowEl.parentElement;
  const cols = fromHolder?.dataset.cols;
  if (!cols) return;

  const startY = e.clientY;
  let ghost = null;
  let offsetY = 0;
  let lockedLeft = 0, hitX = 0;   // 좌우로는 움직이지 않는다 — 표 안에서 위아래로만

  const begin = () => {
    const box = rowEl.getBoundingClientRect();
    offsetY = startY - box.top;
    lockedLeft = box.left;
    hitX = box.left + box.width / 2;   // 놓을 자리 판정도 행의 가로 중앙 기준으로
    ghost = rowEl.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${box.width}px`;
    ghost.style.left = `${lockedLeft}px`;
    document.body.append(ghost);
    rowEl.classList.add('is-dragging');
    document.body.classList.add('is-dragging-row');
  };

  const place = (y) => {
    ghost.style.top = `${y - offsetY}px`;   // left는 고정

    // 커서 높이에서 같은 표 구성의 목록을 찾는다
    ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(hitX, y);
    ghost.style.visibility = '';
    if (!under) return;

    const holder = under.closest?.('.rw-group');
    if (!holder || holder.dataset.cols !== cols) return;

    const rows = [...holder.children].filter((r) => r !== rowEl && !(r._isDraft && r._isDraft()));
    let before = null;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) { before = r; break; }
    }
    if (before) holder.insertBefore(rowEl, before);
    else {
      // 빈 줄은 항상 맨 아래에 둔다
      const draft = [...holder.children].find((r) => r._isDraft && r._isDraft());
      if (draft) holder.insertBefore(rowEl, draft); else holder.append(rowEl);
    }
  };

  const move = (ev) => {
    if (!ghost) {
      if (Math.abs(ev.clientY - startY) < 3) return;   // 세로로 움직여야 시작
      begin();
    }
    place(ev.clientY);

    // 화면 끝에 닿으면 따라 스크롤
    const edge = 80;
    if (ev.clientY < edge) window.scrollBy(0, -12);
    else if (ev.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
  };

  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    if (!ghost) return;                       // 그냥 클릭이었다

    ghost.remove();
    rowEl.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-row');

    const toHolder = rowEl.parentElement;
    const moved = toHolder !== fromHolder;

    // DOM 순서 그대로 목록을 다시 만든다
    for (const holder of new Set([fromHolder, toHolder])) {
      if (!holder?.dataset.key) continue;
      report[holder.dataset.key] = [...holder.children]
        .filter((r) => !(r._isDraft && r._isDraft()))
        .map((r) => r._item)
        .filter(Boolean);
      holder._renumber?.();
    }
    ctx.changed();

    // 구분이 바뀌었으면 행에 묶인 동작(삭제·승격)도 새 구분 기준으로 다시 만들어야 한다
    if (moved) document.dispatchEvent(new CustomEvent('wwr:rerender'));
  };

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));

/**
 * 엑셀처럼 — 셀 안 아무 데나 눌러도 입력창이 잡히게 한다.
 * 입력창은 내용만큼만 높이를 갖는데 행은 가장 긴 칸에 맞춰 늘어나므로,
 * 그냥 두면 셀 아래쪽 빈 공간을 눌렀을 때 아무 일도 일어나지 않는다.
 */
function typeAnywhere(cell) {
  cell.classList.add('is-typable');
  cell.addEventListener('mousedown', (e) => {
    const fields = [...cell.querySelectorAll('textarea, input')];
    if (!fields.length || fields.includes(e.target)) return;

    // 누른 지점에서 세로로 가장 가까운 입력창 (아래 빈 공간이면 마지막 것)
    let target = fields[fields.length - 1];
    for (const f of fields) {
      if (e.clientY <= f.getBoundingClientRect().bottom) { target = f; break; }
    }

    e.preventDefault();          // 포커스가 셀로 새지 않게
    target.focus();
    if (typeof target.value === 'string' && target.setSelectionRange) {
      const n = target.value.length;
      try { target.setSelectionRange(n, n); } catch { /* date 등은 지원 안 함 */ }
    }
  });
}

/**
 * 붙여넣는 글을 다듬는다.
 *
 * 심평원 고시 페이지처럼 한 줄 한 줄을 문단으로 감싸 둔 곳에서 복사하면
 * 줄마다 빈 줄이 하나씩 딸려온다. 웹에서 긁어온 글에는 눈에 안 보이는
 * 공백(줄바꿈 없는 공백·너비 없는 문자)도 섞여 들어온다.
 *
 * 빈 줄이 여러 개 이어지면 하나로 줄이지 않고 아예 없앤다 — 업무 내용에
 * 문단을 나눌 일은 거의 없고, 빈 줄이 남으면 표가 쓸데없이 길어진다.
 */
export function tidyPasted(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')          // 윈도우·맥 줄바꿈을 통일
    .replace(/\u00A0/g, ' ')                  // 줄바꿈 없는 공백 → 보통 공백
    .replace(/[\u200B-\u200D\uFEFF]/g, '')    // 너비 없는 문자는 아예 없앤다
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim();
}

/** 커서 자리에 끼워 넣는다. 되돌리기(Ctrl+Z)가 살아 있도록 실행명령을 먼저 쓴다. */
function insertAtCursor(ta, text) {
  ta.focus();
  if (document.execCommand && document.execCommand('insertText', false, text)) return;
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? s;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  const at = s + text.length;
  ta.setSelectionRange(at, at);
}

function area(obj, key, touch, placeholder, cls) {
  const ta = h('textarea', { class: cls, rows: 1, placeholder, value: obj[key] || '' });
  ta.addEventListener('input', () => { obj[key] = ta.value; autoGrow(ta); touch(); });

  ta.addEventListener('paste', (e) => {
    const raw = e.clipboardData?.getData('text/plain');
    if (raw == null) return;                 // 글이 아닌 걸 붙이면 브라우저에 맡긴다
    const tidy = tidyPasted(raw);
    if (tidy === raw) return;                // 다듬을 게 없으면 그냥 둔다
    e.preventDefault();
    insertAtCursor(ta, tidy);
    obj[key] = ta.value;
    autoGrow(ta);
    touch();
  });

  requestAnimationFrame(() => autoGrow(ta));
  return ta;
}
