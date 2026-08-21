// Validação de CPF/CNPJ.
//
// O Asaas exige cpfCnpj para criar qualquer cliente — não dá pra cobrar
// ninguém sem isso. Esta checagem existe para dar erro na hora, na tela, em
// vez de deixar o cliente clicar em "Pagar" e receber uma recusa vinda da API
// no meio do fluxo.
//
// Quem manda de verdade continua sendo o Asaas: se ele recusar um documento
// que passou aqui, a mensagem dele é a que aparece. O objetivo aqui é pegar o
// erro de digitação óbvio, não ser a autoridade sobre o documento.
'use strict';

// O CNPJ alfanumérico passou a ser emitido em 2026: as 12 primeiras posições
// podem ter letras, e só os 2 dígitos verificadores continuam numéricos. O
// cálculo é o mesmo de sempre, trocando cada caractere pelo seu código ASCII
// menos 48 ('0'→0 ... '9'→9, 'A'→17 ... 'Z'→42). Sem isso, uma empresa nova
// seria recusada por um sistema que se acha mais atualizado do que é.
function valorDoCaractere(ch) {
  return ch.charCodeAt(0) - 48;
}

function limpar(valor) {
  return String(valor || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

// Dígito verificador pelo módulo 11. Os pesos sobem da direita para a
// esquerda a partir de 2, mas CPF e CNPJ divergem no fim da escala e é aí que
// se erra: no CNPJ o peso volta pra 2 depois do 9 (a base tem 12/13
// caracteres, então ele dá a volta), enquanto no CPF ele segue até 10/11 sem
// repetir. Usar a regra do CNPJ no CPF faz TODO CPF válido ser recusado.
function digitoVerificador(base, { pesoVoltaApos9 }) {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    soma += valorDoCaractere(base[i]) * peso;
    peso = pesoVoltaApos9 && peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function isCpfValido(digitos) {
  if (digitos.length !== 11) return false;
  if (!/^\d{11}$/.test(digitos)) return false;
  // 111.111.111-11 e afins passam no módulo 11 mas não existem — é o
  // "documento" que todo mundo digita pra testar.
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const d1 = digitoVerificador(digitos.slice(0, 9), { pesoVoltaApos9: false });
  const d2 = digitoVerificador(digitos.slice(0, 10), { pesoVoltaApos9: false });
  return d1 === Number(digitos[9]) && d2 === Number(digitos[10]);
}

function isCnpjValido(caracteres) {
  if (caracteres.length !== 14) return false;
  // Os 12 primeiros podem ser alfanuméricos; os 2 últimos, nunca.
  if (!/^[0-9A-Z]{12}\d{2}$/.test(caracteres)) return false;
  if (/^(\d)\1{13}$/.test(caracteres)) return false;

  const d1 = digitoVerificador(caracteres.slice(0, 12), { pesoVoltaApos9: true });
  const d2 = digitoVerificador(caracteres.slice(0, 13), { pesoVoltaApos9: true });
  return d1 === Number(caracteres[12]) && d2 === Number(caracteres[13]);
}

// Devolve o documento só com os caracteres úteis (é assim que o Asaas quer
// receber: sem ponto, barra ou traço) ou null se não for válido.
function normalizar(valor) {
  const limpo = limpar(valor);
  if (limpo.length === 11) return isCpfValido(limpo) ? limpo : null;
  if (limpo.length === 14) return isCnpjValido(limpo) ? limpo : null;
  return null;
}

function tipo(valor) {
  const limpo = limpar(valor);
  if (limpo.length === 11) return 'cpf';
  if (limpo.length === 14) return 'cnpj';
  return null;
}

// Só para exibir de volta pro cliente (a API sempre recebe sem máscara).
function formatar(valor) {
  const limpo = limpar(valor);
  if (limpo.length === 11) {
    return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
  }
  if (limpo.length === 14) {
    return `${limpo.slice(0, 2)}.${limpo.slice(2, 5)}.${limpo.slice(5, 8)}/${limpo.slice(8, 12)}-${limpo.slice(12)}`;
  }
  return limpo;
}

module.exports = { normalizar, formatar, tipo, isCpfValido, isCnpjValido, limpar };
