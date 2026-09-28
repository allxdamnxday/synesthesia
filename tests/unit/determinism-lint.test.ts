import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { determinismConfig } from '../../eslint.determinism.js';

// Lints code snippets with the real determinism rule set (no type info needed) and
// checks that clock and randomness access is caught only inside deterministic folders.
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    determinismConfig,
  ],
});

async function errorsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

const FORBIDDEN = [
  'export const x = Math.random();',
  'export const x = Date.now();',
  'export const x = performance.now();',
  'export const x = window.performance.now();',
  'export const x = self.performance.now();',
  'export const x = globalThis.Math.random();',
  'const { random } = Math; export const x = random();',
  'export const x = new Date();',
  'export const x = Date();',
  'export const x = crypto.getRandomValues(new Uint32Array(1));',
];

describe('determinism lint rules', () => {
  for (const dir of ['signature', 'engine', 'materials', 'chance', 'render']) {
    it(`flags clock and randomness in src/${dir}`, async () => {
      for (const code of FORBIDDEN) {
        const errors = await errorsFor(code, `src/${dir}/probe.ts`);
        expect(errors, code).not.toHaveLength(0);
      }
    });
  }

  it('allows the same code outside deterministic folders (UI, state)', async () => {
    for (const code of FORBIDDEN) {
      expect(await errorsFor(code, 'src/ui/probe.ts'), code).toHaveLength(0);
    }
  });

  it('allows deterministic date handling with an explicit timestamp', async () => {
    const errors = await errorsFor(
      'export const d = new Date(0).toISOString();',
      'src/engine/probe.ts',
    );
    expect(errors).toHaveLength(0);
  });
});
