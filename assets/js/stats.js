// 통계 — 월별·요일별·일별 지원 건수와 업무 건수
//
// 제출된 보고서를 모두 읽어 집계한다. 한 번 읽은 건 캐시에 둔다.
// 지원 건수는 주간 보고서에 월~금 5칸으로 들어오므로, 그 주 월요일부터
// 하루씩 날짜에 붙여 일별 값을 만든다.

import { h, clear, metaFromId, fromISO, addDays, toISO } from './util.js?v=20260904143923';
import { SUPPORT_KINDS, DAYS, ITEM_KEYS, supportTotals } from './model.js?v=20260904143923';
import { store } from './store.js?v=20260904143923';
import { app, member } from './main.js?v=20260904143923';

const WORK_KEYS = ITEM_KEYS.filter((k) => k !== 'plan' && k !== 'shared');
const SEG = ['seg-inquiry', 'seg-remote', 'seg-phone'];
const cache = new Map();

async function loadAll(rows, onProgress) {
  const out = [];
  let done = 0;
  for (let i = 0; i < rows.length; i += 6) {
    const chunk = rows.slice(i, i + 6);
    const got = await Promise.all(chunk.map(async (r) => {
      const key = `${r.slug}/${r.id}`;
      if (!cache.has(key)) {
        let rep = null;
        try { rep = await store.load(r.slug, r.id); } catch { rep = null; }
        cache.set(key, rep);
      }
      const rep = cache.get(key);
      return rep ? { ...r, rep } : null;
    }));
    out.push(...got.filter(Boolean));
    done += chunk.length;
    if (onProgress) onProgress(Math.min(done, rows.length), rows.length);
  }
  return out;
}

/** 축 눈금이 깔끔하게 떨어지는 최대값 */
function niceMax(v) {
  if (v <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const top = step * m;
    if (top >= v) return Math.ceil(top / 4) * 4;   // 눈금 4칸으로 나눠떨어지게
  }
  return Math.ceil(v / 4) * 4;
}

export async function renderStats() {
  const wrap = h('div.stats');
  let who = '';
  let year = new Date().getFullYear();
  let calMonth = null;      // 달력이 보여주는 달 (없으면 데이터의 마지막 달)

  const whoWrap = h('div.chip-row');
  const yearWrap = h('div.chip-row');
  const note = h('p.stats-note', '');

  wrap.append(h('header.stats-head',
    h('div',
      h('span.eyebrow', 'STATISTICS'),
      h('h2', '통계'),
      h('p.hint', '제출된 보고서를 모아 월별·연간으로 집계합니다.'),
      note,
    ),
    h('div.stats-filters',
      h('div.filter-line', h('span.filter-label', '담당자'), whoWrap),
      h('div.filter-line', h('span.filter-label', '연도'), yearWrap),
    ),
  ));

  const body = h('div');
  wrap.append(body);

  const paintChips = (years) => {
    clear(whoWrap);
    for (const m of [{ slug: '', name: '부서 전체' }, ...app.members]) {
      const b = h('button.who-chip', { type: 'button', class: m.slug === who ? 'is-on' : '' }, m.name);
      b.addEventListener('click', () => { who = m.slug; calMonth = null; run(); });
      whoWrap.append(b);
    }
    clear(yearWrap);
    for (const y of years) {
      const b = h('button.who-chip', { type: 'button', class: y === year ? 'is-on' : '' }, `${y}년`);
      b.addEventListener('click', () => { year = y; calMonth = null; run(); });
      yearWrap.append(b);
    }
  };

  async function run() {
    clear(body).append(h('p.hint', '불러오는 중…'));

    let index;
    try { index = await store.index(); }
    catch (e) { clear(body).append(h('div.callout.warn', `목록을 불러오지 못했습니다 — ${e.message}`)); return; }

    const all = index.map((r) => ({ ...r, meta: metaFromId(r.id) })).filter((r) => r.meta);
    const years = [...new Set(all.map((r) => r.meta.year))].sort((a, b) => a - b);
    if (years.length && !years.includes(year)) year = years[years.length - 1];
    paintChips(years.length ? years : [year]);

    const rows = all.filter((r) => (!who || r.slug === who) && r.meta.year === year);
    if (!rows.length) {
      note.textContent = '';
      clear(body).append(h('div.callout', `${year}년에 제출된 보고서가 없습니다.`));
      return;
    }

    const loaded = await loadAll(rows, (d, t) => { note.textContent = `보고서 ${t}건 중 ${d}건 읽는 중…`; });
    render(loaded);
  }

  // ── 집계 ────────────────────────────────────────────────────

  function aggregate(loaded) {
    const months = new Map();
    const totals = { inquiry: 0, remote: 0, phone: 0, work: 0, done: 0, weeks: 0 };
    const byDay = [0, 0, 0, 0, 0];
    const byMember = new Map();
    const daily = new Map();          // 'YYYY-MM-DD' → 건수
    const covered = new Set();        // 보고서가 덮은 평일 (0건이어도 업무일)

    for (const row of loaded) {
      const mo = row.meta.month;
      if (!months.has(mo)) months.set(mo, { inquiry: 0, remote: 0, phone: 0, work: 0, done: 0 });
      const b = months.get(mo);

      const t = supportTotals(row.rep);
      for (const { key } of SUPPORT_KINDS) { b[key] += t.byKind[key]; totals[key] += t.byKind[key]; }
      t.byDay.forEach((v, i) => { byDay[i] += v; });

      // 그 주 월요일부터 하루씩 붙인다. 0건인 날도 업무일로는 센다.
      const mon = fromISO(row.rep.weekStart || row.meta.weekStart);
      t.byDay.forEach((v, i) => {
        const key = toISO(addDays(mon, i));
        covered.add(key);
        if (v) daily.set(key, (daily.get(key) || 0) + v);
      });

      const items = WORK_KEYS.flatMap((k) => row.rep[k] || []);
      const doneCount = items.filter((i) => i.done || Number(i.progress) >= 100).length;
      b.work += items.length; b.done += doneCount;
      totals.work += items.length; totals.done += doneCount; totals.weeks += 1;

      const name = member(row.slug).name || row.slug;
      if (!byMember.has(name)) byMember.set(name, { support: 0, work: 0, done: 0, weeks: 0 });
      const mem = byMember.get(name);
      mem.support += t.grand; mem.work += items.length; mem.done += doneCount; mem.weeks += 1;
    }
    return { months, totals, byDay, byMember, daily, covered };
  }

  // ── 그리기 ──────────────────────────────────────────────────

  function render(loaded) {
    const { months, totals, byDay, byMember, daily, covered } = aggregate(loaded);
    const supportTotal = totals.inquiry + totals.remote + totals.phone;
    const monthCount = months.size || 1;
    if (calMonth === null) calMonth = Math.max(...months.keys());

    const whoName = who ? (member(who).name || who) : '부서 전체';
    note.textContent = `${year}년 · ${whoName} · 보고서 ${loaded.length}건 기준 (${monthCount}개월)`;

    clear(body);

    // 요약 — 완료율 카드와 증감 배지는 뺐다
    body.append(h('div.stat-cards',
      statCard('연간 지원 건수', supportTotal, `${year}년 합계`),
      statCard('월평균 지원 건수', Math.round(supportTotal / monthCount), `${monthCount}개월 기준`),
      statCard('업무 건수', totals.work, `완료 ${totals.done}건`),
    ));

    const grid = h('div.stats-grid');
    body.append(grid);

    // 왼쪽 — 월별 + 그 아래 일별 달력. 둘은 같은 열에 두어 폭을 맞춘다.
    const left = h('div.stats-main');
    grid.append(left);

    const monthPanel = h('section.panel');
    monthPanel.append(h('div.panel-head',
      h('div', h('h3', '월별 지원 건수'), h('p.panel-sub', '막대를 선택하면 아래 달력이 함께 이동합니다.')),
      legend(),
    ));
    monthPanel.append(monthChart(months, (mo) => { calMonth = mo; repaintCal(); }));
    monthPanel.append(monthTable(months, totals, supportTotal));
    left.append(monthPanel);

    // 오른쪽 — 유형 구성 + 요일별
    const right = h('div.stats-side');
    right.append(donutPanel(totals, supportTotal));
    right.append(dayPanel(byDay));
    grid.append(right);

    // 월별 바로 아래 — 일별 달력 (같은 열이므로 폭이 월별과 동일하다)
    const calWrap = h('section.panel');
    left.append(calWrap);
    const repaintCal = () => { clear(calWrap); calWrap.append(...calendar(daily, covered, year, calMonth, (mo) => { calMonth = mo; repaintCal(); })); };
    repaintCal();

    // 구성원별
    if (!who && byMember.size > 1) body.append(memberPanel(byMember));
  }

  run();
  return wrap;
}

// ── 조각들 ────────────────────────────────────────────────────

function statCard(label, value, sub) {
  return h('div.stat-card',
    h('span.stat-label', label),
    h('strong.stat-value', String(value)),
    h('span.stat-sub', sub),
  );
}

function legend() {
  return h('div.vlegend',
    ...SUPPORT_KINDS.map((k, i) => h('span.vlegend-item', h('i', { class: SEG[i] }), k.label)),
  );
}

/** 축과 눈금선이 있는 세로 누적 막대 */
function monthChart(months, onPick) {
  const cols = [];
  for (let mo = 1; mo <= 12; mo++) {
    const b = months.get(mo);
    cols.push({ mo, parts: b ? [b.inquiry, b.remote, b.phone] : [0, 0, 0] });
  }
  const sums = cols.map((c) => c.parts.reduce((a, x) => a + x, 0));
  const max = niceMax(Math.max(...sums));
  const ticks = [0, 1, 2, 3, 4].map((i) => Math.round((max / 4) * i)).reverse();

  const axis = h('div.chart-axis', ...ticks.map((t) => h('span', String(t))));
  const gridLines = h('div.chart-grid', ...ticks.map(() => h('i')));

  const plot = h('div.chart-plot');
  cols.forEach((c, i) => {
    const sum = sums[i];
    const stack = h('div.vstack', { style: { height: `${(sum / max) * 100}%` } });
    c.parts.forEach((v, k) => {
      if (!v) return;
      stack.append(h('div', { class: `vseg ${SEG[k]}`, style: { height: `${(v / sum) * 100}%` } }));
    });
    const col = h('button.vcol', {
      type: 'button',
      title: c.parts.map((v, k) => `${SUPPORT_KINDS[k].label} ${v}`).join(' · '),
      onclick: () => { if (sum) onPick(c.mo); },
    },
      h('span.vcol-val', sum ? String(sum) : ''),
      h('div.vcol-bar', stack),
      h('span.vcol-label', `${c.mo}월`),
    );
    if (!sum) col.classList.add('is-empty');
    plot.append(col);
  });

  return h('div.chart', axis, h('div.chart-body', gridLines, plot));
}

/** 월별 표 — 업무·완료 열은 뺐다 */
function monthTable(months, totals, supportTotal) {
  const table = h('div.stat-table');
  table.append(h('div.strow.head',
    h('div.scell.smon', '월'),
    h('div.scell', '질의요청'), h('div.scell', '원격지원'), h('div.scell', '유선지원'),
    h('div.scell.sum', '지원 합계'),
  ));
  for (let mo = 1; mo <= 12; mo++) {
    const b = months.get(mo);
    if (!b) continue;
    table.append(h('div.strow',
      h('div.scell.smon', `${mo}월`),
      h('div.scell', String(b.inquiry)),
      h('div.scell', String(b.remote)),
      h('div.scell', String(b.phone)),
      h('div.scell.sum', String(b.inquiry + b.remote + b.phone)),
    ));
  }
  table.append(h('div.strow.total',
    h('div.scell.smon', '합계'),
    h('div.scell', String(totals.inquiry)),
    h('div.scell', String(totals.remote)),
    h('div.scell', String(totals.phone)),
    h('div.scell.sum', String(supportTotal)),
  ));
  return table;
}

/** 지원 유형 구성 — 도넛 */
function donutPanel(totals, total) {
  const vals = SUPPORT_KINDS.map((k) => totals[k.key]);
  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 140 140');
  svg.setAttribute('class', 'donut');
  const ring = (cls, len, off) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '70'); c.setAttribute('cy', '70'); c.setAttribute('r', String(R));
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '20');
    c.setAttribute('class', cls);
    c.setAttribute('stroke-dasharray', `${len} ${C - len}`);
    c.setAttribute('stroke-dashoffset', String(off));
    c.setAttribute('transform', 'rotate(-90 70 70)');
    return c;
  };
  svg.append(ring('donut-bg', C, 0));
  vals.forEach((v, i) => {
    if (!v || !total) return;
    const len = (v / total) * C;
    svg.append(ring(`donut-seg ${SEG[i]}`, len, -offset));
    offset += len;
  });

  return h('section.panel',
    h('div.panel-head', h('div', h('h3', '지원 유형 구성'), h('p.panel-sub', '유형별 비중'))),
    h('div.donut-wrap',
      h('div.donut-box', svg,
        h('div.donut-center', h('strong', String(total)), h('span', '건'))),
      h('div.donut-legend',
        ...SUPPORT_KINDS.map((k, i) => h('div.donut-row',
          h('i', { class: SEG[i] }),
          h('span.donut-name', k.label),
          h('span.donut-val', `${vals[i]}건 · ${total ? Math.round(vals[i] / total * 100) : 0}%`),
        )),
      ),
    ),
  );
}

/** 요일별 — 가로 막대 (연간 누적) */
function dayPanel(byDay) {
  const total = byDay.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...byDay);
  return h('section.panel',
    h('div.panel-head', h('div', h('h3', '요일별 지원 건수'), h('p.panel-sub', '연간 누적'))),
    h('div.hbars',
      ...DAYS.map((d, i) => h('div.hbar',
        h('span.hbar-name', d),
        h('div.hbar-track', h('i', { style: { width: `${(byDay[i] / max) * 100}%` } })),
        h('span.hbar-val', String(byDay[i])),
        h('span.hbar-pct', total ? `${Math.round(byDay[i] / total * 100)}%` : '0%'),
      )),
    ),
  );
}

/** 일별 달력 히트맵 */
function calendar(daily, covered, year, month, onMove) {
  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();

  const vals = [];
  for (let d = 1; d <= lastDay; d++) vals.push(daily.get(toISO(new Date(year, month - 1, d))) || 0);
  const max = Math.max(0, ...vals);
  const level = (v) => (!v ? 0 : Math.min(4, Math.ceil((v / (max || 1)) * 4)));

  const head = h('div.panel-head',
    h('div', h('h3', '일별 지원 건수'), h('p.panel-sub', '업무일 기준 일별 지원 건수 합계입니다.')),
    h('div.cal-tools',
      h('div.cal-legend', h('span', '적음'),
        ...[1, 2, 3, 4].map((l) => h('i', { class: `heat-${l}` })), h('span', '많음')),
      h('button.btn.btn-icon', { type: 'button', onclick: () => onMove(month === 1 ? 12 : month - 1) }, '‹'),
      h('span.cal-title', `${year}년 ${month}월`),
      h('button.btn.btn-icon', { type: 'button', onclick: () => onMove(month === 12 ? 1 : month + 1) }, '›'),
    ),
  );

  const grid = h('div.cal-grid');
  for (const d of ['일', '월', '화', '수', '목', '금', '토']) grid.append(h('div.cal-dow', d));
  for (let i = 0; i < first.getDay(); i++) grid.append(h('div.cal-pad'));

  for (let d = 1; d <= lastDay; d++) {
    const v = vals[d - 1];
    const dow = new Date(year, month - 1, d).getDay();
    const cell = h('div', { class: `cal-cell heat-${level(v)}${dow === 0 || dow === 6 ? ' is-weekend' : ''}` },
      h('span.cal-num', String(d)),
      v ? h('span.cal-val', String(v)) : null,
    );
    grid.append(cell);
  }

  const sum = vals.reduce((a, b) => a + b, 0);
  // 보고서가 덮은 평일 수로 나눈다 (그날 0건이어도 업무일로 센다)
  let workDays = 0;
  for (let d = 1; d <= lastDay; d++) if (covered.has(toISO(new Date(year, month - 1, d)))) workDays++;
  const peak = vals.indexOf(max);
  const foot = h('div.cal-foot',
    h('span', h('b', '월 합계'), ` ${sum}건`),
    h('span', h('b', '업무일 평균'), ` ${workDays ? (sum / workDays).toFixed(1) : '0'}건`),
    max ? h('span', h('b', '최다 지원일'), ` ${month}월 ${peak + 1}일 · ${max}건`) : null,
  );

  return [head, grid, foot];
}

function memberPanel(byMember) {
  const mt = h('div.stat-table.mem');
  mt.append(h('div.strow.head',
    h('div.scell.smon', '이름'),
    h('div.scell.sum', '지원 건수'),
    h('div.scell', '업무'), h('div.scell', '완료'), h('div.scell', '작성 주차'),
  ));
  for (const [name, v] of [...byMember].sort((a, b) => b[1].support - a[1].support)) {
    mt.append(h('div.strow',
      h('div.scell.smon', name),
      h('div.scell.sum', String(v.support)),
      h('div.scell', String(v.work)),
      h('div.scell', String(v.done)),
      h('div.scell', `${v.weeks}주`),
    ));
  }
  return h('section.panel', h('div.panel-head', h('div', h('h3', '구성원별'))), mt);
}
