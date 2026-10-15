import { TRAIN_CARS, TRAIN_CAR_LEN, TRAIN_GAP, trainLen } from './gen.js';   // car paint and train sizes are world data
import { owned } from './storage.js';
import { cachedGeo, voxelMesh } from './voxel.js';

// Colors, pixel portraits and voxel box lists for everything that is drawn.
// ---------- shared colors (3D models and the pixel portraits use the same ones) ----------
const COLORS = {
  frog: { body: 0x4cbf3f, belly: 0xa6e37a, mouth: 0xe0453a, eye: 0xffffff, pupil: 0x111111, leg: 0x2d7a25 },
  fox: { fur: 0xf07a2a, cream: 0xfff4e6, dark: 0x1a1a1a },
  bunny: { fur: 0xf4f1ec, ear: 0xf7b9c4, eye: 0x222222, nose: 0xe06a7c },
  cat: { fur: 0x6d6f7a, dark: 0x3a3b45, eye: 0xf2c33a, pupil: 0x111111, nose: 0xe88a9a },
  robot: { body: 0xb8c0cc, dark: 0x5a6270, eye: 0x4fb8ff, light: 0xff6f5a },
  pig: { skin: 0xf4a6b8, dark: 0xd4748c, eye: 0x222222 },
  penguin: { back: 0x22252e, belly: 0xf6f3ee, beak: 0xf2a33a, eye: 0xffffff },
  turtle: { shell: 0x3f8f3a, skin: 0x9cd36a, dark: 0x2a5f27, eye: 0x111111 },
  coin: { face: 0xffd84a, rim: 0xc99a1e }
};
const css = hex => '#' + hex.toString(16).padStart(6, '0');

// ---------- pixel portraits for the join cards ----------
const PIX = {
  frog: { rows: [
    '............',
    '..WWW..WWW..',
    '..WKW..WKW..',
    '.GGGGGGGGGG.',
    '.GGGGGGGGGG.',
    '.GRRRRRRRRG.',
    '.GGGGGGGGGG.',
    '.GLLLLLLLLG.',
    '.GLLLLLLLLG.',
    '.DD.DD.DD.DD',
    '............',
    '............'],
    pal: { W: COLORS.frog.eye, K: COLORS.frog.pupil, G: COLORS.frog.body, R: COLORS.frog.mouth, L: COLORS.frog.belly, D: COLORS.frog.leg } },
  fox: { rows: [
    '.K........K.',
    '.OO......OO.',
    '.OOOOOOOOOO.',
    '.OOKOOOOKOO.',
    '.OOOOOOOOOO.',
    '.OOWWWWWWOO.',
    '.OWWWKKWWWO.',
    '.OOWWWWWWOO.',
    '.OOOWWWWOOO.',
    '.OOOOOOOOOO.',
    '..KK....KK..',
    '............'],
    pal: { O: COLORS.fox.fur, W: COLORS.fox.cream, K: COLORS.fox.dark } },
  bunny: { rows: [
    '...W....W...',
    '...WP..WP...',
    '...WP..WP...',
    '...W....W...',
    '..WWWWWWWW..',
    '.WWWWWWWWWW.',
    '.WWKWWWWKWW.',
    '.WWWWWWWWWW.',
    '.WWWWNNWWWW.',
    '..WWWWWWWW..',
    '...WW..WW...',
    '............'],
    pal: { W: COLORS.bunny.fur, P: COLORS.bunny.ear, K: COLORS.bunny.eye, N: COLORS.bunny.nose } },
  cat: { rows: [
    '.D........D.',
    '.DD......DD.',
    '.DFDFFFFDFD.',
    '.FFFFFFFFFF.',
    '.FFFFFFFFFF.',
    '.FEEFFFFEEF.',
    '.FEKFFFFKEF.',
    '.FFFFFFFFFF.',
    '.FFFFNNFFFF.',
    '.FFFDFFDFFF.',
    '..FFFFFFFF..',
    '............'],
    pal: { D: COLORS.cat.dark, F: COLORS.cat.fur, E: COLORS.cat.eye, K: COLORS.cat.pupil, N: COLORS.cat.nose } },
  robot: { rows: [
    '.....L......',
    '....BBB.....',
    '.BBBBBBBBBB.',
    '.BDDDDDDDDB.',
    '.BDEEDDEEDB.',
    '.BDEEDDEEDB.',
    '.BDDDDDDDDB.',
    '.BDLLLLLLDB.',
    '.BDDDDDDDDB.',
    '.BBBBBBBBBB.',
    '..BB....BB..',
    '............'],
    pal: { B: COLORS.robot.body, D: COLORS.robot.dark, E: COLORS.robot.eye, L: COLORS.robot.light } },
  pig: { rows: [
    '............',
    '.PP......PP.',
    '.PPPPPPPPPP.',
    '.PPPPPPPPPP.',
    '.PPKPPPPKPP.',
    '.PPPPPPPPPP.',
    '.PPPDDDDPPP.',
    '.PPPDKDKPPP.',
    '.PPPDDDDPPP.',
    '.PPPPPPPPPP.',
    '..PP....PP..',
    '............'],
    pal: { P: COLORS.pig.skin, D: COLORS.pig.dark, K: COLORS.pig.eye } },
  penguin: { rows: [
    '............',
    '...BBBBBB...',
    '..BBBBBBBB..',
    '..BWBBBBWB..',
    '..BBBOOBBB..',
    '..BBWWWWBB..',
    '.BBWWWWWWBB.',
    '.BBWWWWWWBB.',
    '.BBWWWWWWBB.',
    '..BWWWWWWB..',
    '...OO..OO...',
    '............'],
    pal: { B: COLORS.penguin.back, W: COLORS.penguin.belly, O: COLORS.penguin.beak } },
  turtle: { rows: [
    '............',
    '....GGGG....',
    '...GGGGGG...',
    '..GGSSSSGG..',
    '.GGSSSSSSGG.',
    '.GGSSDDSSGG.',
    '.GGSSSSSSGG.',
    '..GGSSSSGG..',
    '...LLLLLL...',
    '...LKLLKL...',
    '..LL....LL..',
    '............'],
    pal: { G: COLORS.turtle.shell, S: COLORS.turtle.shell, D: COLORS.turtle.dark, L: COLORS.turtle.skin, K: COLORS.turtle.eye } }
};
// one <rect> per pixel, built as nodes (no markup strings: a palette can never become markup)
function drawPix(svg, art) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  art.rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '.') return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', 1); rect.setAttribute('height', 1);
    rect.setAttribute('fill', css(art.pal[c]));
    svg.appendChild(rect);
  }));
}

// ---------- models (all face -z, which is "forward") ----------
function frogBoxes() {
  const c = COLORS.frog;
  const b = [
    [0.62, 0.36, 0.62, c.body, 0, 0.08, 0],
    [0.5, 0.06, 0.5, c.belly, 0, 0.02, 0],
    [0.5, 0.05, 0.04, c.mouth, 0, 0.22, -0.31]
  ];
  for (const s of [-1, 1]) b.push(
    [0.2, 0.2, 0.2, c.eye, s * 0.17, 0.42, -0.16],
    [0.08, 0.1, 0.06, c.pupil, s * 0.17, 0.48, -0.27],
    [0.16, 0.12, 0.3, c.leg, s * 0.33, 0, 0.12],      // back legs
    [0.1, 0.1, 0.12, c.leg, s * 0.22, 0, -0.32]);     // front feet
  return b;
}
function foxBoxes() {
  const c = COLORS.fox;
  const b = [
    [0.5, 0.5, 0.56, c.fur, 0, 0.1, 0],
    [0.36, 0.3, 0.06, c.cream, 0, 0.12, -0.29],       // chest
    [0.26, 0.16, 0.22, c.cream, 0, 0.3, -0.36],       // snout
    [0.08, 0.07, 0.06, c.dark, 0, 0.42, -0.47],       // nose
    [0.18, 0.18, 0.34, c.fur, 0, 0.25, 0.42],         // tail
    [0.16, 0.16, 0.12, c.cream, 0, 0.26, 0.64]
  ];
  for (const s of [-1, 1]) b.push(
    [0.07, 0.09, 0.04, c.dark, s * 0.15, 0.46, -0.28],  // eyes
    [0.14, 0.18, 0.1, c.fur, s * 0.16, 0.6, -0.05],     // ears
    [0.14, 0.06, 0.1, c.dark, s * 0.16, 0.78, -0.05],
    [0.1, 0.12, 0.1, c.dark, s * 0.14, 0, -0.12]);      // legs
  return b;
}
function bunnyBoxes() {
  const c = COLORS.bunny;
  const b = [
    [0.5, 0.44, 0.56, c.fur, 0, 0.08, 0],
    [0.08, 0.06, 0.04, c.nose, 0, 0.28, -0.29],
    [0.16, 0.16, 0.14, c.fur, 0, 0.2, 0.33]           // tail
  ];
  for (const s of [-1, 1]) b.push(
    [0.14, 0.5, 0.1, c.fur, s * 0.14, 0.5, -0.05],      // ears
    [0.07, 0.36, 0.04, c.ear, s * 0.14, 0.56, -0.11],
    [0.07, 0.08, 0.04, c.eye, s * 0.15, 0.36, -0.29],
    [0.12, 0.1, 0.2, c.fur, s * 0.18, 0, -0.1]);        // feet
  return b;
}
function catBoxes() {
  const c = COLORS.cat;
  const b = [
    [0.5, 0.42, 0.6, c.fur, 0, 0.1, 0],
    [0.07, 0.05, 0.04, c.nose, 0, 0.3, -0.31],
    [0.52, 0.05, 0.08, c.dark, 0, 0.5, -0.05],        // stripes
    [0.52, 0.05, 0.08, c.dark, 0, 0.5, 0.15],
    [0.1, 0.1, 0.4, c.dark, 0.1, 0.3, 0.45],          // tail
    [0.1, 0.3, 0.1, c.dark, 0.1, 0.35, 0.62]
  ];
  for (const s of [-1, 1]) b.push(
    [0.12, 0.16, 0.1, c.dark, s * 0.17, 0.52, -0.1],    // ears
    [0.09, 0.08, 0.04, c.eye, s * 0.14, 0.38, -0.31],
    [0.03, 0.08, 0.05, c.pupil, s * 0.14, 0.38, -0.32],
    [0.1, 0.12, 0.1, c.dark, s * 0.15, 0, -0.14],       // legs
    [0.1, 0.12, 0.1, c.dark, s * 0.15, 0, 0.16]);
  return b;
}
function robotBoxes() {
  const c = COLORS.robot;
  const b = [
    [0.46, 0.5, 0.46, c.body, 0, 0.1, 0],
    [0.36, 0.26, 0.04, c.dark, 0, 0.26, -0.24],       // face plate
    [0.22, 0.04, 0.05, c.light, 0, 0.3, -0.26],       // mouth
    [0.05, 0.2, 0.05, c.dark, 0, 0.6, 0],             // antenna
    [0.1, 0.1, 0.1, c.light, 0, 0.78, 0],
    [0.08, 0.08, 0.03, c.light, -0.1, 0.2, -0.24]     // chest light
  ];
  for (const s of [-1, 1]) b.push(
    [0.1, 0.08, 0.05, c.eye, s * 0.1, 0.4, -0.26],
    [0.08, 0.3, 0.12, c.dark, s * 0.3, 0.18, 0],        // arms
    [0.14, 0.12, 0.2, c.dark, s * 0.13, 0, 0]);         // feet
  return b;
}
function pigBoxes() {
  const c = COLORS.pig;
  const b = [
    [0.56, 0.42, 0.6, c.skin, 0, 0.1, 0],
    [0.26, 0.16, 0.08, c.dark, 0, 0.26, -0.33],       // snout
    [0.1, 0.1, 0.16, c.skin, 0.05, 0.3, 0.34]          // curly tail
  ];
  for (const s of [-1, 1]) b.push(
    [0.05, 0.06, 0.04, c.eye, s * 0.06, 0.3, -0.37],    // nostrils
    [0.07, 0.08, 0.04, c.eye, s * 0.17, 0.42, -0.31],   // eyes
    [0.12, 0.12, 0.08, c.dark, s * 0.2, 0.5, -0.1],     // ears
    [0.12, 0.12, 0.12, c.dark, s * 0.17, 0, -0.14],     // legs
    [0.12, 0.12, 0.12, c.dark, s * 0.17, 0, 0.16]);
  return b;
}
function penguinBoxes() {
  const c = COLORS.penguin;
  const b = [
    [0.46, 0.62, 0.42, c.back, 0, 0, 0],
    [0.34, 0.42, 0.06, c.belly, 0, 0.04, -0.22],      // belly
    [0.14, 0.08, 0.16, c.beak, 0, 0.46, -0.28],       // beak
    [0.22, 0.06, 0.26, c.beak, 0, 0, -0.1]            // feet (one block)
  ];
  for (const s of [-1, 1]) b.push(
    [0.07, 0.08, 0.04, c.eye, s * 0.11, 0.52, -0.22],   // eyes
    [0.06, 0.3, 0.26, c.back, s * 0.26, 0.14, 0]);      // flippers
  return b;
}
function turtleBoxes() {
  const c = COLORS.turtle;
  const b = [
    [0.6, 0.3, 0.64, c.shell, 0, 0.12, 0],            // shell
    [0.4, 0.1, 0.44, c.dark, 0, 0.42, 0],             // shell top
    [0.26, 0.22, 0.26, c.skin, 0, 0.1, -0.4],         // head
    [0.1, 0.08, 0.16, c.skin, 0, 0.1, 0.38]           // tail
  ];
  for (const s of [-1, 1]) b.push(
    [0.05, 0.06, 0.04, c.eye, s * 0.08, 0.24, -0.53],   // eyes
    [0.14, 0.1, 0.14, c.skin, s * 0.28, 0, -0.18],      // legs
    [0.14, 0.1, 0.14, c.skin, s * 0.28, 0, 0.18]);
  return b;
}
// a white police car: a plain car body with a light bar; the flashing light is a light instance (lightBoxes)
const policeBoxes = () => vehicleBoxes(false, 0xf4f4f4).concat([[0.5, 0.08, 0.5, 0x222222, 0.08, 0.84, 0]]);
const eagleBoxes = () => {
  const b = [
    [0.9, 0.34, 0.52, 0x4a3426, 0, 0, 0],             // body
    [0.5, 0.12, 0.4, 0x5c4332, 0, 0.34, 0.02],        // back
    [0.32, 0.3, 0.32, 0xf4f1ec, 0, 0.14, -0.52],      // white head
    [0.14, 0.1, 0.22, 0xf2c33a, 0, 0.2, -0.76],       // beak
    [0.1, 0.06, 0.08, 0x3a281d, 0, 0.17, -0.86],      // beak tip (hooked)
    [0.44, 0.08, 0.36, 0xf4f1ec, 0, 0.1, 0.4],        // tail
    [0.2, 0.06, 0.16, 0xe8e2d8, 0, 0.12, 0.58],       // tail tip
    [0.3, 0.14, 0.16, 0xf2c33a, 0, -0.12, -0.1]       // talons
  ];
  for (const s of [-1, 1]) {
    b.push([1.1, 0.09, 0.5, 0x3a281d, s * 0.9, 0.2, 0.02],        // wing
           [0.7, 0.08, 0.42, 0x2e2016, s * 1.75, 0.22, 0.06],      // wing tip, a little back
           [0.5, 0.06, 0.1, 0x241910, s * 1.9, 0.21, 0.3],         // feather
           [0.3, 0.06, 0.1, 0x241910, s * 2.0, 0.21, 0.42],
           [0.06, 0.06, 0.05, 0x111111, s * 0.11, 0.3, -0.66],     // eye
           [0.08, 0.03, 0.08, 0x4a3426, s * 0.11, 0.35, -0.64]);   // brow
  }
  return b;
};
const coinBoxes = () => [[0.34, 0.34, 0.08, COLORS.coin.face, 0, 0.28, 0], [0.18, 0.18, 0.1, COLORS.coin.rim, 0, 0.36, 0]];
// characters a player can pick; the first two are free, the rest are bought with coins
const CHARACTERS = [
  { key: 'frog', name: 'FROG', boxes: frogBoxes, price: 0 },
  { key: 'fox', name: 'FOX', boxes: foxBoxes, price: 0 },
  { key: 'bunny', name: 'BUNNY', boxes: bunnyBoxes, price: 30 },
  { key: 'cat', name: 'CAT', boxes: catBoxes, price: 60 },
  { key: 'robot', name: 'ROBOT', boxes: robotBoxes, price: 100 },
  // prizes: only the prize machine hands these out
  { key: 'pig', name: 'PIG', boxes: pigBoxes, price: 0, prize: true },
  { key: 'penguin', name: 'PENGUIN', boxes: penguinBoxes, price: 0, prize: true },
  { key: 'turtle', name: 'TURTLE', boxes: turtleBoxes, price: 0, prize: true }
];
const PRIZES = CHARACTERS.filter(c => c.prize).map(c => c.key);
const isOwned = ch => (ch.price === 0 && !ch.prize) || owned.has(ch.key);
// the paint (pure white here) is tinted per instance; nothing else may be pure white
function vehicleBoxes(truck, c = 0xffffff) {
  const len = truck ? 2.4 : 1.4;
  const b = truck ? [
    [1.7, 0.75, 0.8, 0xeeeeee, 0.3, 0.12, 0],
    [0.6, 0.6, 0.78, c, -0.85, 0.12, 0],
    [0.12, 0.3, 0.66, 0x223344, -1.12, 0.38, 0]
  ] : [
    [1.4, 0.42, 0.78, c, 0, 0.12, 0],
    [0.75, 0.3, 0.66, 0xf4f4f4, 0.08, 0.54, 0],
    [0.06, 0.2, 0.6, 0x223344, -0.3, 0.58, 0]
  ];
  for (const wx of [-len / 2 + 0.3, len / 2 - 0.3]) for (const wz of [-0.38, 0.38])
    b.push([0.3, 0.26, 0.1, 0x222222, wx, 0, wz]);
  // headlights (front is -x) and tail lights: they glow at night (8th value, see voxel.js)
  for (const wz of [-0.26, 0.26]) b.push([0.06, 0.12, 0.16, 0xfff1b0, -len / 2 - 0.02, 0.3, wz, 1.4], [0.06, 0.1, 0.14, 0xff4a3a, len / 2 + 0.02, 0.3, wz, 0.8]);
  return b;
}
const logBoxes = len => [
  [len, 0.26, 0.78, 0x8a5130, 0, -0.16, 0],
  [0.12, 0.27, 0.7, 0xc08a5a, -len / 2 + 0.05, -0.16, 0],
  [0.12, 0.27, 0.7, 0xc08a5a, len / 2 - 0.05, -0.16, 0]
];
function trainBoxes(dir, cars = TRAIN_CARS) {
  const b = [], len = trainLen(cars), boss = cars > TRAIN_CARS;
  for (let i = 0; i < cars; i++) {
    const x = -len / 2 + TRAIN_CAR_LEN / 2 + i * (TRAIN_CAR_LEN + TRAIN_GAP);
    const front = dir > 0 ? i === cars - 1 : i === 0;
    b.push([TRAIN_CAR_LEN, boss ? 1.1 : 0.9, 0.84, front ? 0xd83a3a : boss ? 0x2a2f3a : 0x3a6fd8, x, 0.12, 0],
           [TRAIN_CAR_LEN - 0.3, 0.2, 0.86, boss ? 0xffd84a : 0xdde6ff, x, boss ? 0.82 : 0.62, 0]);
  }
  const wheels = cars * 2;
  for (let i = 0; i < wheels; i++)
    b.push([0.4, 0.15, 0.9, 0x222222, -len / 2 + 0.6 + i * (len - 1.2) / (wheels - 1), 0, 0]);
  return b;
}
// a boulder (rocks rows): a round-ish grey ball of boxes, about 0.9 across
const boulderBoxes = () => [[0.9, 0.5, 0.62, 0x8b8b86, 0, 0.2, 0], [0.62, 0.9, 0.62, 0x7f7f7a, 0, 0, 0], [0.62, 0.5, 0.9, 0x8b8b86, 0, 0.2, 0],
  [0.22, 0.2, 0.06, 0x62625d, 0.15, 0.55, -0.46], [0.18, 0.16, 0.06, 0x62625d, -0.2, 0.25, 0.46]];
// a bridge plank: boards with two darker cross slats (its top sits just under the feet)
const plankBoxes = () => [[0.9, 0.1, 0.82, 0x9a6a3a, 0, -0.12, 0], [0.08, 0.11, 0.82, 0x6e4826, -0.3, -0.12, 0], [0.08, 0.11, 0.82, 0x6e4826, 0.3, -0.12, 0]];
// power-ups: a blue shield gem and a red magnet
const shieldBoxes = () => [[0.5, 0.5, 0.5, 0x4fb8ff, 0, 0.3, 0], [0.3, 0.3, 0.3, 0xeaf6ff, 0, 0.4, 0]];
const magnetBoxes = () => [[0.16, 0.5, 0.16, 0xe8513a, -0.2, 0.25, 0], [0.16, 0.5, 0.16, 0xe8513a, 0.2, 0.25, 0],
  [0.56, 0.16, 0.16, 0xe8513a, 0, 0.2, 0], [0.16, 0.14, 0.16, 0xeeeeee, -0.2, 0.61, 0], [0.16, 0.14, 0.16, 0xeeeeee, 0.2, 0.61, 0]];
// a twister (the grass boss): grey boxes that widen upward, turned every frame; dark bits of debris. No pure white (instanced)
const twisterBoxes = () => [[0.3, 0.3, 0.3, 0x9a9a9a, 0, 0, 0], [0.5, 0.35, 0.5, 0xa8a8a8, 0.05, 0.3, 0.05], [0.7, 0.4, 0.7, 0xb5b5b5, -0.05, 0.65, 0],
  [0.9, 0.4, 0.9, 0xc2c2c2, 0.05, 1.05, -0.05], [0.12, 0.12, 0.12, 0x5a4a3a, 0.5, 0.9, 0.3], [0.1, 0.1, 0.1, 0x3a6a2a, -0.5, 1.2, -0.2]];
// the versus bomb (a magnet's place in a two-player game, rules.js isBombRow): a black ball with a lit fuse
const bombBoxes = () => [[0.5, 0.5, 0.5, 0x222222, 0, 0.2, 0], [0.08, 0.2, 0.08, 0x8a6a3a, 0.12, 0.7, 0], [0.14, 0.14, 0.14, 0xffd84a, 0.12, 0.9, 0, 1.2]];
// the rock a bomb drops in front of the other player: blocks one column for a few seconds
const blockBoxes = () => [[0.8, 0.55, 0.8, 0x6f6a62, 0, 0, 0], [0.5, 0.3, 0.5, 0x7f7a72, 0.05, 0.55, 0.05]];
// a cliff tile (cliff rows): a stone slab over the chasm; instanced like a plank, it drops once it breaks
const tileBoxes = () => [[0.92, 0.2, 0.92, 0x8d8a84, 0, -0.2, 0], [0.7, 0.04, 0.7, 0xa09c95, 0, 0, 0]];
// hats (rules.js HATS): unlocked by the all-time best, drawn on top of the animal
const HAT_GOLD = 0xffd84a, HAT_RED = 0xe0453a;
function hatBoxes(hat, top) {
  if (hat === 'cap') return [[0.46, 0.14, 0.46, HAT_RED, 0, top, 0], [0.3, 0.05, 0.2, HAT_RED, 0, top, -0.3]];   // a cap with a peak forward
  if (hat === 'crown') {
    const b = [[0.4, 0.1, 0.4, HAT_GOLD, 0, top, 0]];
    for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) b.push([0.1, 0.16, 0.1, HAT_GOLD, x, top + 0.1, z]);
    return b;
  }
  const b = [];   // halo: a thin ring floating over the head
  for (const [x, z, w, d] of [[0, -0.22, 0.34, 0.06], [0, 0.22, 0.34, 0.06], [-0.22, 0, 0.06, 0.34], [0.22, 0, 0.06, 0.34]]) b.push([w, 0.05, d, HAT_GOLD, x, top + 0.18, z, 1.6]);
  return b;
}
const topOf = boxes => Math.max(...boxes.map(b => b[5] + b[1]));
function makeCharacter(boxesFn, key, hat = '') {
  const g = new THREE.Group();
  const body = voxelMesh(cachedGeo(hat ? key + '-' + hat : key, () => { const b = boxesFn(); return hat ? b.concat(hatBoxes(hat, topOf(b))) : b; }));
  g.add(body); g.userData.body = body;
  return g;
}

// signal lights (rail crossings, police cars): one instanced fleet (world.js Inst). The box is pure white, so each
// light is painted per instance with a LIGHT_TINT; its glow (8th value) makes it twice as bright at night
const lightBoxes = () => [[0.38, 0.2, 0.14, 0xffffff, 0, 0, 0, 1]];
const LIGHT_TINT = { off: 0x331111, on: 0xff2222, red: 0xff2a2a, blue: 0x3a7bff };
// a plain (non-voxel) material and geometry: app.js draws one box with them at boot to warm the shader
const LIGHT_OFF = new THREE.MeshLambertMaterial({ color: 0x331111 });
const lightGeo = new THREE.BoxGeometry(0.38, 0.2, 0.14);

export { CHARACTERS, COLORS, blockBoxes, bombBoxes, hatBoxes, tileBoxes, twisterBoxes, LIGHT_OFF, LIGHT_TINT, PIX, PRIZES, boulderBoxes, bunnyBoxes, catBoxes, coinBoxes, drawPix, eagleBoxes, foxBoxes, frogBoxes, isOwned, lightBoxes, lightGeo, logBoxes, magnetBoxes, makeCharacter, penguinBoxes, pigBoxes, plankBoxes, policeBoxes, robotBoxes, shieldBoxes, trainBoxes, turtleBoxes, vehicleBoxes };
