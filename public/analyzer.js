// Движок «Индекса руина». Чистые функции: на вход матч OpenDota + справочники, на выход разбор.
// Работает и в браузере, и в Node (см. test/analyze.mjs).
//
// Принцип: у каждого игрока 7 компонентов, каждый состоит из метрик. Метрика переводится в
// «плохость» 0..100 линейно между якорями best (0) и worst (100); 50 = средняя игра.
// Компонент = взвешенное среднее метрик, итог = взвешенное среднее компонентов (веса зависят
// от позиции 1–5) + штрафы за поведение. Всё, что влияет на число, видно в разборе игрока.

export const ROLE_NAMES = { 1: 'Керри', 2: 'Мидер', 3: 'Оффлейнер', 4: 'Саппорт 4', 5: 'Саппорт 5' };

export const WEIGHTS = {
  1: { lane: 18, deaths: 22, farm: 22, fight: 22, objectives: 8, vision: 0, discipline: 8 },
  2: { lane: 20, deaths: 22, farm: 18, fight: 24, objectives: 8, vision: 0, discipline: 8 },
  3: { lane: 18, deaths: 22, farm: 14, fight: 30, objectives: 8, vision: 0, discipline: 8 },
  4: { lane: 14, deaths: 24, farm: 6, fight: 28, objectives: 4, vision: 16, discipline: 8 },
  5: { lane: 12, deaths: 24, farm: 4, fight: 24, objectives: 2, vision: 26, discipline: 8 },
};

export const COMPONENTS = {
  lane: { label: 'Лайнинг', desc: 'Первые 10 минут: нетворс против оппонента по линии, итог линии, смерти, ластхиты.' },
  deaths: { label: 'Смерти и фид', desc: 'Сколько умирал, сколько золота отдал врагу, ловили ли одного, серии смертей, время в таверне.' },
  farm: { label: 'Экономика', desc: 'GPM/XPM относительно других игроков на этом же герое, доля нетворса команды, сравнение с визави, простои.' },
  fight: { label: 'Драки', desc: 'Урон, участие в убийствах, присутствие на тимфайтах, первая смерть в проигранных драках, баланс золота за драки.' },
  objectives: { label: 'Объекты', desc: 'Урон по строениям относительно героя и роли.' },
  vision: { label: 'Вижен', desc: 'Обсы, сентри, девард, время жизни вардов, стаки. Считается только саппортам.' },
  discipline: { label: 'Дисциплина', desc: 'Тайминг первого крупного предмета, непотраченное золото, смерти сразу после байбека.' },
};

// Ожидаемые доли в команде по позициям 1..5.
const NW_SHARE = { 1: 0.28, 2: 0.24, 3: 0.21, 4: 0.14, 5: 0.13 };
const DMG_SHARE = { 1: 0.25, 2: 0.27, 3: 0.22, 4: 0.14, 5: 0.12 };
const TD_SHARE = { 1: 0.35, 2: 0.25, 3: 0.2, 4: 0.1, 5: 0.1 };

export const TIERS = [
  { min: 68, id: 'ruiner', label: 'Руинер' },
  { min: 58, id: 'weak', label: 'Слабое звено' },
  { min: 45, id: 'ok', label: 'Норм' },
  { min: 34, id: 'good', label: 'Хорошо' },
  { min: -1, id: 'carry', label: 'Тащил' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lin = (v, worst, best) =>
  v == null || Number.isNaN(v) ? null : clamp((100 * (best - v)) / (best - worst), 0, 100);
// Тянет оценку к нейтральным 50, когда сигнал слабый (k = 0..1).
const damp = (bad, k) => (bad == null ? null : 50 + (bad - 50) * k);
const step = (n, table) => table[Math.min(n, table.length - 1)];
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const round1 = (v) => Math.round(v * 10) / 10;

export const fmtTime = (sec) => {
  const s = Math.round(Math.abs(sec));
  return `${sec < 0 ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtNum = (n) => Math.round(n).toLocaleString('ru-RU');
const fmtK = (n) => (Math.abs(n) >= 1000 ? `${round1(n / 1000)}к` : `${Math.round(n)}`);
const signed = (n, f = fmtNum) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${f(Math.abs(n))}`;
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, forms) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  return b === 1 ? forms[0] : forms[2];
};
const times = (n) => `${n} ${plural(n, ['раз', 'раза', 'раз'])}`;

function unitName(key, heroByName) {
  if (!key) return 'неизвестно';
  if (heroByName[key]) return heroByName[key].dname;
  if (key.includes('tower')) return 'башня';
  if (key.includes('roshan')) return 'Рошан';
  if (key.includes('creep') || key.includes('neutral')) return 'крипы';
  if (key.includes('fountain')) return 'фонтан';
  return key.replace('npc_dota_', '').replace(/_/g, ' ');
}

// Нормы по позиции для героя на нетипичной роли (worst, best). Это экспертные ориентиры, а не статистика.
const ROLE_NORMS = {
  gpm: { 1: [380, 680], 2: [370, 640], 3: [300, 520], 4: [220, 400], 5: [190, 340] },
  xpm: { 1: [420, 720], 2: [450, 760], 3: [380, 640], 4: [270, 480], 5: [240, 430] },
  dmg: { 1: [350, 850], 2: [420, 950], 3: [350, 750], 4: [220, 520], 5: [180, 460] }, // урон по героям в минуту
  td: { 1: [60, 350], 2: [40, 220], 3: [30, 180], 4: [5, 60], 5: [5, 50] }, // урон по строениям в минуту
};

// Роли определяются по тому, что игрок делал, а не только по линии:
//  1) единственный герой на миде — мидер;
//  2) из остальных двое с наибольшим «саппорт-счётом» (купленные варды, мало ластхитов, малая доля нетворса, тип героя) — саппорты;
//  3) оставшиеся коры: с лёгкой линии или с большим фармом — керри, другой — оффлейнер;
//  4) саппорт, стоявший на линии с керри, — пятёрка, другой — четвёрка.
function assignPositions(team, parsed) {
  const teamNw = team.reduce((s, p) => s + p.nw, 0) || 1;
  const tag = (p, t) => (p.hero.roles || []).includes(t);
  const wards = (p) => {
    const b = (p.raw.purchase?.ward_observer || 0) + (p.raw.purchase?.ward_sentry || 0);
    return Math.max(b, (p.raw.obs_placed || 0) + (p.raw.sen_placed || 0));
  };
  const supScore = (p) => {
    const heroBias = tag(p, 'Support') && !tag(p, 'Carry') ? 1.5 : tag(p, 'Carry') && !tag(p, 'Support') ? -1.5 : 0;
    return (parsed ? wards(p) - (p.lh10 ?? 0) / 10 : 0) - (p.nw / teamNw) * 10 + heroBias;
  };
  const farm = (p) => (parsed ? (p.nw10 ?? 0) + (p.lh10 ?? 0) * 40 : p.nw);
  const pos = new Map();
  let pool = [...team];
  if (parsed) {
    const mids = team.filter((p) => p.raw.lane_role === 2).sort((a, b) => farm(b) - farm(a));
    if (mids.length) { pos.set(mids[0], 2); pool = pool.filter((p) => p !== mids[0]); }
  }
  const bySup = [...pool].sort((a, b) => supScore(b) - supScore(a));
  const sups = bySup.slice(0, 2);
  const cores = bySup.slice(2).sort((a, b) => farm(b) - farm(a));
  if (!pos.size) { // мидера по линии нет (или матч не разобран): трое коров делят 1–3
    const safe = parsed ? cores.find((p) => p.raw.lane_role === 1) : null;
    const carry = safe || cores[0];
    pos.set(carry, 1);
    cores.filter((p) => p !== carry).forEach((p, i) => pos.set(p, 2 + i));
  } else {
    const safe = cores.filter((p) => p.raw.lane_role === 1);
    const carry = safe.length === 1 ? safe[0] : cores[0];
    pos.set(carry, 1);
    cores.filter((p) => p !== carry).forEach((p) => pos.set(p, 3));
  }
  const carry = team.find((p) => pos.get(p) === 1);
  const withCarry = sups.filter((p) => parsed && carry && p.lane != null && p.lane === carry.lane);
  const five = withCarry.length === 1 ? withCarry[0] : [...sups].sort((a, b) => a.nw - b.nw)[0];
  sups.forEach((p) => pos.set(p, p === five ? 5 : 4));
  team.forEach((p) => {
    p.pos = pos.get(p);
    // герой на нетипичной роли: чистый керри саппортом или чистый саппорт кором
    p.offRole = p.pos >= 4 && tag(p, 'Carry') && !tag(p, 'Support') ? 'core_as_support'
      : p.pos === 1 && tag(p, 'Support') && !tag(p, 'Carry') ? 'support_as_core' : null; // мид гибкий, его не трогаем
  });
}

export function analyzeMatch(m, consts) {
  const { heroes, items } = consts;
  const heroByName = {};
  for (const h of Object.values(heroes)) heroByName[h.name] = h;

  const raws = [...(m.players || [])].sort((a, b) => a.player_slot - b.player_slot);
  if (raws.length !== 10) throw new Error('Поддерживаются только матчи 5 на 5 (в этом матче другой формат).');

  const parsed = raws.some((p) => Array.isArray(p.gold_t) && p.gold_t.length > 5);
  const turbo = m.game_mode === 23;
  const econ = turbo ? 2 : 1;
  const dur = m.duration || 1;
  const durMin = dur / 60;
  const at = (arr, min) => (arr && arr.length ? arr[Math.min(min, arr.length - 1)] : null);

  // ---------- игроки ----------
  const players = raws.map((r, idx) => {
    const isRadiant = r.player_slot < 128;
    const hero = heroes[r.hero_id] || { id: r.hero_id, name: `hero_${r.hero_id}`, dname: `Герой #${r.hero_id}`, img: '', icon: '', roles: [] };
    const nwT = r.networth_t?.length ? r.networth_t : r.gold_t?.length ? r.gold_t : null;
    const nw = r.net_worth ?? r.total_gold ?? Math.round((r.gold_per_min || 0) * durMin);
    return {
      idx, raw: r, slot: r.player_slot, isRadiant,
      team: isRadiant ? 'radiant' : 'dire',
      won: isRadiant === !!m.radiant_win,
      hero, name: r.personaname || 'Аноним', accountId: r.account_id || null,
      kills: r.kills || 0, deaths: r.deaths || 0, assists: r.assists || 0,
      nw, gpm: r.gold_per_min || 0, xpm: r.xp_per_min || 0, lh: r.last_hits || 0, dn: r.denies || 0,
      level: r.level || 0, hd: r.hero_damage || 0, td: r.tower_damage || 0, heal: r.hero_healing || 0,
      nwT, lhT: r.lh_t || null, xpT: r.xp_t || null,
      nw10: at(nwT, 10), lh10: at(r.lh_t, 10),
      lane: r.lane ?? null,
      itemsFinal: [r.item_0, r.item_1, r.item_2, r.item_3, r.item_4, r.item_5].filter(Boolean),
      neutral: r.item_neutral || null,
      bench: (k) => r.benchmarks?.[k]?.pct ?? null,
    };
  });
  const teams = { radiant: players.filter((p) => p.isRadiant), dire: players.filter((p) => !p.isRadiant) };
  for (const t of Object.values(teams)) assignPositions(t, parsed);
  const enemyOf = (p) => teams[p.isRadiant ? 'dire' : 'radiant'];
  const matesOf = (p) => teams[p.team].filter((x) => x !== p);

  // ---------- смерти ----------
  for (const p of players) {
    const r = p.raw;
    let list = [];
    if (Array.isArray(r.deaths_log) && r.deaths_log.length) {
      list = r.deaths_log.map((d) => ({ time: d.time, killer: d.key, goldFed: d.gold_fed, goldLost: d.gold_lost, timeDead: d.time_dead }));
    } else if (parsed) {
      for (const e of enemyOf(p)) {
        for (const k of e.raw.kills_log || []) if (k.key === p.hero.name) list.push({ time: k.time, killer: e.hero.name });
      }
    }
    list.sort((a, b) => a.time - b.time);
    for (const d of list) {
      const minute = Math.max(0, Math.floor(d.time / 60));
      // У ~1% смертей от героев OpenDota отдаёт gold_fed = 0 (дыра в данных, не «золото не отдано») — подставляем оценку и помечаем «≈».
      if (d.goldFed == null || (d.goldFed === 0 && String(d.killer).includes('_hero_'))) {
        d.goldFed = Math.round(150 * econ + (at(p.nwT, minute) || 0) * 0.03);
        d.estimated = true;
      }
      if (d.timeDead == null) d.timeDead = Math.round(clamp(6 + minute * 1.6, 6, 100));
      d.fight = null;
    }
    p.deathList = list;
    p.goldFed = sum(list, (d) => d.goldFed);
    p.laneDeaths = list.filter((d) => d.time < 600).length;
    // худшее 5-минутное окно
    let best = { count: list.length ? 1 : 0, from: list[0]?.time ?? 0, to: list[0]?.time ?? 0 };
    for (let i = 0; i < list.length; i++) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].time - list[i].time <= 300) j++;
      if (j - i + 1 > best.count) best = { count: j - i + 1, from: list[i].time, to: list[j].time };
    }
    p.streak = best;
    p.deadSec = r.life_state_dead ?? (list.length ? sum(list, (d) => d.timeDead) : null);
  }

  const totals = {};
  for (const [name, t] of Object.entries(teams)) {
    totals[name] = {
      kills: sum(t, (p) => p.kills), deaths: sum(t, (p) => p.deaths), nw: sum(t, (p) => p.nw),
      hd: sum(t, (p) => p.hd), td: sum(t, (p) => p.td), goldFed: sum(t, (p) => p.goldFed),
    };
  }

  // ---------- драки ----------
  const adv = m.radiant_gold_adv || null;
  const fights = (parsed ? m.teamfights || [] : []).map((tf, i) => {
    const parts = players.map((p, idx) => {
      const fp = tf.players?.[idx] || {};
      const mid = (tf.start + tf.end) / 2;
      const deadAtStart = p.deathList.some((d) => d.time < tf.start - 5 && d.time + d.timeDead > mid);
      const present = (fp.deaths || 0) > 0 || (fp.damage || 0) > 80 || (fp.healing || 0) > 80 ||
        Object.keys(fp.ability_uses || {}).length > 0 || Object.keys(fp.killed || {}).length > 0;
      return {
        p, deaths: fp.deaths || 0, damage: fp.damage || 0, healing: fp.healing || 0,
        goldDelta: fp.gold_delta || 0, buybacks: fp.buybacks || 0,
        deadAtStart: deadAtStart && !present, present, absent: !present && !deadAtStart,
      };
    });
    const died = [];
    for (const p of players) {
      for (const d of p.deathList) {
        if (d.time >= tf.start - 5 && d.time <= tf.end + 5) { d.fight = i; died.push({ p, d }); }
      }
    }
    died.sort((a, b) => a.d.time - b.d.time);
    const side = (rad) => parts.filter((x) => x.p.isRadiant === rad);
    const radDeaths = sum(side(true), (x) => x.deaths), direDeaths = sum(side(false), (x) => x.deaths);
    const radGold = sum(side(true), (x) => x.goldDelta), direGold = sum(side(false), (x) => x.goldDelta);
    const swing = radGold - direGold;
    let winner = 'draw';
    if (radDeaths < direDeaths) winner = 'radiant';
    else if (radDeaths > direDeaths) winner = 'dire';
    else if (swing > 400 * econ) winner = 'radiant';
    else if (swing < -400 * econ) winner = 'dire';
    return {
      i, start: tf.start, end: tf.end, parts, died, radDeaths, direDeaths, radGold, direGold, swing, winner,
      first: { radiant: died.find((x) => x.p.isRadiant)?.p || null, dire: died.find((x) => !x.p.isRadiant)?.p || null },
      advBefore: at(adv, Math.max(0, Math.floor(tf.start / 60))),
      advAfter: at(adv, Math.ceil(tf.end / 60) + 1),
    };
  });

  for (const p of players) {
    const f = { eligible: 0, present: 0, lost: 0, absentLost: [], firstLost: [], goldDelta: 0, diedIn: 0 };
    for (const tf of fights) {
      const part = tf.parts[p.idx];
      const lost = tf.winner !== 'draw' && tf.winner !== p.team;
      if (!part.deadAtStart) { f.eligible++; if (part.present) f.present++; }
      f.goldDelta += part.goldDelta;
      if (part.deaths) f.diedIn++;
      if (lost) {
        f.lost++;
        if (part.absent) f.absentLost.push(tf.start);
        if (tf.first[p.team] === p) f.firstLost.push(tf.start);
      }
    }
    p.fightStats = f;
    p.soloDeaths = parsed ? p.deathList.filter((d) => d.fight == null && d.time >= 600) : [];
  }

  // ---------- линии ----------
  const LANE_NAMES = { 1: 'Нижняя', 2: 'Центральная', 3: 'Верхняя' };
  const lanes = [];
  if (parsed) {
    for (const L of [1, 2, 3]) {
      const rad = teams.radiant.filter((p) => p.lane === L), dire = teams.dire.filter((p) => p.lane === L);
      if (!rad.length && !dire.length) continue;
      const diff = sum(rad, (p) => p.nw10) - sum(dire, (p) => p.nw10);
      const free = !rad.length || !dire.length; // одна из команд вообще не пришла на линию
      const even = !free && Math.abs(diff) < 800 * econ;
      lanes.push({
        id: L, name: LANE_NAMES[L], radiant: rad, dire, diff, free,
        winner: even ? 'draw' : diff > 0 ? 'radiant' : 'dire',
        crush: !free && Math.abs(diff) >= 2500 * econ,
      });
    }
    for (const p of players) {
      const lane = lanes.find((l) => l.id === p.lane);
      if (!lane) continue;
      const opp = lane[p.isRadiant ? 'dire' : 'radiant'];
      p.laneInfo = { lane, diff: p.isRadiant ? lane.diff : -lane.diff, opps: opp, mates: lane[p.team].filter((x) => x !== p) };
      if (opp.length) {
        const sorted = [...opp].sort((a, b) => b.nw10 - a.nw10);
        p.laneInfo.rival = p.pos <= 3 ? sorted[0] : opp.length > 1 ? sorted[sorted.length - 1] : null;
      }
    }
  }

  // ---------- метрики ----------
  const sub = (id, label, weight, bad, value, ref, why, good) =>
    bad == null ? null : { id, label, weight, bad: Math.round(bad), value, ref, why, good };

  // Герой на своей роли сравнивается с другими игроками на этом герое (перцентиль OpenDota).
  // Герой на нетипичной роли — с нормами позиции: статистика героя собрана по другой роли и к нему неприменима.
  const perMin = { gpm: (p) => p.gpm / econ, xpm: (p) => p.xpm / econ, dmg: (p) => p.hd / durMin, td: (p) => p.td / durMin };
  function versusNorm(p, kind, benchKey, weight, id, what, valueText) {
    if (!p.offRole) return null;
    const [w, b] = ROLE_NORMS[kind][p.pos];
    const v = perMin[kind](p);
    return sub(id, `${what} относительно нормы позиции ${p.pos}`, weight, lin(v, w, b), valueText,
      `${w} — плохо, ${b} — отлично (в минуту, для позиции ${p.pos})`,
      `${valueText} — ниже нормы для позиции ${p.pos} (ориентир ${Math.round((w + b) / 2)} в минуту)`,
      `${valueText} — выше нормы для позиции ${p.pos}`);
  }

  function laneComponent(p) {
    const li = p.laneInfo;
    if (!li || p.nw10 == null) return [];
    const core = p.pos <= 3;
    const out = [];
    if (li.rival) {
      const d = p.nw10 - li.rival.nw10;
      const span = (core ? 2000 : 1000) * econ;
      out.push(sub('lane_rival', `Нетворс на 10:00 против ${li.rival.hero.dname}`, 35, lin(d, -span, span),
        `${signed(d)} (${fmtNum(p.nw10)} vs ${fmtNum(li.rival.nw10)})`, `0 — паритет; ±${fmtNum(span)} — предел шкалы`,
        `К 10-й минуте отставал от ${li.rival.hero.dname} на ${fmtNum(-d)} золота`,
        `К 10-й минуте опережал ${li.rival.hero.dname} на ${fmtNum(d)} золота`));
    }
    if (li.opps.length) {
      out.push(sub('lane_result', `Итог линии (${li.lane.name.toLowerCase()})`, core ? 25 : 35, lin(li.diff, -3000 * econ, 3000 * econ),
        `${signed(li.diff)} золота по сумме линии`, `0 — ничья; ±${fmtNum(3000 * econ)} — предел шкалы`,
        `Линия проиграна на ${fmtNum(-li.diff)} золота к 10:00`,
        `Линия выиграна на ${fmtNum(li.diff)} золота к 10:00`));
    }
    const ld = p.laneDeaths;
    out.push(sub('lane_deaths', 'Смерти до 10:00', 25, step(ld, [0, 30, 60, 85, 100]),
      `${ld}`, '0 — идеал, 4+ — максимум штрафа',
      `Умер ${times(ld)} за первые 10 минут (${p.deathList.filter((d) => d.time < 600).map((d) => fmtTime(d.time)).join(', ')})`,
      'Ни разу не умер на лайнинге'));
    if (core && p.lh10 != null) {
      const [w, b] = { 1: [30, 70], 2: [30, 65], 3: [20, 55] }[p.pos];
      out.push(sub('lane_lh', 'Ластхиты на 10:00', 15, lin(p.lh10, w, b), `${p.lh10}`, `${w} — плохо, ${b} — отлично`,
        `Всего ${p.lh10} ластхитов к 10:00 (норма для роли — около ${Math.round((w + b) / 2)})`,
        `${p.lh10} ластхитов к 10:00`));
    }
    return out;
  }

  function deathsComponent(p) {
    const core = p.pos <= 3;
    const out = [];
    const per10 = p.deaths / (durMin / 10);
    const [b, w] = p.pos <= 2 ? [0.8, 3.2] : p.pos === 3 ? [1.0, 3.4] : [1.0, 3.6];
    out.push(sub('deaths_rate', 'Смертей за 10 минут', 25, lin(per10, w, b), `${round1(per10)} (всего ${p.deaths})`,
      `${b} — отлично, ${w} — провал (для роли)`,
      `Умер ${times(p.deaths)} — это ${round1(per10)} смерти за 10 минут при норме для роли около ${round1((b + w) / 2)}`,
      `Всего ${p.deaths} ${plural(p.deaths, ['смерть', 'смерти', 'смертей'])} за игру`));
    const T = totals[p.team];
    if (parsed && T.goldFed > 0) {
      const share = p.goldFed / T.goldFed;
      out.push(sub('fed_share', 'Доля отданного врагу золота', 25, damp(lin(share, 0.32, 0.08), clamp(T.deaths / 15, 0.3, 1)),
        `${pct(share)} (${fmtNum(p.goldFed)} из ${fmtNum(T.goldFed)})`, '20% — поровну, 32%+ — главный кормилец',
        `Отдал врагу ${fmtNum(p.goldFed)} золота своими смертями — ${pct(share)} всего фида команды`,
        `На него пришлось лишь ${pct(share)} отданного командой золота`));
    } else if (T.deaths > 0) {
      const share = p.deaths / T.deaths;
      out.push(sub('death_share', 'Доля смертей команды', 25, damp(lin(share, 0.32, 0.1), clamp(T.deaths / 15, 0.3, 1)), pct(share), '20% — поровну, 32%+ — главный кормилец',
        `На него пришлось ${pct(share)} всех смертей команды`, `Лишь ${pct(share)} смертей команды`));
    }
    if (parsed) {
      const lateMin = Math.max(1, (durMin - 10) / 10);
      const solo = p.soloDeaths.length;
      if (durMin > 15) {
        out.push(sub('solo_deaths', 'Пойман один (смерти вне драк после 10:00)', 20, lin(solo / lateMin, 1.6, 0),
          `${solo} (${round1(solo / lateMin)} за 10 мин)`, '0 — идеал, 1.6 за 10 мин — провал',
          `${times(solo)} пойман в одиночку вне командных драк: ${p.soloDeaths.slice(0, 6).map((d) => fmtTime(d.time)).join(', ')}`,
          'Почти не давал себя поймать вне драк'));
      }
      if (p.deadSec != null) {
        const share = p.deadSec / dur;
        out.push(sub('dead_time', 'Время в таверне', 15, lin(share, 0.18, 0.04), `${pct(share)} игры (${fmtTime(p.deadSec)})`,
          '4% — отлично, 18% — провал',
          `Провёл мёртвым ${fmtTime(p.deadSec)} — ${pct(share)} всей игры команда играла без него`,
          `Был мёртв всего ${pct(share)} игры`));
      }
      const s = p.streak;
      out.push(sub('death_streak', 'Худшая серия смертей (окно 5 минут)', 15, step(s.count, [0, 10, 35, 65, 85, 100]),
        s.count >= 2 ? `${s.count} за ${fmtTime(s.from)}–${fmtTime(s.to)}` : `${s.count}`, '1 — норма, 5+ за 5 минут — максимум',
        `Умер ${times(s.count)} подряд за 5 минут (${fmtTime(s.from)}–${fmtTime(s.to)})`,
        'Не умирал сериями'));
    }
    return out;
  }

  function farmComponent(p) {
    const core = p.pos <= 3;
    const out = [];
    const g = p.bench('gold_per_min');
    out.push(versusNorm(p, 'gpm', 'gold_per_min', 30, 'gpm_bench', 'GPM', `${p.gpm} GPM`) || sub('gpm_bench', `GPM относительно других игроков на ${p.hero.dname}`, 30, lin(g, 0.1, 0.8),
      g == null ? '' : `${p.gpm} GPM — лучше ${pct(g)} игроков на герое`, 'перцентиль: 10% — провал, 80% — отлично',
      `${p.gpm} GPM — хуже, чем у ${pct(1 - (g ?? 0))} игроков на ${p.hero.dname}`,
      `${p.gpm} GPM — лучше, чем у ${pct(g ?? 0)} игроков на ${p.hero.dname}`));
    const x = p.bench('xp_per_min');
    out.push(versusNorm(p, 'xpm', 'xp_per_min', 15, 'xpm_bench', 'XPM', `${p.xpm} XPM`) || sub('xpm_bench', 'XPM относительно героя', 15, lin(x, 0.1, 0.8),
      x == null ? '' : `${p.xpm} XPM — лучше ${pct(x)}`, 'перцентиль: 10% — провал, 80% — отлично',
      `${p.xpm} XPM (уровень ${p.level}) — хуже, чем у ${pct(1 - (x ?? 0))} игроков на герое`,
      `${p.xpm} XPM — лучше, чем у ${pct(x ?? 0)} игроков на герое`));
    const T = totals[p.team];
    if (T.nw > 0) {
      const share = p.nw / T.nw, ratio = share / NW_SHARE[p.pos];
      out.push(sub('nw_share', 'Доля нетворса команды', 20, lin(ratio, 0.7, 1.3),
        `${pct(share)} при ожидаемых ${pct(NW_SHARE[p.pos])} для позиции ${p.pos}`, '×0.7 от ожидаемого — плохо, ×1.3 — отлично',
        `Держал ${pct(share)} нетворса команды при норме ${pct(NW_SHARE[p.pos])} для позиции ${p.pos} — недофармил свою роль`,
        `Держал ${pct(share)} нетворса команды (норма ${pct(NW_SHARE[p.pos])})`));
    }
    const rival = enemyOf(p).find((e) => e.pos === p.pos);
    if (rival && rival.nw > 0) {
      const ratio = p.nw / rival.nw;
      out.push(sub('nw_rival', `Нетворс против визави (${rival.hero.dname})`, 20, lin(ratio, 0.6, 1.4),
        `${fmtNum(p.nw)} vs ${fmtNum(rival.nw)} (×${ratio.toFixed(2)})`, '×0.6 — разгром, ×1.4 — доминирование',
        `Закончил с ${fmtNum(p.nw)} нетворса против ${fmtNum(rival.nw)} у вражеского ${rival.hero.dname} на той же позиции`,
        `Обфармил вражеского ${rival.hero.dname}: ${fmtNum(p.nw)} против ${fmtNum(rival.nw)}`));
    }
    if (core && parsed && p.nwT && durMin > 18) {
      let idle = 0, total = 0;
      const last = Math.min(p.nwT.length - 1, Math.floor(durMin));
      for (let t = 10; t < last; t++) { total++; if (p.nwT[t + 1] - p.nwT[t] < 200 * econ) idle++; }
      if (total >= 6) {
        const share = idle / total;
        out.push(sub('idle', 'Минуты без роста нетворса (после 10:00)', 15, lin(share, 0.5, 0.1),
          `${idle} из ${total} минут (${pct(share)})`, '10% — отлично, 50% — провал',
          `${idle} из ${total} минут после лайнинга нетворс почти не рос (меньше ${200 * econ} золота в минуту)`,
          'Фармил стабильно без простоев'));
      }
    }
    return out;
  }

  function fightComponent(p) {
    const core = p.pos <= 3;
    const out = [];
    const T = totals[p.team];
    const hb = p.bench('hero_damage_per_min');
    out.push(versusNorm(p, 'dmg', 'hero_damage_per_min', 20, 'dmg_bench', 'Урон по героям', `${fmtNum(p.hd)} урона (${Math.round(p.hd / durMin)} в минуту)`) || sub('dmg_bench', `Урон по героям относительно ${p.hero.dname}`, 20, lin(hb, 0.1, 0.8),
      hb == null ? '' : `${fmtNum(p.hd)} — лучше ${pct(hb)} игроков на герое`, 'перцентиль: 10% — провал, 80% — отлично',
      `Нанёс ${fmtNum(p.hd)} урона — меньше, чем ${pct(1 - (hb ?? 0))} игроков на ${p.hero.dname}`,
      `Нанёс ${fmtNum(p.hd)} урона — больше, чем ${pct(hb ?? 0)} игроков на ${p.hero.dname}`));
    if (T.kills >= 5) {
      const kp = (p.kills + p.assists) / T.kills;
      const [w, b] = p.pos === 1 ? [0.2, 0.65] : [0.25, 0.75];
      out.push(sub('kp', 'Участие в убийствах', 20, lin(kp, w, b), `${pct(kp)} (${p.kills}+${p.assists} из ${T.kills})`,
        `${pct(w)} — плохо, ${pct(b)} — отлично`,
        `Участвовал лишь в ${pct(kp)} убийств команды`, `Участвовал в ${pct(kp)} убийств команды`));
    }
    if (T.hd > 0) {
      const share = p.hd / T.hd, ratio = share / DMG_SHARE[p.pos];
      out.push(sub('dmg_share', 'Доля урона команды', 15, lin(ratio, 0.55, 1.45),
        `${pct(share)} при ожидаемых ${pct(DMG_SHARE[p.pos])}`, '×0.55 от ожидаемого — плохо, ×1.45 — отлично',
        `Дал ${pct(share)} урона команды при норме ${pct(DMG_SHARE[p.pos])} для позиции ${p.pos}`,
        `Дал ${pct(share)} урона команды (норма ${pct(DMG_SHARE[p.pos])})`));
    }
    const f = p.fightStats;
    if (fights.length >= 2) {
      if (f.eligible >= 2) {
        const pr = f.present / f.eligible;
        out.push(sub('presence', 'Присутствие на тимфайтах', 15, lin(pr, 0.4, 0.9),
          `${f.present} из ${f.eligible} (${pct(pr)})`, '40% — плохо, 90% — отлично; драки, которые пропустил мёртвым, не считаются',
          `Был жив, но не участвовал в ${f.eligible - f.present} из ${f.eligible} тимфайтов` +
            (f.absentLost.length ? ` — в том числе в проигранных на ${f.absentLost.map(fmtTime).join(', ')}` : ''),
          `Участвовал в ${f.present} из ${f.eligible} тимфайтов`));
      }
      if (f.lost >= 2) {
        const rate = f.firstLost.length / f.lost;
        out.push(sub('first_death', 'Умирал первым в проигранных драках', 15, lin(rate, 0.5, 0),
          `${f.firstLost.length} из ${f.lost}`, '0 — идеал, половина драк — провал',
          `Первым умер в ${f.firstLost.length} из ${f.lost} проигранных драк (${f.firstLost.map(fmtTime).join(', ')}) — с него они и начинали сыпаться`,
          'Почти никогда не умирал первым в драках'));
      }
      const avg = f.goldDelta / fights.length;
      const span = (core ? 500 : 300) * econ;
      out.push(sub('fight_gold', 'Баланс золота за драку', 15, lin(avg, -span, span),
        `${signed(avg)} в среднем`, `±${span} — пределы шкалы`,
        `В среднем уходил из драки в минус ${fmtNum(-avg)} золота`,
        `В среднем зарабатывал ${fmtNum(avg)} золота за драку`));
    }
    return out;
  }

  function objectivesComponent(p) {
    const out = [];
    const tb = p.bench('tower_damage');
    const tdNorm = versusNorm(p, 'td', 'tower_damage', 60, 'td_bench', 'Урон по строениям', `${fmtNum(p.td)} урона по строениям`);
    if (tdNorm) tdNorm.bad = Math.round(damp(tdNorm.bad, totals[p.team].td < 2000 ? 0.5 : 1));
    out.push(tdNorm || sub('td_bench', `Урон по строениям относительно ${p.hero.dname}`, 60, damp(lin(tb, 0.05, 0.75), totals[p.team].td < 2000 ? 0.5 : 1),
      tb == null ? '' : `${fmtNum(p.td)} — лучше ${pct(tb)} игроков на герое`, 'перцентиль: 5% — провал, 75% — отлично',
      `${fmtNum(p.td)} урона по строениям — меньше, чем у ${pct(1 - (tb ?? 0))} игроков на ${p.hero.dname}`,
      `${fmtNum(p.td)} урона по строениям — больше, чем у ${pct(tb ?? 0)} игроков на герое`));
    const T = totals[p.team];
    if (T.td > 2000) {
      const share = p.td / T.td, ratio = share / TD_SHARE[p.pos];
      out.push(sub('td_share', 'Доля урона по строениям в команде', 40, lin(ratio, 0.3, 1.7),
        `${pct(share)} при ожидаемых ${pct(TD_SHARE[p.pos])}`, '×0.3 — плохо, ×1.7 — отлично',
        `Лишь ${pct(share)} урона команды по строениям при норме ${pct(TD_SHARE[p.pos])}`,
        `${pct(share)} урона команды по строениям`));
    }
    return out;
  }

  function visionComponent(p) {
    if (!parsed || p.pos < 4) return [];
    const r = p.raw, out = [];
    const per10 = (n) => n / (durMin / 10);
    const obs = r.obs_placed ?? 0, sen = r.sen_placed ?? 0;
    const [ow, ob] = p.pos === 5 ? [1.2, 3.6] : [0.6, 2.6];
    out.push(sub('obs', 'Обсерверы за 10 минут', 35, lin(per10(obs), ow, ob), `${round1(per10(obs))} (всего ${obs})`,
      `${ow} — плохо, ${ob} — отлично`,
      `Поставил всего ${obs} ${plural(obs, ['обсервер', 'обсервера', 'обсерверов'])} за ${Math.round(durMin)} минут — команда играла вслепую`,
      `Поставил ${obs} ${plural(obs, ['обсервер', 'обсервера', 'обсерверов'])}`));
    const [sw, sb] = p.pos === 5 ? [1.5, 5] : [1, 4];
    out.push(sub('sen', 'Сентри за 10 минут', 20, lin(per10(sen), sw, sb), `${round1(per10(sen))} (всего ${sen})`,
      `${sw} — плохо, ${sb} — отлично`, `Всего ${sen} сентри за игру`, `Поставил ${sen} сентри`));
    const dew = (r.observer_kills || 0) + (r.sentry_kills || 0);
    out.push(sub('deward', 'Девард за 10 минут', 20, lin(per10(dew), 0, 1.5), `${round1(per10(dew))} (всего ${dew})`,
      '0 — плохо, 1.5 — отлично', `Снял всего ${dew} вражеских вардов`, `Снял ${dew} вражеских вардов`));
    const placed = r.obs_log || [], left = r.obs_left_log || [];
    if (placed.length >= 3) {
      const lives = placed.map((o) => {
        const end = left.find((l) => l.ehandle === o.ehandle);
        return Math.min(360, (end ? end.time : dur) - o.time);
      });
      const avg = sum(lives) / lives.length;
      const killed = left.filter((l) => l.attackername && heroByName[l.attackername]).length;
      out.push(sub('obs_life', 'Среднее время жизни обсервера', 15, lin(avg, 150, 330), `${fmtTime(avg)} из 6:00`,
        '2:30 — плохо, 5:30 — отлично',
        `Обсерверы жили в среднем ${fmtTime(avg)} из 6:00 — ${killed} из ${placed.length} задеварили`,
        `Обсерверы жили в среднем ${fmtTime(avg)} из 6:00`));
    }
    out.push(sub('stacks', 'Стаки за 10 минут', 10, lin(per10(r.camps_stacked || 0), 0, 1.5),
      `${round1(per10(r.camps_stacked || 0))} (всего ${r.camps_stacked || 0})`, '0 — плохо, 1.5 — отлично',
      'Не стакал лагеря для коров', `Сделал ${r.camps_stacked} ${plural(r.camps_stacked, ['стак', 'стака', 'стаков'])}`));
    return out;
  }

  const firstBigItem = (p) => {
    for (const e of p.raw.purchase_log || []) {
      const it = items[e.key];
      if (it && it.cost >= 2000 && !e.key.startsWith('recipe')) return { key: e.key, time: e.time, name: it.dname };
    }
    return null;
  };

  function disciplineComponent(p) {
    const out = [];
    if (parsed && p.pos <= 3) {
      const mine = firstBigItem(p);
      const rival = enemyOf(p).find((e) => e.pos === p.pos);
      const theirs = rival ? firstBigItem(rival) : null;
      p.keyItem = mine;
      if (mine && theirs) {
        const d = mine.time - theirs.time;
        out.push(sub('item_timing', 'Тайминг первого крупного предмета против визави', 45, lin(d, 300, -300),
          `${mine.name} на ${fmtTime(mine.time)} vs ${theirs.name} на ${fmtTime(theirs.time)}`, '−5:00 — отлично, +5:00 — провал',
          `Первый крупный предмет (${mine.name}) собрал на ${fmtTime(mine.time)} — на ${fmtTime(d)} позже, чем вражеский ${rival.hero.dname} свой ${theirs.name}`,
          `Первый крупный предмет (${mine.name}) на ${fmtTime(mine.time)} — на ${fmtTime(-d)} раньше визави`));
      } else if (!mine && theirs && durMin > 20) {
        out.push(sub('item_timing', 'Тайминг первого крупного предмета против визави', 45, 100,
          `нет предмета дороже 2000 vs ${theirs.name} на ${fmtTime(theirs.time)}`, '−5:00 — отлично, +5:00 — провал',
          `За всю игру не собрал ни одного предмета дороже 2000 золота`, ''));
      }
    }
    if (!p.won && p.raw.gold != null) {
      const bb = 200 + p.nw / 13;
      const excess = p.raw.gold - bb;
      out.push(sub('unspent', 'Непотраченное золото на конец игры (сверх байбека)', 25, Math.max(50, lin(excess, 5000 * econ, -1000 * econ)),
        `${fmtNum(p.raw.gold)} в кармане (байбек ≈ ${fmtNum(bb)})`, `до ${fmtNum(2000 * econ)} сверх байбека — норма, ${fmtNum(5000 * econ)} — провал`,
        `Проиграл с ${fmtNum(p.raw.gold)} золота в кармане — это не купленные предметы`, 'Золото в предметах, а не в кармане'));
    }
    if (parsed) {
      const bbs = p.raw.buyback_log || [];
      if (bbs.length) {
        const wasted = bbs.filter((b) => p.deathList.some((d) => d.time > b.time && d.time - b.time <= 45));
        out.push(sub('bb_death', 'Смерти в течение 45 секунд после байбека', 30, step(wasted.length, [40, 80, 100]),
          `${wasted.length} из ${bbs.length} байбеков`, '0 — норма, 2+ — максимум',
          `${times(wasted.length)} выкупился и тут же умер (${wasted.map((b) => fmtTime(b.time)).join(', ')}) — золото в никуда`,
          'Байбеки использовал по делу'));
      }
    }
    return out;
  }

  function flagsFor(p) {
    const r = p.raw, flags = [];
    if ((r.leaver_status || 0) >= 2) flags.push({ id: 'abandon', pts: 40, text: 'Покинул игру (абандон) — команда доигрывала вчетвером' });
    if (parsed && r.actions_per_min != null && r.actions_per_min < 80 && (r.leaver_status || 0) < 2) {
      flags.push({ id: 'afk', pts: 10, text: `Всего ${r.actions_per_min} действий в минуту — почти не играл (АФК или сдался)` });
    }
    if (p.streak.count >= 5) flags.push({ id: 'feedrun', pts: 8, text: `${p.streak.count} смертей за 5 минут (${fmtTime(p.streak.from)}–${fmtTime(p.streak.to)}) — похоже на тильт или намеренный фид` });
    if (parsed && r.lane_role === 4 && p.pos <= 3) flags.push({ id: 'jungle', pts: 6, text: 'С первых минут ушёл в лес вместо линии' });
    if (parsed && !turbo && !p.won) {
      const midas = (r.purchase_log || []).find((e) => e.key === 'hand_of_midas');
      if (midas && midas.time > 14 * 60) flags.push({ id: 'midas', pts: 4, text: `Купил Мидас на ${fmtTime(midas.time)} — слишком поздно, чтобы он окупился` });
    }
    if (parsed && (r.pings || 0) / durMin > 5) flags.push({ id: 'pings', pts: 3, text: `${r.pings} пингов за игру (${round1(r.pings / durMin)} в минуту) — спамил пингами` });
    return flags;
  }

  const builders = { lane: laneComponent, deaths: deathsComponent, farm: farmComponent, fight: fightComponent,
    objectives: objectivesComponent, vision: visionComponent, discipline: disciplineComponent };

  for (const p of players) {
    const W = { ...WEIGHTS[p.pos] };
    if (turbo) W.vision *= 0.3;
    if (p.offRole === 'core_as_support') { W.vision *= 0.7; W.fight *= 1.15; } // от такого героя ждут убийств, а не только вардов // в турбо варды почти не ставят — вижен почти не учитываем
    const comps = [];
    for (const id of Object.keys(COMPONENTS)) {
      if (!W[id]) continue;
      const subs = builders[id](p).filter(Boolean);
      if (!subs.length) continue;
      const sw = sum(subs, (s) => s.weight);
      let score = sum(subs, (s) => s.bad * s.weight) / sw;
      let note = null;
      // Мало данных в компоненте (например, матч не распарсен) — меньше доверия, ближе к 50.
      const conf = clamp(sw / 70, 0.5, 1);
      if (conf < 1) {
        score = 50 + (score - 50) * conf;
        note = `Данных хватило только на часть метрик — оценка сжата к нейтральной (×${conf.toFixed(2)})`;
      }
      if (id === 'lane' && p.laneInfo && p.laneDeaths <= 1) {
        const feeder = p.laneInfo.mates.find((x) => x.laneDeaths >= 3);
        if (feeder && score > 50) {
          score = score - (score - 50) * 0.35;
          note = `${note ? `${note}. ` : ''}Смягчено на 35%: напарник по линии (${feeder.hero.dname}) умер ${times(feeder.laneDeaths)} до 10:00`;
        }
      }
      comps.push({ id, label: COMPONENTS[id].label, weight: W[id], score, subs, subWeight: sw, note });
    }
    const cw = sum(comps, (c) => c.weight) || 1;
    const base = sum(comps, (c) => c.score * c.weight) / cw;
    for (const c of comps) {
      c.share = c.weight / cw;
      c.contrib = c.share * (c.score - 50);
      const raw = sum(c.subs, (s) => s.bad * s.weight) / c.subWeight;
      const k = raw !== 50 ? (c.score - 50) / (raw - 50) : 1; // учёт смягчения
      for (const s of c.subs) s.contrib = c.share * (s.weight / c.subWeight) * (s.bad - 50) * k;
    }
    p.flags = flagsFor(p);
    p.components = comps;
    p.base = base;
    p.ruin = Math.round(clamp(base + sum(p.flags, (f) => f.pts), 0, 100));
    const all = comps.flatMap((c) => c.subs.map((s) => ({ ...s, comp: c.label })));
    p.reasons = [
      ...p.flags.map((f) => ({ text: f.text, pts: f.pts, comp: 'Поведение' })),
      ...all.filter((s) => s.bad >= 62 && s.why).sort((a, b) => b.contrib - a.contrib).map((s) => ({ text: s.why, pts: s.contrib, comp: s.comp })),
    ].sort((a, b) => b.pts - a.pts);
    p.pros = all.filter((s) => s.bad <= 32 && s.good).sort((a, b) => a.contrib - b.contrib).map((s) => ({ text: s.good, pts: s.contrib, comp: s.comp }));
    p.tier = TIERS.find((t) => p.ruin >= t.min);
    if (p.won && p.tier.id === 'ruiner') p.tier = { id: 'ruiner', label: 'Пассажир' };
  }

  for (const t of Object.values(teams)) {
    const pow = t.map((p) => Math.max(0, p.ruin - 30) ** 2);
    const total = sum(pow) || 1;
    t.forEach((p, i) => { p.blame = pow[i] / total; });
  }

  // ---------- перелом игры ----------
  const loser = m.radiant_win ? 'dire' : 'radiant';
  const winner = m.radiant_win ? 'radiant' : 'dire';
  const TEAM_RU = { radiant: 'Radiant', dire: 'Dire' };
  let turning = null;
  if (adv && adv.length > 6) {
    const la = adv.map((v) => (loser === 'radiant' ? v : -v));
    let peak = 0, peakMin = 0, lastAhead = 0;
    la.forEach((v, i) => { if (v > peak) { peak = v; peakMin = i; } if (v > 0) lastAhead = i; });
    const lostFights = fights.filter((f) => f.winner === winner);
    const swingFor = (f) => (loser === 'radiant' ? -f.swing : f.swing);
    if (peak >= 4000 * econ) {
      const after = lostFights.filter((f) => f.end / 60 >= peakMin - 1).sort((a, b) => swingFor(b) - swingFor(a))[0] || null;
      turning = {
        kind: 'throw', minute: peakMin, peak, fight: after,
        text: `${TEAM_RU[loser]} вели +${fmtK(peak)} золота на ${peakMin}-й минуте и всё равно проиграли — это троу.` +
          (after ? ` Перелом — драка на ${fmtTime(after.start)}: ${after[loser === 'radiant' ? 'radDeaths' : 'direDeaths']} смертей, качели в ${fmtK(swingFor(after))} золота.` : ''),
      };
    } else if (lastAhead <= 5) {
      turning = { kind: 'lanes', minute: lastAhead,
        text: `${TEAM_RU[loser]} отставали по золоту практически с самого начала — игра проиграна ещё на линиях.` };
    } else {
      const after = lostFights.filter((f) => f.end / 60 >= lastAhead - 2).sort((a, b) => swingFor(b) - swingFor(a))[0] || null;
      turning = {
        kind: 'slide', minute: lastAhead, fight: after,
        text: `Последний раз ${TEAM_RU[loser]} были впереди по золоту на ${lastAhead}-й минуте, дальше игра шла в одни ворота.` +
          (after ? ` Самая дорогая проигранная драка — на ${fmtTime(after.start)} (−${fmtK(swingFor(after))} золота).` : ''),
      };
    }
  }

  // ---------- таймлайн ----------
  const events = [];
  const side = (p) => p.team;
  for (const f of fights) {
    const lossTeam = f.winner === 'draw' ? null : f.winner === 'radiant' ? 'dire' : 'radiant';
    const absent = lossTeam ? f.parts.filter((x) => x.absent && x.p.team === lossTeam).map((x) => x.p) : [];
    const firstDead = lossTeam ? f.first[lossTeam] : null;
    events.push({
      t: f.start, kind: 'fight', fight: f, winner: f.winner,
      title: `Драка ${f.radDeaths + f.direDeaths > 6 ? '(большая) ' : ''}— ${f.winner === 'draw' ? 'ничья' : `победа ${TEAM_RU[f.winner]}`}`,
      detail: `Radiant потеряли ${f.radDeaths}, Dire потеряли ${f.direDeaths}. Золото: Radiant ${signed(f.radGold)}, Dire ${signed(f.direGold)}.`,
      firstDead, absent,
      died: f.died.map((x) => ({ p: x.p, time: x.d.time, killer: unitName(x.d.killer, heroByName), gold: x.d.goldFed })),
      impact: Math.abs(f.swing),
      isTurning: turning?.fight === f,
    });
  }
  for (const p of players) {
    for (const d of p.soloDeaths) {
      if (d.goldFed < 250 * econ) continue;
      events.push({
        t: d.time, kind: 'pickoff', winner: p.isRadiant ? 'dire' : 'radiant', players: [p],
        title: `${p.hero.dname} пойман один`,
        detail: `Убил: ${unitName(d.killer, heroByName)}. Отдал ${fmtNum(d.goldFed)} золота, ${d.timeDead} сек в таверне.`,
        impact: d.goldFed,
      });
    }
  }
  for (const o of m.objectives || []) {
    if (o.type === 'CHAT_MESSAGE_ROSHAN_KILL') {
      const team = o.team === 2 ? 'radiant' : 'dire';
      events.push({ t: o.time, kind: 'roshan', winner: team, title: `Рошан — ${TEAM_RU[team]}`, detail: '', impact: 1500 });
    } else if (o.type === 'CHAT_MESSAGE_FIRSTBLOOD') {
      const killer = players.find((p) => p.slot === o.player_slot);
      const victim = players.find((p) => p.slot === o.victim_player_slot);
      if (killer) events.push({ t: o.time, kind: 'firstblood', winner: killer.team, title: 'Первая кровь',
        detail: `${killer.hero.dname} убил ${victim ? victim.hero.dname : 'врага'}.`, impact: 300 });
    } else if (o.type === 'building_kill' && typeof o.key === 'string') {
      const lostBy = o.key.includes('goodguys') ? 'radiant' : 'dire';
      const win = lostBy === 'radiant' ? 'dire' : 'radiant';
      const laneRu = o.key.includes('_mid') ? 'мид' : o.key.includes('_top') ? 'верх' : o.key.includes('_bot') ? 'низ' : '';
      if (o.key.includes('rax')) {
        events.push({ t: o.time, kind: 'rax', winner: win, title: `${TEAM_RU[lostBy]} потеряли бараки (${laneRu})`, detail: o.key.includes('melee') ? 'Милишные бараки' : 'Дальние бараки', impact: 2000 });
      } else if (/tower[34]/.test(o.key)) {
        events.push({ t: o.time, kind: 'tower', winner: win, title: `${TEAM_RU[lostBy]} потеряли ${o.key.includes('tower4') ? 'Т4' : `Т3 (${laneRu})`}`, detail: '', impact: 1000 });
      }
    }
  }
  events.sort((a, b) => a.t - b.t);
  const lostFightEvents = events.filter((e) => e.kind === 'fight' && e.winner === winner).sort((a, b) => b.impact - a.impact);
  lostFightEvents.slice(0, 3).forEach((e) => { e.key = true; });

  // ---------- вердикт ----------
  function teamVerdict(name) {
    const t = [...teams[name]].sort((a, b) => b.ruin - a.ruin);
    const [a, b] = t;
    const others = sum(t.slice(1), (p) => p.ruin) / 4;
    const mean = sum(t, (p) => p.ruin) / 5;
    const lost = name === loser;
    const who = (p) => `${p.hero.dname} (${p.name})`;
    const mvp = t[t.length - 1];
    if (!lost) {
      const passenger = a.ruin >= 58 && a.ruin - others >= 10 ? a : null;
      return { kind: 'won', mvp, culprits: passenger ? [passenger] : [], mean,
        title: `MVP — ${who(mvp)}`,
        text: passenger ? `Победу тащили на себе. Пассажир — ${who(passenger)}: индекс руина ${passenger.ruin} при среднем ${Math.round(others)} у остальных.`
          : 'Вся команда отыграла ровно, явных пассажиров нет.' };
    }
    if (a.flags.some((f) => f.id === 'abandon')) {
      return { kind: 'solo', culprits: [a], mvp, mean, title: `Катку заруинил ${who(a)}`, text: 'Вышел из игры — это автоматически главный виновник.' };
    }
    if (a.ruin >= 58 && a.ruin - others >= 11 && a.ruin - b.ruin >= 6) {
      return { kind: 'solo', culprits: [a], mvp, mean, title: `Катку заруинил ${who(a)}`,
        text: `Индекс руина ${a.ruin} из 100 — на ${Math.round(a.ruin - others)} выше среднего по остальной команде (${Math.round(others)}). На него приходится ${pct(a.blame)} вины.` };
    }
    const third = sum(t.slice(2), (p) => p.ruin) / 3;
    if (b.ruin >= 58 && b.ruin - third >= 8) {
      return { kind: 'duo', culprits: [a, b], mvp, mean, title: `Руинили двое: ${a.hero.dname} и ${b.hero.dname}`,
        text: `Индексы ${a.ruin} и ${b.ruin} при среднем ${Math.round(third)} у остальных троих. Вместе на них ${pct(a.blame + b.blame)} вины.` };
    }
    if (mean >= 60) {
      return { kind: 'collective', culprits: t.filter((p) => p.ruin >= 60), mvp, mean, title: 'Коллективный руин — слилась вся команда',
        text: `Средний индекс руина ${Math.round(mean)}, разброс небольшой: одного виноватого нет, плохо сыграли почти все. Меньше всех виноват ${who(mvp)}.` };
    }
    if (a.ruin < 54) {
      return { kind: 'outplayed', culprits: [], mvp, mean, title: 'Никто не руинил — вас просто переиграли',
        text: `Максимальный индекс руина в команде — ${a.ruin}. Все сыграли в пределах нормы, соперник оказался сильнее.` };
    }
    return { kind: 'weak', culprits: [a], mvp, mean, title: `Явного руинера нет. Слабое звено — ${who(a)}`,
      text: `Индекс руина ${a.ruin} — выше остальных, но разрыв с командой (${Math.round(others)}) недостаточен, чтобы повесить всё на одного.` };
  }
  const verdicts = { radiant: teamVerdict('radiant'), dire: teamVerdict('dire') };

  const story = [];
  if (lanes.length) {
    const lostLanes = lanes.filter((l) => l.winner === winner), wonLanes = lanes.filter((l) => l.winner === loser);
    story.push(`Линии: ${TEAM_RU[loser]} проиграли ${lostLanes.length}, выиграли ${wonLanes.length}, ничьих ${lanes.length - lostLanes.length - wonLanes.length}` +
      (lostLanes.length ? ` (проиграны: ${lostLanes.map((l) => `${l.name.toLowerCase()}${l.free ? ' — отдана без боя' : l.crush ? ' — разгромно' : ''}`).join(', ')}).` : '.'));
  }
  for (const l of lanes) {
    for (const t of ['radiant', 'dire']) {
      const other = t === 'radiant' ? 'dire' : 'radiant';
      if (l[t].length >= 3 && lanes.some((x) => x !== l && x.free && !x[t].length)) {
        const empty = lanes.find((x) => x !== l && x.free && !x[t].length);
        story.push(`${TEAM_RU[t]} стояли ${l[t].length === 3 ? 'втроём' : 'вчетвером'} на одной линии (${l.name.toLowerCase()}), а ${empty.name.toLowerCase()} осталась пустой — ${TEAM_RU[other]} фармили её без сопротивления.`);
      }
    }
  }
  if (turning) story.push(turning.text);
  if (fights.length) {
    const w = fights.filter((f) => f.winner === loser).length, l = fights.filter((f) => f.winner === winner).length;
    story.push(`Тимфайты: ${TEAM_RU[loser]} выиграли ${w} и проиграли ${l} из ${fights.length}.`);
  }

  return {
    meta: {
      id: m.match_id, duration: dur, startTime: m.start_time, radiantWin: !!m.radiant_win,
      radiantScore: m.radiant_score ?? totals.radiant.kills, direScore: m.dire_score ?? totals.dire.kills,
      gameMode: m.game_mode, patchId: m.patch ?? null, turbo, parsed, loser, winner,
      radiantName: m.radiant_team?.name || m.radiant_name || 'Radiant', direName: m.dire_team?.name || m.dire_name || 'Dire',
      avgRank: Math.round(sum(players, (p) => p.raw.rank_tier || 0) / (players.filter((p) => p.raw.rank_tier).length || 1)) || null,
    },
    players, teams, totals, lanes, fights, events, turning, verdicts, story,
    series: { goldAdv: adv, xpAdv: m.radiant_xp_adv || null },
  };
}
