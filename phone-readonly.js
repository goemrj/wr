// 핸드폰용 읽기 사본에만 얹는 껍데기 — 앱 소스는 건드리지 않는다.
// tools/phone-export.ps1 이 복사본 index.html 에만 끼워 넣는다.
//
// 하는 일이 둘뿐이다.
//   1) '누구세요' 를 묻지 않게 사람을 미리 정해 둔다 (사본에는 한 사람뿐이다)
//   2) 읽기 전용이라는 것과 언제 만든 사본인지 위에 적어 둔다
//
// 쓰기 단추는 phone-readonly.css 가 감춘다. 이 사본은 깃허브에 올라가
// 있어서 서버에 저장할 수 없다.

(() => {
  'use strict';

  // 앱보다 먼저 돌아야 한다 (main.js 는 module 이라 문서를 다 읽은 뒤 실행된다)
  try {
    const cfg = JSON.parse(localStorage.getItem('wwr:cfg') || '{}');
    if (!cfg.me && window.WR_ME) {
      localStorage.setItem('wwr:cfg', JSON.stringify({ ...cfg, me: window.WR_ME }));
    }
  } catch { /* 저장소가 막혀 있으면 앱이 알아서 첫 사람을 고른다 */ }

  const paint = () => {
    if (document.querySelector('.ro-note')) return;
    const bar = document.getElementById('topbar');
    if (!bar) return;

    const note = document.createElement('div');
    note.className = 'ro-note';

    const strong = document.createElement('strong');
    strong.textContent = '읽기 전용 사본';
    note.append(strong);

    const when = document.createElement('span');
    when.textContent = window.WR_STAMP
      ? `${window.WR_STAMP} 기준 · 사무실 PC 에서 갱신합니다`
      : '사무실 PC 에서 갱신합니다';
    note.append(when);

    bar.after(note);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else {
    paint();
  }
})();
