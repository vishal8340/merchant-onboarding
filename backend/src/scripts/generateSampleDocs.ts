/**
 * Generates Business License and Tax Certificate PDFs for "Raj Retail Store"
 * with fields that pass all risk scoring checks:
 *   - MCC: 5311 Department Store (high AI confidence)
 *   - Chargeback Rate: 0.20% (below Visa VDMP 0.9% threshold)
 *   - Compliance Score: 92/100 (suppresses AML flag)
 *   - No prior fraud incidents (suppresses fraud_flag)
 *   - Established 2015 (11 years — removes bust-out age risk)
 *
 * Run:  npx ts-node src/scripts/generateSampleDocs.ts
 * Output: ~/Downloads/sample-docs/business-license.pdf
 *         ~/Downloads/sample-docs/tax-certificate.pdf
 */

import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const TMP = '/tmp';
const OUT = `${process.env.HOME}/Downloads/sample-docs`;

function drawBorder(doc: PDFKit.PDFDocument) {
  doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke('#1a3a5c');
  doc.rect(26, 26, doc.page.width - 52, doc.page.height - 52).stroke('#c8a440');
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.fontSize(22).fillColor('#1a3a5c').font('Helvetica-Bold').text(title, 50, 60, { align: 'center' });
  doc.fontSize(12).fillColor('#444').font('Helvetica').text(subtitle, 50, 90, { align: 'center' });
  doc.moveTo(50, 112).lineTo(doc.page.width - 50, 112).stroke('#c8a440');
}

function field(doc: PDFKit.PDFDocument, label: string, value: string, y: number) {
  doc.fontSize(10).fillColor('#555').font('Helvetica-Bold').text(label + ':', 60, y);
  doc.fontSize(10).fillColor('#111').font('Helvetica').text(value, 220, y);
}

function renderFields(doc: PDFKit.PDFDocument, fields: [string, string][], startY: number): number {
  let y = startY;
  for (const [label, value] of fields) {
    const lines = value.split('\n');
    field(doc, label, lines[0], y);
    for (let i = 1; i < lines.length; i++) {
      doc.fontSize(10).fillColor('#111').font('Helvetica').text(lines[i], 220, y + i * 14);
    }
    y += lines.length * 14 + 6;
    if (y > 700) { doc.addPage(); drawBorder(doc); y = 60; }
  }
  return y;
}

// ─── Business License ─────────────────────────────────────────────────────────
function generateBusinessLicense() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const outPath = path.join(TMP, 'business-license.pdf');
  doc.pipe(fs.createWriteStream(outPath));

  drawBorder(doc);
  header(doc, 'BUSINESS LICENSE', 'Department of Commerce & Trade Registration Authority');
  doc.fontSize(13).fillColor('#1a3a5c').font('Helvetica-Bold')
    .text('CERTIFICATE OF BUSINESS REGISTRATION', 50, 130, { align: 'center' });

  const fields: [string, string][] = [
    ['License Number',          'BL-2015-RRS-048291'],
    ['Business Name',           'Raj Retail Store'],
    ['Business Type',           'Department Store — General Merchandise Retail'],
    ['MCC Category',            'Retail — Department Store (MCC 5311)'],
    ['Products Sold',
     'Clothing & Apparel, Footwear, Household Goods, Electronics,\n' +
     'Kitchen Appliances, Stationery, Toys & Games, Personal Care Products'],
    ['Business Description',
     'Raj Retail Store is a duly registered department store engaged in\n' +
     'retailing a wide variety of consumer merchandise across multiple\n' +
     'product categories to the general public.'],
    ['Owner / Proprietor',      'Mr. Rajendra Kumar'],
    ['Date of Incorporation',   '05 February 2015'],
    ['Registration Date',       '05 February 2015'],
    ['License Issue Date',      '10 February 2015'],
    ['License Expiry Date',     '09 February 2028'],
    ['Years in Business',       '11 years (established 2015)'],
    ['Business Address',        'Plot 12, Market Area, Commercial Zone, City — 400001'],
    ['Location',                'Plot 12, Market Area'],
    ['State / Province',        'Maharashtra'],
    ['Country',                 'India'],
    ['Contact Email',           'raj.retailstore@example.com'],
    ['Phone Number',            '+91-98765-43210'],
    ['Website',                 'www.rajretailstore.com'],
    ['Tax Identification No.',  'TIN-MH-2015-0048291'],
    ['GST Registration No.',    'GSTIN: 27AABCR1234Q1Z5'],
    ['Annual Turnover (Est.)',   'INR 12,00,000 — 15,00,000 per annum'],
    ['No. of Employees',        '12'],
    ['Chargeback Rate',         '0.20% (well within Visa VDMP 0.9% threshold)'],
    ['Compliance Score',        '92 / 100'],
    ['Compliance Rating',       'EXCELLENT — AML Compliant, KYC Compliant, PCI DSS Compliant'],
    ['Fraud History',           'No prior fraud incidents — clean fraud record maintained since 2015'],
    ['Criminal Record',         'No criminal proceedings or regulatory violations on record'],
    ['No Outstanding Dues',     'NIL — no outstanding dues or pending obligations'],
    ['License Status',          'ACTIVE — IN GOOD STANDING'],
    ['Accreditation',           'Certified under National Retail Federation standards'],
  ];

  let y = renderFields(doc, fields, 168);
  y += 20;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke('#c8a440');
  y += 14;
  doc.fontSize(9).fillColor('#333').font('Helvetica-Oblique').text(
    'This certificate confirms that Raj Retail Store is a licensed and duly registered department store. ' +
    'The business is in good standing with all AML, KYC, and PCI compliance requirements. ' +
    'There are no prior fraud incidents, no criminal proceedings, and no outstanding regulatory violations. ' +
    'Chargeback rate of 0.20% is well within the Visa VDMP 0.9% threshold. ' +
    'This license is valid and in force for the period specified above.',
    50, y, { width: doc.page.width - 100 }
  );
  doc.end();
  console.log('Generated:', outPath);
}

// ─── Tax Certificate ──────────────────────────────────────────────────────────
function generateTaxCertificate() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const outPath = path.join(TMP, 'tax-certificate.pdf');
  doc.pipe(fs.createWriteStream(outPath));

  drawBorder(doc);
  header(doc, 'TAX COMPLIANCE CERTIFICATE', 'Revenue & Taxation Authority — Commercial Division');
  doc.fontSize(13).fillColor('#1a3a5c').font('Helvetica-Bold')
    .text('CERTIFICATE OF TAX CLEARANCE & COMPLIANCE', 50, 130, { align: 'center' });

  const fields: [string, string][] = [
    ['Certificate Number',         'TC-2026-MH-RRS-00482'],
    ['Issue Date',                 '01 April 2026'],
    ['Valid Until',                '31 March 2027'],
    ['Taxpayer Name',              'Raj Retail Store'],
    ['Business Type',              'Department Store — General Merchandise Retail'],
    ['MCC Category',               'Retail — Department Store (MCC 5311)'],
    ['Business Description',
     'Department store retailing clothing, footwear, electronics, household\n' +
     'goods, personal care products, stationery, toys, and kitchen appliances.'],
    ['Tax Identification No.',     'TIN-MH-2015-0048291'],
    ['GST Registration No.',       'GSTIN: 27AABCR1234Q1Z5'],
    ['PAN Number',                 'AABCR1234Q'],
    ['Date of Incorporation',      '05 February 2015'],
    ['Registration Date',          '05 February 2015'],
    ['Years in Business',          '11 years (established 2015)'],
    ['Business Address',           'Plot 12, Market Area, Commercial Zone, City — 400001'],
    ['Location',                   'Plot 12, Market Area'],
    ['Annual Turnover (FY25)',      'INR 14,40,000'],
    ['Monthly Transaction Volume', 'INR 1,20,000 (approx. USD 1,440)'],
    ['Average Transaction Size',   'INR 500 (approx. USD 6)'],
    ['Chargeback Rate',            '0.20% (well within Visa VDMP 0.9% threshold)'],
    ['Compliance Score',           '92 / 100'],
    ['Compliance Rating',          'EXCELLENT'],
    ['AML Compliance',             'AML Compliant — no suspicious transaction reports filed'],
    ['KYC Compliance',             'KYC Compliant — owner identity fully verified'],
    ['PCI DSS Status',             'PCI DSS Compliant — certified'],
    ['GST Payment Status',         'Current — all GST returns filed and paid'],
    ['Income Tax Status',          'Current — IT returns filed for FY 2023-24 and FY 2024-25'],
    ['Outstanding Tax Dues',       'NIL — no outstanding dues'],
    ['Tax Filing Status',          'UP TO DATE — all returns filed'],
    ['Tax Clearance Status',       'CLEARED — Certificate of Tax Clearance granted'],
    ['Fraud History',              'No prior fraud incidents — clear record maintained since 2015'],
    ['Dispute / Fraud Flag',       'NONE — no fraud flag, no suspicious activity reports'],
    ['Criminal Record',            'No criminal proceedings, no regulatory violations on record'],
    ['Good Standing',              'This business is in GOOD STANDING with the tax authority'],
    ['Certified By',               'Deputy Commissioner, Revenue & Taxation Authority'],
    ['Certification Remarks',
     'This merchant has no outstanding dues, no criminal tax proceedings,\n' +
     'no prior fraud incidents, and no record of fraudulent filings.\n' +
     'Compliance score of 92/100 reflects excellent regulatory standing.\n' +
     'Chargeback rate of 0.20% is well below card-network thresholds.\n' +
     'All AML, KYC, and PCI obligations are current and certified.'],
  ];

  let y = renderFields(doc, fields, 168);
  y += 20;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke('#c8a440');
  y += 14;
  doc.fontSize(9).fillColor('#333').font('Helvetica-Oblique').text(
    'This Tax Compliance Certificate confirms that Raj Retail Store has fulfilled all tax obligations. ' +
    'The business has no prior fraud incidents, a chargeback rate of 0.20% well below the Visa VDMP threshold, ' +
    'and a compliance score of 92/100. The merchant is AML Compliant, KYC Compliant, and PCI DSS Certified ' +
    'with no outstanding dues or regulatory violations.',
    50, y, { width: doc.page.width - 100 }
  );
  doc.end();
  console.log('Generated:', outPath);
}

generateBusinessLicense();
generateTaxCertificate();

// Wait briefly for streams to flush, then copy
setTimeout(() => {
  execSync(`cp "${TMP}/business-license.pdf" "${OUT}/business-license.pdf"`);
  execSync(`cp "${TMP}/tax-certificate.pdf" "${OUT}/tax-certificate.pdf"`);
  console.log(`Copied -> ${OUT}/business-license.pdf`);
  console.log(`Copied -> ${OUT}/tax-certificate.pdf`);
}, 1500);
