import { analyzeMatch, fmtTime, fmtNum, ROLE_NAMES, WEIGHTS, COMPONENTS, TIERS } from './analyzer.js';
import { analyzeItems } from './items.js';
import { analyzePro } from './probuild.js';

const CDN = 'https://cdn.cloudflare.steamstatic.com';
const app = document.getElementById('app');
const tip = document.getElementById('tip');
const MODES = { 1: 'All Pick', 2: "Captain's Mode", 3: 'Random Draft', 4: 'Single Draft', 5: 'All Random', 16: 'Captains Draft', 18: 'Ability Draft', 22: 'Ranked All Pick', 23: 'Turbo' };
const TEAM_RU = { radiant: 'Radiant', dire: 'Dire' };
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

let consts = null;
let itemById = {};
const state = { a: null, sel: null, me: null, nwTeam: null, tlAll: false };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const heroImg = (h) => (h?.img ? CDN + h.img : '');
const heroIcon = (h) => (h?.icon ? CDN + h.icon : '');
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`;
const pts = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;
const ruinColor = (v) => (v >= 68 ? 'var(--crit)' : v >= 58 ? 'var(--serious)' : v >= 45 ? 'var(--text-3)' : v >= 34 ? 'var(--radiant)' : 'var(--good)');
const badBg = (v) => (v >= 75 ? '#e66767' : v >= 60 ? '#ec835a' : v > 40 ? '#8b8a82' : v > 25 ? '#5fc7a0' : '#58c758');

// Режим определяется один раз: если рядом отвечает локальный сервер (api/ping) — ходим к нему,
// иначе (GitHub Pages, любой статичный хостинг) тот же набор запросов выполняется прямо в браузере.
let modePromise;
function detectMode() {
  modePromise ||= (async () => {
    try {
      const r = await fetch('api/ping', { cache: 'no-store' });
      if (r.ok && (await r.json()).ok) return { mode: 'server' };
    } catch { /* сервера нет */ }
    const [{ createBackend }, { openStore }] = await Promise.all([import('./opendota.js'), import('./store.js')]);
    const store = await openStore();
    const onWait = (s) => {
      const c = document.querySelector('#app .center');
      if (c?.lastChild?.nodeType === 3) c.lastChild.nodeValue = `OpenDota просит подождать (лимит запросов), ещё около ${s} с…`;
    };
    return { mode: 'static', persistent: store.persistent, backend: createBackend({ store, mode: 'static', onWait }) };
  })();
  return modePromise;
}

async function api(path, init) {
  const m = await detectMode();
  if (m.mode === 'server') {
    const res = await fetch(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Ошибка ${res.status}`);
    return body;
  }
  const [route, query = ''] = path.replace(/^\/?api/, '').split('?');
  const r = await m.backend.handle(init?.method || 'GET', route, new URLSearchParams(query));
  if (r.status >= 400) throw new Error(r.body?.error || `Ошибка ${r.status}`);
  return r.body;
}
async function loadConsts() {
  if (consts) return consts;
  consts = await api('api/constants');
  for (const [key, it] of Object.entries(consts.items)) itemById[it.id] = { ...it, key };
  return consts;
}
const loading = (text) => { app.innerHTML = `<div class="center"><div class="spinner"></div>${esc(text)}</div>`; };
const fail = (text) => { app.innerHTML = `<div class="center"><h2>Не получилось</h2><p>${esc(text)}</p><p><a href="#/">На главную</a></p></div>`; };

// ---------- ввод ----------
function parseInput(raw) {
  const s = raw.trim();
  let m;
  if ((m = s.match(/players?\/(\d+)/i))) return { kind: 'player', id: m[1] };
  if ((m = s.match(/match(?:es)?\/(\d+)/i))) return { kind: 'match', id: m[1] };
  if ((m = s.match(/^\d+$/))) {
    if (s.length === 17 && s.startsWith('7656')) return { kind: 'player', id: String(BigInt(s) - 76561197960265728n) };
    return { kind: 'auto', id: s };
  }
  return null;
}
document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('q');
  const r = parseInput(input.value);
  if (!r) { input.setCustomValidity('Нужен ID матча, ссылка на матч или на профиль'); input.reportValidity(); return; }
  input.setCustomValidity('');
  location.hash = r.kind === 'player' ? `#/player/${r.id}` : r.kind === 'match' ? `#/match/${r.id}` : `#/auto/${r.id}`;
});
document.getElementById('q').addEventListener('input', (e) => e.target.setCustomValidity(''));

// ---------- роутер ----------
async function route() {
  tip.hidden = true;
  const [, kind, id, extra] = location.hash.split('/');
  try {
    if (kind === 'match' && id) return await showMatch(id, extra);
    if (kind === 'player' && id) return await showPlayer(id);
    if (kind === 'auto' && id) {
      loading('Ищу матч…');
      try { await api(`api/match/${id}`); location.replace(`#/match/${id}`); } catch { location.replace(`#/player/${id}`); }
      return;
    }
    if (kind === 'method') return showMethod();
    return await showHome();
  } catch (e) { fail(e.message); }
}
window.addEventListener('hashchange', route);

// ---------- главная ----------
async function showHome() {
  await loadConsts();
  const standalone = (await detectMode()).mode === 'static';
  const history = await api('api/history').catch(() => []);
  const icons = (ids) => ids.map((id) => `<img src="${heroIcon(consts.heroes[id])}" alt="" loading="lazy">`).join('');
  app.innerHTML = `
    <div class="hero-home">
      <h1>Кто <b>заруинил</b> катку?</h1>
      <p>Вставь ID матча или ссылку с Dotabuff — сайт разберёт игру по лайнингу, смертям, фарму, дракам, вижену и покажет,
      кто виноват в поражении, с конкретными причинами и таймингами. Можно вставить ссылку на профиль и выбрать игру из последних.</p>
    </div>
    <section><div class="steps">
      <div class="card"><b>1. Вставь матч</b><span>ID, ссылка Dotabuff, OpenDota или Stratz. Данные берутся из открытого API OpenDota.</span></div>
      <div class="card"><b>2. Получи вердикт</b><span>Каждому игроку считается индекс руина 0–100 из 30+ метрик с поправкой на позицию.</span></div>
      <div class="card"><b>3. Смотри доказательства</b><span>Причины с числами, проигранные драки, кто умер первым, кто не пришёл, где игра сломалась.</span></div>
    </div></section>
    ${standalone ? `<p class="muted" style="font-size:13px;max-width:760px">Сайт работает прямо в браузере: данные берутся напрямую из OpenDota, а история разобранных матчей хранится только на этом устройстве.
      Первый разбор занимает 20–40 секунд (загружаются справочники и статистика героев), следующие — быстрее.</p>` : ''}
    ${history.length ? `<section><div class="tl-head"><div class="h2" style="margin:0">Недавно разобранные</div>
      <button class="btn ghost" id="clearAll">Очистить всё</button></div><div class="mlist">${history.map((h) => `
      <a class="mrow" href="#/match/${h.id}">
        <span class="num">${h.id}</span>
        <span class="icons">${icons(h.radiant)}</span><span class="vs">vs</span><span class="icons">${icons(h.dire)}</span>
        <span class="grow"></span>
        <span class="pill win-${h.radiant_win ? 'radiant' : 'dire'}">Победа ${h.radiant_win ? 'Radiant' : 'Dire'}</span>
        <span class="muted num">${fmtTime(h.duration)}</span>
        <span class="muted">${new Date(h.start_time * 1000).toLocaleDateString('ru-RU')}</span>
        <button class="del" data-del="${h.id}" title="Удалить из истории" aria-label="Удалить матч ${h.id} из истории">×</button>
      </a>`).join('')}</div></section>` : ''}`;
  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await api(`api/history/${b.dataset.del}`, { method: 'DELETE' });
    showHome();
  }));
  document.getElementById('clearAll')?.addEventListener('click', async () => {
    if (!confirm(`Удалить из истории все матчи (${history.length})?`)) return;
    await api('api/history', { method: 'DELETE' });
    showHome();
  });
}

// ---------- профиль ----------
async function showPlayer(id) {
  loading('Загружаю последние матчи игрока…');
  await loadConsts();
  const p = await api(`api/player/${id}`);
  app.innerHTML = `
    <div class="mhead">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" width="48" height="48" style="border-radius:8px">` : ''}
      <h1>${esc(p.name)}</h1><span class="pill">ID ${esc(id)}</span></div>
    <section><div class="h2">Последние матчи — выбери игру для разбора</div><div class="mlist">${p.matches.map((x) => {
      const rad = x.player_slot < 128, win = rad === x.radiant_win, h = consts.heroes[x.hero_id];
      return `<a class="mrow" href="#/match/${x.match_id}/${id}">
        <span class="wl ${win ? 'w' : 'l'}">${win ? 'W' : 'L'}</span>
        <span class="icons"><img src="${heroIcon(h)}" alt=""></span><b>${esc(h?.dname || '')}</b>
        <span class="num sec">${x.kills}/${x.deaths}/${x.assists}</span>
        <span class="grow"></span>
        <span class="pill">${esc(MODES[x.game_mode] || 'Другой режим')}</span>
        <span class="muted num">${fmtTime(x.duration)}</span>
        <span class="muted">${new Date(x.start_time * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      </a>`;
    }).join('') || '<p class="muted">Матчей нет — возможно, история закрыта в настройках Dota 2.</p>'}</div></section>`;
}

// ---------- матч ----------
async function showMatch(id, me, refresh = false) {
  loading((await detectMode()).mode === 'static' ? 'Загружаю данные OpenDota и разбираю матч… первый раз до 40 секунд' : 'Загружаю и разбираю матч…');
  await loadConsts();
  const m = await api(`api/match/${id}${refresh ? '?refresh' : ''}`);
  const base = analyzeMatch(m, consts);
  const heroData = await api(`api/hero-items?ids=${base.players.map((p) => p.hero.id).join(',')}`).catch(() => ({}));
  const enemyIds = (p) => base.teams[p.isRadiant ? 'dire' : 'radiant'].map((e) => e.hero.id).join(',');
  const proData = await api(`api/pro-build?heroes=${base.players.map((p) => `${p.hero.id}${p.pos <= 3 ? 'c' : 's'}:${enemyIds(p)}`).join(';')}`).catch(() => ({}));
  const a = analyzePro(analyzeItems(base, consts, heroData), consts, proData);
  state.a = a;
  state.me = me ? a.players.find((p) => String(p.accountId) === String(me)) || null : null;
  const v = a.verdicts[a.meta.loser];
  state.sel = state.me || v.culprits[0] || [...a.teams[a.meta.loser]].sort((x, y) => y.ruin - x.ruin)[0];
  state.nwTeam = a.meta.loser;
  state.tlAll = false;
  renderMatch();
}

function renderMatch() {
  const a = state.a, meta = a.meta;
  const lose = a.verdicts[meta.loser], win = a.verdicts[meta.winner];
  const calm = lose.kind === 'outplayed';
  app.innerHTML = `
    <div class="mhead">
      <h1>Матч ${meta.id}</h1>
      <div class="score"><span class="rad">${meta.radiantScore}</span><span class="muted">:</span><span class="dire">${meta.direScore}</span></div>
      <span class="pill win-${meta.winner}">Победа ${TEAM_RU[meta.winner]}</span>
      <span class="pill num">${fmtTime(meta.duration)}</span>
      <span class="pill">${esc(MODES[meta.gameMode] || 'Другой режим')}</span>
      <span class="pill">${new Date(meta.startTime * 1000).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}</span>
      <a class="pill" href="https://www.dotabuff.com/matches/${meta.id}" target="_blank" rel="noopener">Dotabuff ↗</a>
    </div>
    ${meta.parsed ? '' : `<div class="card banner"><div class="grow"><b>Базовая точность: реплей ещё не разобран.</b><br>
      <span class="sec">Сейчас доступны только итоговые цифры (KDA, фарм, урон). Лайнинг, драки, варды, тайминги смертей и перелом игры появятся после разбора реплея на OpenDota — обычно 1–3 минуты.</span></div>
      <button class="btn" id="parse">Запросить полный разбор</button></div>`}
    ${meta.turbo ? `<div class="card banner"><div class="grow"><b>Turbo.</b> <span class="sec">Золотые пороги удвоены, вижен почти не учитывается. Сравнение с другими игроками на герое в турбо менее точное.</span></div></div>` : ''}

    <div class="verdict ${calm ? 'calm' : ''}">
      <div class="eyebrow">Вердикт · проиграли ${TEAM_RU[meta.loser]}</div>
      <h2>${esc(lose.title)}</h2>
      <p>${esc(lose.text)}</p>
      ${lose.culprits.length ? `<div class="culprits">${lose.culprits.slice(0, 3).map(culpritCard).join('')}</div>` : ''}
      ${a.story.length ? `<ul class="story">${a.story.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      <div class="sub-verdict"><b>У победителей:</b> ${esc(win.title)}. ${esc(win.text)}</div>
    </div>

    <section><div class="h2">Индекс руина по игрокам — нажми на игрока для разбора</div>
      <div class="teams">${teamTable(meta.loser)}${teamTable(meta.winner)}</div>
      <div id="pdetail"></div>
    </section>

    ${a.series.goldAdv ? `<section><div class="h2">Ход игры</div>
      <div class="card chart-card"><div class="chart-head"><b>Преимущество по золоту</b>
        <div class="legend"><span><i class="box" style="background:var(--radiant)"></i>впереди Radiant</span><span><i class="box" style="background:var(--dire)"></i>впереди Dire</span><span><i class="box" style="background:rgba(255,255,255,.14)"></i>тимфайт</span><span><i class="box" style="background:var(--accent)"></i>ключевая проигранная драка</span></div></div>
        <div id="goldChart"></div></div>
      <div class="card chart-card" style="margin-top:16px"><div class="chart-head"><b>Нетворс игроков</b>
        <div class="tabs" id="nwTabs"><button data-t="radiant">Radiant</button><button data-t="dire">Dire</button></div></div>
        <div class="legend" id="nwLegend"></div><div id="nwChart"></div></div>
    </section>` : ''}

    ${a.lanes.length ? `<section><div class="h2">Линии на 10:00</div><div class="lanes">${a.lanes.map(laneCard).join('')}</div></section>` : ''}

    ${a.events.length ? `<section><div class="tl-head"><div class="h2" style="margin:0">Хронология: где игра сломалась</div>
      <div class="tabs" id="tlTabs"><button data-v="0">Только драки и ключевое</button><button data-v="1">Все события</button></div></div>
      <div class="tl" id="tl"></div></section>` : ''}`;

  app.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('click', () => selectPlayer(+el.dataset.p, true)));
  document.getElementById('parse')?.addEventListener('click', requestParse);
  renderDetail();
  if (a.series.goldAdv) {
    goldChart();
    document.getElementById('nwTabs').addEventListener('click', (e) => { if (e.target.dataset.t) { state.nwTeam = e.target.dataset.t; nwChart(); } });
    nwChart();
  }
  if (a.events.length) {
    document.getElementById('tlTabs').addEventListener('click', (e) => { if (e.target.dataset.v) { state.tlAll = e.target.dataset.v === '1'; renderTimeline(); } });
    renderTimeline();
  }
}

function culpritCard(p) {
  return `<div class="culprit" data-p="${p.idx}">
    <img src="${heroImg(p.hero)}" alt="">
    <div><div class="who">${esc(p.hero.dname)} · ${esc(p.name)}</div>
      <div class="sec" style="font-size:14px">${ROLE_NAMES[p.pos]} · индекс руина <b style="color:var(--text)">${p.ruin}</b> · ${Math.round(p.blame * 100)}% вины</div>
      <ul>${p.reasons.slice(0, 4).map((r) => `<li><span>•</span><span>${esc(r.text)}</span></li>`).join('')}
        ${p.build.score != null ? `<li><span>•</span><span><b style="color:var(--text)">Предметы:</b> ${esc(p.build.summary)}</span></li>` : ''}</ul></div></div>`;
}

function teamTable(name) {
  const a = state.a, lost = name === a.meta.loser;
  const rows = [...a.teams[name]].sort((x, y) => x.pos - y.pos).map((p) => `
    <tr class="prow ${state.sel === p ? 'sel' : ''} ${state.me === p ? 'me' : ''}" data-p="${p.idx}">
      <td><div class="pcell"><img src="${heroImg(p.hero)}" alt="" loading="lazy">
        <div><div class="n">${esc(p.name)}${state.me === p ? ' <span class="muted">(ты)</span>' : ''}</div><div class="r">${esc(p.hero.dname)} · ${ROLE_NAMES[p.pos]}</div></div></div></td>
      <td class="l"><div class="ruinbar"><div class="track"><div class="fill" style="width:${p.ruin}%;background:${ruinColor(p.ruin)}"></div></div><b>${p.ruin}</b></div></td>
      <td class="l"><span class="tier ${p.tier.id}">${p.tier.label}</span></td>
      ${lost ? `<td>${Math.round(p.blame * 100)}%</td>` : ''}
      <td>${p.kills}/${p.deaths}/${p.assists}</td>
      <td>${fmtNum(p.nw)}</td><td>${p.gpm}</td><td>${p.lh}</td><td>${fmtNum(p.hd)}</td><td>${fmtNum(p.td)}</td>
    </tr>`).join('');
  return `<div class="card team"><div class="team-head"><span class="dot" style="background:var(--${name})"></span><b>${esc(a.meta[`${name}Name`])}</b>
    <span class="pill win-${name}">${lost ? 'Поражение' : 'Победа'}</span></div>
    <div class="scroll-x"><table><thead><tr><th>Игрок</th><th class="l">Индекс руина</th><th class="l">Оценка</th>${lost ? '<th>Доля вины</th>' : ''}<th>K/D/A</th><th>Нетворс</th><th>GPM</th><th>LH</th><th>Урон</th><th>По строениям</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function selectPlayer(idx, scroll) {
  state.sel = state.a.players[idx];
  app.querySelectorAll('tr.prow').forEach((tr) => tr.classList.toggle('sel', +tr.dataset.p === idx));
  renderDetail();
  if (scroll) document.getElementById('pdetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDetail() {
  const p = state.sel, a = state.a;
  if (!p) return;
  const itemImg = (id) => (itemById[id]?.img ? `<img src="${CDN + itemById[id].img}" alt="${esc(itemById[id].dname)}" title="${esc(itemById[id].dname)}">` : '');
  const flagPts = p.flags.reduce((s, f) => s + f.pts, 0);
  const comps = p.components.map((c) => {
    const half = Math.abs(c.score - 50);
    const left = c.score >= 50 ? 50 : c.score;
    return `<div class="comp"><span>${c.label}</span>
      <div class="track"><div class="fill" style="left:${left}%;width:${half}%;background:${ruinColor(c.score)}"></div></div>
      <b class="num">${Math.round(c.score)}</b><span class="w num" title="вес компонента × отклонение от 50">${pts(c.contrib)}</span></div>`;
  }).join('');
  const metricRows = p.components.map((c) => `
    <tr class="grp"><td colspan="5">${c.label} — ${Math.round(c.score)} из 100, вес ${Math.round(c.share * 100)}%${c.note ? `<br><span class="muted" style="font-weight:400">${esc(c.note)}</span>` : ''}</td></tr>
    ${c.subs.map((s) => `<tr><td class="l">${esc(s.label)}<br><span class="muted">${esc(s.ref)}</span></td><td class="l">${esc(s.value)}</td>
      <td><span class="badv" style="background:${badBg(s.bad)}">${s.bad}</span></td><td>${Math.round((s.weight / c.subWeight) * 100)}%</td><td>${pts(s.contrib)}</td></tr>`).join('')}`).join('');
  const where = (d) => (d.time < 600 ? 'лайнинг' : d.fight != null ? 'тимфайт' : a.meta.parsed ? 'пойман один' : '');
  const heroBy = Object.fromEntries(a.players.map((x) => [x.hero.name, x.hero]));
  const deaths = p.deathList.map((d) => `<tr><td class="l">${fmtTime(d.time)}</td><td class="l">${esc(heroBy[d.killer]?.dname || (d.killer || '').replace('npc_dota_', '').replace(/_/g, ' '))}</td>
    <td class="l">${where(d)}</td><td>${fmtNum(d.goldFed)}</td><td>${d.timeDead} с</td></tr>`).join('');

  document.getElementById('pdetail').innerHTML = `<div class="card pdetail">
    <div class="pd-head"><img class="h" src="${heroImg(p.hero)}" alt="">
      <div><h3>${esc(p.name)}</h3><div class="sec">${esc(p.hero.dname)} · ${ROLE_NAMES[p.pos]} (позиция ${p.pos}) · ${TEAM_RU[p.team]} · ${p.kills}/${p.deaths}/${p.assists} · уровень ${p.level}</div>
        <div class="items">${p.itemsFinal.map(itemImg).join('')}${p.neutral ? itemImg(p.neutral) : ''}</div>
        ${p.offRole ? `<div class="offrole">Нетипичная роль: ${esc(p.hero.dname)} обычно ${p.offRole === 'core_as_support' ? 'кор, а здесь играл саппортом' : 'саппорт, а здесь играл керри'}. Фарм и урон сравниваются с нормами позиции ${p.pos}, а не с другими игроками на этом герое${p.offRole === 'core_as_support' ? '; вижен весит меньше, драки — больше' : ''}.</div>` : ''}</div>
      <div class="bigscore"><div class="v" style="color:${ruinColor(p.ruin)}">${p.ruin}</div><div class="c">индекс руина · <span class="tier ${p.tier.id}">${p.tier.label}</span></div></div>
    </div>
    <div class="cols">
      <div><div class="h3">Что сделал плохо</div>
        <ul class="reasons">${p.reasons.slice(0, 8).map((r) => `<li><span class="pts">${pts(r.pts)}</span><span><span class="t">${esc(r.text)}</span> <span class="muted">· ${r.comp}</span></span></li>`).join('') || '<li class="muted">Серьёзных претензий нет.</li>'}</ul>
        <div class="h3" style="margin-top:18px">Что сделал хорошо</div>
        <ul class="reasons">${p.pros.slice(0, 5).map((r) => `<li><span class="pts">${pts(r.pts)}</span><span><span class="t">${esc(r.text)}</span> <span class="muted">· ${r.comp}</span></span></li>`).join('') || '<li class="muted">Ничего выдающегося.</li>'}</ul>
      </div>
      <div><div class="h3">Из чего сложился индекс</div>
        ${comps}
        <div class="muted" style="font-size:12.5px;margin-top:4px">Шкала 0–100, вертикальная черта — 50 (средняя игра). Правее — хуже. Справа — вклад компонента в итог.</div>
        <div class="formula num">50 (база) ${p.components.map((c) => `${c.contrib >= 0 ? '+' : '−'} ${Math.abs(c.contrib).toFixed(1)}`).join(' ')}${flagPts ? ` + ${flagPts} (штрафы)` : ''} = <b style="color:var(--text)">${p.ruin}</b></div>
      </div>
    </div>
    <details><summary>Все метрики и расчёт (${p.components.reduce((s, c) => s + c.subs.length, 0)})</summary>
      <div class="scroll-x"><table class="metrics"><thead><tr><th class="l">Метрика и шкала</th><th class="l">Значение</th><th>Плохость 0–100</th><th>Вес в компоненте</th><th>Вклад в индекс</th></tr></thead><tbody>${metricRows}</tbody></table></div>
    </details>
    ${buildBlock(p)}
    ${deaths ? `<details><summary>Все смерти (${p.deathList.length})</summary><div class="scroll-x"><table class="dl"><thead><tr><th class="l">Время</th><th class="l">Кто убил</th><th class="l">Где</th><th>Отдал золота</th><th>В таверне</th></tr></thead><tbody>${deaths}</tbody></table></div></details>` : ''}
  </div>`;
}

// Разбор сборки есть у всех десяти игроков; у виновников из вердикта он сразу раскрыт.
function buildBlock(p) {
  const a = state.a, b = p.build;
  const culprit = a.verdicts.radiant.culprits.includes(p) || a.verdicts.dire.culprits.includes(p);
  const img = (key) => (consts.items[key]?.img ? `<img src="${CDN + consts.items[key].img}" alt="">` : '');
  const ST = { covered: ['ok', 'Закрыто'], hero: ['ok', 'Закрыто героем'], mate: ['ok', 'Закрыл союзник'], early: ['na', 'Не успеть'],
    open: ['bad', 'Не закрыто'], team_ok: ['na', 'Не задача героя · закрыл союзник'], team_open: ['warn', 'Не задача героя · никто не закрыл'] };
  const kills = (n) => `${n} ${[2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'раза' : 'раз'}`;
  const st = (t) => (t.status === 'open' && t.answers[0]?.tier === 'rare' ? ['na', 'Не закрыто · ответ ситуативный'] : ST[t.status]);
  const threats = b.threats.map((t) => `<div class="threat ${st(t)[0]}">
    <div class="th-top"><b>${esc(t.title)}</b><span class="st">${st(t)[1]}</span></div>
    <div class="sec">Источник: ${esc(t.sources.join(', '))} — ${esc(t.why)}.</div>
    ${(t.killsOnMe || t.dmgShare) ? `<div class="sec">Эти герои убили его ${kills(t.killsOnMe)}${t.dmgShare != null ? ` и нанесли ${Math.round(t.dmgShare * 100)}% всего полученного от героев урона (${fmtNum(t.dmg)})` : ''}.</div>` : ''}
    <div class="ans">${t.chips.map((x) => `<span class="tag" title="${esc(x.label)}">${img(x.key)}${esc(x.name)}</span>`).join('')}<span>${esc(t.text)}</span></div>
    ${t.abilities?.length ? `<div class="abl">${t.abilities.map((x) => `<div class="ab ${x.by.length ? 'ok' : 'bad'}">
      <span class="n">${esc(x.name)} <span class="muted">· ${esc(x.hero)}</span></span>
      <span class="meta">${esc(x.types.join(', '))} · ${x.targeted ? 'в цель' : 'по площади'}${x.pierce ? ' · сквозь BKB' : ''} · ${x.uses} ${kills(x.uses).split(' ')[1]}</span>
      <span class="by">${x.by.length ? esc(x.by.join(', ')) : 'не закрыто'}</span></div>`).join('')}
      <div class="muted" style="font-size:12px">Число — сколько раз враг применил это за игру (по всем целям).</div></div>` : ''}
  </div>`).join('');
  const dmgSrc = b.damageSources?.length ? `<div class="h3" style="margin-top:16px">Что наносило ему урон</div>
    <div class="dsrc">${b.damageSources.map((x) => `<div class="drow"><span>${esc(x.name)}${x.hero ? ` <span class="muted">· ${esc(x.hero)}</span>` : ''}${x.pierce ? ' <span class="tag bad">сквозь BKB</span>' : ''}</span>
      <div class="track"><div class="fill" style="width:${Math.round(x.share * 100)}%"></div></div><b class="num">${Math.round(x.share * 100)}%</b><span class="num muted">${fmtNum(x.dmg)}</span></div>`).join('')}</div>
    <div class="muted" style="font-size:12.5px;margin-top:4px">Доля от всего урона, полученного за игру${b.recvTotal ? ` (${fmtNum(b.recvTotal)})` : ''}.</div>` : '';
  const std = b.standard.length ? `<div class="h3" style="margin-top:16px">Что обычно собирают на ${esc(p.hero.dname)}</div>
    <div class="buys">${b.standard.map((x) => `<span class="tag ${x.has ? 'good' : ''}" title="${x.wr != null ? `винрейт с предметом ${Math.round(x.wr * 100)}%` : ''}">${img(x.key)}${esc(x.name)} · ${Math.round(x.share * 100)}% игр${x.has ? ` · есть${x.time != null ? ` на ${fmtTime(x.time)}` : ''}` : ''}</span>`).join('')}</div>
    <div class="muted" style="font-size:12.5px;margin-top:4px">Зелёным — то, что игрок собрал. Статистика OpenDota${b.sample ? `, около ${fmtNum(b.sample)} игр на герое` : ''}; учитываются в основном покупки до 30:00.</div>` : '';
  const TM = { late: ' · поздно', early: ' · рано', ok: '' };
  const timeline = b.timeline.length ? `<div class="h3" style="margin-top:16px">Хронология крупных покупок</div>
    <div class="buys">${b.timeline.map((e) => `<span class="tag ${e.answer ? 'good' : e.timing === 'late' ? 'bad' : ''}">${img(e.key)}<b class="num">${fmtTime(e.time)}</b> ${esc(e.name)}${e.uses != null ? ` · нажал ${e.uses}` : ''}${TM[e.timing] || ''}</span>`).join('')}</div>
    <div class="muted" style="font-size:12.5px;margin-top:4px">Зелёным — предметы, которые отвечают на угрозы врага. Красным — собранные позже, чем обычно на этом герое.</div>` : '';
  return `<details class="build" ${culprit ? 'open' : ''}><summary>Разбор предметов${b.score != null ? ` — ${esc(b.label.toLowerCase())}, ${b.score} из 100` : ''}</summary>
    <p class="sec" style="margin:10px 0">${esc(b.summary)}${b.exact ? '' : ' Реплей не разобран: учитываются только предметы на конец игры, без таймингов.'}${b.offRole ? ` ${esc(p.hero.dname)} на нетипичной для себя позиции ${p.pos}: статистика покупок героя собрана по другой роли, поэтому ответы подобраны по позиции.` : b.sample ? '' : ' Статистика по герою не загрузилась — ответы подобраны по роли, а не по герою.'}</p>
    ${proBlock(p)}
    ${threats ? `<div class="threats">${threats}</div>` : ''}
    ${b.swap ? `<div class="formula">${esc(b.swap.text)}</div>` : ''}
    ${b.notes.length ? `<div class="h3" style="margin-top:16px">Спорные покупки и тайминги</div><ul class="reasons">${b.notes.map((n) => `<li><span>•</span><span class="t">${esc(n)}</span></li>`).join('')}</ul>` : ''}
    ${b.goods.length ? `<div class="h3" style="margin-top:16px">Хорошие тайминги</div><ul class="reasons">${b.goods.map((n) => `<li><span>•</span><span class="t">${esc(n)}</span></li>`).join('')}</ul>` : ''}
    ${dmgSrc}${std}${timeline}
    <div class="muted" style="font-size:12.5px;margin-top:10px">Оценка сборки = доля закрытых угроз с учётом их веса. Считаются только угрозы, на которые этот герой сам собирает ответ. На индекс руина не влияет.</div>
  </details>`;
}

// «Что лучше было собрать»: про-сборка героя в текущем патче и что поменять под этот пик.
function proBlock(p) {
  const pr = p.pro;
  if (!pr) return '';
  const img = (key) => (consts.items[key]?.img ? `<img src="${CDN + consts.items[key].img}" alt="">` : '');
  if (!pr.core.length) {
    const why = a_turbo() ? 'в Turbo про-сборки неприменимы' : `в текущем патче мало про-матчей, где ${p.hero.dname} играл ${pr.role}ом`;
    return `<div class="pro"><div class="h3">Что лучше было собрать</div><div class="muted" style="font-size:13px">Нет данных: ${why}.</div></div>`;
  }
  return `<div class="pro"><div class="h3">Что лучше было собрать <span class="muted" style="font-weight:400;font-size:13px">· патч ${esc(pr.patch)}, ${fmtNum(pr.n)} про-игр на ${esc(p.hero.dname)} в роли ${pr.role}а</span></div>
    <div class="buys">${pr.core.map((c) => `<span class="tag ${c.has ? 'good' : ''}" title="у ${Math.round(c.share * 100)}% про, винрейт ${Math.round(c.wr * 100)}%">${img(c.key)}${esc(c.name)} <span class="num">≈${fmtTime(c.med)}</span>${c.has ? ` · у него ${c.time != null ? fmtTime(c.time) : 'есть'}` : ''}</span>`).join('<span class="arrow">→</span>')}</div>
    ${pr.lines.length ? `<ul class="reasons" style="margin-top:10px">${pr.lines.map((l) => `<li class="${l.important ? 'imp' : ''}" ${l.title ? `title="${esc(l.title)}"` : ''}><span>${l.important ? '!' : '•'}</span><span class="t">${l.key ? img(l.key) : ''}${esc(l.text)}</span></li>`).join('')}</ul>` : '<div class="muted" style="font-size:13px;margin-top:6px">Сборка совпадает с про-сборкой, замечаний нет.</div>'}
  </div>`;
}
const a_turbo = () => state.a?.meta.turbo;

function laneCard(l) {
  const sideHtml = (team) => `<div class="side">${l[team].map((p) => `<img src="${heroIcon(p.hero)}" alt="${esc(p.hero.dname)}" title="${esc(p.hero.dname)}">`).join('') || '<span class="muted">пусто</span>'}
    <span class="sec">${TEAM_RU[team]}</span><span class="g num">${fmtNum(l[team].reduce((s, p) => s + (p.nw10 || 0), 0))}</span></div>`;
  const res = l.winner === 'draw' ? 'Ничья' : l.free ? `Отдана без боя — ${TEAM_RU[l.winner]}` : `${l.crush ? 'Разгром' : 'Победа'} ${TEAM_RU[l.winner]}`;
  return `<div class="card lane"><div class="name">${l.name} линия</div>${sideHtml('radiant')}${sideHtml('dire')}
    <div class="res"><span class="pill ${l.winner === 'draw' ? '' : `win-${l.winner}`}">${res}</span> <span class="muted num">${signed(Math.abs(l.diff))} золота</span></div></div>`;
}

function renderTimeline() {
  const a = state.a;
  document.querySelectorAll('#tlTabs button').forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === state.tlAll));
  const list = a.events.filter((e) => state.tlAll || e.kind === 'fight' || e.kind === 'roshan' || e.kind === 'rax');
  const tag = (p, extra = '', bad = false) => `<span class="tag ${bad ? 'bad' : ''}"><img src="${heroIcon(p.hero)}" alt="">${esc(p.hero.dname)}${extra}</span>`;
  document.getElementById('tl').innerHTML = list.map((e) => {
    let tags = '';
    if (e.kind === 'fight') {
      if (e.firstDead) tags += `<span class="tag bad">Первым умер:</span>${tag(e.firstDead, '', true)}`;
      if (e.absent.length) tags += `<span class="tag bad">Был жив, но не участвовал:</span>${e.absent.map((p) => tag(p, '', true)).join('')}`;
      if (e.died.length) tags += `<span class="tag">Погибли:</span>${e.died.map((d) => tag(d.p, ` ${fmtTime(d.time)}`)).join('')}`;
    }
    return `<div class="ev ${e.winner} ${e.key ? 'key' : ''}"><div class="t">${fmtTime(e.t)}</div><div>
      <div class="ttl">${esc(e.title)}${e.key ? ' <span class="tag bad">ключевой момент</span>' : ''}${e.isTurning ? ' <span class="tag bad">перелом игры</span>' : ''}</div>
      ${e.detail ? `<div class="d">${esc(e.detail)}</div>` : ''}${tags ? `<div class="tags">${tags}</div>` : ''}</div></div>`;
  }).join('');
}

// ---------- графики ----------
function showTip(evt, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX + 14, y = evt.clientY + 14;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - 14;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function niceStep(max, ticks) {
  const raw = max / ticks, pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) || raw;
}
const kfmt = (v) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}к` : `${v}`);

function hoverLayer(svg, { W, H, L, R, T, B, n, onMove }) {
  const cross = svg.querySelector('.cross');
  const rect = svg.querySelector('.hit');
  rect.addEventListener('mousemove', (evt) => {
    const box = svg.getBoundingClientRect();
    const x = ((evt.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - L) / (W - L - R)) * (n - 1))));
    const cx = L + (i / (n - 1)) * (W - L - R);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    showTip(evt, onMove(i));
  });
  rect.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
}

function goldChart() {
  const a = state.a, g = a.series.goldAdv, xp = a.series.xpAdv, n = g.length;
  const W = 1000, H = 280, L = 46, R = 10, T = 10, B = 24;
  const max = Math.max(1000, ...g.map(Math.abs));
  const stepV = niceStep(max, 3), top = Math.ceil(max / stepV) * stepV;
  const X = (i) => L + (i / (n - 1)) * (W - L - R);
  const Y = (v) => T + ((top - v) / (2 * top)) * (H - T - B);
  const line = g.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const area = `${line}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z`;
  let grid = '';
  for (let v = -top; v <= top + 1; v += stepV) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? 'var(--text-3)' : 'var(--line)'}" stroke-width="1"/>
      <text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v === 0 ? '0' : kfmt(Math.abs(v))}</text>`;
  }
  const xt = n > 50 ? 10 : 5;
  for (let i = 0; i < n; i += xt) grid += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${i}:00</text>`;
  const bands = a.events.filter((e) => e.kind === 'fight').map((e) => {
    const x1 = X(e.fight.start / 60), x2 = Math.max(x1 + 4, X(Math.min(n - 1, e.fight.end / 60)));
    return `<rect x="${x1}" y="${T}" width="${x2 - x1}" height="${H - T - B}" fill="${e.key ? 'var(--accent)' : '#fff'}" opacity="${e.key ? 0.35 : 0.1}"/>`;
  }).join('');
  document.getElementById('goldChart').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Преимущество по золоту по минутам">
    <defs><clipPath id="up"><rect x="0" y="0" width="${W}" height="${Y(0)}"/></clipPath><clipPath id="down"><rect x="0" y="${Y(0)}" width="${W}" height="${H}"/></clipPath></defs>
    ${grid}${bands}
    <path d="${area}" fill="var(--radiant)" opacity=".3" clip-path="url(#up)"/><path d="${area}" fill="var(--dire)" opacity=".3" clip-path="url(#down)"/>
    <path d="${line}" fill="none" stroke="var(--radiant)" stroke-width="2" stroke-linejoin="round" clip-path="url(#up)"/>
    <path d="${line}" fill="none" stroke="var(--dire)" stroke-width="2" stroke-linejoin="round" clip-path="url(#down)"/>
    <line class="cross" y1="${T}" y2="${H - B}" stroke="var(--text-2)" stroke-width="1" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  hoverLayer(document.querySelector('#goldChart svg'), { W, H, L, R, T, B, n, onMove: (i) => {
    const lead = (v) => (v === 0 ? 'поровну' : `${v > 0 ? 'Radiant' : 'Dire'} +${fmtNum(Math.abs(v))}`);
    const f = a.fights.filter((x) => Math.floor(x.start / 60) === i);
    return `<b>${i}:00</b><div class="row"><span>Золото</span><b>${lead(g[i])}</b></div>
      ${xp ? `<div class="row"><span>Опыт</span><b>${lead(xp[i] ?? 0)}</b></div>` : ''}
      ${f.map((x) => `<div class="row"><span>Драка ${fmtTime(x.start)}</span><b>${x.winner === 'draw' ? 'ничья' : TEAM_RU[x.winner]}</b></div>`).join('')}`;
  } });
}

function nwChart() {
  const a = state.a;
  const team = [...a.teams[state.nwTeam]].sort((x, y) => x.pos - y.pos).filter((p) => p.nwT);
  document.querySelectorAll('#nwTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === state.nwTeam));
  if (!team.length) { document.getElementById('nwChart').innerHTML = '<p class="muted">Нет поминутных данных.</p>'; return; }
  const n = Math.max(...team.map((p) => p.nwT.length));
  const W = 1000, H = 260, L = 46, R = 10, T = 10, B = 24;
  const max = Math.max(...a.players.filter((p) => p.nwT).flatMap((p) => p.nwT));
  const stepV = niceStep(max, 4), top = Math.ceil(max / stepV) * stepV;
  const X = (i) => L + (i / (n - 1)) * (W - L - R);
  const Y = (v) => T + ((top - v) / top) * (H - T - B);
  let grid = '';
  for (let v = 0; v <= top + 1; v += stepV) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${kfmt(v)}</text>`;
  const xt = n > 50 ? 10 : 5;
  for (let i = 0; i < n; i += xt) grid += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${i}:00</text>`;
  const lines = team.map((p) => `<path d="${p.nwT.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="${SERIES[p.pos - 1]}" stroke-width="2" stroke-linejoin="round"/>`).join('');
  document.getElementById('nwLegend').innerHTML = team.map((p) => `<span><i style="background:${SERIES[p.pos - 1]}"></i>${p.pos} · ${esc(p.hero.dname)}</span>`).join('');
  document.getElementById('nwChart').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Нетворс игроков по минутам">${grid}${lines}
    <line class="cross" y1="${T}" y2="${H - B}" stroke="var(--text-2)" stroke-width="1" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  hoverLayer(document.querySelector('#nwChart svg'), { W, H, L, R, T, B, n, onMove: (i) =>
    `<b>${i}:00</b>${[...team].sort((x, y) => (y.nwT[i] ?? 0) - (x.nwT[i] ?? 0)).map((p) => `<div class="row"><span><i style="background:${SERIES[p.pos - 1]}"></i>${esc(p.hero.dname)}</span><b>${fmtNum(p.nwT[Math.min(i, p.nwT.length - 1)])}</b></div>`).join('')}` });
}

// ---------- запрос разбора реплея ----------
async function requestParse() {
  const btn = document.getElementById('parse');
  const id = state.a.meta.id, me = state.me?.accountId || '';
  btn.disabled = true;
  btn.textContent = 'Отправляю запрос…';
  try {
    const r = await api(`api/parse/${id}`, { method: 'POST' });
    const jobId = r.job?.jobId;
    for (let i = 0; i < 40; i++) {
      btn.textContent = `Реплей разбирается… ${i * 6} с`;
      await new Promise((ok) => setTimeout(ok, 6000));
      if (state.a?.meta.id !== id) return;
      const done = jobId ? (await api(`api/parse-status/${jobId}`).catch(() => ({}))).done : false;
      if (done || i % 5 === 4) {
        const m = await api(`api/match/${id}?refresh`).catch(() => null);
        if (m?.players?.some((p) => p.gold_t)) return showMatch(id, me);
      }
    }
    btn.textContent = 'Не дождался — попробуй позже';
  } catch (e) {
    btn.textContent = 'Не удалось запросить разбор';
    btn.title = e.message;
  }
}

// ---------- методика ----------
function showMethod() {
  const ids = Object.keys(COMPONENTS);
  app.innerHTML = `<div class="prose">
    <h1>Как считается индекс руина</h1>
    <p>Индекс руина — число от 0 до 100 у каждого игрока. <b>50 — средняя игра</b>, выше — хуже. Он собирается из 7 компонентов,
    а каждый компонент — из конкретных метрик. Ни одна оценка не ставится «на глаз»: в карточке игрока раскрыта каждая метрика, её шкала и вклад в итог.</p>
    <h2>1. Данные</h2>
    <p>Матч загружается из открытого API OpenDota (те же данные, что показывает Dotabuff, плюс разобранный реплей: поминутное золото и опыт,
    лог смертей с отданным золотом, тимфайты, варды, закупы). Если реплей не разобран, считаются только итоговые цифры, а сайт предлагает запросить разбор.</p>
    <h2>2. Позиции</h2>
    <p>Роль определяется по тому, что игрок делал, а не только по линии. Единственный герой на центральной линии — мидер (2). Из остальных двое с наибольшим
    «саппорт-счётом» — саппорты: счёт растёт от купленных вардов и падает от ластхитов на 10-й минуте и доли нетворса; тип героя даёт небольшую поправку.
    Из оставшихся коров тот, кто стоял на лёгкой линии или больше нафармил, — керри (1), другой — оффлейнер (3). Саппорт с линии керри — пятёрка, второй — четвёрка.
    От позиции зависят веса и нормы.</p>
    <p><b>Герой на нетипичной роли</b> (чистый керри саппортом или чистый саппорт на позиции керри) оценивается иначе: его GPM, XPM и урон сравниваются не с другими игроками
    на этом герое — та статистика собрана по другой роли, — а с нормами позиции. У керри-героя на саппорте вижен весит на 30% меньше, драки — на 15% больше.
    Нормы позиций — экспертные ориентиры, а не статистика.</p>
    <h2>3. Метрика → «плохость» 0–100</h2>
    <p>У каждой метрики два якоря: <code>best</code> (0 очков) и <code>worst</code> (100 очков), между ними линейно:
    <code>плохость = 100 × (best − значение) / (best − worst)</code>, с обрезкой до 0–100. Якоря зависят от роли: пять смертей у керри хуже, чем у пятёрки.
    GPM, XPM, урон и урон по строениям сравниваются не с абстрактной нормой, а с перцентилем других игроков <b>на этом же герое</b>.</p>
    <h2>4. Компоненты и веса по позициям</h2>
    <div class="card scroll-x" style="padding:0"><table><thead><tr><th>Компонент</th>${[1, 2, 3, 4, 5].map((p) => `<th>${ROLE_NAMES[p]}</th>`).join('')}</tr></thead>
      <tbody>${ids.map((id) => `<tr><td><b>${COMPONENTS[id].label}</b><br><span class="muted" style="font-size:13px">${COMPONENTS[id].desc}</span></td>${[1, 2, 3, 4, 5].map((p) => `<td>${WEIGHTS[p][id] || '—'}${WEIGHTS[p][id] ? '%' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p>Если данных для компонента нет (например, вижен у керри или лайнинг в неразобранном матче), он выпадает, а веса остальных пересчитываются до 100%.</p>
    <h2>5. Итог</h2>
    <p><code>индекс = Σ (вес компонента × оценка компонента) + штрафы</code>. Штрафы — за поведение: абандон +40, серия из 5+ смертей за 5 минут +8,
    АФК (меньше 60 действий в минуту) +10, лес с первой минуты на коре +6, Мидас после 14:00 в проигранной игре +4, спам пингами +3.</p>
    <h2>6. Поправки на справедливость</h2>
    <ul>
      <li>Если напарник по линии умер 3+ раза до 10:00, а сам игрок — не больше одного, его оценка за лайнинг смягчается на 35%.</li>
      <li>Драки, которые игрок пропустил мёртвым, не считаются ему как «не пришёл». «Не пришёл» — это был жив и не нанёс урона, не лечил и не нажал ни одной способности.</li>
      <li>Доля фида учитывается слабее, если команда в целом умирала мало.</li>
      <li>Непотраченное золото считается только сверх стоимости байбека и только проигравшим.</li>
      <li>В Turbo золотые пороги удвоены, вижен почти не учитывается.</li>
    </ul>
    <h2>7. Оценки и вердикт</h2>
    <p>${TIERS.map((t, i) => `<b>${t.label}</b> — ${i === 0 ? `от ${t.min}` : t.min < 0 ? `ниже ${TIERS[i - 1].min}` : `${t.min}–${TIERS[i - 1].min - 1}`}`).join(' · ')}.</p>
    <ul>
      <li><b>«Катку заруинил X»</b> — индекс от 58, на 11+ выше среднего остальных четверых и на 6+ выше второго в команде.</li>
      <li><b>«Руинили двое»</b> — у второго тоже от 58 и он на 8+ выше среднего оставшихся троих.</li>
      <li><b>«Коллективный руин»</b> — средний индекс команды от 60 без явного лидера.</li>
      <li><b>«Вас переиграли»</b> — максимальный индекс в команде ниже 54.</li>
      <li><b>Доля вины</b> — <code>(индекс − 30)²</code>, нормированный на команду: чем сильнее игрок выбивается вверх, тем непропорционально больше его доля.</li>
    </ul>
    <h2>8. Перелом игры</h2>
    <p>По графику золота определяется сценарий: <b>троу</b> (проигравшие вели 4к+ и проиграли), <b>проигрыш с линий</b> (отставали с первых минут)
    или <b>постепенный слив</b>. Три самые дорогие проигранные драки помечаются ключевыми: видно, кто умер первым и кто был жив, но не пришёл.</p>
    <h2>9. Разбор предметов</h2>
    <p>Отдельная оценка, которая <b>не влияет на индекс руина</b>. Есть у всех десяти игроков; у виновников из вердикта блок сразу раскрыт.</p>
    <ul>
      <li><b>Угрозы.</b> По героям и предметам врага определяется, что именно мешало: много контроля, магический прокаст, точечные ультимейты, сайленсы,
      уклонение, сильные пассивки, лечение, иллюзии, невидимость, физический бурст, мобильные герои, спасающие предметы.</li>
      <li><b>Ответы под конкретного героя.</b> У каждой угрозы есть список возможных ответов, но предлагаются только те, что на этом герое берут регулярно —
      по статистике OpenDota: от 4% игр на герое (от 2.5% для дорогих лейтовых предметов, которые статистика занижает). Редкие покупки советом не считаются.</li>
      <li><b>Механики героев.</b> Если герой отвечает на угрозу сам, предмет не требуется: например, Rage у Lifestealer вместо BKB, Doppelganger у Phantom Lancer
      (BKB на нём вреден — выдаёт настоящего), Dark Pact у Slark, Nethertoxin у Viper против пассивок. Таблица составлена вручную: разобраны все герои, запись есть у тех, чья способность реально заменяет предмет. Сайленсов в ней нет — под молчанкой способность не нажать.</li>
      <li><b>Не задача героя.</b> Если герой такие предметы не собирает (например, антихил на Phantom Assassin), угроза не идёт ему в минус.
      Сайт показывает, закрыл ли её кто-то из союзников, и если нет — кому это подходило больше всего.</li>
      <li><b>Разбор по способностям.</b> Для контроля и сайленсов сайт смотрит не на список героев, а на реальные способности врагов из справочника OpenDota:
      тип (стан, хекс, рут, таунт, молчание), наведение (в цель или по площади), проходит ли сквозь BKB, снимается ли диспелом — и сколько раз враг применил каждую в этом матче.
      Дальше считается, что из этого закрывала механика героя и купленные предметы: Counterspell, Linken и Lotus — только направленные, BKB — всё, кроме пробивающего,
      Manta — только молчание и руты (под станом её не нажать). Совет даётся на предмет, который закрыл бы больше всего оставшегося контроля, с процентом.</li>
      <li><b>Что наносило урон.</b> Из реплея: какие способности, предметы и атаки с руки нанесли игроку больше всего урона.</li>
      <li><b>Что лучше было собрать.</b> Из базы про- и лиговых матчей OpenDota текущего патча: стандартная сборка героя с медианным временем покупки,
      что про берут чаще обычного против героев из пика врагов, порядок покупок и чего не хватило. Аганим и Шард разбираются по их описанию в текущем патче:
      если они закрывают угрозу (например, Аганим Drow в 7.41 режет восстановление здоровья — это антихил), сайт считает его собственным ответом героя.</li>
      <li><b>Тайминги.</b> Время покупки сравнивается с тем, когда этот предмет берут на этом герое, и с винрейтом героя при покупке в том же окне.</li>
      <li><b>Стандартная сборка.</b> Показано, что на герое берут чаще всего и что из этого было у игрока. Предметы, которые на герое почти не берут, отмечаются как нестандартные.</li>
      <li><b>«На везении».</b> Если игрок сыграл хорошо, но не закрыл угрозы, на которые его герой обычно отвечает, сайт так и пишет.</li>
    </ul>
    <p>Ограничения: статистика таймингов у OpenDota покрывает покупки до 30:00, поэтому поздние предметы в ней занижены; список «угроза → ответы» — экспертный.</p>
    <h2>Чего модель не видит</h2>
    <p>Позиционку, качество использования способностей, коммуникацию, драфт и контрпики. Это статистическая оценка: она отвечает на вопрос
    «чьи цифры хуже всего и где именно», а не читает мысли. Если разрыв между игроками небольшой, сайт честно пишет, что явного руинера нет.</p>
  </div>`;
}

route();
