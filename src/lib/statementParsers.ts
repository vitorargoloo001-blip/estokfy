// Parsers de extrato bancário (OFX/CSV) para importação manual no Connect —
// alternativa sem dependência externa ao Pluggy. Reaproveita a mesma
// engine de conciliação (connect_run_matching) via import_bank_statement.

export interface ParsedTransaction {
  /** Identificador único da transação dentro do arquivo (FITID do OFX, ou hash gerado para CSV). */
  fileRef: string;
  date: string; // YYYY-MM-DD
  amount: number; // sempre positivo
  type: 'debit' | 'credit';
  method: string;
  description: string;
}

const METHOD_KEYWORDS: [RegExp, string][] = [
  [/\bpix\b/i, 'pix'],
  [/\bted\b/i, 'ted'],
  [/\bdoc\b/i, 'doc'],
  [/boleto/i, 'boleto'],
  [/cart[aã]o.*cr[eé]dito|credit ?card/i, 'credit_card'],
  [/cart[aã]o.*d[eé]bito|debit ?card/i, 'debit_card'],
  [/dep[oó]sito|esp[eé]cie|dinheiro/i, 'money'],
];

function guessMethod(description: string): string {
  for (const [re, method] of METHOD_KEYWORDS) {
    if (re.test(description)) return method;
  }
  return 'other';
}

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── OFX ───────────────────────────────────────────────────────────────

function ofxDateToISO(raw: string): string | null {
  const digits = raw.trim().slice(0, 8);
  if (!/^\d{8}$/.test(digits)) return null;
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function extractOfxField(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\r\n]*)`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

export async function parseOFX(text: string): Promise<ParsedTransaction[]> {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const results: ParsedTransaction[] = [];

  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const trnType = extractOfxField(block, 'TRNTYPE');
    const dtPosted = extractOfxField(block, 'DTPOSTED');
    const trnAmt = extractOfxField(block, 'TRNAMT');
    const fitId = extractOfxField(block, 'FITID');
    const memo = extractOfxField(block, 'MEMO') ?? '';
    const name = extractOfxField(block, 'NAME') ?? '';
    const description = [name, memo].filter(Boolean).join(' — ') || 'Transação bancária';

    const isoDate = dtPosted ? ofxDateToISO(dtPosted) : null;
    const amountNum = trnAmt ? parseFloat(trnAmt.replace(',', '.')) : NaN;
    if (!isoDate || !Number.isFinite(amountNum) || amountNum === 0) continue;

    const type: 'debit' | 'credit' =
      trnType && /credit|dep/i.test(trnType) ? 'credit'
      : trnType && /debit/i.test(trnType) ? 'debit'
      : amountNum < 0 ? 'debit' : 'credit';

    const fileRef = fitId && fitId.length > 0 ? `ofx:${fitId}` : `ofx:${await hashString(`${isoDate}|${amountNum}|${description}`)}`;

    results.push({
      fileRef,
      date: isoDate,
      amount: Math.abs(amountNum),
      type,
      method: guessMethod(description),
      description,
    });
  }

  return results;
}

// ── CSV ───────────────────────────────────────────────────────────────

function detectDelimiter(sample: string): string {
  // Bancos brasileiros exportam CSV com ; como separador justamente porque o
  // valor usa vírgula decimal (ex: "150,50") — se houver qualquer ; na
  // amostra, ele é o delimitador. Vírgula como delimitador só é assumida
  // quando não há nenhum ; (formato então esperado com decimal em ponto).
  return sample.includes(';') ? ';' : ',';
}

function parseCsvDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseCsvAmount(raw: string): number | null {
  let s = raw.trim().replace(/^R\$\s*/i, '');
  // Formato brasileiro "1.234,56" -> "1234.56"; formato simples "1234.56" mantém.
  if (/,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
}

/** Espera colunas na ordem: Data, Descrição, Valor. Primeira linha é ignorada se não parecer uma data válida. */
export async function parseCSV(text: string): Promise<ParsedTransaction[]> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const startIdx = parseCsvDate(splitCsvLine(lines[0], delimiter)[0] ?? '') ? 0 : 1;

  const results: ParsedTransaction[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delimiter);
    if (cols.length < 3) continue;
    const [rawDate, rawDesc, rawAmount] = cols;
    const isoDate = parseCsvDate(rawDate);
    const amountNum = parseCsvAmount(rawAmount);
    if (!isoDate || amountNum === null || amountNum === 0) continue;

    const description = rawDesc || 'Transação bancária';
    const type: 'debit' | 'credit' = amountNum < 0 ? 'debit' : 'credit';
    const fileRef = `csv:${await hashString(`${isoDate}|${amountNum}|${description}|${i}`)}`;

    results.push({
      fileRef,
      date: isoDate,
      amount: Math.abs(amountNum),
      type,
      method: guessMethod(description),
      description,
    });
  }

  return results;
}

export async function parseStatementFile(file: File): Promise<ParsedTransaction[]> {
  const text = await file.text();
  const isOfx = /\.ofx$/i.test(file.name) || /<OFX>/i.test(text.slice(0, 2000));
  return isOfx ? parseOFX(text) : parseCSV(text);
}
