// 저장소 — 이 앱이 올라가 있는 웹서버(nginx)의 data 폴더에 직접 읽고 쓴다.
//
// 파일 배치:
//   data/members.json          부서 구성원 목록
//   data/<슬러그>/<주차>.json   보고서 한 건  (예: data/kimdahye/2026-08-4.json)
//
// 읽기는 그냥 GET. 쓰기는 nginx의 WebDAV(ngx_http_dav_module)에 PUT/DELETE 를 보낸다.
// 목록은 nginx의 autoindex(JSON 형식)로 폴더를 훑어 만든다.
//
//   PUT    <앱주소>/data/<슬러그>/<주차>.json    본문 = 보고서 JSON
//   DELETE <앱주소>/data/<슬러그>/<주차>.json
//   GET    <앱주소>/data/                       → [{name, type}, …]
//
// 전부 앱과 같은 출처라서 CORS도, 로그인도, 계정도 필요 없다.
// 서버 쪽 설정은 docs/서버설정.md 참고.
//
// 쓰기가 막혀 있으면(DAV 미설정, 권한 없음, 오프라인) 조용히 이 브라우저에
// 보관하고 그 사실을 알려준다 — 작성 중인 내용을 잃지 않는 게 우선이다.

import { DEFAULT_MEMBERS, normalize } from './model.js?v=20260904143923';

const CFG_KEY = 'wwr:cfg';
const CACHE_PREFIX = 'wwr:cache:';
const DRAFT_PREFIX = 'wwr:draft:';
const LOCAL_PREFIX = 'wwr:local:';
// 지운 보고서 표식. 서버 쓰기가 막힌 상태에서 지웠을 때, 서버에 남아 있는
// 옛 파일이 다시 살아나지 않게 이 브라우저에 지웠다는 사실을 남긴다.
const GONE_PREFIX = 'wwr:gone:';

const DEFAULTS = {
  me: '',   // 내가 누구인지만 기억한다. 계정 정보는 이 앱이 다루지 않는다.
};

const lsGet = (k, dflt = null) => {
  try { const v = localStorage.getItem(k); return v === null ? dflt : JSON.parse(v); }
  catch { return dflt; }
};
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 용량 초과 무시 */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* noop */ } };

export const cfg = {
  read() { return { ...DEFAULTS, ...(lsGet(CFG_KEY) || {}) }; },
  write(patch) {
    const next = { ...cfg.read(), ...patch };
    lsSet(CFG_KEY, next);
    return next;
  },
};

export class SaveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SaveError';
    this.status = status;
  }
}

// ── 경로 규칙 ─────────────────────────────────────────────────

export const reportPath = (slug, id) => `data/${slug}/${id}.json`;
const MEMBERS_PATH = 'data/members.json';
const INDEX_PATH = 'data/index.json';
const DATA_DIR = 'data/';

/** 앱 위치 기준 상대 경로 — 하위 경로(/WeeklyReport/)에 배포돼도 맞게 잡힌다 */
const url = (path) => new URL(path, document.baseURI).href;

// ── 서버 입출력 ───────────────────────────────────────────────

/**
 * 서버에서 읽는다. 캐시를 타지 않게 시각을 붙인다.
 *
 * "없다(404)"와 "못 물어봤다(연결 실패·서버 오류)"를 반드시 구분한다.
 * 404는 그 보고서가 서버에서 지워졌다는 확실한 답이므로 예전에 받아둔
 * 캐시를 버려야 한다. 이걸 뭉뚱그리면 남이 지운 보고서가 내 화면에서만
 * 되살아난다.
 *   { data }    읽었다
 *   { gone }    서버에 없다 (확실)
 *   { offline } 물어보지 못했다
 */
async function fetchJson(path) {
  let res;
  try {
    res = await fetch(`${url(path)}?t=${Date.now()}`, { cache: 'no-store' });
  } catch {
    return { offline: true };
  }
  if (res.status === 404) return { gone: true };
  if (!res.ok) return { offline: true };
  try { return { data: await res.json() }; } catch { return { offline: true }; }
}

/** 있으면 내용, 없거나 못 읽으면 null — 구분이 필요 없는 곳에서 쓴다 */
async function readJson(path) {
  return (await fetchJson(path)).data ?? null;
}

const WRITE_HINT = '웹서버에 저장하지 못했습니다';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 잠깐 지나가는 실패인가.
 * 0   브라우저가 요청을 아예 못 보냄 (연결 끊김)
 * 499 nginx가 요청을 받다가 끊음 — 서버가 새 파일을 받아가는 동안(배포) 이런다
 * 5xx 서버가 잠시 맛이 감
 */
const isTransient = (status) => status === 0 || status === 499 || status >= 500;

/** 한 번 보내고 상태만 돌려준다 (예외를 던지지 않는다) */
async function send(path, init) {
  try {
    const res = await fetch(url(path), init);
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * 보내고, 지나가는 실패면 한 번만 조용히 다시 시도한다.
 * 배포 중에 저장을 눌렀다는 이유로 작성한 내용이 막히면 안 된다.
 */
async function sendRetrying(path, init) {
  const first = await send(path, init);
  if (!isTransient(first)) return first;
  await sleep(700);
  return send(path, init);
}

/** data 폴더에 파일을 쓴다 (nginx WebDAV) */
async function writeJson(path, value) {
  const status = await sendRetrying(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(value, null, 2),
  });
  // DAV는 새 파일이면 201, 덮어쓰면 204를 준다
  if (status === 201 || status === 204 || (status >= 200 && status < 300)) return status;
  if (status === 0) {
    throw new SaveError(`${WRITE_HINT} — 서버에 연결하지 못했습니다. 사내망 연결을 확인해주세요.`, 0);
  }
  throw new SaveError(`${WRITE_HINT} (${status}) — ${saveHint(status)}`, status);
}

async function deleteFile(path) {
  const status = await sendRetrying(path, { method: 'DELETE' });
  if (status === 404) return 404;             // 이미 없으면 지운 것과 같다
  if (status >= 200 && status < 300) return status;
  if (status === 0) throw new SaveError('서버에 연결하지 못했습니다.', 0);
  throw new SaveError(`서버에서는 지우지 못했습니다 (${status}) — ${saveHint(status)}`, status);
}

function saveHint(status) {
  if (status === 405) return '쓰기(WebDAV)가 켜져 있지 않습니다.';
  if (status === 403) return 'data 폴더에 쓸 권한이 없습니다.';
  if (status === 409) return 'data 폴더가 없거나 하위 폴더를 만들지 못했습니다.';
  if (status === 413) return '내용이 서버 허용 크기를 넘었습니다.';
  if (status === 499) return '서버가 요청을 받다가 끊었습니다. 잠시 뒤 다시 눌러주세요.';
  if (status >= 500) return '서버가 잠시 응답하지 못했습니다. 잠시 뒤 다시 눌러주세요.';
  return '서버 설정을 확인해주세요.';
}

/**
 * 서버 파일이 지운 시각보다 나중에 저장된 것인가.
 * 옛 표식은 true 로 저장돼 있었다 — 시각을 알 수 없으니 지운 상태로 둔다.
 */
function isAfter(updatedAt, goneAt) {
  return typeof goneAt === 'string' && typeof updatedAt === 'string' && updatedAt > goneAt;
}

/* ── 사람별 목록 파일 ──────────────────────────────────────────
 *
 * data/<슬러그>/index.json  =  ["2026-08-4", "2026-09-1", …]
 *
 * 서버가 폴더 목록을 안 내주더라도(autoindex 꺼짐) 기록 조회와 통계가
 * 남의 보고서를 찾을 수 있어야 한다. 그래서 저장·삭제할 때마다 앱이
 * 이 파일을 같이 고쳐 둔다. 서버 설정을 손댈 필요가 없다.
 *
 * 사람마다 파일이 따로라, 두 사람이 동시에 제출해도 서로의 목록을
 * 덮어쓰지 않는다.
 */
const memberIndexPath = (slug) => `data/${slug}/index.json`;

async function readMemberIndex(slug) {
  const list = await readJson(memberIndexPath(slug));
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : null;
}

/** 목록에 주차를 넣거나 뺀다. 실패해도 저장 자체는 이미 끝났으므로 조용히 넘긴다. */
async function updateMemberIndex(slug, id, add) {
  const cur = (await readMemberIndex(slug)) || [];
  const has = cur.includes(id);
  if (add === has) return;                     // 이미 맞게 되어 있다
  const next = add ? [...cur, id].sort() : cur.filter((x) => x !== id);
  try { await writeJson(memberIndexPath(slug), next); } catch { /* 목록은 다음 제출 때 다시 맞춰진다 */ }
}

/**
 * nginx autoindex(JSON)로 폴더 안을 훑는다.
 * 켜져 있지 않으면 null — 그때는 data/index.json 으로 넘어간다.
 */
async function listDir(path) {
  const rows = await readJson(path);
  if (!Array.isArray(rows)) return null;
  return rows.filter((r) => r && typeof r.name === 'string');
}

// ── 공개 API ──────────────────────────────────────────────────

export const store = {
  /** 화면에 보여줄 저장 위치 */
  dataUrl() { return url(DATA_DIR); },

  // 구성원 ------------------------------------------------------

  async loadMembers() {
    const cached = lsGet('wwr:members');
    const list = await readJson(MEMBERS_PATH);
    if (Array.isArray(list) && list.length) { lsSet('wwr:members', list); return list; }
    return cached || DEFAULT_MEMBERS;
  },

  async saveMembers(list) {
    lsSet('wwr:members', list);
    await writeJson(MEMBERS_PATH, list);
    return { saved: true };
  },

  // 보고서 ------------------------------------------------------

  /** 전체 보고서 색인 [{slug, id, path}] */
  async index() {
    let out = [];

    // 1) 서버가 폴더 목록을 내주면(autoindex) 그게 가장 정확하다
    const dirs = await listDir(DATA_DIR);
    if (dirs) {
      for (const d of dirs) {
        if (d.type && d.type !== 'directory') continue;
        const slug = d.name.replace(/\/$/, '');
        const files = await listDir(`${DATA_DIR}${slug}/`);
        for (const f of (files || [])) {
          const m = /^(.+)\.json$/.exec(f.name);
          if (!m || m[1] === 'index') continue;   // 목록 파일 자체는 보고서가 아니다
          out.push({ slug, id: m[1], path: reportPath(slug, m[1]) });
        }
      }
    }

    // 2) 폴더 목록을 못 받으면 앱이 스스로 적어둔 사람별 목록을 읽는다.
    //    서버를 손대지 않아도 되도록 저장할 때마다 이 파일을 같이 갱신한다.
    if (!out.length) {
      const members = lsGet('wwr:members') || DEFAULT_MEMBERS;
      for (const m of members) {
        if (!m?.slug) continue;
        for (const id of (await readMemberIndex(m.slug)) || []) {
          out.push({ slug: m.slug, id, path: reportPath(m.slug, id) });
        }
      }
    }

    // 3) 그것도 없으면 예전 방식의 공용 색인
    if (!out.length) {
      const list = await readJson(INDEX_PATH);
      for (const row of (Array.isArray(list) ? list : [])) {
        if (!row?.slug || !row?.id) continue;
        out.push({ slug: row.slug, id: row.id, path: reportPath(row.slug, row.id), static: true });
      }
    }

    // 지운 보고서는 뺀다 — 서버에 파일이 남아 있어도 마찬가지다
    out = out.filter((o) => !lsGet(GONE_PREFIX + o.path));

    // 아직 서버에 못 올린 로컬 보고서도 목록에 노출
    for (const local of this.localIndex()) {
      if (!out.some((o) => o.slug === local.slug && o.id === local.id)) out.push({ ...local, localOnly: true });
    }
    return out;
  },

  /**
   * 이 보고서가 서버와 어긋나 있는가 — 다른 자리에서 보이는 모습과 다른 경우다.
   *   'ok'      서버와 같다
   *   'local'   이 브라우저에만 있다 (아직 못 올림). 다른 사람은 못 본다.
   *   'pending' 여기서는 지웠는데 서버에는 남아 있다. 다른 사람은 아직 본다.
   * 지움 표식이 있을 때만 서버를 한 번 더 확인하므로 평소엔 추가 요청이 없다.
   */
  async syncState(slug, id) {
    const path = reportPath(slug, id);
    if (lsGet(LOCAL_PREFIX + `${slug}/${id}`)) return 'local';
    const goneAt = lsGet(GONE_PREFIX + path);
    if (goneAt) {
      const remote = await readJson(path);
      return (remote && !isAfter(remote.updatedAt, goneAt)) ? 'pending' : 'ok';
    }
    return 'ok';
  },

  localIndex() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LOCAL_PREFIX)) continue;
      const rest = k.slice(LOCAL_PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash < 0) continue;
      const slug = rest.slice(0, slash), id = rest.slice(slash + 1);
      out.push({ slug, id, path: reportPath(slug, id), local: true });
    }
    return out;
  },

  async load(slug, id) {
    const path = reportPath(slug, id);

    const res = await fetchJson(path);
    const remote = res.data;

    // 1) 서버가 최신이다
    if (remote) {
      // 여기서 지운 보고서인데 서버에 아직 파일이 남아 있는 경우.
      // 서버 것이 그 뒤에 다시 저장된 게 아니라면 지운 상태를 유지한다 —
      // 그러지 않으면 서버 쓰기가 막혀 있는 동안 삭제가 매번 되살아난다.
      const goneAt = lsGet(GONE_PREFIX + path);
      if (goneAt && !isAfter(remote.updatedAt, goneAt)) return null;
      if (goneAt) lsDel(GONE_PREFIX + path);   // 누군가 그 뒤에 다시 올렸다

      const parsed = normalize(remote);
      lsSet(CACHE_PREFIX + path, parsed);
      // 서버 것이 내 로컬본보다 최신이면 로컬본은 역할이 끝났다
      const local = lsGet(LOCAL_PREFIX + `${slug}/${id}`);
      if (local && !(local.updatedAt > remote.updatedAt)) lsDel(LOCAL_PREFIX + `${slug}/${id}`);
      else if (local) return normalize(local);
      return parsed;
    }

    // 2) 서버가 "없다"고 확실히 답했다.
    //    남이 지웠을 수도 있으므로 예전에 받아둔 캐시는 버린다 —
    //    붙들고 있으면 지운 보고서가 내 화면에서만 계속 살아 있다.
    if (res.gone) {
      lsDel(CACHE_PREFIX + path);
      lsDel(GONE_PREFIX + path);   // 서버에도 없으니 지움 표식은 할 일이 끝났다
      const mine = lsGet(LOCAL_PREFIX + `${slug}/${id}`);
      return mine ? normalize(mine) : null;   // 아직 못 올린 내 것만 남긴다
    }

    // 3) 서버에 물어보지 못했다 (연결 실패·서버 오류) — 있는 것으로 버틴다
    if (lsGet(GONE_PREFIX + path)) return null;

    const local = lsGet(LOCAL_PREFIX + `${slug}/${id}`);
    if (local) return normalize(local);

    const cached = lsGet(CACHE_PREFIX + path);
    return cached ? normalize(cached) : null;
  },

  /**
   * 보고서 저장. 웹서버에 쓰고, 막혀 있으면 이 브라우저에 보관한다.
   * 돌려주는 mode: 'server' = 서버에 올라감, 'local' = 이 브라우저에만.
   */
  async save(report, slug) {
    const path = reportPath(slug, report.id);
    report.updatedAt = new Date().toISOString();

    // 먼저 브라우저에 붙잡아 둔다 — 서버가 실패해도 내용은 남아야 한다
    lsSet(LOCAL_PREFIX + `${slug}/${report.id}`, report);
    lsDel(GONE_PREFIX + path);

    try {
      await writeJson(path, report);
    } catch (e) {
      return { mode: 'local', reason: e.message };
    }

    lsSet(CACHE_PREFIX + path, report);
    lsDel(LOCAL_PREFIX + `${slug}/${report.id}`);
    await updateMemberIndex(slug, report.id, true);   // 기록 조회·통계가 찾을 수 있게
    return { mode: 'server' };
  },

  /**
   * 보고서 삭제. 저장과 같은 규칙을 따른다 —
   * 서버가 안 열려 있어도 이 브라우저에서는 지운 것으로 하고 그 사실만 알린다.
   */
  async remove(slug, id) {
    const path = reportPath(slug, id);
    lsSet(GONE_PREFIX + path, new Date().toISOString());   // 언제 지웠는지 남긴다
    lsDel(LOCAL_PREFIX + `${slug}/${id}`);
    lsDel(CACHE_PREFIX + path);
    lsDel(DRAFT_PREFIX + `${slug}:${id}`);
    try {
      await deleteFile(path);
    } catch (e) {
      return { mode: 'local', reason: e.message };
    }
    await updateMemberIndex(slug, id, false);
    return { mode: 'server' };
  },

  // 작성 중 초안 (제출 전 내용 보호) -----------------------------

  saveDraft(slug, report) { lsSet(DRAFT_PREFIX + `${slug}:${report.id}`, report); },
  loadDraft(slug, id) { const d = lsGet(DRAFT_PREFIX + `${slug}:${id}`); return d ? normalize(d) : null; },
  clearDraft(slug, id) { lsDel(DRAFT_PREFIX + `${slug}:${id}`); },

  /** 아직 제출 안 한 초안 목록 [{slug, id}] — 색인에는 안 올라오는 것들이다 */
  draftIndex() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      const rest = k.slice(DRAFT_PREFIX.length);
      const colon = rest.indexOf(':');
      if (colon < 0) continue;
      out.push({ slug: rest.slice(0, colon), id: rest.slice(colon + 1) });
    }
    return out;
  },

  /**
   * 서버에 정말 쓸 수 있는지 확인한다.
   * 실제 보고서를 건드리지 않도록 검사용 파일을 하나 썼다가 바로 지운다.
   */
  async testConnection() {
    const probe = `${DATA_DIR}.check.json`;
    const readable = (await readJson(MEMBERS_PATH)) !== null || (await listDir(DATA_DIR)) !== null;
    await writeJson(probe, { at: new Date().toISOString() });
    let cleaned = true;
    try { await deleteFile(probe); } catch { cleaned = false; }
    return {
      readable,
      listable: (await listDir(DATA_DIR)) !== null,
      cleaned,
    };
  },
};
