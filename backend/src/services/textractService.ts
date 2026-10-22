import { 
  TextractClient, 
  AnalyzeDocumentCommand,
  AnalyzeDocumentCommandOutput,
  Block,
  FeatureType
} from '@aws-sdk/client-textract';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { telemetry, estimateTextractCost } from './telemetryService';

/**
 * Converts a PDF file to a single PNG image using Ghostscript.
 * Returns the path to the generated PNG (caller must delete it).
 * Throws if Ghostscript is not available.
 */
function convertPdfToPng(pdfPath: string): string {
  const tmpDir = os.tmpdir();
  const outBase = path.join(tmpDir, `textract_pdf_${Date.now()}`);
  const outFile = `${outBase}-000001.png`;

  // Resolve gs from known Homebrew path if not on PATH
  const gsBin = ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', 'gs']
    .find(p => { try { execSync(`test -x ${p}`, { stdio: 'ignore' }); return true; } catch { return false; } }) ?? 'gs';
  execSync(`"${gsBin}" -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m -r200 -dFirstPage=1 -dLastPage=1 -sOutputFile="${outBase}-%06d.png" "${pdfPath}"`, { stdio: 'ignore' });

  if (!fs.existsSync(outFile)) {
    throw new Error(`Ghostscript did not produce output: ${outFile}`);
  }
  return outFile;
}

export interface TextractResult {
  /** Merged flat key-value pairs: form fields + businessInfo heuristics */
  keyValues: Record<string, string>;

  /** Full extracted text (joined lines) — used for keyword scanning in agents */
  text: string;

  // Summary counts
  pageCount: number;
  lineCount: number;
  wordCount: number;
  formFieldCount: number;

  // Telemetry fields
  latencyMs: number;
  estimatedCostUsd: number;
}

export class TextractService {
  private textractClient: TextractClient;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    this.textractClient = new TextractClient({
      region,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {})
    });
  }

  /**
   * Single-call document analysis — sends file bytes directly to Textract.
   * One API call extracts text, forms, AND tables simultaneously.
   * @param applicationId  Used to record telemetry; pass empty string if not available.
   */
  async analyzeDocument(filepath: string, filename: string, applicationId = ''): Promise<TextractResult> {
    const ext = path.extname(filename).toLowerCase();
    let analysisPath = filepath;
    let tmpPng: string | null = null;

    // Textract synchronous API only supports JPEG/PNG/TIFF — convert PDF via Ghostscript
    if (ext === '.pdf') {
      console.log(`[Textract] PDF detected — converting to PNG via Ghostscript before analysis`);
      try {
        tmpPng = convertPdfToPng(filepath);
        analysisPath = tmpPng;
        console.log(`[Textract] PDF → PNG conversion done: ${path.basename(tmpPng)} (${(fs.statSync(tmpPng).size / 1024).toFixed(1)} KB)`);
      } catch (convErr: any) {
        console.error(`[Textract] PDF conversion failed: ${convErr.message} — sending raw PDF (may fail)`);
      }
    }

    const fileBytes = fs.readFileSync(analysisPath);
    console.log(`[Textract] Analyzing "${filename}" (${(fileBytes.length / 1024).toFixed(1)} KB) — single API call`);

    const command = new AnalyzeDocumentCommand({
      Document: { Bytes: fileBytes },
      FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES]
    });

    const t0 = Date.now();
    let response!: AnalyzeDocumentCommandOutput;
    try {
      response = await this.textractClient.send(command);
    } finally {
      // Clean up temp PNG (if PDF was converted) regardless of success/failure
      if (tmpPng) {
        try { fs.unlinkSync(tmpPng); } catch { /* ignore */ }
      }
    }
    const latencyMs = Date.now() - t0;
    const blocks: Block[] = response.Blocks ?? [];

    // --- Text ---
    const lineBlocks = blocks.filter(b => b.BlockType === 'LINE');
    const wordBlocks = blocks.filter(b => b.BlockType === 'WORD');
    const lines = lineBlocks.map(b => b.Text ?? '');
    const text  = lines.join('\n');

    // --- Forms (key-value pairs from Textract) ---
    const forms = this.parseKeyValuePairs(blocks);

    // --- Heuristic business-info extraction ---
    const businessInfo = this.extractBusinessInfo(text, forms);

    // --- Merge into one flat KV map (forms win; businessInfo fills gaps) ---
    const keyValues: Record<string, string> = { ...forms, ...businessInfo };

    const pageCount      = blocks.filter(b => b.BlockType === 'PAGE').length || 1;
    const formFieldCount = Object.keys(forms).length;
    const estimatedCostUsd = estimateTextractCost(pageCount, 'ANALYZE');

    console.log(`[Textract] Done — ${lines.length} lines, ${wordBlocks.length} words, ${formFieldCount} form fields`);
    console.log(`[Textract] Extracted Key-Value Pairs JSON:\n${JSON.stringify(keyValues, null, 2)}`);

    if (applicationId) {
      telemetry.record(applicationId, {
        service: 'TEXTRACT',
        model: 'aws-textract-analyze-document',
        agent: 'KYC',
        purpose: `Document analysis: ${filename}`,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        estimatedCostUsd,
        pages: pageCount,
        timestamp: new Date(),
      });
    }

    return {
      keyValues,
      text,
      pageCount,
      lineCount:      lines.length,
      wordCount:      wordBlocks.length,
      formFieldCount,
      latencyMs,
      estimatedCostUsd,
    };
  }

  // Cleanup moved here so it always runs after return is reached
  private cleanupTmpPng(tmpPng: string | null): void {
    if (tmpPng) {
      try { fs.unlinkSync(tmpPng); } catch { /* ignore */ }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private parseKeyValuePairs(blocks: Block[]): Record<string, string> {
    const result: Record<string, string> = {};
    const blockMap = new Map(blocks.map(b => [b.Id, b]));

    blocks
      .filter(b => b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes?.includes('KEY'))
      .forEach(keyBlock => {
        const keyText   = this.getBlockText(keyBlock, blockMap);
        const valueBlock = this.getValueBlock(keyBlock, blockMap);
        const valueText  = valueBlock ? this.getBlockText(valueBlock, blockMap) : '';
        if (keyText && valueText) result[keyText.trim()] = valueText.trim();
      });

    return result;
  }

  private getBlockText(block: Block, blockMap: Map<string | undefined, Block>): string {
    if (block.Text) return block.Text;
    const childIds = block.Relationships?.find(r => r.Type === 'CHILD')?.Ids ?? [];
    return childIds.map(id => blockMap.get(id)?.Text ?? '').join(' ');
  }

  private getValueBlock(keyBlock: Block, blockMap: Map<string | undefined, Block>): Block | undefined {
    const valueId = keyBlock.Relationships?.find(r => r.Type === 'VALUE')?.Ids?.[0];
    return valueId ? blockMap.get(valueId) : undefined;
  }

  private extractBusinessInfo(text: string, forms: Record<string, string>): Record<string, string> {
    const info: Record<string, string> = {};

    Object.entries(forms).forEach(([key, value]) => {
      const k = key.toLowerCase();
      if (k.includes('business name') || k.includes('company name')) info.businessName = value;
      // Only map taxId if the value looks like US EIN format (XX-XXXXXXX) — ignore Indian GST/other formats
      if ((k.includes('tax id') || k.includes('ein') || k.includes('tax identification')) && /^\d{2}-\d{7}$/.test(value.trim())) info.taxId = value.trim();
      if (k.includes('address')) info.address = value;
      if (k.includes('date') || k.includes('issued')) info.issueDate = value;
      // Skip "license valid until" / expiry date lines — only extract actual license/reg numbers
      if ((k.includes('license') || k.includes('registration number') || k.includes('reg no')) &&
          !k.includes('valid') && !k.includes('expir') && !k.includes('until')) info.licenseNumber = value;
      if (k.includes('phone') || k.includes('mobile') || k.includes('contact')) info.phone = value;
      if (k.includes('email')) info.email = value;
      if (k.includes('owner') || k.includes('proprietor')) info.ownerName = value;
    });

    // Regex fallbacks on raw text
    // Only extract taxId if it matches the expected XX-XXXXXXX (US EIN) format
    if (!info.taxId) {
      const m = text.match(/\b\d{2}-\d{7}\b/);
      if (m) info.taxId = m[0];
    }
    // Guard: discard taxId if it doesn't match XX-XXXXXXX (e.g. Indian GST won't compare)
    if (info.taxId && !/^\d{2}-\d{7}$/.test(info.taxId.trim())) {
      delete info.taxId;
    }
    if (!info.businessName) {
      const m = text.match(/Business\s+Name\s*:?\s*([^\n]+)/i);
      if (m) info.businessName = m[1].trim();
    }
    // Only extract license number if it looks like an alphanumeric code (not a date)
    if (!info.licenseNumber) {
      const m = text.match(/(?:Registration|License|Reg)\s+(?:Number|No\.?|#)\s*:?\s*([A-Z]{2,}[A-Z0-9-]{4,}|[A-Z0-9]{6,})/i);
      if (m) info.licenseNumber = m[1];
    }
    // Discard licenseNumber if it looks like a date
    if (info.licenseNumber && /\b(January|February|March|April|May|June|July|August|September|October|November|December|\d{4})\b/i.test(info.licenseNumber)) {
      delete info.licenseNumber;
    }
    if (!info.email) {
      const m = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
      if (m) info.email = m[0];
    }
    // Phone regex: require 10+ digits, exclude patterns that look like dates or certificate numbers
    if (!info.phone) {
      const m = text.match(/(?:\+\d{1,3}[-\s]?)?\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4,}/);
      if (m) info.phone = m[0].trim();
    }

    return info;
  }
}
