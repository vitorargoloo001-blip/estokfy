import { describe, it, expect } from 'vitest';
import { parseFiscalXml } from './nfeXml';

// Chave de acesso real tem 44 dígitos. Definida como constante e injetada no
// XML pelo template, para o teste nunca divergir do que ele mesmo afirma.
const KEY = '35240914200166000187550010000000151000000015';

function nfe(opts: { mod?: string; tpNF?: string } = {}) {
  const { mod = '55', tpNF = '1' } = opts;
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe versao="4.00" Id="NFe${KEY}">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA DE MERCADORIA</natOp>
        <mod>${mod}</mod>
        <serie>1</serie>
        <nNF>000015</nNF>
        <dhEmi>2026-09-08T10:30:00-03:00</dhEmi>
        <tpNF>${tpNF}</tpNF>
      </ide>
      <emit><CNPJ>14.200.166/0001-87</CNPJ><xNome>LOJA EMITENTE LTDA</xNome></emit>
      <dest><CPF>123.456.789-09</CPF><xNome>MARIA DA SILVA</xNome></dest>
      <total><ICMSTot><vNF>1250.50</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;
}

describe('parseFiscalXml', () => {
  it('lê uma NF-e de saída completa', () => {
    const r = parseFiscalXml(nfe());
    expect(r).not.toBeNull();
    expect(r!.documentType).toBe('nfe');
    expect(r!.direction).toBe('outgoing');
    expect(r!.invoiceNumber).toBe('15'); // zeros à esquerda removidos
    expect(r!.series).toBe('1');
    expect(r!.accessKey).toBe(KEY);
    expect(r!.accessKey).toHaveLength(44);
    expect(r!.issueDate).toBe('2026-09-08');
    expect(r!.totalAmount).toBe(1250.5);
  });

  it('na saída, a contraparte é o destinatário (e o CPF vem sem máscara)', () => {
    const r = parseFiscalXml(nfe());
    expect(r!.counterpartName).toBe('MARIA DA SILVA');
    expect(r!.counterpartDoc).toBe('12345678909');
  });

  it('na entrada, a contraparte passa a ser o emitente', () => {
    const r = parseFiscalXml(nfe({ tpNF: '0' }));
    expect(r!.direction).toBe('incoming');
    expect(r!.counterpartName).toBe('LOJA EMITENTE LTDA');
    expect(r!.counterpartDoc).toBe('14200166000187');
  });

  it('reconhece NFC-e pelo modelo 65', () => {
    expect(parseFiscalXml(nfe({ mod: '65' }))!.documentType).toBe('nfce');
  });

  it('devolve null para conteúdo que não é XML', () => {
    expect(parseFiscalXml('isso aqui não é xml <<< {')).toBeNull();
  });

  it('devolve null para XML válido sem campos fiscais', () => {
    expect(parseFiscalXml('<?xml version="1.0"?><raiz><algo>valor</algo></raiz>')).toBeNull();
  });

  it('ignora chave de acesso com tamanho inválido', () => {
    const xml = nfe().replace(`NFe${KEY}`, 'NFe123');
    const r = parseFiscalXml(xml);
    expect(r!.accessKey).toBeUndefined();
    expect(r!.invoiceNumber).toBe('15'); // o resto continua sendo lido
  });
});
