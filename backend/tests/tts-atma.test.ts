/**
 * TESTE — voz da ATMA: identidade vocal configurada e texto preparado para a fala.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoParaFala, VOZ_ATMA } from '../src/modules/tts/tts.service.js';

test('Voz da ATMA: Thalita, um pouco mais lenta e mais grave (escolha do responsável)', () => {
  assert.equal(VOZ_ATMA.voz, process.env.NEXUS_TTS_VOZ || 'pt-BR-ThalitaNeural');
  assert.equal(VOZ_ATMA.velocidade, process.env.NEXUS_TTS_VELOCIDADE || '-6%');
  assert.equal(VOZ_ATMA.tom, process.env.NEXUS_TTS_TOM || '-2Hz');
});

test('Texto para fala: sem ids, sem marcação, listas viram frases, valores intactos', () => {
  const falado = textoParaFala([
    'A proposta de compra foi preparada.',
    '',
    '**Detalhes da Proposta:**',
    '- Produto: Fermento químico em pó',
    '- Quantidade: 10 kg',
    '- Valor estimado: R$ 1.300,50',
    '- Status: aguardando aprovação (ID: cmwuucyth000r1047hvl0ruei). Nada foi criado ainda.',
    '',
    '### Limitações: nenhuma.',
  ].join('\n'));
  assert.equal(falado, 'A proposta de compra foi preparada. Detalhes da Proposta: Produto: Fermento químico em pó. Quantidade: 10 kg. Valor estimado: R$ 1.300,50. Status: aguardando aprovação. Nada foi criado ainda. Limitações: nenhuma.');
  assert.doesNotMatch(falado, /cmwu|\*|#/);
});

test('Texto para fala: símbolos lidos como palavras e id solto removido', () => {
  assert.equal(textoParaFala('Estoque mínimo: 5 → 12 kg; perdas ≥ 2× o padrão.'), 'Estoque mínimo: 5 para 12 kg; perdas maior ou igual a 2 vezes o padrão.');
  assert.equal(textoParaFala('Filial Matriz (`cmwuvb3j90002nj36gslsi0fg`) com 3 produtos.'), 'Filial Matriz com 3 produtos.');
  assert.equal(textoParaFala('   '), '');
});
