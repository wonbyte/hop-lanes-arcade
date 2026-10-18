import { audio, sfx } from './audio.js';
import { $, G } from './core.js';
import { t } from './i18n.js';
import { CHARACTERS, PAINTS, drawPix, isOwned, paintCss, paintedPix } from './models.js';
import { closeDialog, openDialog } from './panels.js';
import { charOf, players } from './players.js';
import { setCards } from './screens.js';
import { addPaint, hasPaint, paintOf, setBank, wearPaint } from './storage.js';

// The paint shop (the coin sink): a dialog on the title. The arrows pick one of the animals the player owns; the
// swatches under it are the paint jobs (models.js PAINTS). A tap on a bought one puts it on, a tap on a locked one buys
// it with coins (once per animal). A paint changes the look only (storage.js paintOf: the animal wears it everywhere).
// ---------- the paint shop ----------
let animal = 0;   // the index into CHARACTERS of the animal on show
const ownedChars = () => CHARACTERS.map((c, i) => (isOwned(c) ? i : -1)).filter(i => i >= 0);
const swatches = $('swatches');
PAINTS.forEach((p, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.i = String(i);
  b.append(document.createElement('i'), document.createElement('span'));   // the color chip, the name and price
  b.addEventListener('click', () => pickPaint(i));
  swatches.appendChild(b);
});
function showPaint() {
  const ch = CHARACTERS[animal], worn = paintOf(ch.key);
  $('paintTitle').textContent = t('PAINT SHOP'); $('closePaint').textContent = t('CLOSE');
  $('paintName').textContent = t(ch.name) + ' · ' + t(PAINTS.find(p => p.key === worn).name);
  drawPix($('paintPic'), paintedPix(ch.key, worn));
  for (const b of /** @type {HTMLCollectionOf<HTMLElement>} */ (swatches.children)) {
    const p = PAINTS[Number(b.dataset.i)], own = hasPaint(ch.key, p.key);
    /** @type {HTMLElement} */ (b.querySelector('i')).style.background = paintCss(ch.key, p.key);
    b.querySelector('span').textContent = t(p.name) + (own ? '' : ' \u00b7 ' + p.price);
    b.setAttribute('aria-pressed', String(p.key === worn));
    b.classList.toggle('locked', !own);
  }
  $('paintNote').textContent = t('YOU HAVE {n} COINS', { n: G.bank });
}
// a bought paint goes on at once; a locked one is bought first, when the coins are there
function pickPaint(i) {
  const ch = CHARACTERS[animal], p = PAINTS[i];
  if (!hasPaint(ch.key, p.key)) {
    if (G.bank < p.price) { sfx.nope(); showPaint(); $('paintNote').textContent = t('NEED {n} COINS', { n: p.price }); return; }
    setBank(G.bank - p.price);
    addPaint(ch.key, p.key);
    sfx.buy();
  } else sfx.tick();
  wearPaint(ch.key, p.key);
  showPaint();
  setCards();   // the join cards show the animal in its new paint
}
function cycleAnimal(d) {
  const own = ownedChars(), k = own.indexOf(animal);
  animal = own[(k + d + own.length) % own.length];
  sfx.tick();
  showPaint();
}
$('paintPrev').addEventListener('click', () => cycleAnimal(-1));
$('paintNext').addEventListener('click', () => cycleAnimal(1));
$('paintBtn').addEventListener('click', () => {
  if (G.state !== 'attract') return;
  audio(); sfx.tick();
  const first = charOf(players[0]);   // the shop opens on player 1's animal (a locked pick: the first owned one)
  animal = isOwned(first) ? players[0].charIndex : ownedChars()[0];
  showPaint();
  openDialog('paintBox');
});
$('closePaint').addEventListener('click', () => { sfx.tick(); closeDialog(); });
document.addEventListener('hoplanes:lang', () => { $('paintBtn').textContent = t('PAINT SHOP'); });
$('paintBtn').textContent = t('PAINT SHOP');
