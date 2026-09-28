// Determinism guard (SPEC section 3, C6/C8; CLAUDE.md "Hard rules").
//
// Code that shapes a render must be a pure function of signature + composition + seed.
// These rules forbid wall-clock time and browser randomness in the folders that shape
// output. Progress/ETA display is the only exception; mark each such line with
//   // eslint-disable-next-line no-restricted-properties -- progress/ETA display only
// Seeds come from the seeded PRNG in src/chance/prng.ts. Picking a *new* seed from
// crypto entropy happens outside these folders (UI/state code), never inside them.

/** Folders whose code must be deterministic. */
export const DETERMINISTIC_FILES = [
  'src/signature/**/*.{ts,tsx}',
  'src/engine/**/*.{ts,tsx}',
  'src/materials/**/*.{ts,tsx}',
  'src/chance/**/*.{ts,tsx}',
  'src/render/**/*.{ts,tsx}',
];

const CLOCK =
  'No wall-clock time in deterministic code: advance by signature time (fixed dt). Progress/ETA display only, with a disable comment.';
const RANDOM =
  'No browser randomness in deterministic code: use the seeded PRNG in src/chance/prng.ts.';
const ENTROPY = 'Crypto entropy may only pick a new seed, outside deterministic folders.';

/** Member access through a global object, e.g. `window.performance.now` or `self.Math.random`. */
function viaGlobal(objectName, propertyName, message) {
  return {
    selector: `MemberExpression[object.type='MemberExpression'][object.property.name='${objectName}'][property.name='${propertyName}']`,
    message,
  };
}

/** @type {import('eslint').Linter.RulesRecord} */
export const determinismRules = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: RANDOM },
    { object: 'Date', property: 'now', message: CLOCK },
    { object: 'performance', property: 'now', message: CLOCK },
    { object: 'crypto', property: 'getRandomValues', message: ENTROPY },
  ],
  'no-restricted-syntax': [
    'error',
    viaGlobal('Math', 'random', RANDOM),
    viaGlobal('Date', 'now', CLOCK),
    viaGlobal('performance', 'now', CLOCK),
    viaGlobal('crypto', 'getRandomValues', ENTROPY),
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: `${CLOCK} (new Date() reads the clock; set timestamps in library code.)`,
    },
    {
      selector: "CallExpression[callee.name='Date']",
      message: `${CLOCK} (Date() reads the clock.)`,
    },
  ],
};

/** Flat-config block that applies the guard to the deterministic folders. */
export const determinismConfig = {
  name: 'sp/determinism',
  files: DETERMINISTIC_FILES,
  rules: determinismRules,
};
