import test from 'node:test';
import assert from 'node:assert/strict';
import { formatarAnoFipe } from './fipe.util';

test('converte 32000 em 0 Km preservando o combustível', () => {
  assert.equal(formatarAnoFipe('32000 Flex'), '0 Km Flex');
  assert.equal(formatarAnoFipe('32000 - Flex'), '0 Km Flex');
  assert.equal(formatarAnoFipe('32000'), '0 Km');
});

test('preserva labels de anos normais', () => {
  assert.equal(formatarAnoFipe('2023 Gasolina'), '2023 Gasolina');
  assert.equal(formatarAnoFipe('2022'), '2022');
});
