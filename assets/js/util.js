// 공통 유틸 — 날짜/주차 계산, DOM 헬퍼

export const pad2 = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' (로컬 기준) */
export function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' → Date (로컬 자정) */
export function fromISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** 해당 날짜가 속한 주의 월요일 (주 시작 = 월요일) */
export function mondayOf(d) {
  const dow = d.getDay();               // 0=일 … 6=토
  const back = dow === 0 ? 6 : dow - 1; // 일요일은 직전 월요일에 붙임
  return addDays(d, -back);
}

/** 해당 주의 금요일 */
export function fridayOf(d) {
  return addDays(mondayOf(d), 4);
}

/**
 * 주차 규칙 — 기존 엑셀 양식과 동일하게 맞춤.
 *   그 주 "금요일"이 속한 달의, 몇 번째 금요일인지가 곧 주차.
 *   (검증: 7/3→7월1주, 7/10→7월2주, 7/16→7월3주, 7/24→7월4주, 7/31→7월5주, 8/7→8월1주)
 * 주가 달을 걸쳐도 금요일 기준이라 배정이 흔들리지 않는다.
 */
export function weekMeta(dateLike) {
  const d = typeof dateLike === 'string' ? fromISO(dateLike) : dateLike;
  const mon = mondayOf(d);
  const fri = addDays(mon, 4);

  const year = fri.getFullYear();
  const month = fri.getMonth() + 1;

  // 그 달의 첫 금요일
  const first = new Date(year, fri.getMonth(), 1);
  const shift = (5 - first.getDay() + 7) % 7;
  const firstFri = 1 + shift;
  const week = Math.floor((fri.getDate() - firstFri) / 7) + 1;

  return {
    year, month, week,
    label: `${month}월 ${week}주`,
    longLabel: `${year}년 ${month}월 ${week}주`,
    weekStart: toISO(mon),
    weekEnd: toISO(addDays(mon, 6)),
    friday: toISO(fri),
    id: `${year}-${pad2(month)}-${week}`,
  };
}

/** 주차 id ('2026-08-1') → weekMeta */
export function metaFromId(id) {
  const m = /^(\d{4})-(\d{2})-(\d+)$/.exec(id);
  if (!m) return null;
  const [, ys, ms, ws] = m;
  const year = +ys, month = +ms, week = +ws;
  const first = new Date(year, month - 1, 1);
  const shift = (5 - first.getDay() + 7) % 7;
  const friDate = 1 + shift + (week - 1) * 7;
  return weekMeta(new Date(year, month - 1, friDate));
}

export function shiftWeeks(dateLike, n) {
  const d = typeof dateLike === 'string' ? fromISO(dateLike) : dateLike;
  return addDays(d, n * 7);
}

export function quarterOf(month) { return Math.floor((month - 1) / 3) + 1; }

/** '2026-08-07' → '08/07' 같은 짧은 표기 */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${+m[2]}/${+m[3]}` : (iso || '');
}

// ── DOM ────────────────────────────────────────────────────────

/** h('div.cls', {attr}, ...children) */
export function h(spec, props, ...kids) {
  const [tag, ...classes] = String(spec).split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');

  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (props !== undefined && props !== null) {
    kids.unshift(props);
  }

  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** textarea 높이를 내용에 맞춤 */
export function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(22, ta.scrollHeight) + 'px';
}

let toastTimer = 0;
export function toast(msg, kind = '') {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const t = h('div.toast', { class: kind }, msg);
  wrap.append(t);
  clearTimeout(toastTimer);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** UTF-8 안전 base64 (Contents API 용) */
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
