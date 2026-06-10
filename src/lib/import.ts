// ── Lazy library loaders ──────────────────────────────────────────────────────
// pdfjs-dist (~2.5 MB) and xlsx (~500 KB) are loaded on-demand the first time
// a PDF/Excel operation is triggered, not on module import.  This removes them
// from the CargoSubPage and ImportPage initial bundles entirely, cutting cold
// load time by ~3 MB.
//
// WORKER STRATEGY — public/pdf.worker.js
// ───────────────────────────────────────
// The hosting CDN (Cloudflare Pages) serves .mjs files as
// `application/octet-stream`.  Browsers reject such files as module workers
// AND pdfjs's fake-worker fallback uses dynamic import() which also fails
// for octet-stream or blob: URLs blocked by CSP.
//
// Fix: the vite.config.ts `copy-pdfjs-worker` plugin copies
//   pdfjs-dist/build/pdf.worker.min.mjs  →  public/pdf.worker.js
// at every build.  Cloudflare Pages serves .js as application/javascript
// so both the real Worker constructor and dynamic import() succeed.
// The file is served from our own origin — no CORS, no CSP issues.

type XLSXModule = typeof import('xlsx');
type PdfjsModule = typeof import('pdfjs-dist');
type MammothModule = typeof import('mammoth');

let _xlsxCache: XLSXModule | null = null;
async function getXLSX(): Promise<XLSXModule> {
  if (!_xlsxCache) _xlsxCache = await import('xlsx');
  return _xlsxCache;
}

let _pdfjsCache: PdfjsModule | null = null;
async function getPdfjs(): Promise<PdfjsModule> {
  if (_pdfjsCache) return _pdfjsCache;
  const lib = await import('pdfjs-dist');
  // Use Vite's BASE_URL so the path is correct whether the app is deployed at
  // the root ("/") or a sub-path.  The worker file lives in public/ and is
  // copied verbatim to dist/ by Vite — no hashing — so the path is stable.
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  lib.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.js`;
  _pdfjsCache = lib;
  return lib;
}

let _mammothCache: MammothModule | null = null;
async function getMammoth(): Promise<MammothModule> {
  if (!_mammothCache) _mammothCache = await import('mammoth');
  return _mammothCache;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ImportType = 'containers' | 'cargo';

export interface ParsedRow {
  rowIndex: number;                         // 1-based row number from source file
  data: Record<string, string | number | null>;
  errors: string[];
  warnings: string[];
  valid: boolean;
}

export interface ImportPreview {
  headers: string[];                        // detected source headers
  mappedFields: Record<string, string>;     // sourceHeader → appField
  rows: ParsedRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

// ── Column alias maps ─────────────────────────────────────────────────────────

const CONTAINER_ALIASES: Record<string, string> = {
  // container_id
  container_id: 'container_id', 'container id': 'container_id',
  'container no': 'container_id', 'container number': 'container_id',
  container: 'container_id', 'cont id': 'container_id', 'cont no': 'container_id',
  // vessel_name
  vessel_name: 'vessel_name', vessel: 'vessel_name', 'vessel name': 'vessel_name',
  ship: 'vessel_name', 'ship name': 'vessel_name',
  // arrival_date
  arrival_date: 'arrival_date', arrival: 'arrival_date', 'arrival date': 'arrival_date',
  eta: 'arrival_date', 'arrival dt': 'arrival_date',
  // destuff_date
  destuff_date: 'destuff_date', 'destuff date': 'destuff_date',
  'destuffing date': 'destuff_date', 'de-stuff date': 'destuff_date',
  // destuff_shed
  destuff_shed: 'destuff_shed', shed: 'destuff_shed', 'destuff shed': 'destuff_shed',
  'shed number': 'destuff_shed', 'shed no': 'destuff_shed',
  // status
  status: 'status', state: 'status', condition: 'status',
  // expected_cargo_count
  expected_cargo_count: 'expected_cargo_count', 'expected count': 'expected_cargo_count',
  'cargo count': 'expected_cargo_count', 'expected cargo': 'expected_cargo_count',
  'expected qty': 'expected_cargo_count', 'exp count': 'expected_cargo_count',
};

const CARGO_ALIASES: Record<string, string> = {
  // container_id
  container_id: 'container_id', 'container id': 'container_id',
  'container no': 'container_id', container: 'container_id',
  'cont no': 'container_id', 'cont id': 'container_id',
  // pallet_no
  pallet_no: 'pallet_no', pallet: 'pallet_no', 'pallet no': 'pallet_no',
  'pallet number': 'pallet_no', 'plt no': 'pallet_no',
  // commodity — also accept "number of pkgs / packages" variants from port manifests
  commodity: 'commodity', description: 'commodity', item: 'commodity',
  'cargo type': 'commodity', goods: 'commodity', product: 'commodity',
  'description of goods': 'commodity', 'goods description': 'commodity',
  'number of pkgs': 'commodity', 'no of pkgs': 'commodity',
  'no. of pkgs': 'commodity', 'no of packages': 'commodity',
  'number of packages': 'commodity', 'pkg description': 'commodity',
  'pkgs description': 'commodity', 'package description': 'commodity',
  // quantity — "qty" alias already present; also accept "pieces" as a count column
  quantity: 'quantity', qty: 'quantity', count: 'quantity',
  amount: 'quantity', units: 'quantity', pieces: 'quantity',
  'total qty': 'quantity', 'total quantity': 'quantity', 'total pieces': 'quantity',
  // marks — also accept "consignee" / "importer" from port manifests
  marks: 'marks', marking: 'marks', markings: 'marks',
  'shipping marks': 'marks', 'cargo marks': 'marks',
  consignee: 'marks', 'consignee name': 'marks',
  importer: 'marks', 'importer name': 'marks', 'shipper consignee': 'marks',
  // storage_location
  storage_location: 'storage_location', location: 'storage_location',
  storage: 'storage_location', 'storage loc': 'storage_location',
  loc: 'storage_location', bay: 'storage_location', position: 'storage_location',
  // damage
  damage: 'damage', 'damage type': 'damage', condition: 'damage',
  'damage status': 'damage', 'cargo condition': 'damage',
  // remarks
  remarks: 'remarks', notes: 'remarks', comments: 'remarks',
  note: 'remarks', comment: 'remarks', info: 'remarks',
  // bl_no
  bl_no: 'bl_no', 'bl#': 'bl_no', 'bl #': 'bl_no', 'b/l': 'bl_no', 'b/l no': 'bl_no',
  'bill of lading': 'bl_no', 'bill of lading no': 'bl_no', 'hbl': 'bl_no', 'hbl no': 'bl_no',
  'bl number': 'bl_no', 'bl no': 'bl_no', 'bol': 'bl_no',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a header string for alias lookup */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
}

/** Map source headers to app field names */
export function buildFieldMapping(
  headers: string[],
  type: ImportType,
): Record<string, string> {
  const aliases = type === 'containers' ? CONTAINER_ALIASES : CARGO_ALIASES;
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const key = normalise(h);
    if (aliases[key]) mapping[h] = aliases[key];
  }
  return mapping;
}

/** Parse a date string, return ISO YYYY-MM-DD or null */
function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  // Excel serial number — manual conversion avoids a runtime dependency on XLSX.SSF
  if (typeof v === 'number') {
    // Excel epoch is 1900-01-01; serial 1 = Jan 1 1900.
    // Excel incorrectly treats 1900 as a leap year (serial 60 = phantom Feb 29),
    // so serials > 59 are offset by 2, others by 1.
    const offset = v > 59 ? v - 2 : v - 1;
    const d = new Date(Date.UTC(1900, 0, 1) + offset * 86_400_000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // Try direct parse — handle dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd
  const isoMatch = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const dmyMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmyMatch) {
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return `${year}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

const VALID_STATUSES = ['Scheduled', 'In Process', 'Completed'];
const VALID_SHEDS = ['Shed 6', 'Shed 7'];
const VALID_DAMAGE = ['none', 'wet', 'torn', 'broken', 'dented', 'b/o'];

function normaliseStatus(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'scheduled' || s === '') return 'Scheduled';
  if (s === 'in process' || s === 'in-process' || s === 'inprocess') return 'In Process';
  if (s === 'completed' || s === 'complete' || s === 'done') return 'Completed';
  return String(v ?? '').trim();
}

function normaliseShed(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '6' || s === 'shed6' || s === 'shed 6') return 'Shed 6';
  if (s === '7' || s === 'shed7' || s === 'shed 7') return 'Shed 7';
  return null;
}

function normaliseDamage(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (VALID_DAMAGE.includes(s)) return s;
  if (s === '' || s === 'nil' || s === 'n/a' || s === 'no damage') return 'none';
  return s;
}

// ── Container row validation ─────────────────────────────────────────────────

function validateContainerRow(
  raw: Record<string, unknown>,
  rowIndex: number,
): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const container_id = String(raw.container_id ?? '').trim().toUpperCase();
  if (!container_id) errors.push('container_id is required');

  const vessel_name = String(raw.vessel_name ?? '').trim();
  if (!vessel_name) errors.push('vessel_name is required');

  const arrival_date = parseDate(raw.arrival_date);
  if (!arrival_date) errors.push('arrival_date is missing or invalid');

  const destuff_date = parseDate(raw.destuff_date) ?? null;

  const status = normaliseStatus(raw.status);
  if (!VALID_STATUSES.includes(status)) {
    errors.push(`status "${status}" is invalid — must be Scheduled, In Process, or Completed`);
  }

  const destuff_shed = normaliseShed(raw.destuff_shed);
  if (raw.destuff_shed !== undefined && raw.destuff_shed !== '' && raw.destuff_shed !== null && !destuff_shed) {
    warnings.push(`destuff_shed "${raw.destuff_shed}" not recognised — will be left blank`);
  }

  const expected_cargo_count = raw.expected_cargo_count !== undefined && raw.expected_cargo_count !== ''
    ? Number(raw.expected_cargo_count)
    : null;
  if (expected_cargo_count !== null && isNaN(expected_cargo_count)) {
    warnings.push('expected_cargo_count is not a number — will be ignored');
  }

  return {
    rowIndex,
    data: {
      container_id,
      vessel_name,
      arrival_date: arrival_date ?? '',
      destuff_date,
      destuff_shed,
      status,
      expected_cargo_count: expected_cargo_count !== null && !isNaN(expected_cargo_count) ? expected_cargo_count : null,
    },
    errors,
    warnings,
    valid: errors.length === 0,
  };
}

// ── Cargo row validation ─────────────────────────────────────────────────────

function validateCargoRow(
  raw: Record<string, unknown>,
  rowIndex: number,
): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const container_id = String(raw.container_id ?? '').trim().toUpperCase();
  if (!container_id) errors.push('container_id is required');

  const commodity = String(raw.commodity ?? '').trim();
  if (!commodity) errors.push('commodity is required');

  const quantity = Number(raw.quantity);
  if (raw.quantity === undefined || raw.quantity === '') {
    errors.push('quantity is required');
  } else if (isNaN(quantity) || quantity <= 0) {
    errors.push(`quantity "${raw.quantity}" must be a positive number`);
  }

  const pallet_no = raw.pallet_no ? String(raw.pallet_no).trim().toUpperCase() || null : null;
  const marks = raw.marks ? String(raw.marks).trim() || null : null;
  const storage_location = raw.storage_location ? String(raw.storage_location).trim().toUpperCase() || null : null;

  const rawDamage = raw.damage;
  const damage = normaliseDamage(rawDamage);
  if (rawDamage && rawDamage !== '' && !VALID_DAMAGE.includes(damage)) {
    warnings.push(`damage "${rawDamage}" not in standard list — will be saved as-is`);
  }

  const remarks = raw.remarks ? String(raw.remarks).trim() || null : null;
  const bl_no = raw.bl_no ? String(raw.bl_no).trim().toUpperCase() || null : null;

  return {
    rowIndex,
    data: { container_id, pallet_no, commodity, quantity: isNaN(quantity) ? 0 : quantity, marks, bl_no, storage_location, damage: damage || 'none', remarks },
    errors,
    warnings,
    valid: errors.length === 0,
  };
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse an uploaded file (Excel or CSV) and return a full import preview.
 * Works in-browser via FileReader + xlsx (loaded on demand).
 */
export async function parseImportFile(
  file: File,
  type: ImportType,
): Promise<ImportPreview> {
  const XLSX = await getXLSX();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Read as array-of-arrays to get raw headers
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (raw.length < 2) {
    return { headers: [], mappedFields: {}, rows: [], totalRows: 0, validRows: 0, invalidRows: 0 };
  }

  const headers = (raw[0] as unknown[]).map((h) => String(h ?? '').trim()).filter(Boolean);
  const dataRows = raw.slice(1);

  const mappedFields = buildFieldMapping(headers, type);

  // Pre-compute column indices for consignee-name and marks-number fields separately.
  // When a spreadsheet has BOTH a CONSIGNEE column AND a MARKS/MARKS & NUMBERS column
  // we combine them as "CONSIGNEE / MARK_NO" so both appear in the marks DB field.
  const CONSIGNEE_NAME_KEYS = new Set([
    'consignee', 'consignee name', 'importer', 'importer name', 'shipper consignee',
  ]);
  const MARK_NO_HEADER_KEYS = new Set([
    'marks', 'marks & numbers', 'marks and numbers',
    'shipping marks', 'cargo marks', 'mark no', 'mark number',
  ]);
  const consigneeColIndices: number[] = headers.reduce<number[]>((acc, h, idx) => {
    if (CONSIGNEE_NAME_KEYS.has(normalise(h)) && mappedFields[h] === 'marks') acc.push(idx);
    return acc;
  }, []);
  const markNoColIndices: number[] = headers.reduce<number[]>((acc, h, idx) => {
    if (MARK_NO_HEADER_KEYS.has(normalise(h)) && mappedFields[h] === 'marks') acc.push(idx);
    return acc;
  }, []);

  const parsedRows: ParsedRow[] = dataRows
    .filter((row) => (row as unknown[]).some((cell) => cell !== '' && cell !== null && cell !== undefined))
    .map((row, i) => {
      const cells = row as unknown[];

      // Build raw object keyed by app field name
      const rawObj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        const field = mappedFields[h];
        if (field) rawObj[field] = cells[idx];
      });

      // When consignee-name AND marks-number columns are both present, combine them
      // as "CONSIGNEE / MARK_NO" so neither piece of data is lost.
      // When only one type of column exists, use whichever is populated.
      if (consigneeColIndices.length > 0 || markNoColIndices.length > 0) {
        let consigneeName = '';
        let markNo = '';
        for (const idx of consigneeColIndices) {
          const v = String(cells[idx] ?? '').trim();
          if (v) { consigneeName = v; break; }
        }
        for (const idx of markNoColIndices) {
          const v = String(cells[idx] ?? '').trim();
          if (v) { markNo = v; break; }
        }
        const combined =
          consigneeName && markNo ? `${consigneeName} / ${markNo}`
          : consigneeName         ? consigneeName
          : markNo                ? markNo
          :                         (rawObj.marks ? String(rawObj.marks) : '');
        if (combined) rawObj.marks = combined;
      }

      return type === 'containers'
        ? validateContainerRow(rawObj, i + 2)
        : validateCargoRow(rawObj, i + 2);
    });

  const validRows = parsedRows.filter((r) => r.valid).length;

  return {
    headers,
    mappedFields,
    rows: parsedRows,
    totalRows: parsedRows.length,
    validRows,
    invalidRows: parsedRows.length - validRows,
  };
}

// ── PDF manifest parser ───────────────────────────────────────────────────────

const HBL_RE      = /^HBL[-\s\/]?\d+[A-Z0-9]*$/i;  // HBL12345, HBL-12345, HBL 12345, HBL/12345
const WR_RE       = /^WR[#\-\s\/]?\S+$/i;            // WR#12345, WR-12345, WR12345
const PKG_QTY_RE  = /^\d+$/;
const PKG_TYPE_RE = /^(BOX|BOXES|PLT|PLTS|SKD|SKID|SKIDS|ROL|ROLL|ROLLS|BDL|BUNDLE|BUNDLES|PCS|PIECE|PIECES|BAG|BAGS|FRM|PAL|PALLET|PALLETS|ACE|CTN|CTNS|CARTON|CARTONS|CRT|CRATE|CRATES|PKG|PKGS|PACKAGE|PACKAGES|DRUM|DRUMS|DRM|DRMS|CASE|CASES|UNIT|UNITS|TRAY|TRAYS)$/i;

// STL format: "STL572161" or "STL 572161" or "STL-572161" (St. Lucia Express)
const STL_RE = /^STL[\s\-]?\d+$/i;

interface PdfItem { x: number; y: number; text: string }
interface PkgLine { qty: number; type: string }
interface HblEntry { blNo: string; consignee: string; commodity: string; pkgs: PkgLine[]; wrNos: string[] }

// ── STL (St. Lucia Express) manifest parser ───────────────────────────────────

interface StlCols {
  xStlMax:   number;   // right edge of BL number column
  xMarksMin: number;   // left  edge of Marks & Numbers column
  xMarksMax: number;   // right edge of Marks & Numbers column (before Shipper)
  xConsMin:  number;   // left  edge of Consignee column
  xConsMax:  number;   // right edge of Consignee column (before Pcs)
  xPcsMin:   number;   // left  edge of Pcs column
  xPkgMin:   number;   // left  edge of Pkg Type column
}

interface StlEntry {
  blNo:      string;
  markNos:   string[];   // each mark/reference number as a separate string
  consignee: string;     // first-line business name only
  pkgs:      PkgLine[];  // qty+type pairs from Pcs / Pkg Type columns
}

/**
 * Detect St. Lucia Express (STL-format) manifests by the presence of any
 * BL number matching /^STL\d+$/i.
 */
function isStlManifest(allRows: { y: number; items: PdfItem[] }[]): boolean {
  return allRows.some((row) => row.items.some((item) => STL_RE.test(item.text)));
}

/**
 * Derive column x-boundaries by scanning up to the first 80 rows for header
 * keywords: "Marks", "Shipper", "Consignee", "Pcs", "Pkg" / "Pkg Type".
 *
 * Matching is case-insensitive and uses startsWith so partial keywords still
 * match (e.g. "CONSIGNEE NAME" triggers "consignee", "MARKS & NUMBERS" triggers
 * "marks").  The scan window is 80 rows to handle manifests with long company
 * headers before the table begins.
 *
 * Returns null when the required "Consignee" keyword is not found.
 */
function deriveStlColumns(allRows: { y: number; items: PdfItem[] }[]): StlCols | null {
  let marksX:     number | null = null;
  let shipperX:   number | null = null;
  let consigneeX: number | null = null;
  let pcsX:       number | null = null;
  let pkgX:       number | null = null;

  for (const row of allRows.slice(0, 80)) {
    for (const item of row.items) {
      const t = item.text.trim().toLowerCase();
      if (!marksX     && t.startsWith('marks'))                         marksX     = item.x;
      if (!shipperX   && t.startsWith('shipper'))                       shipperX   = item.x;
      if (!consigneeX && t.startsWith('consignee'))                     consigneeX = item.x;
      if (!pcsX       && (t === 'pcs' || t === 'pieces' || t === 'qty' || t === 'quantity')) pcsX = item.x;
      if (!pkgX       && (t.startsWith('pkg') || t === 'type' || t.startsWith('package'))) pkgX = item.x;
    }
    if (consigneeX && marksX) break;
  }

  if (!consigneeX) return null;

  // Fallback estimates when header keywords split across two rows or are absent.
  // Use generous left buffers (-30 to -40 pt) because PDF column headers are often
  // centred over data, so the header x can be 20-30 pt to the right of the data start.
  const xMarksMin = (marksX  ?? 110) - 15;
  const xMarksMax = (shipperX ?? (consigneeX - 170)) - 10;
  const xConsMax  = (pcsX    ?? consigneeX + 150) - 5;
  const xPcsMin   = pcsX     ?? consigneeX + 150;
  const xPkgMin   = pkgX     ?? xPcsMin + 30;

  return {
    xStlMax:   xMarksMin,              // STL number is always left of the Marks column
    xMarksMin,
    xMarksMax,
    xConsMin:  consigneeX - 40,        // wide left buffer — data often starts left of header
    xConsMax,
    xPcsMin,
    xPkgMin,
  };
}

/**
 * Parse a St. Lucia Express Freight Services manifest.
 *
 * Layout per BL entry (rows may span multiple lines):
 *   STL#  |  Mark No(s)  |  Shipper  |  Consignee  |  Pcs  |  Pkg Type  |  Description
 *
 * Each mark number is matched 1-to-1 with its pkg line (same vertical order).
 * Output per mark number:
 *   marks     = "CONSIGNEE NAME / MARK_NUMBER"  (e.g. "MADE IN PARADISE / 382768")
 *   bl_no     = STL number
 *   commodity = pkg type  (e.g. "Carton", "Pallet")
 *   quantity  = pcs count for that pkg type
 */
function parseStlManifest(allRows: { y: number; items: PdfItem[] }[]): ImportPreview {
  const cols = deriveStlColumns(allRows);
  if (!cols) return { headers: [], mappedFields: {}, rows: [], totalRows: 0, validRows: 0, invalidRows: 0 };

  const entries: StlEntry[] = [];
  let current: StlEntry | null = null;
  let consigneeNameLocked = false; // stop collecting name lines once address starts

  for (const row of allRows) {
    // Check for a STL BL number at the far left (allow 50 pt beyond xStlMax for narrow PDFs)
    const stlItem = row.items.find(
      (i) => i.x < cols.xStlMax + 50 && STL_RE.test(i.text),
    );

    if (stlItem) {
      // Push completed entry and start a new one
      if (current) entries.push(current);

      // First mark number on the same row as the STL number
      const firstMark = row.items
        .filter((i) => i.x >= cols.xMarksMin && i.x < cols.xMarksMax && /^\d{3,}$/.test(i.text))
        .sort((a, b) => a.y - b.y || a.x - b.x)  // top-to-bottom within the row
        .map((i) => i.text);

      // Consignee: first non-address text in the consignee column on this row
      const consItems = row.items
        .filter((i) => i.x >= cols.xConsMin && i.x < cols.xConsMax)
        .sort((a, b) => a.x - b.x);
      const consLine = consItems.map((i) => i.text).join(' ').trim();
      const consignee = consLine && !isAddressLine(consLine) ? consLine : '';
      consigneeNameLocked = isAddressLine(consLine);

      // First pkg line: pcs count + type from this row
      const firstPkg = extractStlPkg(row.items, cols);

      current = {
        blNo:      stlItem.text,
        markNos:   firstMark,
        consignee,
        pkgs:      firstPkg ? [firstPkg] : [],
      };

    } else if (current) {
      // Continuation row — append marks, pkgs, and extra consignee name lines

      // Additional mark numbers
      const moreMarks = row.items
        .filter((i) => i.x >= cols.xMarksMin && i.x < cols.xMarksMax && /^\d{3,}$/.test(i.text))
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((i) => i.text);
      if (moreMarks.length > 0) current.markNos.push(...moreMarks);

      // Additional pkg lines
      const morePkg = extractStlPkg(row.items, cols);
      if (morePkg) current.pkgs.push(morePkg);

      // Extend consignee name with additional non-address lines
      if (!consigneeNameLocked) {
        const contItems = row.items
          .filter((i) => i.x >= cols.xConsMin && i.x < cols.xConsMax)
          .sort((a, b) => a.x - b.x);
        const contLine = contItems.map((i) => i.text).join(' ').trim();
        if (contLine) {
          if (isAddressLine(contLine)) {
            consigneeNameLocked = true;
          } else {
            current.consignee = current.consignee
              ? `${current.consignee} ${contLine}`
              : contLine;
          }
        }
      }
    }
  }
  if (current) entries.push(current);

  if (entries.length === 0) {
    return { headers: [], mappedFields: {}, rows: [], totalRows: 0, validRows: 0, invalidRows: 0 };
  }

  // Build one cargo row per (markNo, pkgLine) pair.
  // When mark count == pkg count we zip 1:1; otherwise cross-associate.
  const parsedRows: ParsedRow[] = [];
  let rowIndex = 1;

  for (const entry of entries) {
    const consignee = entry.consignee || entry.blNo;
    const markNos   = entry.markNos.length > 0 ? entry.markNos : [''];
    const pkgs      = entry.pkgs.length > 0 ? entry.pkgs : [{ qty: 1, type: 'PKGS' }];

    const paired = markNos.length === pkgs.length;

    for (let mi = 0; mi < markNos.length; mi++) {
      const pkg   = paired ? pkgs[mi] : pkgs[0]; // 1:1 when counts match, else use first
      const mark  = markNos[mi];
      // Combine consignee + individual mark number so each row is uniquely identifiable
      const marksField = mark ? `${consignee} / ${mark}` : consignee;

      const rawObj: Record<string, unknown> = {
        marks:     marksField,
        bl_no:     entry.blNo,
        commodity: pkg.type || 'GENERAL CARGO',
        quantity:  pkg.qty,
      };
      const validated = validateCargoRow(rawObj, rowIndex++);
      validated.errors = validated.errors.filter((e) => !e.toLowerCase().includes('marks'));
      validated.valid  = validated.errors.length === 0;
      parsedRows.push(validated);
    }
  }

  const validRows = parsedRows.filter((r) => r.valid).length;
  return {
    headers:      ['marks', 'bl_no', 'commodity', 'quantity'],
    mappedFields: { marks: 'marks', bl_no: 'bl_no', commodity: 'commodity', quantity: 'quantity' },
    rows:         parsedRows,
    totalRows:    parsedRows.length,
    validRows,
    invalidRows:  parsedRows.length - validRows,
  };
}

/**
 * Extract a single (qty, type) pkg line from the Pcs + Pkg Type columns of a row.
 * Returns null when no valid pkg entry is found on that row.
 */
function extractStlPkg(items: PdfItem[], cols: StlCols): PkgLine | null {
  // Pcs count: a number in the Pcs column (before Pkg Type)
  const qtyItem = items.find(
    (i) => i.x >= cols.xPcsMin && i.x < cols.xPkgMin && PKG_QTY_RE.test(i.text),
  );
  // Pkg type: known type keyword in or after the Pkg Type column
  const typeItem = items.find(
    (i) => i.x >= cols.xPkgMin && PKG_TYPE_RE.test(i.text),
  );
  if (!qtyItem && !typeItem) return null;
  return {
    qty:  qtyItem  ? parseInt(qtyItem.text, 10) : 1,
    type: typeItem ? typeItem.text.charAt(0).toUpperCase() + typeItem.text.slice(1).toLowerCase() : 'PKGS',
  };
}

/** Return items within [xMin, xMax), sorted left→right, joined as a string. */
function colText(items: PdfItem[], xMin: number, xMax: number): string {
  return items
    .filter((w) => w.x >= xMin && w.x < xMax)
    .sort((a, b) => a.x - b.x)
    .map((w) => w.text)
    .join(' ')
    .trim();
}

/**
 * Scan all text items for any token matching HBL\d+.
 * No x-range required — works regardless of PDF scale.
 */
function isHblManifest(allRows: { y: number; items: PdfItem[] }[]): boolean {
  return allRows.some((row) =>
    row.items.some((item) => HBL_RE.test(item.text)),
  );
}

/**
 * Derive column x-boundaries from ALL HBL rows in the manifest.
 *
 * Previous approach used only the first HBL row and relied on finding a
 * standalone "SP" token to locate the MARKS column boundary.  PDF.js often
 * returns entire cell text as one run (e.g. "SP GENERAL CARGO"), so the
 * single-token match failed, causing the fallback to overshoot and include
 * MARKS text inside the consignee zone.
 *
 * New strategy (multi-row scan):
 *  1. Scan every HBL row to collect candidate x-positions for:
 *       xConsMax  – left edge of the MARKS AND NUMBERS column
 *       xConsMin  – left edge of the CONSIGNEE column (after shipper gap)
 *       xWeight   – left edge of the weight column
 *  2. For xConsMax, accept any item whose text starts with "SP" or matches
 *     a known MARKS-column pattern (GENERAL CARGO, MEDICAL SUPPLIES, etc.).
 *     This is robust whether PDF.js returns "SP" or "SP GENERAL CARGO" as
 *     one token.
 *  3. Take the MINIMUM of all candidates so we stay safely left of any item
 *     that might straddle the boundary.
 *  4. For xConsMin, take the minimum "first-item-after-gap" x across rows
 *     (the gap between the shipper cluster and the consignee column).
 */
function deriveColumns(allRows: { y: number; items: PdfItem[] }[]): {
  xBlMax: number;
  xConsMin: number; xConsMax: number;
  xCommMin: number; xCommMax: number;
  xPkgMin: number;  xPkgMax: number;
} {
  // Matches text that signals the MARKS AND NUMBERS column:
  //   "SP" standalone, "SP GENERAL CARGO" as one run, or any common mark type
  const MARKS_START_RE = /^SP\b|^(GENERAL|MEDICAL|HOTEL|ELECTRICAL|MARINE|FREIGHT|PERSONAL|HOUSEHOLD)\s/i;
  const WEIGHT_RE      = /^\d[\d,]*\.\d{2}$/;

  const consMinCandidates: number[] = [];
  const consMaxCandidates: number[] = [];
  const weightCandidates:  number[] = [];
  let   xBlMaxCommon = 88; // updated from first HBL row

  for (const row of allRows) {
    const hblItem = row.items.find((i) => HBL_RE.test(i.text));
    if (!hblItem) continue;

    const sorted  = [...row.items].sort((a, b) => a.x - b.x);
    const xBlMax  = hblItem.x + 80;
    xBlMaxCommon  = xBlMax;

    // ── xConsMax: left edge of MARKS column ──────────────────────────────
    // Accept the first item after xBlMax whose text signals the marks column.
    const marksItem = sorted.find((i) => i.x > xBlMax && MARKS_START_RE.test(i.text));
    if (marksItem) consMaxCandidates.push(marksItem.x);

    // ── xWeight: left edge of weight column ──────────────────────────────
    const weightItem = sorted.find((i) => WEIGHT_RE.test(i.text) && i.x > xBlMax);
    if (weightItem) weightCandidates.push(weightItem.x);

    // ── xConsMin: first consignee item x ─────────────────────────────────
    // Shipper items cluster near the BL column (x ≈ 73–175).
    // Adding a 100-pt guard past xBlMax reliably skips all shipper tokens
    // and lands on the first consignee column item (consistently x ≈ 219).
    const xConsMaxEst = marksItem ? marksItem.x : hblItem.x + 400;
    const consigneeItems = sorted.filter((i) => i.x > xBlMax + 100 && i.x < xConsMaxEst);
    if (consigneeItems.length > 0) {
      consMinCandidates.push(consigneeItems[0].x); // leftmost item in consignee zone
    }
  }

  // ── Aggregate: take the minimum (most inclusive / most leftward) ──────
  const xConsMax   = consMaxCandidates.length > 0 ? Math.min(...consMaxCandidates) : xBlMaxCommon + 270;
  const xConsMin   = consMinCandidates.length > 0 ? Math.min(...consMinCandidates) - 5 : xBlMaxCommon + 80;
  const xWeight    = weightCandidates.length  > 0 ? Math.min(...weightCandidates)  : xBlMaxCommon + 600;

  // Pkg + commodity zone: from right edge of MARKS column to weight column
  const xSpTypeEnd = xConsMax + 80;

  return {
    xBlMax:   xBlMaxCommon,
    xConsMin, xConsMax,
    xCommMin: xSpTypeEnd, xCommMax: xWeight,
    xPkgMin:  xSpTypeEnd, xPkgMax:  xWeight,
  };

  // Static fallback is intentionally unreachable when isHblManifest() passed.
}

/** Extract (qty, type) pairs from items in the pkg area. */
function extractPkgs(items: PdfItem[], xPkgMin: number, xPkgMax: number): PkgLine[] {
  const tokens = items
    .filter((w) => w.x >= xPkgMin && w.x < xPkgMax)
    .sort((a, b) => a.x - b.x);
  const pkgs: PkgLine[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (PKG_QTY_RE.test(tokens[i].text) && i + 1 < tokens.length && PKG_TYPE_RE.test(tokens[i + 1].text)) {
      pkgs.push({ qty: parseInt(tokens[i].text, 10), type: tokens[i + 1].text.toUpperCase() });
      i++;
    }
  }
  return pkgs;
}

/**
 * Parse an HBL-style port manifest (e.g. RSD International format).
 * Column boundaries are derived dynamically from the first HBL line, so
 * this works at any PDF scale without hardcoded pixel values.
 *
 * Output per package line:
 *   marks     = consignee name
 *   bl_no     = HBL# alone
 *   commodity = "<description> (<pkg type>)"
 *   quantity  = package count
 */
function parseHblManifest(allRows: { y: number; items: PdfItem[] }[]): ImportPreview {
  const cols = deriveColumns(allRows);
  const entries: HblEntry[] = [];
  let current: HblEntry | null = null;

  for (const row of allRows) {
    // Find the BL/WR token: leftmost item on the row (x < xBlMax)
    const blItem = row.items.find((i) => i.x < cols.xBlMax && (HBL_RE.test(i.text) || WR_RE.test(i.text)));
    if (!blItem) continue;

    const blText = blItem.text;

    if (HBL_RE.test(blText)) {
      if (current) entries.push(current);

      const consignee = colText(row.items, cols.xConsMin, cols.xConsMax)
        .replace(/\s+SP$/i, '').trim();

      // Commodity: any non-numeric non-pkg-type text in the pkg+commodity zone
      const zoneItems = row.items
        .filter((w) => w.x >= cols.xCommMin && w.x < cols.xCommMax)
        .sort((a, b) => a.x - b.x);
      let commodity = '';
      for (const item of zoneItems) {
        if (!PKG_QTY_RE.test(item.text) && !PKG_TYPE_RE.test(item.text)) {
          commodity += (commodity ? ' ' : '') + item.text;
        }
      }

      const pkgs = extractPkgs(row.items, cols.xPkgMin, cols.xPkgMax);
      current = { blNo: blText, consignee, commodity: commodity.trim(), pkgs, wrNos: [] };

    } else if (WR_RE.test(blText) && current) {
      current.wrNos.push(blText.toUpperCase());
      current.pkgs.push(...extractPkgs(row.items, cols.xPkgMin, cols.xPkgMax));
      if (!current.consignee) {
        const c = colText(row.items, cols.xConsMin, cols.xConsMax);
        if (c) current.consignee = c;
      }
      if (!current.commodity) {
        const zoneItems = row.items
          .filter((w) => w.x >= cols.xCommMin && w.x < cols.xCommMax)
          .sort((a, b) => a.x - b.x);
        for (const item of zoneItems) {
          if (!PKG_QTY_RE.test(item.text) && !PKG_TYPE_RE.test(item.text)) {
            current.commodity += (current.commodity ? ' ' : '') + item.text;
          }
        }
        current.commodity = current.commodity.trim();
      }
    }
  }
  if (current) entries.push(current);

  if (entries.length === 0) {
    return { headers: [], mappedFields: {}, rows: [], totalRows: 0, validRows: 0, invalidRows: 0 };
  }

  const parsedRows: ParsedRow[] = [];
  let rowIndex = 1;
  for (const entry of entries) {
    // marks = clean consignee name only (WR continuation numbers are internal
    // manifest references and should not appear in the cargo marks field)
    const marks = entry.consignee || entry.blNo;
    const baseCommodity = entry.commodity || 'GENERAL CARGO';

    for (const pkg of entry.pkgs) {
      const rawObj: Record<string, unknown> = {
        marks,
        bl_no:     entry.blNo,
        commodity: `${baseCommodity} (${pkg.type})`,
        quantity:  pkg.qty,
      };
      const validated = validateCargoRow(rawObj, rowIndex++);
      validated.errors = validated.errors.filter((e) => !e.toLowerCase().includes('marks'));
      validated.valid  = validated.errors.length === 0;
      parsedRows.push(validated);
    }
  }

  const validRows = parsedRows.filter((r) => r.valid).length;
  return {
    headers:      ['marks', 'bl_no', 'commodity', 'quantity'],
    mappedFields: { marks: 'marks', bl_no: 'bl_no', commodity: 'commodity', quantity: 'quantity' },
    rows:         parsedRows,
    totalRows:    parsedRows.length,
    validRows,
    invalidRows:  parsedRows.length - validRows,
  };
}

/**
 * Extract all text items from every page, grouped into rows by y-coordinate.
 * PDF coordinate space has y increasing upward, so rows are sorted descending.
 * pdfjs-dist is loaded on demand via getPdfjs() — not bundled into the initial chunk.
 */
async function extractPdfItems(file: File): Promise<{ y: number; items: PdfItem[] }[]> {
  const pdfjsLib    = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();

  // Try with the pre-built worker first; fall back to disableWorker=true if
  // the worker script is unreachable (e.g. CDN MIME issue or missing file).
  //
  // IMPORTANT: pdfjs *transfers* the ArrayBuffer to the Worker thread via
  // postMessage, which detaches the buffer in the main thread.  We must
  // re-read the file for the retry — we cannot reuse the same ArrayBuffer.
  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>>['promise'] extends Promise<infer T> ? T : never;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  } catch (workerErr) {
    console.warn('[pdfjs] Worker failed, retrying without worker:', workerErr);
    // Re-read the file because the original ArrayBuffer was transferred (detached)
    const retryBuffer = await file.arrayBuffer();
    // Reset cache so next call re-initialises cleanly with worker disabled
    _pdfjsCache = null;
    const lib2 = await import('pdfjs-dist');
    lib2.GlobalWorkerOptions.workerSrc = '';  // disable worker → run synchronously
    _pdfjsCache = lib2;
    pdf = await lib2.getDocument({ data: retryBuffer, disableWorker: true } as Parameters<typeof lib2.getDocument>[0]).promise;
  }

  const allItems: PdfItem[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page        = await pdf.getPage(pageNum);
    const viewport    = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const pageHeight  = viewport.height;

    for (const item of textContent.items) {
      if ('str' in item && item.str.trim()) {
        const tx = item.transform as number[];
        // Convert PDF y (bottom-up) to top-down, offset by page index so pages don't overlap
        const x = tx[4];
        const y = (pageHeight - tx[5]) + (pageNum - 1) * pageHeight;
        allItems.push({ x, y, text: item.str.trim() });
      }
    }
  }

  // Group by y within ±4pt tolerance
  const rowMap = new Map<number, PdfItem[]>();
  for (const item of allItems) {
    let matched: number | null = null;
    for (const key of rowMap.keys()) {
      if (Math.abs(key - item.y) <= 4) { matched = key; break; }
    }
    if (matched === null) { rowMap.set(item.y, [item]); }
    else { rowMap.get(matched)!.push(item); }
  }

  return Array.from(rowMap.entries())
    .sort((a, b) => a[0] - b[0])         // top → bottom
    .map(([y, items]) => ({ y, items: items.sort((a, b) => a.x - b.x) }));
}

// ── Consignee name-line vs address-line heuristic ────────────────────────────

/**
 * Address-line patterns: a line that matches these is an address continuation,
 * NOT part of the business name.  Stop collecting the consignee name when we
 * see one of these.
 *
 * Matches:
 *  - US state abbreviations alone (FL, SC, NY …)
 *  - "ST. LUCIA" / "ST LUCIA"
 *  - "CASTRIES" (capital city used as city line)
 *  - "U.S.A." / "USA" / "UNITED STATES …"
 *  - 5-digit ZIP codes
 *  - Lines that start with a street number ( "102 NE …", "13155 NW …" )
 *  - Lines containing "ROAD", "STREET", "AVENUE", "LANE", "DRIVE", "SUITE",
 *    "HIGHWAY", "HWY", "BLVD", "BOX" with a number before it
 *  - Common locality words on their own line
 */
const ADDRESS_LINE_RE = /^(FL|SC|NY|GA|TX|CA|MD|VA|NC|NJ|PA|OH|IL|MI|WA|CO|AZ|ST\.?\s*LUCIA|CASTRIES|GROS\s*ISLET|RODNEY\s*BAY|UNITED\s+STATES.*|U\.S\.A\.|USA|\d{5}(-\d{4})?|\d+\s+\w+.*)$/i;
const STREET_KEYWORD_RE = /\b(ROAD|STREET|AVENUE|AVE|LANE|DRIVE|SUITE|HIGHWAY|HWY|BLVD|COURT|CRT|WAY|PO\s*BOX)\b/i;
// Unanchored locality check: catches multi-token lines like "RODNEY BAY, GROS ISLET"
const LOCALITY_RE = /\b(CASTRIES|RODNEY\s*BAY|GROS[\s-]*ISLET|ST\.?\s*LUCIA|GOODLANDS|CUL[\s-]*DE[\s-]*SAC)\b/i;

function isAddressLine(text: string): boolean {
  // Strip trailing punctuation (e.g. "CASTRIES," → "CASTRIES") before full-string match
  const t = text.trim().replace(/[,;.]+$/, '');
  return ADDRESS_LINE_RE.test(t) || STREET_KEYWORD_RE.test(t) || LOCALITY_RE.test(t);
}

export interface ConsigneeEntry {
  blNo: string;
  consignee: string;    // raw consignee name from the manifest
  marksText: string;    // Marks & Numbers value (preferred for MARKS column); empty string if not present
  pkgType: string;      // e.g. "CTNS", "BAGS", "PLTS" — maps to commodity (kept for legacy compat)
  qty: number;          // package count — kept for legacy compat
  wrNos: string[];      // WR continuation numbers for HBL entries
}

/**
 * Resolve the MARKS column value from a ConsigneeEntry.
 * Priority: Marks & Numbers field → Consignee name.
 * This is the single source of truth for what goes into the DB marks column.
 */
export function resolveMarks(e: ConsigneeEntry): string {
  return (e.marksText || e.consignee).trim();
}

/**
 * Extract one entry per HBL × package-type from a port manifest PDF.
 * maps to cargo fields:  marks = consignee, commodity = pkgType, quantity = qty.
 * If a consignee has multiple package types (e.g. 10 CTNS + 5 BAGS) it
 * produces two rows, one per type.
 *
 * Consignee name collection:
 *   - Starts from the HBL line (first line of the consignee cell).
 *   - Continues onto WR continuation lines as long as the consignee-zone
 *     text looks like a name (not an address line).
 *   - Stops on the first WR line whose consignee text matches address patterns
 *     (street numbers, city names, state abbreviations, country lines etc.)
 *
 * Returns an empty array for non-HBL PDFs.
 */
export async function extractConsigneesFromPdf(file: File): Promise<ConsigneeEntry[]> {
  const allRows = await extractPdfItems(file);

  // ── HBL-style port manifest ────────────────────────────────────────────
  if (isHblManifest(allRows)) {    const cols = deriveColumns(allRows);
    const entries: HblEntry[] = [];
    let current: HblEntry | null = null;
    let collectingConsigneeName = false;

    for (const row of allRows) {
      const blItem = row.items.find((i) => i.x < cols.xBlMax && (HBL_RE.test(i.text) || WR_RE.test(i.text)));
      if (!blItem) continue;
      const blText = blItem.text;

      if (HBL_RE.test(blText)) {
        if (current) entries.push(current);
        const consignee = colText(row.items, cols.xConsMin, cols.xConsMax).replace(/\s+SP$/i, '').trim();
        const zoneItems = row.items.filter((w) => w.x >= cols.xCommMin && w.x < cols.xCommMax).sort((a, b) => a.x - b.x);
        let commodity = '';
        for (const item of zoneItems) {
          if (!PKG_QTY_RE.test(item.text) && !PKG_TYPE_RE.test(item.text)) commodity += (commodity ? ' ' : '') + item.text;
        }
        const pkgs = extractPkgs(row.items, cols.xPkgMin, cols.xPkgMax);
        current = { blNo: blText, consignee, commodity: commodity.trim(), pkgs, wrNos: [] };
        collectingConsigneeName = true;

      } else if (WR_RE.test(blText) && current) {
        current.wrNos.push(blText.toUpperCase());
        current.pkgs.push(...extractPkgs(row.items, cols.xPkgMin, cols.xPkgMax));

        if (collectingConsigneeName) {
          const wrConsText = colText(row.items, cols.xConsMin, cols.xConsMax)
            .replace(/\s+SP$/i, '').trim();
          if (wrConsText) {
            if (isAddressLine(wrConsText)) {
              collectingConsigneeName = false;
            } else {
              current.consignee = current.consignee
                ? `${current.consignee} ${wrConsText}`
                : wrConsText;
            }
          }
        }

        if (!current.consignee) {
          const c = colText(row.items, cols.xConsMin, cols.xConsMax).replace(/\s+SP$/i, '').trim();
          if (c && !isAddressLine(c)) current.consignee = c;
        }

        if (!current.commodity) {
          const zoneItems = row.items.filter((w) => w.x >= cols.xCommMin && w.x < cols.xCommMax).sort((a, b) => a.x - b.x);
          for (const item of zoneItems) {
            if (!PKG_QTY_RE.test(item.text) && !PKG_TYPE_RE.test(item.text)) current.commodity += (current.commodity ? ' ' : '') + item.text;
          }
          current.commodity = current.commodity.trim();
        }
      }
    }
    if (current) entries.push(current);

    const result: ConsigneeEntry[] = [];
    for (const e of entries) {
      const consignee = e.consignee || e.blNo;
      if (e.pkgs.length === 0) {
        result.push({ blNo: e.blNo, consignee, marksText: '', pkgType: 'PKGS', qty: 1, wrNos: e.wrNos });
      } else {
        for (const p of e.pkgs) {
          result.push({ blNo: e.blNo, consignee, marksText: '', pkgType: p.type.toUpperCase() || 'PKGS', qty: p.qty, wrNos: e.wrNos });
        }
      }
    }
    if (result.length > 0) return result;
    // Fall through to generic parser if HBL rows were detected but nothing extracted
  }

  // ── STL-format manifest (St. Lucia Express Freight Services) ──────────────
  if (isStlManifest(allRows)) {
    const stlPreview = parseStlManifest(allRows);
    const stlEntries = stlPreview.rows
      .filter((r) => r.data.marks && String(r.data.marks).trim())
      .map((r) => ({
        blNo:      String(r.data.bl_no || ''),
        consignee: String(r.data.marks || '').trim(),
        marksText: '',
        pkgType:   String(r.data.commodity || 'PKGS').trim() || 'PKGS',
        qty:       Number(r.data.quantity) || 1,
        wrNos:     [] as string[],
      }));
    if (stlEntries.length > 0) return stlEntries;
    // Fall through if STL detected but nothing extracted (unusual layout)
  }

  // ── Generic tabular fallback — re-use already-parsed allRows, no second PDF parse ──
  const genericPreview = parsePdfManifestFromRows(allRows);
  const genericEntries = genericPreview.rows
    .filter((r) => r.data.marks && String(r.data.marks).trim())
    .map((r) => ({
      blNo:      String(r.data.bl_no || ''),
      consignee: String(r.data.marks || '').trim(),
      marksText: '',
      pkgType:   String(r.data.commodity || 'PKGS').trim() || 'PKGS',
      qty:       Number(r.data.quantity) || 1,
      wrNos:     [] as string[],
    }));
  return genericEntries;
}

/**
 * Inner sync implementation of the generic column-header PDF parser.
 * Accepts already-extracted rows so callers can avoid a second extractPdfItems() call.
 */
function parsePdfManifestFromRows(allRows: { y: number; items: PdfItem[] }[]): ImportPreview {
  const rawRows = allRows.map((row) => row.items.map((i) => i.text));

  const aliases = CARGO_ALIASES;
  let headerIdx = -1;
  for (let i = 0; i < rawRows.length; i++) {
    const matches = rawRows[i].filter((cell) => aliases[normalise(cell)]);
    if (matches.length >= 2) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    for (let i = 0; i < rawRows.length; i++) {
      if (rawRows[i].length >= 3) { headerIdx = i; break; }
    }
  }
  if (headerIdx === -1) {
    return { headers: [], mappedFields: {}, rows: [], totalRows: 0, validRows: 0, invalidRows: 0 };
  }

  const headers  = rawRows[headerIdx].map((h) => h.trim()).filter(Boolean);
  const dataRows = rawRows.slice(headerIdx + 1).filter((row) => row.some((c) => c.trim() !== ''));
  const mappedFields = buildFieldMapping(headers, 'cargo');

  const CONSIGNEE_NAME_KEYS2 = new Set([
    'consignee', 'consignee name', 'importer', 'importer name', 'shipper consignee',
  ]);
  const MARK_NO_HEADER_KEYS2 = new Set([
    'marks', 'marks & numbers', 'marks and numbers',
    'shipping marks', 'cargo marks', 'mark no', 'mark number',
  ]);
  const consigneeColIndices: number[] = headers.reduce<number[]>((acc, h, idx) => {
    if (CONSIGNEE_NAME_KEYS2.has(normalise(h)) && mappedFields[h] === 'marks') acc.push(idx);
    return acc;
  }, []);
  const markNoColIndices2: number[] = headers.reduce<number[]>((acc, h, idx) => {
    if (MARK_NO_HEADER_KEYS2.has(normalise(h)) && mappedFields[h] === 'marks') acc.push(idx);
    return acc;
  }, []);

  const parsedRows: ParsedRow[] = dataRows.map((row, i) => {
    const rawObj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const field = mappedFields[h];
      if (field) rawObj[field] = row[idx] ?? '';
    });
    // Apply marks-first logic: use Marks & Numbers column if present, else consignee column.
    // Never combine them — per import spec.
    if (consigneeColIndices.length > 0 || markNoColIndices2.length > 0) {
      let consigneeName = '';
      let markNo = '';
      for (const idx of consigneeColIndices) {
        const v = String(row[idx] ?? '').trim();
        if (v) { consigneeName = v; break; }
      }
      for (const idx of markNoColIndices2) {
        const v = String(row[idx] ?? '').trim();
        if (v) { markNo = v; break; }
      }
      // Priority: Marks & Numbers → Consignee
      const resolved = markNo || consigneeName || (rawObj.marks ? String(rawObj.marks) : '');
      if (resolved) rawObj.marks = resolved;
    }
    return validateCargoRow(rawObj, i + 2);
  });

  const validRows = parsedRows.filter((r) => r.valid).length;
  return { headers, mappedFields, rows: parsedRows, totalRows: parsedRows.length, validRows, invalidRows: parsedRows.length - validRows };
}

/**
 * Extract consignee entries from an Excel (.xlsx / .xls) or CSV manifest.
 *
 * Scans the first sheet for a header row containing a recognisable
 * "consignee" or "marks" column and optional BL-number, commodity, and
 * quantity columns.  Returns one ConsigneeEntry per non-empty data row.
 */
export async function extractConsigneesFromExcel(file: File): Promise<ConsigneeEntry[]> {
  const XLSX = await getXLSX();
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rawRows: string[][] = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][])
    .map((r) => (r as unknown[]).map((c) => String(c ?? '').trim()));
  return parseConsigneesFromRows(rawRows);
}

/**
 * Extract consignee entries from a plain-text (.txt) manifest.
 *
 * Rules:
 *   • Extract ONLY: BL No, Consignee, Marks.  All other fields are ignored.
 *   • marks field = "CONSIGNEE / MARKS" when Marks present, else consignee name only.
 *   • Rows sharing the same BL No + Consignee name are merged into ONE entry.
 *     Different BL No → separate entry even if the consignee is the same.
 *
 * Format detection (in priority order):
 *   1. Label: value  — lines like "BOL: STL572161", "CONSIGNEE: …", "MARKS: …"
 *   2. Delimited columns (tab > pipe > comma) with a header row.
 *   3. Plain list — one consignee name per non-blank line.
 */
export async function extractConsigneesFromTxt(file: File): Promise<ConsigneeEntry[]> {
  const text  = await file.text();
  const lines = text.split(/\r?\n/);

  // ── 1. Label: value format detection ───────────────────────────────────
  // A file is label:value if ≥30% of non-blank lines look like "KEYWORD: …"
  const nonBlank = lines.filter((l) => l.trim());
  const labelRe  = /^([A-Z][A-Z0-9 &/:.()\-]{1,40}):\s*(.*)$/i;
  const labelHits = nonBlank.filter((l) => labelRe.test(l.trim())).length;
  if (nonBlank.length > 0 && labelHits / nonBlank.length >= 0.3) {
    const entries = parseLabelValueTxt(lines);
    if (entries.length > 0) return entries;
  }

  // ── 2. Delimited columns ────────────────────────────────────────────────
  const sample = nonBlank.slice(0, 10);
  const countDelim = (d: string) =>
    sample.reduce((sum, l) => sum + (l.split(d).length - 1), 0);
  const tabScore   = countDelim('\t');
  const pipeScore  = countDelim('|');
  const commaScore = countDelim(',');
  const maxScore   = Math.max(tabScore, pipeScore, commaScore);

  let delimiter: string | null = null;
  if (maxScore >= sample.length) {
    if      (tabScore   === maxScore) delimiter = '\t';
    else if (pipeScore  === maxScore) delimiter = '|';
    else                              delimiter = ',';
  }
  if (delimiter) {
    const rawRows: string[][] = lines
      .map((l) => l.split(delimiter!).map((c) => c.trim()))
      .filter((r) => r.some(Boolean));
    const entries = parseTxtRows(rawRows);
    if (entries.length > 0) return entries;
  }

  // ── 3. Plain-list fallback ──────────────────────────────────────────────
  const entries: ConsigneeEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^[-=*#\s]+$/.test(trimmed)) continue;
    entries.push({ blNo: '', consignee: trimmed, marksText: '', pkgType: 'PKGS', qty: 1, wrNos: [] });
  }
  return entries;
}

/**
 * Parse a "LABEL: value" format TXT manifest.
 *
 * Recognises these labels (case-insensitive, flexible spacing):
 *   BOL / B/L / BILL OF LADING / HBL / STL    → blNo
 *   CONSIGNEE / IMPORTER                       → consigneeName
 *   MARKS / MARKS & NUMBERS / SHIPPING MARKS   → marks
 *
 * Each block of lines that shares the same BOL + CONSIGNEE pair is collapsed
 * into a single ConsigneeEntry.  The file may contain many consecutive blocks.
 */
function parseLabelValueTxt(lines: string[]): ConsigneeEntry[] {
  // Label → field classifier
  const classifyLabel = (raw: string): 'bl' | 'consignee' | 'marks' | null => {
    const s = raw.toLowerCase().replace(/[^a-z0-9 /]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(bol|b l|b\/l|bill of lading|hbl|stl)/.test(s))             return 'bl';
    if (/^(consignee|importer|importer name|consignee name)/.test(s))  return 'consignee';
    if (/^(marks|marks and numbers|marks & numbers|shipping marks|mark no|mark number)/.test(s)) return 'marks';
    return null;
  };

  // Accumulator: group by (blNo, consigneeName) key
  const groupOrder: string[] = [];
  const groupBlNo  = new Map<string, string>();
  const groupName  = new Map<string, string>();
  const groupMarks = new Map<string, string>(); // store the raw marks string (already joined by source)

  // Current record being assembled
  let curBl   = '';
  let curName = '';
  let curMark = '';

  const flushRecord = () => {
    if (!curName && !curMark) return; // nothing useful
    const key = `${curBl.toLowerCase()}|||${curName.toLowerCase()}`;
    if (!groupMarks.has(key)) {
      groupOrder.push(key);
      groupBlNo.set(key, curBl);
      groupName.set(key, curName);
      groupMarks.set(key, curMark);
    } else if (curMark && !groupMarks.get(key)) {
      // Same group but marks arrived on a later line — fill in if still empty
      groupMarks.set(key, curMark);
    }
  };

  const labelRe = /^([A-Z][A-Z0-9 &/:.()\-]{1,40}):\s*(.*)$/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const m = labelRe.exec(line);
    if (!m) continue; // non-label line — skip (addresses, misc data, etc.)

    const label = m[1].trim();
    const value = m[2].trim();
    const field = classifyLabel(label);

    if (!field) continue; // irrelevant label (CONTAINER, PORT OF LOADING, SHIPPER, etc.)

    if (field === 'bl') {
      // Starting a new BOL resets the current record.
      // But first save whatever we have so far.
      flushRecord();
      curBl   = value;
      curName = '';
      curMark = '';
    } else if (field === 'consignee') {
      curName = value;
    } else if (field === 'marks') {
      curMark = value;
    }
  }
  // Flush the last record
  flushRecord();

  // Build ConsigneeEntry list
  const entries: ConsigneeEntry[] = [];
  for (const key of groupOrder) {
    const bl       = groupBlNo.get(key)!;
    const consName = groupName.get(key)!;
    const marks    = groupMarks.get(key) ?? '';

    // Keep consignee and marksText separate — never combine.
    // resolveMarks() applies marks-first logic at import time.
    if (!consName && !marks) continue;
    entries.push({ blNo: bl, consignee: consName, marksText: marks, pkgType: 'PKGS', qty: 1, wrNos: [] });
  }
  return entries;
}

/**
 * TXT-specific row parser: finds header, maps only BL/Consignee/Marks columns,
 * then groups rows by (blNo, consigneeName) so the same shipment appears once.
 */
function parseTxtRows(rawRows: string[][]): ConsigneeEntry[] {
  const CONSIGNEE_KEYS = new Set([
    'consignee', 'consignee name', 'importer', 'importer name', 'shipper consignee',
  ]);
  const MARKS_KEYS = new Set([
    'marks', 'marks & numbers', 'marks and numbers',
    'shipping marks', 'cargo marks', 'mark no', 'mark number',
  ]);
  const BL_KEYS = new Set([
    'bl no', 'bl#', 'bl number', 'b/l', 'b/l no', 'bill of lading',
    'bill of lading no', 'hbl', 'hbl no', 'hbl#', 'stl', 'stl no',
  ]);

  // ── Find header row ─────────────────────────────────────────────────────
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const norm = rawRows[i].map((c) => c.toLowerCase().trim());
    const hasName = norm.some(
      (h) => CONSIGNEE_KEYS.has(h) || MARKS_KEYS.has(h) ||
             h.includes('consignee') || h.includes('importer'),
    );
    const hasBl = norm.some(
      (h) => BL_KEYS.has(h) || h.includes('lading') || (h.startsWith('bl') && h.length <= 12),
    );
    if (hasName || hasBl) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];

  const headers = rawRows[headerIdx].map((h) => h.toLowerCase().trim());

  const findCol = (keys: Set<string>, fuzzy: RegExp) =>
    headers.findIndex((h) => keys.has(h) || fuzzy.test(h));

  const blIdx        = findCol(BL_KEYS,        /lading|^bl/);
  const consigneeIdx = findCol(CONSIGNEE_KEYS,  /consignee|importer/);
  const marksIdx     = findCol(MARKS_KEYS,      /marks/);

  // Must have at least a consignee or marks column
  if (consigneeIdx === -1 && marksIdx === -1) return [];

  // ── Parse rows: collect (blNo, consigneeName, markNo) triples ───────────
  // Group key: `${blNo}|||${consigneeName}` (case-insensitive)
  // Value: Set of unique mark numbers for that group
  const groupOrder: string[] = [];
  const groupBlNo    = new Map<string, string>();  // key → original-case blNo
  const groupName    = new Map<string, string>();  // key → original-case consigneeName
  const groupMarks   = new Map<string, Set<string>>(); // key → unique mark strings

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.every((c) => !c)) continue;

    const consigneeName = (consigneeIdx !== -1 ? row[consigneeIdx] : '') ?? '';
    const markNo        = (marksIdx     !== -1 ? row[marksIdx]     : '') ?? '';
    const blNo          = (blIdx        !== -1 ? row[blIdx]        : '') ?? '';

    const name    = consigneeName.trim();
    const mark    = markNo.trim();
    const bl      = blNo.trim();

    if (!name && !mark) continue; // nothing useful on this row

    // Group key is case-insensitive (bl + consignee)
    const key = `${bl.toLowerCase()}|||${name.toLowerCase()}`;
    if (!groupMarks.has(key)) {
      groupOrder.push(key);
      groupBlNo.set(key, bl);
      groupName.set(key, name);
      groupMarks.set(key, new Set());
    }
    if (mark) groupMarks.get(key)!.add(mark);
  }

  // ── Build one ConsigneeEntry per group ──────────────────────────────────
  const entries: ConsigneeEntry[] = [];
  for (const key of groupOrder) {
    const bl           = groupBlNo.get(key)!;
    const consName     = groupName.get(key)!;
    const marks        = [...(groupMarks.get(key) ?? [])].join(', ');

    // Keep consignee and marksText separate — never combine.
    // resolveMarks() will apply marks-first logic at import time.
    if (!consName && !marks) continue;
    entries.push({ blNo: bl, consignee: consName, marksText: marks, pkgType: 'PKGS', qty: 1, wrNos: [] });
  }
  return entries;
}

/**
 * Shared column-detection + row-mapping logic used by both the Excel and TXT
 * extractors.  Accepts a 2-D array of string cells (rows × columns).
 */
function parseConsigneesFromRows(rawRows: string[][]): ConsigneeEntry[] {
  // spreadsheet has BOTH columns we can combine them rather than picking one.
  const CONSIGNEE_NAME_KEYS = new Set([
    'consignee', 'consignee name', 'importer', 'importer name', 'shipper consignee',
  ]);
  // "marks" columns carry reference/mark numbers, not the business name
  const MARK_NO_KEYS = new Set([
    'marks', 'marks & numbers', 'marks and numbers',
    'shipping marks', 'cargo marks', 'mark no', 'mark number',
  ]);
  const BL_KEYS = new Set([
    'bl no', 'bl#', 'bl number', 'b/l', 'b/l no', 'bill of lading',
    'bill of lading no', 'hbl', 'hbl no', 'hbl#', 'stl', 'stl no',
  ]);
  const COMMODITY_KEYS = new Set([
    'commodity', 'pkg type', 'package type', 'type', 'description',
    'goods description', 'nature of goods',
  ]);
  const QTY_KEYS = new Set([
    'qty', 'quantity', 'pcs', 'pieces', 'packages',
    'no of packages', 'no. of packages', 'total packages', 'total pcs',
  ]);

  // ── Locate header row (first 20 rows) ─────────────────────────────────
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const norm = rawRows[i].map((c) => c.toLowerCase());
    const hasConsignee = norm.some(
      (h) => CONSIGNEE_NAME_KEYS.has(h) || MARK_NO_KEYS.has(h) || h.includes('consignee') || h.includes('importer'),
    );
    const hasBl = norm.some(
      (h) => BL_KEYS.has(h) || h.includes('lading') || (h.startsWith('bl') && h.length <= 12),
    );
    if (hasConsignee || hasBl) { headerIdx = i; break; }
  }
  // Last resort: first row with ≥ 3 non-empty cells
  if (headerIdx === -1) {
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      if (rawRows[i].filter(Boolean).length >= 3) { headerIdx = i; break; }
    }
  }
  if (headerIdx === -1) return [];

  const headers = rawRows[headerIdx].map((h) => h.toLowerCase().trim());

  // ── Map header labels to column indices ───────────────────────────────
  const indexOf = (keys: Set<string>, fuzzy?: RegExp) =>
    headers.findIndex((h) => keys.has(h) || (fuzzy ? fuzzy.test(h) : false));

  // consigneeIdx = business name column; markNoIdx = marks/reference-number column
  const consigneeIdx = indexOf(CONSIGNEE_NAME_KEYS, /consignee|importer/);
  const markNoIdx    = indexOf(MARK_NO_KEYS, /marks/);
  const blIdx        = indexOf(BL_KEYS, /lading|^bl/);
  const commodityIdx = indexOf(COMMODITY_KEYS, /commodity|pkg.?type|description/);
  const qtyIdx       = indexOf(QTY_KEYS, /^qty|^pcs|^pieces|packages/);

  // Need at least one name column
  if (consigneeIdx === -1 && markNoIdx === -1) return [];

  // ── Parse data rows ────────────────────────────────────────────────────
  const entries: ConsigneeEntry[] = [];
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.every((c) => !c)) continue;          // skip entirely blank rows

    const consigneeName = consigneeIdx !== -1 ? row[consigneeIdx]?.trim() || '' : '';
    const markNo        = markNoIdx    !== -1 ? row[markNoIdx]?.trim()    || '' : '';

    // Require at least one of the two name fields to be populated
    if (!consigneeName && !markNo) continue;

    // MARKS priority: Marks & Numbers column → Consignee column (never combined)
    // Both values are preserved separately so the caller can decide.
    const blNo    = blIdx        !== -1 ? row[blIdx]?.trim()        || '' : '';
    const pkgType = commodityIdx !== -1 ? row[commodityIdx]?.trim() || 'PKGS' : 'PKGS';
    const qtyRaw  = qtyIdx       !== -1 ? Number(row[qtyIdx])       || 0  : 0;
    const qty     = qtyRaw > 0 ? qtyRaw : 1;

    entries.push({ blNo, consignee: consigneeName, marksText: markNo, pkgType: pkgType || 'PKGS', qty, wrNos: [] });
  }

  return entries;
}

/**
 * Extract consignee entries from a DOCX (Word) manifest.
 *
 * Uses mammoth to convert the document to plain text, then routes through the
 * same label:value / delimited-column / plain-list pipeline as the TXT extractor.
 * This handles:
 *   • Word documents with labelled fields (BOL:, CONSIGNEE:, MARKS:, etc.)
 *   • Word documents containing manifest tables (mammoth flattens tables to
 *     tab-separated rows which the delimited-column parser picks up)
 *   • Simple Word documents with one consignee per paragraph
 */
async function extractConsigneesFromDocx(file: File): Promise<ConsigneeEntry[]> {
  const mammoth = await getMammoth();
  const buf = await file.arrayBuffer();
  // extractRawText preserves table cell boundaries as newlines and is lighter
  // than convertToHtml — sufficient for manifest data extraction.
  const { value: rawText } = await mammoth.extractRawText({ arrayBuffer: buf });
  if (!rawText.trim()) return [];

  // mammoth renders table rows as lines; individual cells are separated by
  // whitespace.  We split on newlines and let the TXT extractor decide format.
  const pseudoFile = new File([rawText], file.name.replace(/\.docx?$/i, '.txt'), { type: 'text/plain' });
  return extractConsigneesFromTxt(pseudoFile);
}

/**
 * Unified extractor — dispatches to PDF, Excel/CSV, TXT, or DOCX based on
 * file extension.  Also handles files with a text/plain MIME type but no
 * .txt extension.  Returns the same ConsigneeEntry[] shape for all types.
 *
 * MARKS column priority (per import spec):
 *   1. Marks & Numbers field (ConsigneeEntry.marksText) — used when present
 *   2. Consignee name (ConsigneeEntry.consignee)       — fallback
 * Commodity and Quantity are intentionally left blank at import time.
 * Call resolveMarks(entry) to get the final MARKS value.
 */
export async function extractConsigneesFromFile(file: File): Promise<ConsigneeEntry[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf')                               return extractConsigneesFromPdf(file);
  if (['xlsx', 'xls', 'csv'].includes(ext))        return extractConsigneesFromExcel(file);
  if (ext === 'docx' || ext === 'doc')             return extractConsigneesFromDocx(file);
  if (ext === 'txt' || file.type === 'text/plain') return extractConsigneesFromTxt(file);
  return [];
}
export async function parsePdfManifest(file: File): Promise<ImportPreview> {
  const allRows = await extractPdfItems(file);

  // ── HBL-format port manifest (e.g. RSD International) ────────────────
  if (isHblManifest(allRows)) {
    return parseHblManifest(allRows);
  }

  // ── STL-format manifest (St. Lucia Express Freight Services) ──────────
  if (isStlManifest(allRows)) {
    return parseStlManifest(allRows);
  }

  // ── Generic tabular manifest fallback ─────────────────────────────────
  return parsePdfManifestFromRows(allRows);
}

// ── Template generation ───────────────────────────────────────────────────────

export async function downloadTemplate(type: ImportType) {
  const XLSX = await getXLSX();
  const headers =
    type === 'containers'
      ? ['container_id', 'vessel_name', 'arrival_date', 'destuff_date', 'destuff_shed', 'status', 'expected_cargo_count']
      : ['container_id', 'pallet_no', 'commodity', 'quantity', 'marks', 'bl_no', 'storage_location', 'damage', 'remarks'];

  const examples =
    type === 'containers'
      ? [['ABCU1234567', 'MV Atlantic Star', '2026-06-01', '2026-06-03', 'Shed 6', 'Scheduled', 50]]
      : [['ABCU1234567', 'PLT-001', 'carton', 100, 'ABC CORP', 'HBL205422', 'A-01-03', 'none', 'Handle with care']];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type === 'containers' ? 'Containers' : 'Cargo');
  XLSX.writeFile(wb, `import_template_${type}.xlsx`);
}
