// 보고서 데이터 모델

import { weekMeta, metaFromId, shiftWeeks, fromISO, toISO, addDays } from './util.js?v=20260904143923';

export const SCHEMA = 2;

/** 부서 기본 구성원 — 설정에서 수정 가능 */
export const DEFAULT_MEMBERS = [
  { name: '김은혜', slug: 'kimeunhye' },
  { name: '김다혜', slug: 'kimdahye' },
  { name: '최현정', slug: 'choihyunjung' },
  { name: '김혜진', slug: 'kimhyejin' },
];

/**
 * 화면에 나오는 순서대로의 섹션 정의.
 *  cols  — 표 구성 (work / plan / shared)
 *  group — 같은 값이면 카드 하나에 묶어서 소제목으로 나눠 보여준다
 */
export const SECTION_DEFS = [
  { key: 'rules',   title: '점검룰생성 및 고시사항', sub: '기존업무(일상업무)', cols: 'work',   flagLabel: '완료' },
  { key: 'support', title: '고객지원',              sub: '지원 특이사항',      cols: 'work',   flagLabel: '완료', singleBody: true },
  { key: 'dev',     title: '프로그램',              sub: '개발',              cols: 'work',   flagLabel: '배포', group: 'program', singleBody: true },
  { key: 'test',    title: '프로그램',              sub: '테스트',            cols: 'work',   flagLabel: '완료', group: 'program', singleBody: true },
  // singleBody — 업무내용을 제목/상세로 나누지 않고 한 칸으로 쓴다
  { key: 'account', title: '회계',                  sub: '',                  cols: 'work',   flagLabel: '완료', singleBody: true },
  { key: 'plan',    title: '차주 예정(목표)업무',    sub: '금주 미완료 · 차주 계획', cols: 'plan' },
  { key: 'shared',  title: '부서공유 및 문제사항',   sub: '',                  cols: 'shared' },
];

export const ITEM_KEYS = SECTION_DEFS.map((s) => s.key);

export const SUPPORT_KINDS = [
  { key: 'inquiry', label: '질의요청' },
  { key: 'remote',  label: '원격지원' },
  { key: 'phone',   label: '유선지원' },
];

export const DAYS = ['월', '화', '수', '목', '금'];

/* ── 공휴일 ────────────────────────────────────────────────────
 *
 * 브라우저에 들어 있는 한국 음력 달력(dangi)을 쓴다. 윈도우·크롬 달력이
 * 쓰는 것과 같은 자료라 설날·추석·부처님오신날도 해마다 알아서 맞는다.
 * 인터넷 연결도, 해마다 날짜 표를 고쳐 넣는 일도 필요 없다.
 */

/** 해마다 같은 날 */
const SOLAR_HOLIDAYS = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
};

/** 주말과 겹쳐도 대체공휴일이 붙지 않는 날 */
const NO_SUBSTITUTE = new Set(['신정', '현충일']);

let dangi = null;

/** 그 날의 음력 월·일. 음력 달력이 없는 브라우저면 null (양력 공휴일만 잡힌다) */
function lunarMD(date) {
  try {
    if (!dangi) dangi = new Intl.DateTimeFormat('en-u-ca-dangi', { month: 'numeric', day: 'numeric' });
    const p = dangi.formatToParts(date);
    const mo = Number(p.find((x) => x.type === 'month')?.value);
    const da = Number(p.find((x) => x.type === 'day')?.value);
    return Number.isFinite(mo) && Number.isFinite(da) ? { mo, da } : null;
  } catch {
    return null;
  }
}

/** 윤달인가 — 한 달 앞도 같은 달 번호면 지금이 윤달이다 */
function isLeapMonth(date, mo) {
  const prev = lunarMD(addDays(date, -30));
  return Boolean(prev && prev.mo === mo);
}

function lunarHoliday(iso) {
  const d = fromISO(iso);
  const L = lunarMD(d);
  if (!L) return null;

  if (L.mo === 1 && !isLeapMonth(d, 1)) {
    if (L.da === 1) return '설날';
    if (L.da === 2) return '설 연휴';
  }
  if (L.mo === 8 && !isLeapMonth(d, 8)) {
    if (L.da === 15) return '추석';
    if (L.da === 14 || L.da === 16) return '추석 연휴';
  }
  if (L.mo === 4 && L.da === 8 && !isLeapMonth(d, 4)) return '부처님오신날';

  // 섣달 그믐 — 다음 날이 설날이면 그 전날부터 연휴다
  if (L.mo === 12) {
    const next = lunarMD(addDays(d, 1));
    if (next && next.mo === 1 && next.da === 1) return '설 연휴';
  }
  return null;
}

/* 같은 날짜를 여러 번 묻게 되므로 한 번 계산한 건 들고 있는다 */
const holidayCache = new Map();

/** 대체공휴일을 뺀, 그 날짜 자체의 공휴일 이름 */
function baseHoliday(iso) {
  if (holidayCache.has(iso)) return holidayCache.get(iso);
  const name = SOLAR_HOLIDAYS[String(iso).slice(5, 10)] || lunarHoliday(iso);
  holidayCache.set(iso, name);
  return name;
}

/** 양력 공휴일과 음력 공휴일이 같은 날 겹쳤는가 (2025년 어린이날 · 부처님오신날) */
function isOverlapped(iso) {
  return Boolean(SOLAR_HOLIDAYS[String(iso).slice(5, 10)]) && Boolean(lunarHoliday(iso));
}

/**
 * 공휴일이 주말에 걸리거나 다른 공휴일과 겹쳐 이 날로 밀려왔는가.
 * 신정·현충일은 밀리지 않는다.
 */
function substituteHoliday(iso) {
  const d = fromISO(iso);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return null;   // 주말로는 밀려오지 않는다

  for (let back = 1; back <= 7; back++) {
    const src = addDays(d, -back);
    const srcIso = toISO(src);
    const day = src.getDay();
    const name = baseHoliday(srcIso);
    if (!name || NO_SUBSTITUTE.has(name)) continue;
    // 주말에 걸렸거나, 공휴일 두 개가 같은 날 겹친 경우만 밀린다
    if (day !== 0 && day !== 6 && !isOverlapped(srcIso)) continue;

    // 주말·공휴일이 아닌 첫 평일로 민다
    let t = addDays(src, 1);
    for (let step = 0; step < 10; step++) {
      const wd = t.getDay();
      if (wd !== 0 && wd !== 6 && !baseHoliday(toISO(t))) break;
      t = addDays(t, 1);
    }
    if (toISO(t) === iso) return '대체공휴일';
  }
  return null;
}

/** 그 날짜가 공휴일이면 이름, 아니면 null */
export function holidayName(iso) {
  if (!iso) return null;
  return baseHoliday(iso) || substituteHoliday(iso);
}

/* 요일 표시 — 머리글을 누를 때마다 이 순서로 돈다.
   ''(평일) → 'leave'(연차) → 'holiday'(휴일) → '' */
export const DAY_MARKS = ['', 'leave', 'holiday'];
export const nextDayMark = (m) => DAY_MARKS[(DAY_MARKS.indexOf(m) + 1) % DAY_MARKS.length] ?? '';

let seq = 0;
const uid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 모든 섹션이 같은 형태를 쓰고, 표 구성에 따라 필요한 칸만 렌더한다 */
export function emptyItem(patch = {}) {
  return {
    uid: uid(),
    title: '',        // 업무내용 첫 줄 (굵게)
    detail: '',       // 상세 내용 · 조건
    startDate: '',    // 업무발생일 (YYYY-MM-DD)
    dueDate: '',      // 완료예정일
    progress: 0,      // 0–100
    done: false,      // 완료 / 배포
    note: '',         // 비고
    repeat: false,    // 차주 예정업무 — 매주 반복
    // 매주 반복 항목이 주차를 스스로 갱신하기 위한 내부 서식.
    // 화면에는 안 나오고, title에는 항상 치환된 실제 문구가 들어간다.
    tpl: '',
    meeting: false,   // 부서공유 — 회의
    notice: false,    // 부서공유 — 공지
    carried: false,   // 지난주에서 이월된 항목
    // 앱이 스스로 깔아준 행인가 ('매주' 자동 승계, 첫 보고서 서식).
    // 사용자가 그 행을 한 번이라도 건드리면 풀린다.
    auto: false,
    ...patch,
  };
}

const emptyCounts = () => ({
  inquiry: [0, 0, 0, 0, 0],
  remote: [0, 0, 0, 0, 0],
  phone: [0, 0, 0, 0, 0],
});

/** 항목이 실제로 내용을 가지고 있는가 (빈 행 판별) */
export function hasContent(it) {
  return Boolean(
    String(it.title || '').trim() ||
    String(it.detail || '').trim() ||
    String(it.note || '').trim() ||
    it.startDate || it.dueDate || it.date
  );
}

export function emptyReport(author, dateLike) {
  const meta = weekMeta(dateLike);
  const rep = {
    schema: SCHEMA,
    id: meta.id,
    author,
    year: meta.year,
    month: meta.month,
    week: meta.week,
    label: meta.label,
    weekStart: meta.weekStart,
    weekEnd: meta.weekEnd,
    writtenOn: meta.friday,
    counts: emptyCounts(),
    dayMarks: ['', '', '', '', ''],   // 월~금 연차/휴일 표시
    submittedAt: null,
    updatedAt: new Date().toISOString(),
  };
  for (const k of ITEM_KEYS) rep[k] = [];
  return rep;
}

/** 저장본을 현재 스키마로 맞춘다 (v1 형식도 읽어들인다) */
export function normalize(raw) {
  const meta = metaFromId(raw.id) || weekMeta(raw.writtenOn || new Date());

  const fixItem = (it) => {
    // v1은 여러 줄 content 하나였다 — 첫 줄을 제목, 나머지를 상세로 나눈다
    let title = it.title, detail = it.detail;
    if (title === undefined && typeof it.content === 'string') {
      const lines = it.content.split('\n');
      title = lines[0] || '';
      detail = lines.slice(1).join('\n').replace(/^\n+/, '');
    }
    const done = typeof it.done === 'boolean' ? it.done : it.flag === 'Y';
    const pct = Math.max(0, Math.min(100, Number(it.progress) || 0));
    return emptyItem({
      ...it,
      uid: it.uid || uid(),
      title: title || '',
      detail: detail || '',
      startDate: it.startDate === '-' ? '' : (it.startDate || ''),
      dueDate: it.dueDate === '-' ? '' : (it.dueDate || ''),
      // 완료 체크와 진행율은 늘 붙어 다닌다. 예전에 저장된 건도 열 때 맞춰준다.
      progress: done ? 100 : pct,
      done,
      meeting: typeof it.meeting === 'boolean' ? it.meeting : it.meeting === 'Y',
      notice: typeof it.notice === 'boolean' ? it.notice : it.notice === 'Y',
      // v1 부서공유는 date 필드를 썼다
      ...(it.date && !it.startDate ? { startDate: it.date } : {}),
    });
  };

  const fixMarks = (a) => {
    const out = ['', '', '', '', ''];
    if (Array.isArray(a)) for (let i = 0; i < 5; i++) if (DAY_MARKS.includes(a[i])) out[i] = a[i];
    return out;
  };

  const fixDays = (a) => {
    const out = [0, 0, 0, 0, 0];
    if (Array.isArray(a)) for (let i = 0; i < 5; i++) out[i] = Number(a[i]) || 0;
    return out;
  };

  // v1은 support가 건수 객체였고, v2에서 counts로 분리됐다
  const rawCounts = raw.counts || (raw.support && !Array.isArray(raw.support) ? raw.support : null) || {};

  const out = {
    schema: SCHEMA,
    id: raw.id || meta.id,
    author: raw.author || '',
    year: raw.year ?? meta.year,
    month: raw.month ?? meta.month,
    week: raw.week ?? meta.week,
    label: raw.label || meta.label,
    weekStart: raw.weekStart || meta.weekStart,
    weekEnd: raw.weekEnd || meta.weekEnd,
    writtenOn: raw.writtenOn || meta.friday,
    counts: {
      inquiry: fixDays(rawCounts.inquiry),
      remote: fixDays(rawCounts.remote),
      phone: fixDays(rawCounts.phone),
    },
    dayMarks: fixMarks(raw.dayMarks),
    submittedAt: raw.submittedAt || null,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };

  for (const k of ITEM_KEYS) {
    const src = Array.isArray(raw[k]) ? raw[k] : [];
    out[k] = src.map(fixItem).filter(hasContent);
  }
  return out;
}

// ── 집계 ──────────────────────────────────────────────────────

export function supportTotals(report) {
  const c = report.counts;
  const byKind = {};
  for (const { key } of SUPPORT_KINDS) byKind[key] = c[key].reduce((a, b) => a + (Number(b) || 0), 0);
  const byDay = DAYS.map((_, i) =>
    SUPPORT_KINDS.reduce((a, { key }) => a + (Number(c[key][i]) || 0), 0));
  const grand = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { byKind, byDay, grand };
}

export function countsFilled(report) {
  return supportTotals(report).grand > 0;
}

export function summarize(report) {
  // 차주계획·부서공유는 "업무 건수"에 넣지 않는다 (따로 세어 보여준다)
  const WORK_KEYS = ITEM_KEYS.filter((k) => k !== 'plan' && k !== 'shared');
  const items = WORK_KEYS.flatMap((k) => report[k]);
  return {
    items: items.length,
    done: items.filter((i) => i.done || Number(i.progress) >= 100).length,
    support: supportTotals(report).grand,
    plan: report.plan.length,
    shared: report.shared.length,
  };
}

const isOpen = (it) => !(it.done || Number(it.progress) >= 100);

/** '{{금주}}', '{{차주}}' 토큰을 실제 주차 표기로 치환 */
export function expandTokens(text, meta) {
  if (!text) return text;
  const next = weekMeta(shiftWeeks(meta.friday, 1));
  return String(text)
    .replaceAll('{{금주}}', meta.longLabel)
    .replaceAll('{{차주}}', next.longLabel);
}

/**
 * '매주' 체크한 차주 예정업무를 다음 주차로 넘긴다.
 * 서식(tpl)이 있으면 그 주차 문구로 다시 만들어 준다.
 * 새 주차를 열 때마다 자동으로 불리므로, 한 번 체크해두면 계속 따라온다.
 */
export function carryRepeatPlan(prev, meta) {
  return (prev?.plan || []).filter((p) => p.repeat).map((p) => emptyItem({
    auto: true,
    tpl: p.tpl,
    title: p.tpl ? expandTokens(p.tpl, meta) : p.title,
    detail: p.detail, note: p.note, repeat: true,
  }));
}

/**
 * 지난주 보고서에서 이번주 보고서를 만든다.
 *  1) 미완료 항목은 각 구분 그대로 승계
 *  2) 지난주 "차주 예정업무"는 이번주 점검룰생성 및 고시사항으로 내려온다
 *  3) '매주 반복'으로 표시한 차주 항목은 다음 주 차주란에 다시 생성
 *  4) 지원 건수는 0으로, 작성일자·주차는 자동
 */
export function createNextWeek(prev, opts = {}) {
  const baseDate = opts.date || shiftWeeks(prev.writtenOn, 1);
  const fresh = emptyReport(prev.author, baseDate);
  const meta = weekMeta(fresh.writtenOn);

  const carry = (arr) => arr.filter(isOpen).map((it) => emptyItem({
    title: it.title, detail: it.detail,
    startDate: it.startDate, dueDate: it.dueDate,
    progress: Number(it.progress) || 0, note: it.note, carried: true,
  }));

  for (const k of ['rules', 'support', 'dev', 'test', 'account']) fresh[k] = carry(prev[k]);

  // 이미 승계된 항목과 제목이 같으면 중복으로 쌓지 않는다
  const seen = new Set(['rules', 'support', 'dev', 'test', 'account']
    .flatMap((k) => fresh[k]).map((it) => it.title.trim()));

  // 차주 항목의 제목은 이미 실제 문구다 (토큰은 화면에 두지 않는다)
  for (const p of prev.plan) {
    const title = String(p.title || '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    fresh.rules.push(emptyItem({
      title,
      detail: p.detail,
      startDate: p.startDate || meta.weekStart,
      dueDate: p.dueDate || meta.friday,
      note: p.note,
      carried: true,
    }));
  }

  fresh.plan = carryRepeatPlan(prev, meta);
  return fresh;
}

/** 저장 직전 — 내용이 비어버린 행은 털어낸다 */
export function compact(report) {
  for (const k of ITEM_KEYS) report[k] = report[k].filter(hasContent);
  return report;
}

/* 앱이 스스로 깔아준 차주 예정업무 ('매주' 자동 승계, 첫 보고서 서식).
   초기화해도 남고 새 주차에도 저절로 생기므로, 이것만 있는 보고서는 아직
   안 쓴 것으로 본다. 그 행을 건드리는 순간 auto가 풀려 진짜 내용이 된다. */
const isRepeatBoilerplate = (it) => Boolean(it.auto);

/** 초기화 직후처럼 알맹이가 하나도 없는 보고서인가 — 홈에서 '미작성'으로 볼지 가른다 */
export function isEmptyReport(report) {
  if (!report) return true;
  const real = (k) => (report[k] || [])
    .filter((it) => !(k === 'plan' && isRepeatBoilerplate(it)))
    .some(hasContent);
  if (ITEM_KEYS.some(real)) return false;
  // 연차·휴일 표시도 적어둔 내용이다 — 그 주에 쉬었다는 기록이 지워지면 안 된다
  if ((report.dayMarks || []).some(Boolean)) return false;
  return supportTotals(report).grand === 0;
}

/* 첫 보고서에 기본으로 깔아주는 매주 반복 항목.
   SEED_COMMON 은 부서 공통, SEED_BY_MEMBER 는 그 사람에게만 붙는다.
   여기서 지우면 다음부터 새로 시작하는 보고서에 안 나온다. */
const SEED_COMMON = ['{{차주}} 고시 분석 및 내용 정리'];
const SEED_BY_MEMBER = {
  kimdahye: ['질의 답변 건 리뷰 및 복습'],
};

/**
 * 처음 시작할 때 깔아주는 매주 반복 항목.
 * 제목에는 서식이 아니라 치환된 실제 문구가 들어간다.
 * (예: 8월 4주 보고서라면 "2026년 9월 1주 고시 분석 및 내용 정리")
 */
export function seedPlan(dateLike, slug) {
  const meta = weekMeta(dateLike);
  return [...SEED_COMMON, ...(SEED_BY_MEMBER[slug] || [])].map((tpl) =>
    emptyItem({
      auto: true,
      tpl: tpl.includes('{{') ? tpl : '',   // 주차가 들어간 문구만 서식으로 들고 있는다
      title: expandTokens(tpl, meta),
      repeat: true,
    }));
}
