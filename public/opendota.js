// Загрузка и подготовка данных OpenDota. Один и тот же код работает
//  • в Node — внутри локального сервера (кэш на диске),
//  • в браузере — на GitHub Pages, где сервера нет (кэш в IndexedDB).
// Хранилище передаётся снаружи: { get(key), set(key, value), del(key) }.

const OD = 'https://api.opendota.com/api';
const UNPARSED_TTL = 2 * 60 * 1000;
const CONST_TTL = 24 * 3600 * 1000;        // справочники: раз в сутки
const HERO_TTL = 3 * 24 * 3600 * 1000;      // статистика предметов героя
const PRO_TTL = 24 * 3600 * 1000;
// Справочники предметов и способностей берём прямо из репозитория OpenDota (dotaconstants): он обновляется сразу после патчей,
// а API OpenDota отдаёт его более старую сборку (например, другие цены Hurricane Pike, Heart, Dagon). API — запасной вариант.
const DC = 'https://raw.githubusercontent.com/odota/dotaconstants/master/build';
const PRO_WINDOW_DAYS = 60;                  // про-сборки считаем по последним двум месяцам, а не по всему патчу
const BOOT_KEYS = ['power_treads', 'phase_boots', 'arcane_boots', 'tranquil_boots'];

const isParsed = (m) => m && m.version != null && Array.isArray(m.players) && m.players.some((p) => p.gold_t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// onWait(секунды) — вызывается, когда запросы приходится придержать из-за лимита OpenDota (60 в минуту без ключа).
export function createBackend({ store, apiKey = '', mode = 'server', onWait = null }) {
  // Не больше 5 запросов к OpenDota одновременно; при лимите (429) и сбоях сети — повтор с паузой.
  let active = 0;
  const waiters = [];
  const slot = async () => { if (active >= 5) await new Promise((r) => waiters.push(r)); active++; };
  const release = () => { active--; waiters.shift()?.(); };

  // Скользящее окно: не больше 50 запросов за 60 секунд (лимит OpenDota — 60). Первая загрузка матча (~37 запросов) проходит без задержек.
  const stamps = [];
  async function throttle() {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 60000) stamps.shift();
      if (stamps.length < 50) { stamps.push(now); return; }
      const wait = 60000 - (now - stamps[0]) + 50;
      onWait?.(Math.ceil(wait / 1000));
      await sleep(wait);
    }
  }

  async function od(pathname, init = {}) {
    await slot();
    try {
      for (let attempt = 0; ; attempt++) {
        await throttle();
        const url = new URL(OD + pathname);
        if (apiKey) url.searchParams.set('api_key', apiKey);
        let res;
        try {
          res = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
        } catch (e) {
          // в браузере ответ 429 без CORS-заголовков выглядит как сетевая ошибка
          if (attempt < 3 && e?.name !== 'AbortError' && e?.name !== 'TimeoutError') { onWait?.(Math.ceil(2 * 2 ** attempt)); await sleep(2000 * 2 ** attempt); continue; }
          throw e;
        }
        if ((res.status === 429 || res.status >= 502) && attempt < 5) { onWait?.(Math.ceil(2 * 2 ** attempt)); await sleep(2000 * 2 ** attempt); continue; }
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) }; }
        return { status: res.status, body };
      }
    } finally { release(); }
  }

  async function updateIndex(m) {
    const index = (await store.get('index')) || [];
    const entry = {
      id: m.match_id, radiant_win: m.radiant_win, duration: m.duration, start_time: m.start_time, game_mode: m.game_mode,
      parsed: isParsed(m),
      radiant: m.players.filter((p) => p.player_slot < 128).map((p) => p.hero_id),
      dire: m.players.filter((p) => p.player_slot >= 128).map((p) => p.hero_id),
      savedAt: Date.now(),
    };
    await store.set('index', [entry, ...index.filter((e) => e.id !== entry.id)].slice(0, 60));
  }

  async function getMatch(id, refresh) {
    if (!refresh) {
      const cached = await store.get(`match_${id}`);
      if (cached && (isParsed(cached.data) || Date.now() - cached.at < UNPARSED_TTL)) return { status: 200, body: cached.data };
    }
    const { status, body } = await od(`/matches/${id}`);
    if (status !== 200 || !body || !Array.isArray(body.players)) {
      return { status: status === 200 ? 404 : status, body: { error: body?.error || 'Матч не найден' } };
    }
    await store.set(`match_${id}`, { at: Date.now(), data: body });
    await updateIndex(body);
    return { status: 200, body };
  }

  async function constantsFile(name) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${DC}/${name}.json`, { signal: AbortSignal.timeout(60000) });
        if (res.ok) return { status: 200, body: await res.json(), repo: true };
      } catch { /* пробуем ещё раз, потом API */ }
    }
    return { ...(await od(`/constants/${name}`)), repo: false };
  }

  // Дата последнего обновления справочников в репозитории — чтобы честно показывать, насколько данные свежие.
  async function constantsDate() {
    try {
      const res = await fetch('https://api.github.com/repos/odota/dotaconstants/commits?per_page=1&path=build', { signal: AbortSignal.timeout(15000) });
      if (res.ok) return (await res.json())[0]?.commit?.committer?.date || null;
    } catch { /* не критично */ }
    return null;
  }

  async function getConstants() {
    const cached = await store.get('constants_v7');
    if (cached && Date.now() - cached.at < CONST_TTL) return cached.data;
    const [h, i, ab, ha, ag, pt, date] = await Promise.all([constantsFile('heroes'), constantsFile('items'), constantsFile('abilities'),
      constantsFile('hero_abilities'), constantsFile('aghs_desc'), constantsFile('patch'), constantsDate()]);
    if ([h, i, ab, ha, ag, pt].some((x) => x.status !== 200)) {
      if (cached) return cached.data;
      throw new Error('Не удалось загрузить справочники OpenDota');
    }
    const heroes = {};
    for (const [id, x] of Object.entries(h.body)) {
      heroes[id] = { id: x.id, name: x.name, dname: x.localized_name, img: x.img, icon: x.icon, attr: x.primary_attr, roles: x.roles || [] };
    }
    const items = {};
    for (const [key, x] of Object.entries(i.body)) {
      items[key] = { id: x.id, dname: x.dname || key, cost: x.cost || 0, img: x.img, created: !!x.created, parts: Array.isArray(x.components) ? x.components : [] };
    }
    // Способности героев: только то, что нужно для разбора (наведение, пробитие BKB, диспел, тип урона, описание).
    const heroAbilities = {}, abilities = {};
    const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const DISP = { Yes: 'basic', 'Strong Dispels Only': 'strong', No: 'none' };
    for (const [hero, x] of Object.entries(ha.body)) {
      heroAbilities[hero] = (x.abilities || []).filter((k) => k !== 'generic_hidden');
      for (const k of heroAbilities[hero]) {
        const a = ab.body[k];
        if (!a || !a.dname) continue;
        abilities[k] = {
          dname: a.dname, beh: list(a.behavior), dmg: typeof a.dmg_type === 'string' ? a.dmg_type : null,
          pierce: a.bkbpierce === 'Yes', disp: DISP[a.dispellable] || null, team: typeof a.target_team === 'string' ? a.target_team : null,
          desc: (a.desc || '').slice(0, 300), attr: (a.attrib || []).map((t) => t.key).join(' '),
        };
      }
    }
    // Аганим и Шард по текущему патчу: что именно они дают каждому герою.
    const aghs = {};
    for (const x of Array.isArray(ag.body) ? ag.body : []) {
      aghs[x.hero_id] = {
        scepter: x.has_scepter ? { skill: x.scepter_skill_name, desc: x.scepter_desc, isNew: !!x.scepter_new_skill } : null,
        shard: x.has_shard ? { skill: x.shard_skill_name, desc: x.shard_desc, isNew: !!x.shard_new_skill } : null,
      };
    }
    const plist = Array.isArray(pt.body) ? pt.body : [];
    const last = plist[plist.length - 1] || null;
    const patch = last ? { id: last.id, name: last.name, start: Math.floor(new Date(last.date).getTime() / 1000) } : null;
    const patches = plist.map((x) => ({ id: x.id, name: x.name }));
    const source = { repo: [h, i, ab, ha, ag].every((x) => x.repo), date };
    const data = { heroes, items, abilities, heroAbilities, aghs, patch, patches, source };
    await store.set('constants_v7', { at: Date.now(), data });
    return data;
  }

  // Статистика предметов на герое: в какой доле игр предмет берут, к какому времени и с каким винрейтом.
  // scenarios/itemTimings — большая выборка, но только покупки до 30:00; itemPopularity — маленькая, зато с лейтом.
  async function getHeroItems(id) {
    const cached = await store.get(`hero_items_${id}`);
    if (cached && Date.now() - cached.at < HERO_TTL) return cached.data;
    const [sc, pop, consts] = await Promise.all([od(`/scenarios/itemTimings?hero_id=${id}`), od(`/heroes/${id}/itemPopularity`), getConstants()]);
    if (sc.status !== 200 || !Array.isArray(sc.body)) return cached?.data || null;
    const items = {};
    for (const r of sc.body) {
      const it = (items[r.item] ||= { g: 0, w: 0, t: {} });
      const g = Number(r.games), w = Number(r.wins);
      it.g += g; it.w += w; it.t[r.time] = [g, w];
    }
    const maxG = Math.max(1, ...Object.values(items).map((x) => x.g));
    const n = Math.max(maxG, BOOT_KEYS.reduce((sum, k) => sum + (items[k]?.g || 0), 0));
    const keyById = {};
    for (const [key, it] of Object.entries(consts.items)) keyById[it.id] = key;
    const p = pop.status === 200 && pop.body ? pop.body : {};
    const popN = Math.max(1, ...Object.values(p.start_game_items || {}));
    const late = {};
    for (const cat of ['mid_game_items', 'late_game_items']) {
      for (const [itemId, c] of Object.entries(p[cat] || {})) {
        const key = keyById[itemId];
        if (key) late[key] = (late[key] || 0) + c;
      }
    }
    for (const key of new Set([...Object.keys(items), ...Object.keys(late)])) {
      const it = (items[key] ||= { g: 0, w: 0, t: {} });
      const popShare = (late[key] || 0) >= 2 && popN >= 40 ? late[key] / popN : 0;
      it.share = Math.min(1, Math.max(it.g / n, popShare));
    }
    const data = { n, items };
    await store.set(`hero_items_${id}`, { at: Date.now(), data });
    return data;
  }

  // Как этого героя собирают про-игроки в текущем патче — в целом и против каждого героя врага.
  // Источник — SQL-обозреватель OpenDota (про- и лиговые матчи с разобранными реплеями).
  // role: 'core' — игры, где герой фармил как кор (GPM от 420), 'sup' — как саппорт.
  async function getProBuild(hero, enemies, role) {
    const consts = await getConstants();
    if (!consts.patch) return null;
    const vs = enemies.slice(0, 5);
    const key = `pro_${consts.patch.name}_w${PRO_WINDOW_DAYS}_${hero}_${role}_${[...vs].sort((a, b) => a - b).join('-')}`;
    const cached = await store.get(key);
    if (cached && Date.now() - cached.at < PRO_TTL) return cached.data;
    const flagCols = vs.map((e, i) => `EXISTS (SELECT 1 FROM player_matches e WHERE e.match_id = b.match_id AND e.hero_id = ${e} AND (e.player_slot < 128) <> b.rad) AS v${i}`).join(', ');
    const vcols = vs.map((_, i) => `v${i}`).join(', ');
    const cnt = vs.map((_, i) => `count(*) FILTER (WHERE v${i}) AS c${i}`).join(', ');
    const query = async (since) => {
      const sql = `
WITH base AS (
  SELECT pm.match_id, (pm.player_slot < 128) AS rad, pm.purchase_log AS pl, ((pm.player_slot < 128) = m.radiant_win) AS win
  FROM player_matches pm JOIN matches m ON m.match_id = pm.match_id
  WHERE m.start_time > ${since} AND pm.hero_id = ${hero} AND pm.purchase_log IS NOT NULL AND pm.gold_per_min ${role === 'sup' ? '<' : '>='} 420
), flags AS (SELECT b.match_id, b.pl, b.win${vs.length ? `, ${flagCols}` : ''} FROM base b),
firsts AS (
  SELECT f.match_id, f.win${vs.length ? `, ${vcols}` : ''}, x->>'key' AS k, min((x->>'time')::int) AS t
  FROM flags f, unnest(f.pl) x GROUP BY f.match_id, f.win${vs.length ? `, ${vcols}` : ''}, k
)
SELECT k, count(*) AS c, percentile_cont(0.5) WITHIN GROUP (ORDER BY t) AS med, sum(win::int) AS w${vs.length ? `, ${cnt}` : ''} FROM firsts GROUP BY k
UNION ALL
SELECT '__total__', count(*), 0, sum(win::int)${vs.length ? `, ${cnt}` : ''} FROM flags`;
      const r = await od(`/explorer?sql=${encodeURIComponent(sql)}`);
      if (r.status !== 200 || !Array.isArray(r.body?.rows)) return null;
      const total = r.body.rows.find((x) => x.k === '__total__');
      return total ? { rows: r.body.rows, total } : null;
    };
    // Окно — последние два месяца (букв-патчи 7.41a–f меняют баланс, мета начала патча уже не та). Если игр мало — расширяем до начала патча.
    const recent = Math.floor(Date.now() / 1000) - PRO_WINDOW_DAYS * 86400;
    let since = Math.max(consts.patch.start, recent);
    let res = await query(since);
    if ((!res || Number(res.total.c) < 40) && since > consts.patch.start) { since = consts.patch.start; res = await query(since); }
    if (!res) return cached?.data || null;
    const { rows, total } = res;
    if (!Number(total.c)) return null;
    const items = {};
    for (const x of rows) {
      if (x.k === '__total__') continue;
      items[x.k] = { c: Number(x.c), med: Math.round(Number(x.med)), w: Number(x.w), vs: vs.map((_, i) => Number(x[`c${i}`])) };
    }
    const data = { patch: consts.patch.name, role, since, n: Number(total.c), w: Number(total.w), vs: vs.map((e, i) => ({ hero: e, n: Number(total[`c${i}`]) })), items };
    await store.set(key, { at: Date.now(), data });
    return data;
  }

  // Удаляет один матч из истории и кэша, без id — всю историю. Справочники не трогает.
  async function deleteHistory(id) {
    const index = (await store.get('index')) || [];
    const gone = id ? index.filter((e) => String(e.id) === id) : index;
    await Promise.all(gone.map((e) => store.del(`match_${e.id}`)));
    const next = id ? index.filter((e) => String(e.id) !== id) : [];
    await store.set('index', next);
    return next;
  }

  const playerCache = new Map();
  async function getPlayer(id) {
    const hit = playerCache.get(id);
    if (hit && Date.now() - hit.at < 120000) return hit.data;
    const [profile, recent] = await Promise.all([od(`/players/${id}`), od(`/players/${id}/recentMatches`)]);
    if (recent.status !== 200 || !Array.isArray(recent.body)) return { error: 'Игрок не найден или у него закрыта история матчей' };
    const data = {
      id, name: profile.body?.profile?.personaname || `Игрок ${id}`, avatar: profile.body?.profile?.avatarmedium || null,
      rank_tier: profile.body?.rank_tier ?? null, matches: recent.body,
    };
    playerCache.set(id, { at: Date.now(), data });
    return data;
  }

  // Единая точка входа: тот же набор запросов, что раньше обслуживал сервер. pathname — без префикса /api.
  async function handle(method, pathname, params = new URLSearchParams()) {
    try {
      const [kind, arg] = pathname.split('/').filter(Boolean);
      const num = /^\d{1,20}$/.test(arg || '') ? arg : null;
      const ok = (body, status = 200) => ({ status, body });

      if (kind === 'ping') return ok({ ok: true, mode });
      if (kind === 'constants') return ok(await getConstants());
      if (kind === 'history' && method === 'DELETE') return ok(await deleteHistory(num));
      if (kind === 'history') return ok((await store.get('index')) || []);
      if (kind === 'pro-build') {
        // ?heroes=6c:31,23,73,34,5;93s:...  — герой, роль (c — кор, s — саппорт) и его враги
        const out = {};
        const pairs = (params.get('heroes') || '').split(';').slice(0, 10).map((x) => x.split(':'))
          .filter(([h, e]) => /^\d{1,4}[cs]$/.test(h) && /^[\d,]*$/.test(e || ''));
        for (let i = 0; i < pairs.length; i += 3) {
          await Promise.all(pairs.slice(i, i + 3).map(async ([h, e]) => {
            out[h] = await getProBuild(Number(h.slice(0, -1)), (e || '').split(',').filter(Boolean).map(Number), h.endsWith('s') ? 'sup' : 'core').catch(() => null);
          }));
        }
        return ok(out);
      }
      if (kind === 'hero-items') {
        const ids = (params.get('ids') || '').split(',').filter((x) => /^\d{1,4}$/.test(x)).slice(0, 10);
        const out = {};
        for (let i = 0; i < ids.length; i += 4) {
          await Promise.all(ids.slice(i, i + 4).map(async (id) => { out[id] = await getHeroItems(id).catch(() => null); }));
        }
        return ok(out);
      }
      if (kind === 'match' && num) return await getMatch(num, params.has('refresh'));
      if (kind === 'player' && num) {
        const data = await getPlayer(num);
        return ok(data, data.error ? 404 : 200);
      }
      if (kind === 'parse' && num && method === 'POST') {
        const r = await od(`/request/${num}`, { method: 'POST' });
        return ok(r.body, r.status);
      }
      if (kind === 'parse-status' && num) {
        const r = await od(`/request/${num}`);
        return ok(r.body ?? { done: true }, r.status);
      }
      return ok({ error: 'Неизвестный запрос' }, 404);
    } catch (e) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      return { status: 502, body: { error: timeout ? 'OpenDota не отвечает, попробуй ещё раз' : e instanceof TypeError ? 'Нет связи с OpenDota — проверь интернет или попробуй позже (возможно, достигнут лимит запросов)' : `Ошибка: ${e.message}` } };
    }
  }

  return { handle };
}
