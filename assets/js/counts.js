// 오른쪽 고정 박스 — 지원 건수 집계 / 부서원 명단

import { h, addDays, fromISO, toISO } from './util.js?v=20260904143923';
import { SUPPORT_KINDS, DAYS, supportTotals, holidayName, nextDayMark } from './model.js?v=20260904143923';

export function renderCounts(report, opts = {}) {
  const ro = Boolean(opts.readOnly);
  const changed = () => { if (opts.onChange) opts.onChange(report); };

  const grand = h('strong', '0');
  const box = h('section.side-card',
    h('div.counts-head',
      h('div',
        h('h3', '지원 건수 집계'),
        h('p', ro ? '주간 지원 건수' : '입력하면 합계가 자동 계산됩니다'),
      ),
      h('div.counts-total', h('span', '총건수'), grand),
    ),
  );

  /* 요일 음영 — 공휴일은 빨강, 연차는 노랑.
     날짜가 고정된 공휴일은 자동으로 잡히고, 설·추석처럼 음력 명절이나
     회사 휴무일은 머리글을 눌러 '휴일'로 표시한다.
     한 열에 속한 칸을 모아뒀다가 표시가 바뀌면 함께 칠한다. */
  const monday = fromISO(report.weekStart);
  const dates = DAYS.map((_, i) => toISO(addDays(monday, i)));
  const holidays = dates.map(holidayName);
  const columns = DAYS.map(() => []);

  const headCells = DAYS.map((d, i) => {
    const label = h('span', d);
    if (ro) return h('div.cday', label);
    const btn = h('button.cday.cday-head', { type: 'button' }, label);
    btn.addEventListener('click', () => {
      report.dayMarks[i] = nextDayMark(report.dayMarks[i]);
      paintDays();
      changed();
    });
    return btn;
  });
  headCells.forEach((c, i) => columns[i].push(c));

  box.append(h('div.crow.head',
    h('div.ckind', '구분'),
    ...headCells,
    h('div.csum', '계'),
  ));

  /** 요일 표시를 열 전체에 칠하고, 머리글에 이유를 적어준다 */
  function paintDays() {
    DAYS.forEach((d, i) => {
      const mark = report.dayMarks[i];
      const isHoliday = Boolean(holidays[i]) || mark === 'holiday';
      const isLeave = mark === 'leave';
      for (const cell of columns[i]) {
        cell.classList.toggle('is-holiday', isHoliday);
        cell.classList.toggle('is-leave', isLeave);
      }
      const head = headCells[i];
      const why = isLeave ? '연차' : (holidays[i] || (mark === 'holiday' ? '휴일' : ''));
      const tag = head.querySelector('.cday-tag');
      if (why) {
        if (tag) tag.textContent = why;
        else head.append(h('span.cday-tag', why));
      } else if (tag) {
        tag.remove();
      }
      if (!ro) {
        head.title = `${dates[i]} (${d})` + (why ? ` · ${why}` : '') + '\n눌러서 연차 → 휴일 → 평일';
      }
    });
  }

  const kindCell = {};
  const dayCell = [];
  const grid = [];   // grid[구분][요일] — Tab/Enter로 세로 이동하기 위해 들고 있는다

  SUPPORT_KINDS.forEach((kind, k) => {
    const row = h('div.crow', h('div.ckind', kind.label));
    grid[k] = [];
    for (let i = 0; i < 5; i++) {
      const cell = h('div.cday');
      if (ro) {
        cell.append(h('span', String(report.counts[kind.key][i] || 0)));
      } else {
        const input = h('input', { type: 'number', min: '0', value: String(report.counts[kind.key][i] || 0) });
        input.addEventListener('input', () => {
          report.counts[kind.key][i] = Math.max(0, Number(input.value) || 0);
          refresh(); changed();
        });
        input.addEventListener('focus', () => input.select());
        input.addEventListener('keydown', (e) => onKey(e, k, i));
        grid[k][i] = input;
        cell.append(input);
      }
      columns[i].push(cell);
      row.append(cell);
    }
    const sum = h('div.csum', '0');
    kindCell[kind.key] = sum;
    row.append(sum);
    box.append(row);
  });

  /**
   * Tab / Enter 는 아래 칸으로 내려간다 (질의요청 → 원격지원 → 유선지원).
   * 세로로 끝까지 가면 다음 요일 맨 위로 넘어가고, Shift+Tab 은 반대로 간다.
   * 좌우 이동은 방향키로.
   */
  function onKey(e, k, i) {
    const last = SUPPORT_KINDS.length - 1;
    const step = (dk, di) => {
      const target = grid[dk]?.[di];
      if (!target) return false;
      e.preventDefault();
      target.focus();
      return true;
    };

    if (e.key === 'Enter' || e.key === 'Tab') {
      const back = e.shiftKey;
      if (back) {
        if (k > 0) return step(k - 1, i);
        if (i > 0) return step(last, i - 1);
        return;                       // 맨 앞이면 그대로 둔다
      }
      if (k < last) return step(k + 1, i);
      if (i < 4) return step(0, i + 1);
      if (e.key === 'Enter') e.preventDefault();   // 마지막 칸에서 Enter는 무시
      return;                                      // 마지막 칸의 Tab은 밖으로 나가게 둔다
    }
    // number 입력칸은 selectionStart를 못 읽으므로 방향키는 조건 없이 칸 이동에 쓴다
    if (e.key === 'ArrowDown') return step(k + 1, i);
    if (e.key === 'ArrowUp') return step(k - 1, i);
    if (e.key === 'ArrowRight') return step(k, i + 1);
    if (e.key === 'ArrowLeft') return step(k, i - 1);
  }

  const totalRow = h('div.crow.total', h('div.ckind', '합계'));
  for (let i = 0; i < 5; i++) {
    const c = h('div.cday', '0');
    dayCell.push(c); columns[i].push(c); totalRow.append(c);
  }
  const totalSum = h('div.csum', '0');
  totalRow.append(totalSum);
  box.append(totalRow);

  function refresh() {
    const t = supportTotals(report);
    for (const kind of SUPPORT_KINDS) kindCell[kind.key].textContent = String(t.byKind[kind.key]);
    t.byDay.forEach((v, i) => { dayCell[i].textContent = String(v); });
    totalSum.textContent = String(t.grand);
    grand.textContent = String(t.grand);
  }
  refresh();
  paintDays();

  return box;
}

/**
 * 같은 주차의 부서원 명단.
 * 남의 보고서를 보려고 홈까지 나갔다 오지 않도록, 작성 화면 옆에 붙여 둔다.
 * 눌러도 '내가 누구인지'는 바뀌지 않는다 — 보러 가는 것뿐이다.
 *
 * 상태는 서버에서 읽어야 알 수 있으므로 이름부터 먼저 그리고 나중에 채운다.
 */
export function renderPeople(members, { weekLabel, current, statusOf, onPick }) {
  const box = h('section.side-card.people-card',
    h('div.recent-head', h('h3', '부서원 보고서'), h('p.people-sub', weekLabel || '')),
  );

  for (const m of members) {
    const state = h('span.people-state', '…');
    const btn = h('button.recent-item', {
      type: 'button',
      class: m.slug === current ? 'is-current' : '',
      title: `${m.name} 보고서 열기`,
    },
      h('span.recent-dot'),
      h('span.recent-week', m.name),
      state,
    );
    if (m.slug === current) {
      btn.disabled = true;
      state.textContent = '보는 중';
    } else {
      btn.addEventListener('click', () => onPick(m));
      statusOf(m.slug).then((s) => {
        state.textContent = s.label;
        btn.querySelector('.recent-dot').className = `recent-dot ${s.cls}`;
      }).catch(() => { state.textContent = ''; });
    }
    box.append(btn);
  }
  return box;
}
