/* palette.js — the one 32-colour palette every pixel on screen comes from.
   Names are used everywhere else (C.sky, C.duck …) so a palette swap is one edit. */

export const PALETTE = [
  '#0b0b16', // 0  ink        – deepest shadow / outline base
  '#1a1c3b', // 1  navy       – night sky
  '#24305e', // 2  deepblue
  '#3a5ba0', // 3  blue
  '#5d8fd6', // 4  sky
  '#9fd0f0', // 5  lightsky
  '#f4f4f0', // 6  paper      – off-white
  '#c2c3c7', // 7  lightgray
  '#8a8b94', // 8  gray
  '#55566a', // 9  darkgray
  '#3b2a4f', // 10 plum
  '#6b4a8e', // 11 purple
  '#e07aa8', // 12 pink
  '#c8323c', // 13 red
  '#7a1c2b', // 14 darkred
  '#f07a2a', // 15 orange
  '#f6a93b', // 16 amber
  '#ffd84a', // 17 yellow
  '#fff1b8', // 18 cream
  '#4a2e22', // 19 darkbrown
  '#7c4a2d', // 20 brown
  '#b97a46', // 21 tan
  '#e0b679', // 22 sand
  '#1e4a35', // 23 darkgreen
  '#3c8a46', // 24 green
  '#8cc84b', // 25 lime
  '#2a8a8a', // 26 teal
  '#6fe3e0', // 27 cyan
  '#f2b48c', // 28 peach
  '#d9884e', // 29 rust
  '#2b1b2e', // 30 outline    – sprite outline colour
  '#ffffff', // 31 white      – highlights only
];

export const C = {
  ink: PALETTE[0], navy: PALETTE[1], deepblue: PALETTE[2], blue: PALETTE[3], sky: PALETTE[4],
  lightsky: PALETTE[5], paper: PALETTE[6], lightgray: PALETTE[7], gray: PALETTE[8],
  darkgray: PALETTE[9], plum: PALETTE[10], purple: PALETTE[11], pink: PALETTE[12],
  red: PALETTE[13], darkred: PALETTE[14], orange: PALETTE[15], amber: PALETTE[16],
  yellow: PALETTE[17], cream: PALETTE[18], darkbrown: PALETTE[19], brown: PALETTE[20],
  tan: PALETTE[21], sand: PALETTE[22], darkgreen: PALETTE[23], green: PALETTE[24],
  lime: PALETTE[25], teal: PALETTE[26], cyan: PALETTE[27], peach: PALETTE[28],
  rust: PALETTE[29], outline: PALETTE[30], white: PALETTE[31],
};

/* Colour ramps used by fireworks / glows: index 0 = hottest. */
export const RAMPS = {
  fire: [C.white, C.cream, C.yellow, C.amber, C.orange, C.red, C.darkred, C.plum],
  pink: [C.white, C.pink, C.purple, C.plum],
  cyan: [C.white, C.cyan, C.teal, C.deepblue],
  lime: [C.white, C.lime, C.green, C.darkgreen],
  gold: [C.white, C.cream, C.yellow, C.amber, C.rust],
  sky:  [C.white, C.lightsky, C.sky, C.blue, C.deepblue],
};
export const RAMP_NAMES = Object.keys(RAMPS);
