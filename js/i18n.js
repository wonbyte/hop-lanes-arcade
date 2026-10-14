// Text in three languages. Keys are the English strings; a missing translation falls back to English.
// Static markup uses data-i18n="key"; code calls t(key, { n, name }).
const ES = {
  'TAP THIS\nSIDE TO JOIN': 'TOCA ESTE\nLADO PARA ENTRAR', 'PRESS TAP\nTO JOIN': 'PULSA TAP\nPARA ENTRAR', 'READY!': '¡LISTO!',
  'PLAYER {n}': 'JUGADOR {n}', 'TAP TO BUY': 'TOCA PARA COMPRAR', 'NEED {n} COINS': 'FALTAN {n} MONEDAS', '{name} · {n} COINS': '{name} · {n} MONEDAS',
  FROG: 'RANA', FOX: 'ZORRO', BUNNY: 'CONEJO', CAT: 'GATO', ROBOT: 'ROBOT', PIG: 'CERDO', PENGUIN: 'PINGÜINO', TURTLE: 'TORTUGA',
  'MODE: CLASSIC': 'MODO: CLÁSICO', 'MODE: RACE': 'MODO: CARRERA', 'MODE: DAILY': 'MODO: DIARIO', 'ROOM: {code}': 'SALA: {code}',
  'PRIZE · {n} COINS': 'PREMIO · {n} MONEDAS', 'ALL PRIZES WON': 'TODOS LOS PREMIOS', 'COLLECT THEM ON THE ROAD': 'RECÓGELAS EN EL CAMINO',
  'YOU GOT {name}!': '¡TIENES {name}!', 'IT IS NOW PLAYER 1': 'AHORA ES EL JUGADOR 1',
  'SHARED!': '¡COMPARTIDO!', 'COPIED!': '¡COPIADO!', 'SELECT AND COPY': 'SELECCIONA Y COPIA', SHARE: 'COMPARTIR',
  'COPY REPLAY LINK': 'COPIAR REPETICIÓN', 'REPLAY LINK COPIED!': '¡ENLACE COPIADO!', 'REPLAY OVER': 'FIN DE LA REPETICIÓN', REPLAY: 'REPETICIÓN',
  'GAME OVER': 'FIN DEL JUEGO', 'TIE GAME!': '¡EMPATE!', '{name} WINS!': '¡GANA {name}!',
  'NEW ALL TIME BEST!': '¡NUEVO RÉCORD!', 'NEW BEST TODAY!': '¡MEJOR DE HOY!', 'NEW DAILY CHALLENGE BEST!': '¡RÉCORD DEL RETO DIARIO!',
  'DAILY CHALLENGE BEST {n}.': 'MEJOR DEL RETO DIARIO {n}.', 'BY {n} ROWS.': 'POR {n} FILAS.', 'PRESS TAP TO PLAY AGAIN': 'PULSA TAP PARA JUGAR OTRA VEZ',
  'WORLD BEST {n} · {name}': 'MEJOR DEL MUNDO {n} · {name}', 'TODAY TOP {n} · {name}': 'MEJOR DE HOY {n} · {name}',
  'I scored {n} in Hop Lanes as {name}!': '¡Hice {n} en Hop Lanes como {name}!', 'Room {code}': 'Sala {code}',
  PAUSED: 'PAUSA', 'TAP TO CONTINUE': 'TOCA PARA SEGUIR', 'PRESS ANY KEY': 'PULSA UNA TECLA', 'GO!': '¡YA!',
  'FROG VS FOX': 'RANA CONTRA ZORRO', 'OTHER PLAYER: TAP TO JOIN': 'OTRO JUGADOR: TOCA PARA ENTRAR', 'TAP TO HOP · SWIPE TO TURN': 'TOCA PARA SALTAR · DESLIZA PARA GIRAR',
  'Tap the game to hop forward.\nSwipe to move left, right or back.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!':
    'Toca el juego para saltar.\nDesliza para ir a un lado o atrás.\nJunta monedas para abrir animales.\n¡Si te quedas quieto, el águila te atrapa!',
  'Player 1: W A S D.  Player 2: arrow keys.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!':
    'Jugador 1: W A S D.  Jugador 2: flechas.\nJunta monedas para abrir animales.\n¡Si te quedas quieto, el águila te atrapa!',
  'HOW TO PLAY': 'CÓMO JUGAR', 'GOT IT': 'ENTENDIDO', BEST: 'RÉCORD', TODAY: 'HOY', COINS: 'MONEDAS', TAP: 'TAP', 'PLAYER 1': 'JUGADOR 1', 'PLAYER 2': 'JUGADOR 2',
  START: 'INICIO', P1: 'J1', P2: 'J2', 'P1 W A S D': 'J1 W A S D', 'P2 ARROWS': 'J2 FLECHAS', 'SPACE START': 'ESPACIO INICIO', 'SOUND ON': 'SONIDO SÍ', 'SOUND OFF': 'SONIDO NO',
  'ADD TO HOME SCREEN': 'AÑADIR A INICIO', 'TAP SHARE IN SAFARI, THEN "ADD TO HOME SCREEN"': 'TOCA COMPARTIR EN SAFARI Y LUEGO "AÑADIR A INICIO"',
  MAGNET: 'IMÁN', 'HANDICAP: OFF': 'VENTAJA: NO', 'SHIELD: P1': 'ESCUDO: J1', 'SHIELD: P2': 'ESCUDO: J2', 'ROOM CODE (4 LETTERS)': 'CÓDIGO DE SALA (4 LETRAS)',
  MISSIONS: 'MISIONES', 'MISSION DONE +{n}': 'MISIÓN HECHA +{n}',
  'COLLECT {n} COINS IN ONE RUN': 'JUNTA {n} MONEDAS EN UNA PARTIDA', 'REACH ROW {n}': 'LLEGA A LA FILA {n}', 'CROSS {n} RIVERS': 'CRUZA {n} RÍOS',
  'HOP {n} TIMES': 'SALTA {n} VECES', 'RIDE {n} LOGS': 'MONTA {n} TRONCOS', 'COMBO OF {n}': 'COMBO DE {n}', 'GRAB A POWER-UP': 'COGE UN POTENCIADOR', 'FIND A HIDDEN COIN': 'HALLA UNA MONEDA OCULTA'
};
const DE = {
  'TAP THIS\nSIDE TO JOIN': 'TIPPE HIER\nZUM MITSPIELEN', 'PRESS TAP\nTO JOIN': 'DRÜCKE TAP\nZUM MITSPIELEN', 'READY!': 'BEREIT!',
  'PLAYER {n}': 'SPIELER {n}', 'TAP TO BUY': 'TIPPEN ZUM KAUFEN', 'NEED {n} COINS': 'NOCH {n} MÜNZEN', '{name} · {n} COINS': '{name} · {n} MÜNZEN',
  FROG: 'FROSCH', FOX: 'FUCHS', BUNNY: 'HASE', CAT: 'KATZE', ROBOT: 'ROBOTER', PIG: 'SCHWEIN', PENGUIN: 'PINGUIN', TURTLE: 'SCHILDKRÖTE',
  'MODE: CLASSIC': 'MODUS: KLASSISCH', 'MODE: RACE': 'MODUS: RENNEN', 'MODE: DAILY': 'MODUS: TÄGLICH', 'ROOM: {code}': 'RAUM: {code}',
  'PRIZE · {n} COINS': 'PREIS · {n} MÜNZEN', 'ALL PRIZES WON': 'ALLE PREISE GEWONNEN', 'COLLECT THEM ON THE ROAD': 'SAMMLE SIE AUF DER STRASSE',
  'YOU GOT {name}!': 'DU HAST {name}!', 'IT IS NOW PLAYER 1': 'JETZT SPIELER 1',
  'SHARED!': 'GETEILT!', 'COPIED!': 'KOPIERT!', 'SELECT AND COPY': 'MARKIEREN UND KOPIEREN', SHARE: 'TEILEN',
  'COPY REPLAY LINK': 'REPLAY-LINK KOPIEREN', 'REPLAY LINK COPIED!': 'LINK KOPIERT!', 'REPLAY OVER': 'REPLAY ZU ENDE', REPLAY: 'REPLAY',
  'GAME OVER': 'SPIEL VORBEI', 'TIE GAME!': 'UNENTSCHIEDEN!', '{name} WINS!': '{name} GEWINNT!',
  'NEW ALL TIME BEST!': 'NEUER REKORD!', 'NEW BEST TODAY!': 'TAGESBESTE!', 'NEW DAILY CHALLENGE BEST!': 'NEUER TAGES-REKORD!',
  'DAILY CHALLENGE BEST {n}.': 'TAGES-REKORD {n}.', 'BY {n} ROWS.': 'MIT {n} REIHEN.', 'PRESS TAP TO PLAY AGAIN': 'DRÜCKE TAP FÜR NOCH EIN SPIEL',
  'WORLD BEST {n} · {name}': 'WELTREKORD {n} · {name}', 'TODAY TOP {n} · {name}': 'HEUTE BESTE {n} · {name}',
  'I scored {n} in Hop Lanes as {name}!': 'Ich habe {n} in Hop Lanes als {name} geschafft!', 'Room {code}': 'Raum {code}',
  PAUSED: 'PAUSE', 'TAP TO CONTINUE': 'TIPPEN ZUM WEITERSPIELEN', 'PRESS ANY KEY': 'DRÜCKE EINE TASTE', 'GO!': 'LOS!',
  'FROG VS FOX': 'FROSCH GEGEN FUCHS', 'OTHER PLAYER: TAP TO JOIN': 'ZWEITER SPIELER: TIPPEN ZUM MITSPIELEN', 'TAP TO HOP · SWIPE TO TURN': 'TIPPEN ZUM HÜPFEN · WISCHEN ZUM DREHEN',
  'Tap the game to hop forward.\nSwipe to move left, right or back.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!':
    'Tippe auf das Spiel, um zu hüpfen.\nWische nach links, rechts oder zurück.\nSammle Münzen für neue Tiere.\nStehst du zu lange still, holt dich der Adler!',
  'Player 1: W A S D.  Player 2: arrow keys.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!':
    'Spieler 1: W A S D.  Spieler 2: Pfeiltasten.\nSammle Münzen für neue Tiere.\nStehst du zu lange still, holt dich der Adler!',
  'HOW TO PLAY': 'SO GEHT ES', 'GOT IT': 'ALLES KLAR', BEST: 'REKORD', TODAY: 'HEUTE', COINS: 'MÜNZEN', TAP: 'TAP', 'PLAYER 1': 'SPIELER 1', 'PLAYER 2': 'SPIELER 2',
  START: 'START', P1: 'S1', P2: 'S2', 'P1 W A S D': 'S1 W A S D', 'P2 ARROWS': 'S2 PFEILE', 'SPACE START': 'LEERTASTE START', 'SOUND ON': 'TON AN', 'SOUND OFF': 'TON AUS',
  'ADD TO HOME SCREEN': 'ZUM STARTBILDSCHIRM', 'TAP SHARE IN SAFARI, THEN "ADD TO HOME SCREEN"': 'IN SAFARI AUF TEILEN, DANN "ZUM HOME-BILDSCHIRM"',
  MAGNET: 'MAGNET', 'HANDICAP: OFF': 'HANDICAP: AUS', 'SHIELD: P1': 'SCHILD: S1', 'SHIELD: P2': 'SCHILD: S2', 'ROOM CODE (4 LETTERS)': 'RAUMCODE (4 BUCHSTABEN)',
  MISSIONS: 'MISSIONEN', 'MISSION DONE +{n}': 'MISSION GESCHAFFT +{n}',
  'COLLECT {n} COINS IN ONE RUN': 'SAMMLE {n} MÜNZEN IN EINEM LAUF', 'REACH ROW {n}': 'ERREICHE REIHE {n}', 'CROSS {n} RIVERS': 'ÜBERQUERE {n} FLÜSSE',
  'HOP {n} TIMES': 'HÜPFE {n} MAL', 'RIDE {n} LOGS': 'REITE AUF {n} STÄMMEN', 'COMBO OF {n}': 'COMBO VON {n}', 'GRAB A POWER-UP': 'SCHNAPP DIR EIN POWER-UP', 'FIND A HIDDEN COIN': 'FINDE EINE VERSTECKTE MÜNZE'
};
const LANGS = ['en', 'es', 'de'];
const TABLES = { en: {}, es: ES, de: DE };
const LANG_KEY = 'hoplanes.lang';
let lang = 'en';
function pickLang() {
  let saved = '';
  try { saved = localStorage.getItem(LANG_KEY) || ''; } catch (e) {}
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  lang = LANGS.includes(saved) ? saved : LANGS.includes(nav) ? nav : 'en';
  document.documentElement.lang = lang;
}
function setLang(l) {
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
  document.documentElement.lang = l;
  applyLang();
}
const nextLang = () => LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
function t(key, args) {
  let s = TABLES[lang][key] || key;
  if (args) for (const k in args) s = s.split('{' + k + '}').join(args[k]);
  return s;
}
// static texts: every element with data-i18n gets its text in the current language
function applyLang() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  const b = document.getElementById('lang');
  if (b) b.textContent = lang.toUpperCase();
}
pickLang();
applyLang();
const getLang = () => lang;

export { DE, ES, LANGS, LANG_KEY, applyLang, getLang, nextLang, pickLang, setLang, t };
