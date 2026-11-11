// Reconstruye el estado del Dualocke a partir de TODAS las partidas subidas (saves/<jugador>/<fecha>.sav)
// y genera la web en site/. Lo ejecuta GitHub Actions en cada subida.
const fs = require('fs'), path = require('path');
const { parse } = require('./parse.js');
const ROOT = path.join(__dirname, '..'), SAVES = path.join(ROOT, 'saves'), SITE = path.join(ROOT, 'site');
const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';

// ---------- nombres (PokeAPI, en español con respaldo en inglés) ----------
function csvRows(text) { return text.split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(',')); }
function nameTable(text) { // id,lang,name,...
  const es = {}, en = {};
  for (const r of csvRows(text)) { if (r[1] === '7') es[r[0]] = r[2]; else if (r[1] === '9') en[r[0]] = r[2]; }
  return Object.assign(en, es);
}
async function get(file) { const r = await fetch(CSV + file); if (!r.ok) throw new Error(file + ' ' + r.status); return r.text(); }
async function loadNames() {
  const N = { species: {}, moves: {}, abilities: {}, items: {}, natures: {} };
  const safe = async (k, fn) => { try { N[k] = await fn(); } catch (e) { console.log('Sin nombres de', k, '-', e.message); } };
  await Promise.all([
    safe('species', async () => nameTable(await get('pokemon_species_names.csv'))),
    safe('moves', async () => nameTable(await get('move_names.csv'))),
    safe('abilities', async () => nameTable(await get('ability_names.csv'))),
    safe('items', async () => {
      const names = nameTable(await get('item_names.csv')), out = {};
      for (const r of csvRows(await get('item_game_indices.csv'))) if (r[1] === '7' && names[r[0]]) out[r[2]] = names[r[0]];
      return out;
    }),
  ]);
  return N;
}
const NATURES = ['Fuerte','Huraña','Audaz','Firme','Pícara','Osada','Dócil','Plácida','Agitada','Floja','Miedosa','Activa','Seria','Alegre','Ingenua','Modesta','Afable','Mansa','Tímida','Alocada','Serena','Amable','Grosera','Cauta','Rara'];
const ZTYPES = { 807:'Normal',808:'Fuego',809:'Agua',810:'Eléctrico',811:'Planta',812:'Hielo',813:'Lucha',814:'Veneno',815:'Tierra',816:'Volador',817:'Psíquico',818:'Bicho',819:'Roca',820:'Fantasma',821:'Dragón',822:'Siniestro',823:'Acero',824:'Hada' };
const bits = v => { let n = 0; for (let b = 0; b < 32; b++) n += v >>> b & 1; return n; };

// ---------- nivel a partir de la experiencia ----------
const CURVES = {
  fast: n => Math.floor(4 * n ** 3 / 5), mediumFast: n => n ** 3,
  mediumSlow: n => Math.floor(6 * n ** 3 / 5) - 15 * n * n + 100 * n - 140, slow: n => Math.floor(5 * n ** 3 / 4),
  erratic: n => n <= 50 ? Math.floor(n ** 3 * (100 - n) / 50) : n <= 68 ? Math.floor(n ** 3 * (150 - n) / 100) : n <= 98 ? Math.floor(n ** 3 * Math.floor((1911 - 10 * n) / 3) / 500) : Math.floor(n ** 3 * (160 - n) / 100),
  fluctuating: n => n <= 15 ? Math.floor(n ** 3 * (Math.floor((n + 1) / 3) + 24) / 50) : n <= 36 ? Math.floor(n ** 3 * (n + 14) / 50) : Math.floor(n ** 3 * (Math.floor(n / 2) + 32) / 50),
};
function levelFor(curve, exp) { let l = 1; while (l < 100 && exp >= (l + 1 === 1 ? 0 : CURVES[curve](l + 1))) l++; return l; }
const speciesCurves = {}; // especie -> curvas compatibles con lo observado
function learnCurve(species, exp, level) {
  const cur = speciesCurves[species] || Object.keys(CURVES);
  const ok = cur.filter(c => levelFor(c, exp) === level);
  if (ok.length) speciesCurves[species] = ok;
}
function guessLevel(species, exp) {
  const levels = [...new Set((speciesCurves[species] || Object.keys(CURVES)).map(c => levelFor(c, exp)))];
  return { level: Math.round(levels.reduce((a, b) => a + b, 0) / levels.length), exact: levels.length === 1 };
}

// ---------- reconstrucción ----------
const fmtPT = p => `${p.h}h ${String(p.m).padStart(2, '0')}m`;
const secs = p => p.h * 3600 + p.m * 60 + p.s;
function tsFromFile(f) { // 2026-11-11T09-30-00Z.sav
  const m = f.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/); return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : null;
}
function processPlayer(player, N) {
  const dir = path.join(SAVES, player);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sav') && tsFromFile(f)).sort();
  const mons = new Map(), events = [], alerts = [];
  let prev = null, last = null, zPrev = null, saveCount = 0;
  const spName = p => p.isEgg ? 'Huevo' : (N.species[p.species] || `#${p.species}`);
  const label = m => m.nick && m.nick !== m.name ? `${m.nick} (${m.name})` : m.name;
  for (const f of files) {
    const t = tsFromFile(f); let s;
    try { s = parse(fs.readFileSync(path.join(dir, f))); }
    catch (e) { alerts.push({ t, text: `Archivo de partida ilegible (${f}): ${e.message}` }); continue; }
    saveCount++;
    const ev = (type, text, key) => events.push({ t, type, text, key, pt: fmtPT(s.playtime) });
    const al = text => alerts.push({ t, text, pt: fmtPT(s.playtime) });
    const first = !prev;
    if (prev) {
      if (s.trainer.tid !== prev.trainer.tid || s.trainer.sid !== prev.trainer.sid || s.trainer.name !== prev.trainer.name)
        al(`La partida es de otro entrenador: antes ${prev.trainer.name} (${prev.trainer.tid}), ahora ${s.trainer.name} (${s.trainer.tid}).`);
      if (secs(s.playtime) < secs(prev.playtime))
        al(`El tiempo de juego ha retrocedido (de ${fmtPT(prev.playtime)} a ${fmtPT(s.playtime)}): se ha cargado una partida anterior.`);
    }
    const seen = new Set();
    const cur = [...s.party.map((p, i) => ({ ...p, where: 'party', slot: i + 1 })), ...s.boxes.map(p => ({ ...p, where: 'box' }))];
    for (const p of cur) {
      let key = `${p.ec}-${p.pid}`;
      if (seen.has(key)) { let n = 2; while (seen.has(`${key}#${n}`)) n++; key = `${key}#${n}`;
        if (!mons.has(key) && !first) al(`Pokémon duplicado detectado (posible clonación): ${p.nick || spName(p)}.`); }
      seen.add(key);
      if (p.level) learnCurve(p.species, p.exp, p.level);
      const old = mons.get(key), name = spName(p);
      const m = old || { key, firstSeen: t, status: 'alive', baseline: first };
      const was = { ...m };
      Object.assign(m, { species: p.species, form: p.form, name, nick: p.nick, isEgg: p.isEgg, exp: p.exp, where: p.where, box: p.box || null, slot: p.slot,
        item: p.item, itemName: p.item ? (N.items[p.item] || `Objeto #${p.item}`) : null, nature: NATURES[p.nature] || null,
        ability: N.abilities[p.ability] || `Habilidad #${p.ability}`, moves: p.moves.filter(Boolean).map(x => N.moves[x] || `Mov. #${x}`),
        ot: p.ot, metLoc: p.metLoc, metLvl: p.metLvl, metDate: p.metDate, ball: p.ball, lastSeen: t });
      if (p.level) { m.level = p.level; m.levelExact = true; m.hp = p.hp; m.maxHp = p.maxHp; }
      mons.set(key, m);
      if (!old) {
        if (!first) ev('catch', `Nuevo Pokémon: ${label(m)}, obtenido a nivel ${p.metLvl} (zona #${p.metLoc}).`, key);
        if (!p.isEgg && (p.tid !== s.trainer.tid || p.ot !== s.trainer.name)) al(`${label(m)} no pertenece a este entrenador (EO: ${p.ot}): intercambiado o introducido desde fuera.`);
        if (!p.valid) al(`${label(m)} tiene datos corruptos o manipulados.`);
      } else {
        if (was.species !== p.species && !was.isEgg) ev('evo', `${was.nick && was.nick !== was.name ? was.nick : was.name} evoluciona: ${was.name} → ${name}.`, key);
        if (was.isEgg && !p.isEgg) ev('catch', `Eclosiona un huevo: ${label(m)}.`, key);
        if (p.exp < was.exp) al(`${label(m)} tiene menos experiencia que antes (${was.exp} → ${p.exp}).`);
        if (was.status === 'gone') { m.status = was.diedAt ? 'dead' : 'alive'; al(`${label(m)} había desaparecido de la partida y ha vuelto a aparecer.`); }
        if (m.status === 'dead' && p.where === 'party' && p.hp > 0 && !(was.where === 'party' && was.hp > 0))
          al(`${label(m)} está muerto pero vuelve a estar en el equipo con vida.`);
      }
      if (p.where === 'party' && !p.isEgg && p.hp === 0 && m.status === 'alive') {
        m.status = 'dead'; m.diedAt = t; m.deathLevel = p.level;
        if (first) m.baseline = true;
        ev('death', `${label(m)} ha muerto (debilitado al guardar, nivel ${p.level}).`, key);
      }
    }
    for (const m of mons.values()) if (!seen.has(m.key) && m.status !== 'gone') {
      if (m.status === 'alive' && !m.isEgg) ev('gone', `${label(m)} ya no está en la partida (liberado o intercambiado). Cuenta como perdido.`, m.key);
      m.goneAt = t; m.prevStatus = m.status; m.status = 'gone'; m.where = null;
    }
    const z = s.items.z.map(i => i.id);
    if (zPrev) {
      for (const id of z) if (!zPrev.includes(id)) ev('z', `Nuevo cristal Z: ${zName(id, N)}.`);
      for (const id of zPrev) if (!z.includes(id)) al(`Ha desaparecido un cristal Z: ${zName(id, N)}.`);
    }
    zPrev = z;
    if (prev) for (let b = 0; b < 32; b++) if ((s.stamps >>> b & 1) && !(prev.stamps >>> b & 1)) ev('stamp', `Nuevo sello en el pasaporte (nº ${b + 1}).`);
    if (first) ev('start', `Primera partida registrada: ${s.trainer.name}, ${fmtPT(s.playtime)} de juego, ${cur.length} Pokémon.`);
    prev = s; last = t;
  }
  if (!prev) return null;
  const all = [...mons.values()];
  for (const m of all) if (!m.levelExact) { const g = guessLevel(m.species, m.exp); m.level = g.level; m.levelExact = g.exact; }
  const pub = m => { const { exp, baseline, prevStatus, ...r } = m; return r; };
  return {
    player, trainer: prev.trainer, playtime: fmtPT(prev.playtime), money: prev.money, lastSave: last, saveCount,
    party: all.filter(m => m.where === 'party').sort((a, b) => a.slot - b.slot).map(pub),
    boxes: all.filter(m => m.where === 'box' && m.status === 'alive').sort((a, b) => a.box - b.box || a.slot - b.slot).map(pub),
    dead: all.filter(m => m.status === 'dead' || (m.status === 'gone' && m.diedAt)).map(pub),
    lost: all.filter(m => m.status === 'gone' && !m.diedAt && !m.isEgg).map(pub),
    z: zPrev.map(id => zName(id, N)),
    stamps: bits(prev.stamps),
    events: events.reverse(), alerts: alerts.reverse(),
  };
}
function zName(id, N) { return ZTYPES[id] ? `Cristal Z ${ZTYPES[id]}` : (N.items[id] || `Cristal Z #${id}`); }

(async () => {
  const N = await loadNames();
  fs.rmSync(SITE, { recursive: true, force: true }); fs.mkdirSync(path.join(SITE, 'data'), { recursive: true });
  const players = fs.existsSync(SAVES) ? fs.readdirSync(SAVES).filter(d => fs.statSync(path.join(SAVES, d)).isDirectory()) : [];
  const done = [];
  for (const p of players) { const r = processPlayer(p, N); if (r) { fs.writeFileSync(path.join(SITE, 'data', p + '.json'), JSON.stringify(r)); done.push(p); console.log(p, r.saveCount, 'partidas,', r.events.length, 'eventos,', r.alerts.length, 'avisos'); } }
  fs.writeFileSync(path.join(SITE, 'data', 'index.json'), JSON.stringify({ players: done, generated: new Date().toISOString() }));
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(SITE, 'index.html'));
})();
