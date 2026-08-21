// Validação de CPF/CNPJ.
//
// O Asaas não cria cliente sem documento, então esta checagem é o que decide
// se o cliente vê o erro na hora, no campo, ou só depois de clicar em "Pagar"
// e receber uma recusa vinda da API.
//
// O que estes testes travam:
//   - CPF e CNPJ usam escalas de peso DIFERENTES no módulo 11 (foi o bug da
//     primeira versão: usar a regra do CNPJ recusava todo CPF válido);
//   - documento de dígito repetido não passa, apesar de fechar a conta;
//   - CNPJ alfanumérico (emitido a partir de 2026) é aceito — recusá-lo
//     deixaria empresa nova sem conseguir pagar.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizar, formatar, tipo } = require('../../src/lib/cpfCnpj');

test('CPF válido passa, com ou sem máscara', () => {
  assert.equal(normalizar('529.982.247-25'), '52998224725');
  assert.equal(normalizar('52998224725'), '52998224725');
  assert.equal(normalizar('168.995.350-09'), '16899535009');
});

test('CPF com dígito verificador errado é recusado', () => {
  assert.equal(normalizar('529.982.247-26'), null);
  assert.equal(normalizar('168.995.350-00'), null);
});

test('CPF de dígito repetido é recusado mesmo fechando a conta do módulo 11', () => {
  for (const d of '0123456789') {
    assert.equal(normalizar(d.repeat(11)), null, `${d.repeat(11)} não pode passar`);
  }
});

test('CNPJ válido passa, com ou sem máscara', () => {
  assert.equal(normalizar('11.222.333/0001-81'), '11222333000181');
  assert.equal(normalizar('62.111.132/0001-48'), '62111132000148');
});

test('CNPJ com dígito verificador errado é recusado', () => {
  assert.equal(normalizar('11.222.333/0001-82'), null);
});

test('CNPJ alfanumérico (regra de 2026) é aceito', () => {
  assert.equal(normalizar('12ABC34501DE35'), '12ABC34501DE35');
  assert.equal(normalizar('12abc34501de35'), '12ABC34501DE35', 'minúsculas viram maiúsculas');
  // Os dois últimos caracteres são sempre numéricos, nunca letra.
  assert.equal(normalizar('12ABC34501DEAB'), null);
});

test('tamanho errado é recusado sem tentar adivinhar', () => {
  assert.equal(normalizar(''), null);
  assert.equal(normalizar('123'), null);
  assert.equal(normalizar('5299822472'), null, '10 dígitos não é CPF nem CNPJ');
  assert.equal(normalizar('529982247251'), null);
  assert.equal(normalizar(null), null);
  assert.equal(normalizar(undefined), null);
});

test('sabe dizer se é pessoa física ou empresa', () => {
  assert.equal(tipo('529.982.247-25'), 'cpf');
  assert.equal(tipo('11.222.333/0001-81'), 'cnpj');
  assert.equal(tipo('123'), null);
});

test('formata de volta pra mostrar na tela', () => {
  assert.equal(formatar('52998224725'), '529.982.247-25');
  assert.equal(formatar('11222333000181'), '11.222.333/0001-81');
});
