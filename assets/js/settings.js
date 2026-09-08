// 설정 — 저장 위치 확인, 부서 구성원, 백업

import { h, clear, toast } from './util.js?v=20260904143923';
import { store } from './store.js?v=20260904143923';
import { app, go } from './main.js?v=20260904143923';

export function renderSettings() {
  const wrap = h('div');

  // ── 저장 위치 ──────────────────────────────────────────────
  // 부서원은 아무것도 입력하지 않는다. 이 앱이 올라가 있는 웹서버의
  // data 폴더에 그대로 읽고 쓴다 — 같은 주소라 로그인도 계정도 없다.
  const p1 = h('div.panel');
  p1.append(h('h2', '저장 위치'));
  p1.append(h('p.hint', '작성한 보고서는 이 웹서버의 data 폴더에 JSON으로 쌓입니다. 같은 주소를 여는 사람은 모두 서로의 보고서를 함께 봅니다. 따로 로그인하거나 계정을 만들 필요는 없습니다.'));

  p1.append(h('div.form-grid',
    h('label', '저장 폴더'),
    h('code', { style: { fontSize: '12.5px', wordBreak: 'break-all' } }, store.dataUrl()),
  ));

  const status = h('div', { style: { marginTop: '12px', fontSize: '13px' } });
  const testBtn = h('button.btn', '저장 확인');

  testBtn.addEventListener('click', async () => {
    clear(status).append('확인 중…');
    try {
      const r = await store.testConnection();
      clear(status).append(h('span', { style: { color: 'var(--ok)' } },
        `저장 가능 — 읽기 ${r.readable ? '정상' : '실패'}, 쓰기 정상, 목록 ${r.listable ? '자동' : 'index.json 사용'}`));
      if (!r.cleaned) toast('검사용 파일(data/.check.json)이 남았습니다. 서버에서 지워주세요.', 'err');
    } catch (e) {
      clear(status).append(h('span', { style: { color: 'var(--danger)' } }, e.message));
    }
  });

  p1.append(h('div.row', { style: { marginTop: '14px' } }, testBtn));
  p1.append(status);

  p1.append(h('div.callout.warn',
    h('strong', '저장이 안 될 때'),
    h('ul',
      h('li', '“저장 확인”이 실패하면 제출한 내용은 이 브라우저에만 남습니다. 내용이 사라지지는 않지만 다른 사람은 볼 수 없습니다.'),
      h('li', h('span', '웹서버(nginx)에서 data 폴더에 쓰기(WebDAV)가 켜져 있어야 합니다. 설정 방법은 저장소의 ')
        , h('code', 'docs/서버설정.md'), h('span', ' 에 정리해 두었습니다.')),
      h('li', '서버가 열린 뒤 각자 화면에서 다시 제출하면 그때 올라갑니다.'),
    ),
  ));

  wrap.append(p1);

  // ── 구성원 ─────────────────────────────────────────────────
  const p2 = h('div.panel');
  p2.append(h('h2', '부서 구성원'));
  p2.append(h('p.hint', '이름과 폴더명(영문)을 지정합니다. 폴더명은 저장 경로가 되므로 한 번 정하면 바꾸지 마세요.'));

  const list = h('div');
  const draft = app.members.map((m) => ({ ...m }));

  const paint = () => {
    clear(list);
    list.append(h('div.member-row',
      h('label', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, '이름'),
      h('label', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, '폴더명 (영문)'),
      h('span'),
    ));
    draft.forEach((m, i) => {
      const name = h('input', { type: 'text', value: m.name });
      const slug = h('input', { type: 'text', value: m.slug });
      name.addEventListener('input', () => { m.name = name.value; });
      slug.addEventListener('input', () => { m.slug = slug.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''); });
      list.append(h('div.member-row', name, slug,
        h('button.btn.btn-sm.btn-ghost', { onclick: () => { draft.splice(i, 1); paint(); } }, '×')));
    });
  };
  paint();
  p2.append(list);

  p2.append(h('div.row', { style: { marginTop: '12px' } },
    h('button.btn', { onclick: () => { draft.push({ name: '', slug: '' }); paint(); } }, '+ 구성원 추가'),
    h('button.btn.btn-primary', {
      onclick: async () => {
        const clean = draft.filter((m) => m.name.trim() && m.slug.trim());
        if (!clean.length) return toast('최소 한 명은 있어야 합니다.', 'err');
        if (new Set(clean.map((m) => m.slug)).size !== clean.length) return toast('폴더명이 중복됩니다.', 'err');
        try {
          await store.saveMembers(clean);
          app.members = clean;
          if (!clean.some((m) => m.slug === app.slug)) app.slug = clean[0].slug;
          toast('구성원 목록을 저장했습니다.', 'ok');
          go('settings');
        } catch (e) {
          toast(e.message, 'err');
        }
      },
    }, '구성원 저장'),
  ));
  wrap.append(p2);

  // ── 백업 ───────────────────────────────────────────────────
  const p3 = h('div.panel');
  p3.append(h('h2', '백업'));
  p3.append(h('p.hint', '이 브라우저에 저장된 모든 보고서를 JSON 한 파일로 내려받거나 되돌립니다.'));

  const importInput = h('input', { type: 'file', accept: '.json', style: { display: 'none' } });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.reports)) throw new Error('형식이 올바르지 않습니다.');
      for (const r of data.reports) {
        localStorage.setItem(`wwr:local:${r.slug}/${r.report.id}`, JSON.stringify(r.report));
      }
      toast(`${data.reports.length}건을 복원했습니다. 각 주차를 열어 제출하면 웹서버에도 올라갑니다.`, 'ok');
    } catch (e) {
      toast(`가져오기 실패 — ${e.message}`, 'err');
    } finally {
      importInput.value = '';
    }
  });

  p3.append(h('div.row',
    h('button.btn', {
      onclick: () => {
        const reports = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k?.startsWith('wwr:local:') && !k?.startsWith('wwr:cache:')) continue;
          try {
            const raw = JSON.parse(localStorage.getItem(k));
            const slug = k.startsWith('wwr:local:')
              ? k.slice('wwr:local:'.length).split('/')[0]
              : k.split('/')[1];
            if (raw?.id) reports.push({ slug, report: raw });
          } catch { /* 건너뜀 */ }
        }
        const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), reports }, null, 2)],
          { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `주간업무보고_백업_${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove();
      },
    }, '내려받기'),
    h('button.btn', { onclick: () => importInput.click() }, '가져오기'),
    importInput,
  ));
  wrap.append(p3);

  // ── 버전 ───────────────────────────────────────────────────
  // 파일을 손으로 복사해 배포하므로, 새 파일이 실제로 반영됐는지
  // 여기서 확인할 수 있어야 한다. 값은 tools/stamp.sh 가 찍는다.
  const p4 = h('div.panel');
  p4.append(h('h2', '버전'));
  p4.append(h('p.hint',
    `이 화면이 쓰고 있는 파일: ${buildStamp()}. ` +
    '복사한 뒤에도 값이 그대로면 브라우저가 예전 파일을 쥐고 있는 것이니 Ctrl+F5로 새로고침하세요.'));
  wrap.append(p4);

  return wrap;
}

/** index.html 이 불러온 진입 스크립트에 찍힌 ?v= 값 (YYYYMMDDHHMMSS) */
function buildStamp() {
  const src = document.querySelector('script[src*="assets/js/main.js"]')?.getAttribute('src') || '';
  const m = /\?v=(\d{14})/.exec(src);
  if (!m) return '표시 없음';
  const s = m[1];
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}
