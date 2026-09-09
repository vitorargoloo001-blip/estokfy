// Leitura best-effort de XML de nota fiscal para pré-preencher o formulário.
// O usuário SEMPRE confirma os dados depois — isto é conveniência de
// digitação, não fonte de verdade. NF-e/NFC-e seguem o layout nacional e
// são lidas com confiança; NFS-e é municipal (cada prefeitura tem seu
// próprio schema), então só os campos que casarem são aproveitados.

export interface ParsedFiscalXml {
  documentType?: 'nfe' | 'nfce' | 'nfse';
  direction?: 'incoming' | 'outgoing';
  invoiceNumber?: string;
  series?: string;
  accessKey?: string;
  issueDate?: string; // yyyy-MM-dd
  counterpartName?: string;
  counterpartDoc?: string;
  totalAmount?: number;
}

function findText(root: Element | Document, localName: string): string | undefined {
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if ((el.localName || el.nodeName).toLowerCase() === localName.toLowerCase()) {
      const t = el.textContent?.trim();
      if (t) return t;
    }
  }
  return undefined;
}

function findElement(root: Element | Document, localName: string): Element | undefined {
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if ((el.localName || el.nodeName).toLowerCase() === localName.toLowerCase()) return el;
  }
  return undefined;
}

function onlyDigits(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = v.replace(/\D/g, '');
  return d || undefined;
}

export function parseFiscalXml(xmlText: string): ParsedFiscalXml | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  const out: ParsedFiscalXml = {};

  // ----- chave de acesso: atributo Id="NFe<44 dígitos>" ou tag solta
  const infNFe = findElement(doc, 'infNFe');
  const idAttr = infNFe?.getAttribute('Id') || infNFe?.getAttribute('id');
  const keyFromId = onlyDigits(idAttr || undefined);
  const keyFromTag = onlyDigits(findText(doc, 'chNFe'));
  const key = [keyFromId, keyFromTag].find((k) => k && k.length === 44);
  if (key) out.accessKey = key;

  // ----- modelo: 55 = NF-e, 65 = NFC-e
  const mod = findText(doc, 'mod');
  if (mod === '65') out.documentType = 'nfce';
  else if (mod === '55') out.documentType = 'nfe';
  else if (infNFe) out.documentType = 'nfe';
  else if (findElement(doc, 'InfNfse') || findElement(doc, 'Nfse')) out.documentType = 'nfse';

  // ----- número e série
  const num = findText(doc, 'nNF') || findText(doc, 'Numero');
  if (num) out.invoiceNumber = num.replace(/^0+(?=\d)/, '');
  const serie = findText(doc, 'serie') || findText(doc, 'Serie');
  if (serie) out.series = serie;

  // ----- emissão
  const emi = findText(doc, 'dhEmi') || findText(doc, 'dEmi') || findText(doc, 'DataEmissao');
  if (emi) {
    const m = emi.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) out.issueDate = `${m[1]}-${m[2]}-${m[3]}`;
  }

  // ----- direção: tpNF 0 = entrada, 1 = saída
  const tpNF = findText(doc, 'tpNF');
  if (tpNF === '0') out.direction = 'incoming';
  else if (tpNF === '1') out.direction = 'outgoing';

  // ----- contraparte: na saída é o destinatário, na entrada é o emitente
  const counterpartTag = out.direction === 'incoming' ? 'emit' : 'dest';
  const cp = findElement(doc, counterpartTag) || findElement(doc, 'dest') || findElement(doc, 'emit');
  if (cp) {
    const name = findText(cp, 'xNome') || findText(cp, 'RazaoSocial');
    if (name) out.counterpartName = name;
    const docNum = onlyDigits(findText(cp, 'CNPJ') || findText(cp, 'CPF'));
    if (docNum) out.counterpartDoc = docNum;
  }

  // ----- total
  const totalRaw =
    findText(doc, 'vNF') ||
    findText(doc, 'ValorLiquidoNfse') ||
    findText(doc, 'ValorServicos');
  if (totalRaw) {
    const parsed = parseFloat(totalRaw.replace(',', '.'));
    if (Number.isFinite(parsed)) out.totalAmount = parsed;
  }

  // nada reconhecido => trata como falha, para o usuário digitar na mão
  const found = Object.keys(out).length;
  return found > 0 ? out : null;
}
