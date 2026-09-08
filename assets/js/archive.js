// 기록 조회 — 작성자별 보고서 목록 + 전체 내용 검색
//
// 검색은 저장된 보고서를 모두 읽어 업무내용·상세·비고를 훑는다.
// 한 번 읽은 보고서는 캐시에 두어 검색어를 바꿔도 다시 받지 않는다.

import { h, clear, quarterOf, metaFromId, debounce } from './util.js?v=20260904143923';
import { SECTION_DEFS, ITEM_KEYS } from './model.js?v=20260904143923';
import { store } from './store.js?v=20260904143923';
import { app, member, openWeek } from './main.js?v=20260904143923';

const SECTION_LABEL = Object.fromEntries(
  SECTION_DEFS.map((d) => [d.key, d.sub ? `${d.title} · ${d.sub}` : d.title])
);

/** `${slug}/${id}` → { ...row, rep } | null */
const cache = new Map();

async function loadAll(rows, onProgress) {
  const out = [];
  let done = 0;
  // 한 번에 너무 많이 요청하지 않도록 6건씩 끊어서 읽는다
  for (let i = 0; i < rows.length; i += 6) {
    const chunk = rows.slice(i, i + 6);
    const got = await Promise.all(chunk.map(async (r) => {
      const key = `${r.slug}/${r.id}`;
      if (cache.has(key)) return cache.get(key);
      let rep = null;
      try { rep = await store.load(r.slug, r.id); } catch { rep = null; }
      const val = rep ? { ...r, rep } : null;
      cache.set(key, val);
      return val;
    }));
    out.push(...got.filter(Boolean));
    done += chunk.length;
    if (onProgress) onProgress(Math.min(done, rows.length), rows.length);
  }
  return out;
}

export async function renderArchive() {
  const wrap = h('div.lookup');
  let who = app.me;   // 기본은 내 것부터

  const whoWrap = h('div.who-chips');
  const search = h('input.search-input', {
    type: 'search', placeholder: '내용 검색 — 예: MS0757, 간호간병, 고시 분석',
    autocomplete: 'off', spellcheck: 'false',
  });
  const clearBtn = h('button.btn', { type: 'button' }, '지우기');
  const countLabel = h('span.lookup-count', '');

  wrap.append(h('div.panel.lookup-head',
    h('h2', '기록 조회'),
    h('p.hint', '작성자를 고르면 지금까지 쓴 보고서가 최신순으로 나옵니다. 검색어를 넣으면 모든 주차의 업무내용에서 찾습니다.'),
    whoWrap,
    h('div.search-row', search, clearBtn, countLabel),
  ));

  const body = h('div');
  wrap.append(body);

  const chips = [{ slug: '', name: '전체' }, ...app.members];
  const paintChips = () => {
    clear(whoWrap);
    for (const m of chips) {
      const b = h('button.who-chip', { type: 'button', class: m.slug === who ? 'is-on' : '' }, m.name);
      b.addEventListener('click', () => { who = m.slug; paintChips(); run(); });
      whoWrap.append(b);
    }
  };
  paintChips();

  clearBtn.addEventListener('click', () => { search.value = ''; run(); search.focus(); });
  search.addEventListener('input', debounce(() => run(), 250));

  // ── 실행 ──────────────────────────────────────────────────

  async function run() {
    const q = search.value.trim();
    clear(body).append(h('p.hint', '불러오는 중…'));

    let index;
    try { index = await store.index(); }
    catch (e) { clear(body).append(h('div.callout.warn', `목록을 불러오지 못했습니다 — ${e.message}`)); return; }

    const rows = index
      .filter((r) => !who || r.slug === who)
      .map((r) => ({ ...r, meta: metaFromId(r.id) }))
      .filter((r) => r.meta)
      .sort((a, b) => (a.meta.friday < b.meta.friday ? 1 : -1));

    if (!rows.length) {
      countLabel.textContent = '';
      clear(body).append(h('div.callout',
        who ? `${member(who).name} 님의 저장된 보고서가 없습니다.` : '저장된 보고서가 아직 없습니다.'));
      return;
    }

    if (!q) {
      countLabel.textContent = `보고서 ${rows.length}건`;
      return renderWeekList(rows);
    }

    const note = h('p.hint', `보고서 ${rows.length}건에서 찾는 중…`);
    clear(body).append(note);
    const loaded = await loadAll(rows, (d, t) => { note.textContent = `보고서 ${t}건 중 ${d}건 확인…`; });
    renderHits(q, loaded);
  }

  // ── 주차 목록 ─────────────────────────────────────────────

  function renderWeekList(rows) {
    clear(body);
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.meta.year}.${quarterOf(r.meta.month)}분기`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, list] of groups) {
      const g = h('div.arch-group');
      g.append(h('h3', `${key} · ${list.length}건`));
      const grid = h('div.arch-grid');
      for (const r of list) {
        const card = h('button.arch-card', { type: 'button' },
          h('div.wk', `${r.meta.year}년 ${r.meta.label}`),
          h('div.dt', `${member(r.slug).name || r.slug} · ${r.meta.weekStart} ~ ${r.meta.friday}`),
          h('div.stat', r.localOnly ? '이 브라우저에만 있음 (제출 필요)' : '제출됨'),
        );
        card.addEventListener('click', () => openWeek(r.id, { slug: r.slug }));
        grid.append(card);
      }
      g.append(grid);
      body.append(g);
    }
  }

  // ── 검색 결과 ─────────────────────────────────────────────

  function renderHits(q, loaded) {
    const needle = q.toLowerCase();
    const hits = [];

    for (const row of loaded) {
      for (const key of ITEM_KEYS) {
        for (const it of row.rep[key] || []) {
          const fields = [it.title, it.detail, it.note].filter(Boolean);
          if (!fields.join('\n').toLowerCase().includes(needle)) continue;
          hits.push({ row, key, item: it, snippet: snippetOf(fields.slice(1).join(' · '), q) });
        }
      }
    }

    countLabel.textContent = `${hits.length}건 찾음`;
    clear(body);
    if (!hits.length) {
      body.append(h('div.callout', `“${q}” 가 들어간 업무내용을 찾지 못했습니다.`));
      return;
    }

    const list = h('div.hits');
    for (const hit of hits) {
      const m = hit.row.meta;
      const card = h('button.hit', { type: 'button' },
        h('div.hit-top',
          h('span.hit-week', `${m.year}년 ${m.label}`),
          h('span.hit-who', member(hit.row.slug).name || hit.row.slug),
          h('span.hit-sec', SECTION_LABEL[hit.key] || hit.key),
          h('span.grow'),
          h('span.hit-date', `${m.weekStart} ~ ${m.friday}`),
        ),
        h('div.hit-title', mark(hit.item.title || '(제목 없음)', q)),
        hit.snippet ? h('div.hit-snippet', mark(hit.snippet, q)) : null,
      );
      card.addEventListener('click', () => openWeek(hit.row.id, { slug: hit.row.slug }));
      list.append(card);
    }
    body.append(list);
  }

  run();
  return wrap;
}

/** 검색어 주변만 잘라 보여준다 */
function snippetOf(text, q) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, 120) + (flat.length > 120 ? ' …' : '');
  const from = Math.max(0, i - 40);
  const to = Math.min(flat.length, i + q.length + 90);
  return (from ? '… ' : '') + flat.slice(from, to) + (to < flat.length ? ' …' : '');
}

/** 검색어에 해당하는 부분을 강조 */
function mark(text, q) {
  const s = String(text);
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return s;
  return h('span', s.slice(0, i), h('mark', s.slice(i, i + q.length)), s.slice(i + q.length));
}
