import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import multer from 'multer';

/**
 * Convert a PDF file to PNG using Ghostscript (first page only).
 * Saves PNG alongside the original file. Returns the PNG path, or null on failure.
 */
function convertUploadedPdfToPng(pdfPath: string): string | null {
  try {
    const base = pdfPath.replace(/\.pdf$/i, '');
    const outFile = `${base}-000001.png`;
    // Resolve gs from known Homebrew path if not on PATH
    const gsBin = ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', 'gs']
      .find(p => { try { execSync(`test -x ${p}`, { stdio: 'ignore' }); return true; } catch { return false; } }) ?? 'gs';
    execSync(`"${gsBin}" -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m -r200 -dFirstPage=1 -dLastPage=1 -sOutputFile="${base}-%06d.png" "${pdfPath}"`, { stdio: 'ignore' });
    if (fs.existsSync(outFile)) {
      console.log(`[Upload] PDF → PNG conversion done: ${path.basename(outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
      return outFile;
    }
    return null;
  } catch (e: any) {
    console.error(`[Upload] PDF → PNG conversion failed:`, e.message);
    return null;
  }
}
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { UserModel, seedUsers } from './models/User';
import http from 'http';
import {
  MerchantApplication,
  CreateApplicationRequest,
  OnboardingStatus,
  Document
} from './types';
import { OnboardingOrchestrator } from './orchestrator';
import { ApplicationStorage } from './storage';
import { EventBus } from './events/eventBus';
import { KYCAgent } from './agents/kycAgent';
import { MCCAgent } from './agents/mccAgent';
import { RiskAgent } from './agents/riskAgent';

import { TextractService } from './services/textractService';
import { telemetry } from './services/telemetryService';
import { callDialWithUsage, parseDialJson } from './services/dialService';

const textractService = new TextractService();


const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ============================================
// MONGODB CONNECTION
// ============================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/merchant-onboarding';

const JWT_SECRET = process.env.JWT_SECRET || 'merchant-portal-secret-key-change-in-production';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected successfully');
    console.log(`📊 Database: ${MONGODB_URI}`);
    await seedUsers();
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    console.log('⚠️  Continuing with in-memory storage...');
  });

// MongoDB Application Model (inline definition for simplicity)
const ApplicationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  businessName: { type: String, required: true },
  businessType: { type: String, required: true },
  country: { type: String, required: true },
  taxId: { type: String, required: true },
  contactEmail: { type: String, required: true },
  contactPhone: { type: String, required: true },
  website: String,
  status: { type: String, required: true },
  agentResults: [mongoose.Schema.Types.Mixed],
  documents: [mongoose.Schema.Types.Mixed],
  auditLog: [mongoose.Schema.Types.Mixed],
  textractResults: [mongoose.Schema.Types.Mixed],
  aiTelemetry: { type: mongoose.Schema.Types.Mixed, default: null },
  merchantId: { type: String },
  merchantPassword: { type: String }
}, {
  timestamps: true
});

const ApplicationModel = mongoose.model('Application', ApplicationSchema);

// ============================================
// FILE UPLOAD CONFIGURATION
// ============================================
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage_multer = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage_multer,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpg|jpeg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, JPEG, PNG files are allowed!'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// ============================================
// INITIALIZE EVENT BUS AND SERVICES
// ============================================
const eventBus = new EventBus(process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost');
const storage = new ApplicationStorage();
const orchestrator = new OnboardingOrchestrator(eventBus);

const kycAgent = new KYCAgent(eventBus);
const mccAgent = new MCCAgent(eventBus);
const riskAgent = new RiskAgent(eventBus);

// ============================================
// HELPER: generate merchant credentials
// ============================================
function generateMerchantCredentials(): { merchantId: string; merchantPassword: string } {
  const merchantId = 'MID-' + uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase();
  const pwChars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!';
  let merchantPassword = '';
  for (let i = 0; i < 12; i++) {
    merchantPassword += pwChars[Math.floor(Math.random() * pwChars.length)];
  }
  return { merchantId, merchantPassword };
}

// ============================================
// STARTUP FUNCTION
// ============================================
async function startServer() {
  try {
    await eventBus.connect();
    await orchestrator.initialize();
    
    if (eventBus.isConnected()) {
      await kycAgent.startListening();
      await mccAgent.startListening();
      await riskAgent.startListening();
      console.log('[Server] All agents are listening for events');
    } else {
      console.log('[Server] Running without event system (fallback mode)');
    }
  } catch (error) {
    console.error('[Server] Startup error:', error);
    console.log('[Server] Continuing in fallback mode...');
  }

  // ============================================
  // AUTH ROUTES
  // ============================================

  app.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const { userId, password } = req.body as { userId?: string; password?: string };
      if (!userId || !password) {
        return res.status(400).json({ error: 'userId and password are required' });
      }

      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database unavailable. Please try again shortly.' });
      }

      const user = await UserModel.findOne({ userId: userId.toLowerCase().trim() });
      if (!user) {
        return res.status(401).json({ error: 'User ID not found' });
      }

      const valid = await user.validatePassword(password);
      if (!valid) {
        return res.status(401).json({ error: 'Incorrect password' });
      }

      const token = jwt.sign(
        { userId: user.userId, role: user.role },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      return res.json({
        token,
        user: {
          userId: user.userId,
          name:   user.name,
          role:   user.role,
          email:  user.email,
        },
      });
    } catch (err) {
      console.error('[Auth] Login error:', err);
      return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  });

  // ============================================
  // API ROUTES
  // ============================================

  // ── Real-time duplicate check (no application created) ───────────────────
  // Called from the form as user progresses through steps.
  // Body: { businessName?, contactEmail?, contactPhone? }
  // Returns: { isDuplicate: false } | { isDuplicate: true, duplicateFields, message }
  app.post('/api/validate-merchant', async (req: Request, res: Response) => {
    try {
      const { businessName, contactEmail, contactPhone } = req.body as {
        businessName?: string; contactEmail?: string; contactPhone?: string;
      };
      const normalize = (s?: string) => (s || '').trim().toLowerCase();

      const orClauses: any[] = [];
      if (businessName?.trim()) {
        orClauses.push({ businessName: { $regex: `^${normalize(businessName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
      }
      if (contactEmail?.trim()) {
        orClauses.push({ contactEmail: { $regex: `^${normalize(contactEmail).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
      }
      if (contactPhone?.trim()) {
        orClauses.push({ contactPhone: normalize(contactPhone) });
      }

      if (orClauses.length === 0) return res.json({ isDuplicate: false });

      let duplicate: any = null;
      if (mongoose.connection.readyState === 1) {
        duplicate = await ApplicationModel.findOne({ status: OnboardingStatus.APPROVED, $or: orClauses }).lean();
      } else {
        const normBN = normalize(businessName); const normEM = normalize(contactEmail); const normPH = normalize(contactPhone);
        duplicate = storage.getAll().find(a =>
          a.status === OnboardingStatus.APPROVED && (
            (businessName?.trim() && normalize(a.businessName) === normBN) ||
            (contactEmail?.trim() && normalize(a.contactEmail) === normEM) ||
            (contactPhone?.trim() && normalize(a.contactPhone) === normPH)
          )
        ) ?? null;
      }

      if (!duplicate) return res.json({ isDuplicate: false });

      const duplicateFields: string[] = [];
      if (businessName?.trim() && normalize(duplicate.businessName) === normalize(businessName)) duplicateFields.push('businessName');
      if (contactEmail?.trim()  && normalize(duplicate.contactEmail)  === normalize(contactEmail))  duplicateFields.push('contactEmail');
      if (contactPhone?.trim()  && normalize(duplicate.contactPhone)  === normalize(contactPhone))  duplicateFields.push('contactPhone');

      const fieldLabels: Record<string,string> = { businessName: 'business name', contactEmail: 'email address', contactPhone: 'phone number' };
      return res.json({
        isDuplicate: true,
        duplicateFields,
        message: `An approved merchant account already exists with the same ${duplicateFields.map(f => fieldLabels[f]).join(', ')}. Please enter alternate details to proceed.`
      });
    } catch (err) {
      console.error('[ValidateMerchant]', err);
      res.status(500).json({ error: 'Validation check failed' });
    }
  });

  // Create application (MongoDB + In-Memory fallback)
  app.post('/api/applications', async (req: Request<{}, {}, CreateApplicationRequest>, res: Response) => {
    try {
      const { businessName, contactEmail, contactPhone } = req.body;

      // ── Duplicate merchant guard ──────────────────────────────────────────────
      // Check whether an APPROVED merchant already exists with the same
      // business name, email, or phone number. Any one match is sufficient.
      const normalize = (s: string) => (s || '').trim().toLowerCase();

      let duplicateFields: string[] = [];
      let existingApp: any = null;

      if (mongoose.connection.readyState === 1) {
        // MongoDB path
        const duplicate = await ApplicationModel.findOne({
          status: OnboardingStatus.APPROVED,
          $or: [
            { businessName: { $regex: `^${normalize(businessName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
            { contactEmail:  { $regex: `^${normalize(contactEmail).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,  $options: 'i' } },
            { contactPhone:  normalize(contactPhone) }
          ]
        }).lean();

        if (duplicate) {
          existingApp = duplicate;
          if (normalize(duplicate.businessName) === normalize(businessName)) duplicateFields.push('businessName');
          if (normalize(duplicate.contactEmail)  === normalize(contactEmail))  duplicateFields.push('contactEmail');
          if (normalize(duplicate.contactPhone)  === normalize(contactPhone))  duplicateFields.push('contactPhone');
        }
      } else {
        // In-memory path
        const all = storage.getAll();
        const dup = all.find(a =>
          a.status === OnboardingStatus.APPROVED && (
            normalize(a.businessName) === normalize(businessName) ||
            normalize(a.contactEmail)  === normalize(contactEmail)  ||
            normalize(a.contactPhone)  === normalize(contactPhone)
          )
        );
        if (dup) {
          existingApp = dup;
          if (normalize(dup.businessName) === normalize(businessName)) duplicateFields.push('businessName');
          if (normalize(dup.contactEmail)  === normalize(contactEmail))  duplicateFields.push('contactEmail');
          if (normalize(dup.contactPhone)  === normalize(contactPhone))  duplicateFields.push('contactPhone');
        }
      }

      if (existingApp) {
        console.warn(`[DuplicateCheck] Blocked duplicate application for "${businessName}" — matches existing approved merchant ${existingApp.id || existingApp._id} on fields: ${duplicateFields.join(', ')}`);
        return res.status(409).json({
          error: 'MERCHANT_ALREADY_ACTIVE',
          message: `An approved merchant account already exists with the same ${duplicateFields.map(f => ({ businessName: 'business name', contactEmail: 'email address', contactPhone: 'phone number' }[f])).join(', ')}. Please resubmit with alternate details.`,
          duplicateFields,
          existingMerchantId: existingApp.merchantId ?? null
        });
      }
      // ─────────────────────────────────────────────────────────────────────────

      const applicationData = {
        id: `app_${uuidv4()}`,
        ...req.body,
        status: OnboardingStatus.DRAFT,
        // merchantId and merchantPassword are NOT generated here;
        // they are only created when the application is APPROVED
        agentResults: [],
        documents: [],
        auditLog: [{
          id: `audit_${uuidv4()}`,
          timestamp: new Date(),
          eventType: 'APPLICATION_CREATED',
          actor: 'merchant',
          details: { businessName: req.body.businessName }
        }],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Try MongoDB first
      if (mongoose.connection.readyState === 1) {
        const application = new ApplicationModel(applicationData);
        await application.save();
        console.log(`✅ Application saved to MongoDB: ${application.id}`);
        return res.status(201).json(application);
      }
      
      // Fallback to in-memory
      const application: MerchantApplication = applicationData;
      storage.save(application);
      console.log(`⚠️  Application saved to memory: ${application.id}`);
      res.status(201).json(application);
    } catch (error) {
      console.error('Error creating application:', error);
      res.status(500).json({ error: 'Failed to create application' });
    }
  });
 
// ── Document-type validation labels (must match frontend documentTypes values) ──
const DOC_TYPE_LABELS: Record<string, string> = {
  BUSINESS_LICENSE:        'Business License',
  TAX_CERTIFICATE:         'Tax Certificate',
  BENEFICIAL_OWNERSHIP:    'Beneficial Ownership Declaration',
  BANK_STATEMENT:          'Bank Statement',
  ID_DOCUMENT:             'Government-issued ID / Passport',
  BANK_ACCOUNT_INFO:       'Bank Account Information',
  BUSINESS_WEBSITE:        'Website & Online Presence',
  BUSINESS_PLAN:           'Business Plan / Financial Projections',
  COMPLIANCE_DOCUMENTATION:'Compliance / Regulatory Documentation',
};

/**
 * Uses GPT-4o via DIAL to verify the uploaded file matches the declared document type.
 * Returns { match: true } or { match: false, detectedLabel, confidence }.
 * On DIAL unavailability it returns { match: true } (fail-open — don't block upload).
 */
async function validateDocumentType(
  filePath: string,
  declaredType: string
): Promise<{ match: boolean; detectedLabel?: string; detectedType?: string; confidence?: number }> {
  try {
    const expectedLabel = DOC_TYPE_LABELS[declaredType] ?? declaredType;

    // Read file as base64 for GPT-4o vision
    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a document classification expert for a financial institution. ' +
          'Given an image of a document, classify it into exactly ONE of these categories:\n' +
          Object.entries(DOC_TYPE_LABELS).map(([k, v]) => `- ${k}: ${v}`).join('\n') + '\n\n' +
          'Respond ONLY with valid JSON: { "detectedType": "<KEY>", "detectedLabel": "<label>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>" }. ' +
          'No markdown, no extra text.'
      },
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: `Classify this document. The user claims it is a "${expectedLabel}". Is that correct?` },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' } }
        ] as any
      }
    ];

    const result = await callDialWithUsage(messages, 200);
    const parsed = parseDialJson<{ detectedType: string; detectedLabel: string; confidence: number; reasoning: string }>(result.content);

    console.log(`[DocValidation] declared=${declaredType} detected=${parsed.detectedType} confidence=${parsed.confidence} — ${parsed.reasoning}`);

    if (parsed.detectedType === declaredType || parsed.confidence < 0.70) {
      return { match: true };
    }
    return { match: false, detectedLabel: parsed.detectedLabel, detectedType: parsed.detectedType, confidence: parsed.confidence };
  } catch (err: any) {
    // DIAL unavailable or parse error — fail open (don't block upload)
    console.warn(`[DocValidation] Skipping validation (DIAL unavailable): ${err.message}`);
    return { match: true };
  }
}

  app.post('/api/applications/:id/documents', upload.single('document'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // ── PDF → PNG conversion at upload time ────────────────────────────────
    // Textract synchronous API only supports JPEG/PNG/TIFF (not Chrome-generated PDFs).
    // Convert immediately so Textract always receives a PNG during submit.
    let finalPath = req.file.path;
    let finalMime = req.file.mimetype;
    let finalFilename = req.file.originalname;
    if (req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
      console.log(`[Upload] PDF detected — converting to PNG: ${req.file.originalname}`);
      const pngPath = convertUploadedPdfToPng(req.file.path);
      if (pngPath) {
        finalPath = pngPath;
        finalMime = 'image/png';
        finalFilename = req.file.originalname.replace(/\.pdf$/i, '.png');
      } else {
        console.warn(`[Upload] PDF conversion failed — keeping original PDF (Textract may fail)`);
      }
    }

    const document: any = {
      id: `doc_${uuidv4()}`,
      type: req.body.type || 'GENERAL',
      filename: finalFilename,
      originalFilename: req.file.originalname,
      uploadedAt: new Date(),
      verified: false,
      filepath: finalPath,
      size: req.file.size,
      mimetype: finalMime
    };

    // ── AI document-type validation ─────────────────────────────────────────
    const declaredType = req.body.type || 'GENERAL';
    const validation = await validateDocumentType(finalPath, declaredType);
    if (!validation.match) {
      // Clean up the uploaded file — no point keeping a mismatched doc
      try { fs.unlinkSync(req.file.path); if (finalPath !== req.file.path) fs.unlinkSync(finalPath); } catch {}
      return res.status(422).json({
        error: `Document mismatch: you selected "${DOC_TYPE_LABELS[declaredType] ?? declaredType}" but the uploaded file appears to be a "${validation.detectedLabel}". Please upload the correct document.`,
        detectedType: validation.detectedType,
        detectedLabel: validation.detectedLabel,
        expectedType: declaredType,
        expectedLabel: DOC_TYPE_LABELS[declaredType] ?? declaredType,
      });
    }

    if (mongoose.connection.readyState === 1) {
      const application = await ApplicationModel.findOne({ id: req.params.id });
      if (!application) return res.status(404).json({ error: 'Application not found' });

      // Replace existing document of the same type (re-upload) — filter out old, push new
      const filtered = (application.documents as any[]).filter((d: any) => d.type !== document.type);
      filtered.push(document);
      (application as any).documents = filtered;
      application.markModified('documents');
      application.auditLog.push({
        id: `audit_${uuidv4()}`,
        timestamp: new Date(),
        eventType: 'DOCUMENT_UPLOADED',
        actor: 'merchant',
        details: { documentType: document.type, documentId: document.id, filename: req.file.originalname, size: req.file.size }
      });

      await application.save();
      console.log(`✅ Document stored (pending Textract): ${document.id} — ${req.file.originalname}`);
      return res.json(application);
    }

    // Fallback to in-memory
    const application = storage.get(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    application.documents = application.documents.filter((d: any) => d.type !== document.type);
    application.documents.push(document);
    storage.save(application);
    res.json(application);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// View Textract results
app.get('/api/documents/:docId/textract', async (req: Request, res: Response) => {
  try {
    const applications = await ApplicationModel.find();
    
    for (const app of applications) {
      const doc = app.documents.find((d: any) => d.id === req.params.docId);
      if (doc) {
        return res.json({
          documentId:  doc.id,
          filename:    doc.filename,
          uploadedAt:  doc.uploadedAt,
          size:        doc.size,
          mimetype:    doc.mimetype,
          textract:    doc.textract ?? { processed: false, reason: 'No Textract data for this document' }
        });
      }
    }

    res.status(404).json({ error: 'Document not found' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get Textract results' });
  }
});
  

  // ── Helper: check whether an application conflicts with an already-APPROVED merchant ──
  async function checkDuplicateForApp(appId: string): Promise<{ isDuplicate: boolean; conflictingFields: string[]; message: string }> {
    const normalize = (s: string) => (s || '').trim().toLowerCase();

    let app: any = null;
    if (mongoose.connection.readyState === 1) {
      app = await ApplicationModel.findOne({ id: appId }).lean();
    } else {
      app = storage.get(appId);
    }
    if (!app) return { isDuplicate: false, conflictingFields: [], message: '' };

    const { businessName, contactEmail, contactPhone } = app;

    let conflictingFields: string[] = [];
    let duplicate: any = null;

    if (mongoose.connection.readyState === 1) {
      duplicate = await ApplicationModel.findOne({
        id: { $ne: appId },
        status: OnboardingStatus.APPROVED,
        $or: [
          { businessName: { $regex: `^${normalize(businessName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
          { contactEmail:  { $regex: `^${normalize(contactEmail).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,  $options: 'i' } },
          { contactPhone:  normalize(contactPhone) }
        ]
      }).lean();
    } else {
      duplicate = storage.getAll().find(a =>
        a.id !== appId && a.status === OnboardingStatus.APPROVED && (
          normalize(a.businessName) === normalize(businessName) ||
          normalize(a.contactEmail)  === normalize(contactEmail)  ||
          normalize(a.contactPhone)  === normalize(contactPhone)
        )
      ) ?? null;
    }

    if (duplicate) {
      if (normalize(duplicate.businessName) === normalize(businessName)) conflictingFields.push('businessName');
      if (normalize(duplicate.contactEmail)  === normalize(contactEmail))  conflictingFields.push('contactEmail');
      if (normalize(duplicate.contactPhone)  === normalize(contactPhone))  conflictingFields.push('contactPhone');
      const fieldLabels = conflictingFields.map(f => ({ businessName: 'business name', contactEmail: 'email address', contactPhone: 'phone number' } as Record<string,string>)[f]);
      return {
        isDuplicate: true,
        conflictingFields,
        message: `An approved merchant account already exists with the same ${fieldLabels.join(', ')}. Please go back and resubmit with alternate details.`
      };
    }
    return { isDuplicate: false, conflictingFields: [], message: '' };
  }

  // Duplicate check for a specific application (called from DocumentUpload page)
  app.get('/api/applications/:id/duplicate-check', async (req: Request, res: Response) => {
    try {
      const result = await checkDuplicateForApp(req.params.id);
      res.json(result);
    } catch (error) {
      console.error('[DuplicateCheck]', error);
      res.status(500).json({ error: 'Duplicate check failed' });
    }
  });

  // Submit application — runs Textract on all documents, stores results, dispatches to agents
  app.post('/api/applications/:id/submit', async (req: Request, res: Response) => {
    try {
      // ── Final duplicate guard before submission ─────────────────────────────
      const dupCheck = await checkDuplicateForApp(req.params.id);
      if (dupCheck.isDuplicate) {
        console.warn(`[Submit] Blocked submission for ${req.params.id} — ${dupCheck.message}`);
        return res.status(409).json({
          error: 'MERCHANT_ALREADY_ACTIVE',
          message: dupCheck.message,
          conflictingFields: dupCheck.conflictingFields
        });
      }
      // ───────────────────────────────────────────────────────────────────────

      if (mongoose.connection.readyState === 1) {
        const application = await ApplicationModel.findOne({ id: req.params.id });
        if (!application) return res.status(404).json({ error: 'Application not found' });
        if (application.status !== OnboardingStatus.DRAFT) return res.status(400).json({ error: 'Application already submitted' });

        // ── TEXTRACT: process every uploaded document ────────────────────────
        console.log(`\n${'='.repeat(60)}`);
        console.log(`[Textract] Starting full document analysis for ${application.id}`);
        console.log(`[Textract] Documents to process: ${application.documents.length}`);
        console.log('='.repeat(60));

        const textractResults: any[] = [];

        for (const doc of application.documents as any[]) {
          if (!doc.filepath || !require('fs').existsSync(doc.filepath)) {
            console.log(`[Textract] Skipping ${doc.filename} — file not found on disk`);
            continue;
          }
          try {
            console.log(`\n[Textract] ── Processing: ${doc.filename} (${doc.type}) ──`);
            const result = await textractService.analyzeDocument(doc.filepath, doc.filename, application.id as string);

            // Log extracted KV pairs as JSON
            console.log(`\n[Textract] ══ KEY-VALUE PAIRS JSON: ${doc.filename} ══`);
            console.log(JSON.stringify(result.keyValues, null, 2));
            console.log(`[Textract] ══ END: ${doc.filename} (${result.lineCount} lines, ${result.wordCount} words, ${result.formFieldCount} form fields) ══\n`);

            // Store only slim KV data on the document record
            doc.textract = {
              keyValues:      result.keyValues,
              pageCount:      result.pageCount,
              lineCount:      result.lineCount,
              wordCount:      result.wordCount,
              formFieldCount: result.formFieldCount,
              processedAt:    new Date()
            };

            const entry = {
              documentId:    doc.id,
              filename:      doc.filename,
              documentType:  doc.type,
              keyValues:     result.keyValues,
              text:          result.text,
              pageCount:     result.pageCount,
              lineCount:     result.lineCount,
              wordCount:     result.wordCount,
              formFieldCount: result.formFieldCount,
              processedAt:   new Date()
            };
            textractResults.push(entry);
          } catch (err) {
            console.error(`[Textract] Failed for ${doc.filename}:`, err);
          }
        }

        // Save Textract results to MongoDB
        application.set('textractResults', textractResults);
        application.markModified('documents'); // doc.textract was mutated in-place
        application.markModified('textractResults');

        // Merge all keyValues across documents for agents
        const mergedKeyValues: Record<string, string> = {};
        textractResults.forEach(r => Object.assign(mergedKeyValues, r.keyValues));

        console.log(`\n[Textract] ══ MERGED KEY-VALUES ACROSS ALL DOCS ══`);
        console.log(JSON.stringify(mergedKeyValues, null, 2));
        console.log(`[Textract] Total textract results stored: ${textractResults.length}`);
        console.log('='.repeat(60) + '\n');

        application.status = OnboardingStatus.SUBMITTED;
        application.auditLog.push({
          id: `audit_${uuidv4()}`,
          timestamp: new Date(),
          eventType: 'TEXTRACT_COMPLETED',
          actor: 'system',
          details: {
            documentsProcessed: textractResults.length,
            mergedKeyValues,
            summary: textractResults.map(r => ({
              filename: r.filename,
              type: r.documentType,
              lines: r.lineCount,
              formFields: r.formFieldCount
            }))
          }
        });
        await application.save();

        // Build enriched application object for agents (includes textractResults)
        const appObj = application.toObject();
        const appForOrchestrator = { ...appObj, website: appObj.website ?? undefined, textractResults };

        orchestrator.processApplication(appForOrchestrator as any, async (updatedApp) => {
          // Persist telemetry alongside the final result
          const appTelemetry = telemetry.getForApplication(application.id as string);
          const updateFields: Record<string, any> = {
            status: updatedApp.status,
            agentResults: updatedApp.agentResults,
            auditLog: updatedApp.auditLog,
            aiTelemetry: appTelemetry
          };
          // Generate merchantId + password only on auto-APPROVED
          if (updatedApp.status === OnboardingStatus.APPROVED) {
            const creds = generateMerchantCredentials();
            updateFields.merchantId = creds.merchantId;
            updateFields.merchantPassword = creds.merchantPassword;
            console.log(`[Server] Auto-APPROVED — credentials generated for ${updatedApp.id}: ${creds.merchantId}`);
          }
          await ApplicationModel.findOneAndUpdate(
            { id: updatedApp.id },
            updateFields,
            { new: true }
          );
          console.log(`[Server] Persisted final status ${updatedApp.status} for ${updatedApp.id}`);
        }).catch(err => console.error('[Server] Processing error:', err));

        return res.json({
          application,
          keyValueData: textractResults.map(r => ({
            documentId:    r.documentId,
            filename:      r.filename,
            documentType:  r.documentType,
            keyValues:     r.keyValues,
            lineCount:     r.lineCount,
            wordCount:     r.wordCount,
            formFieldCount: r.formFieldCount,
            processedAt:   r.processedAt
          }))
        });
      }

      // Fallback to in-memory
      const application = storage.get(req.params.id);
      if (!application) return res.status(404).json({ error: 'Application not found' });
      if (application.status !== OnboardingStatus.DRAFT) return res.status(400).json({ error: 'Application already submitted' });

      application.status = OnboardingStatus.SUBMITTED;
      storage.save(application);

      orchestrator.processApplication(application, async (updatedApp) => {
        storage.save(updatedApp);
        console.log(`[Server] Persisted final status ${updatedApp.status} for ${updatedApp.id}`);
      }).catch(err => console.error('[Server] Processing error:', err));

      res.json(application);
    } catch (error) {
      res.status(500).json({ error: 'Failed to submit application' });
    }
  });

  // Get application by ID
  app.get('/api/applications/:id', async (req: Request, res: Response) => {
    try {
      // Try MongoDB first
      if (mongoose.connection.readyState === 1) {
        const application = await ApplicationModel.findOne({ id: req.params.id });
        if (application) {
          return res.json(application);
        }
      }

      // Fallback to in-memory
      const application = storage.get(req.params.id) || orchestrator.getApplication(req.params.id);
      if (!application) {
        return res.status(404).json({ error: 'Application not found' });
      }
      res.json(application);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get application' });
    }
  });

  // Get all applications
  app.get('/api/applications', async (req: Request, res: Response) => {
    try {
      // Try MongoDB first
      if (mongoose.connection.readyState === 1) {
        const applications = await ApplicationModel.find();
        return res.json(applications);
      }

      // Fallback to in-memory
      res.json(storage.getAll());
    } catch (error) {
      res.status(500).json({ error: 'Failed to get applications' });
    }
  });

  // Get pending reviews
  app.get('/api/applications/review/pending', async (req: Request, res: Response) => {
    try {
      // Try MongoDB first
      if (mongoose.connection.readyState === 1) {
        const applications = await ApplicationModel.find({ status: 'MANUAL_REVIEW' });
        return res.json(applications);
      }

      // Fallback to in-memory
      res.json(storage.getPendingReview());
    } catch (error) {
      res.status(500).json({ error: 'Failed to get pending reviews' });
    }
  });

  // Manual review decision
  app.post('/api/applications/:id/review', async (req: Request, res: Response) => {
    try {
      const isApprove = req.body.decision === 'APPROVE';

      // Try MongoDB first
      if (mongoose.connection.readyState === 1) {
        const application = await ApplicationModel.findOne({ id: req.params.id });
        if (!application) {
          return res.status(404).json({ error: 'Application not found' });
        }

        application.status = isApprove
          ? OnboardingStatus.APPROVED
          : OnboardingStatus.REJECTED;

        // Generate merchantId + password only on manual APPROVE
        if (isApprove) {
          const creds = generateMerchantCredentials();
          (application as any).merchantId = creds.merchantId;
          (application as any).merchantPassword = creds.merchantPassword;
          console.log(`[Server] Manual APPROVED — credentials generated for ${application.id}: ${creds.merchantId}`);
        }

        application.auditLog.push({
          id: `audit_${uuidv4()}`,
          timestamp: new Date(),
          eventType: 'MANUAL_REVIEW_DECISION',
          actor: req.body.reviewedBy,
          details: {
            decision: req.body.decision,
            comments: req.body.comments
          }
        });

        await application.save();
        return res.json(application);
      }

      // Fallback to in-memory
      const application = storage.get(req.params.id);
      if (!application) {
        return res.status(404).json({ error: 'Application not found' });
      }

      application.status = isApprove
        ? OnboardingStatus.APPROVED
        : OnboardingStatus.REJECTED;

      // Generate merchantId + password only on manual APPROVE
      if (isApprove) {
        const creds = generateMerchantCredentials();
        (application as any).merchantId = creds.merchantId;
        (application as any).merchantPassword = creds.merchantPassword;
      }

      application.auditLog.push({
        id: `audit_${uuidv4()}`,
        timestamp: new Date(),
        eventType: 'MANUAL_REVIEW_DECISION',
        actor: req.body.reviewedBy,
        details: {
          decision: req.body.decision,
          comments: req.body.comments
        }
      });

      storage.save(application);
      res.json(application);
    } catch (error) {
      res.status(500).json({ error: 'Failed to process review' });
    }
  });

  // ============================================
  // MERCHANT CREDENTIALS ENDPOINT
  // ============================================

  // Returns existing credentials for an APPROVED application.
  // Credentials are auto-generated at approval time; this endpoint is read-only.
  app.post('/api/applications/:id/credentials', async (req: Request, res: Response) => {
    try {
      const appId = req.params.id;

      if (mongoose.connection.readyState === 1) {
        const existing = await ApplicationModel.findOne({ id: appId });
        if (!existing) return res.status(404).json({ error: 'Application not found' });
        if (existing.status !== OnboardingStatus.APPROVED) {
          return res.status(400).json({ error: 'Credentials are only available for APPROVED applications' });
        }
        const merchantId = (existing as any).merchantId;
        const merchantPassword = (existing as any).merchantPassword;
        if (!merchantId || !merchantPassword) {
          return res.status(404).json({ error: 'Credentials not yet generated for this application' });
        }
        return res.json({ merchantId, merchantPassword });
      }

      // Fallback: in-memory
      const application = storage.get(appId) || orchestrator.getApplication(appId);
      if (!application) return res.status(404).json({ error: 'Application not found' });
      if (application.status !== OnboardingStatus.APPROVED) {
        return res.status(400).json({ error: 'Credentials are only available for APPROVED applications' });
      }
      const merchantId = (application as any).merchantId;
      const merchantPassword = (application as any).merchantPassword;
      if (!merchantId || !merchantPassword) {
        return res.status(404).json({ error: 'Credentials not yet generated for this application' });
      }
      return res.json({ merchantId, merchantPassword });
    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve credentials' });
    }
  });

  // ============================================
  // ADMIN ENDPOINTS
  // ============================================

  // Admin stats
  app.get('/api/admin/stats', async (req: Request, res: Response) => {
    try {
      let allApps: any[] = [];

      // Try MongoDB first
      if (mongoose.connection.readyState === 1) {
        allApps = await ApplicationModel.find();
      } else {
        allApps = storage.getAll();
      }
      
      res.json({
        timestamp: new Date().toISOString(),
        storage: {
          type: mongoose.connection.readyState === 1 ? 'MONGODB' : 'IN_MEMORY',
          totalApplications: allApps.length,
          byStatus: {
            DRAFT: allApps.filter(a => a.status === 'DRAFT').length,
            SUBMITTED: allApps.filter(a => a.status === 'SUBMITTED').length,
            PROCESSING: allApps.filter(a => a.status === 'PROCESSING').length,
            MANUAL_REVIEW: allApps.filter(a => a.status === 'MANUAL_REVIEW').length,
            APPROVED: allApps.filter(a => a.status === 'APPROVED').length,
            REJECTED: allApps.filter(a => a.status === 'REJECTED').length,
          },
          totalDocuments: allApps.reduce((sum, app) => sum + app.documents.length, 0),
          eventBusConnected: eventBus.isConnected()
        },
        applications: allApps.map(app => ({
          id: app.id,
          businessName: app.businessName,
          status: app.status,
          documentsCount: app.documents.length,
          createdAt: app.createdAt
        }))
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  // MongoDB specific stats
  app.get('/api/admin/mongodb', async (req: Request, res: Response) => {
    if (mongoose.connection.readyState !== 1) {
      return res.json({
        connected: false,
        message: 'MongoDB not connected'
      });
    }

    try {
      const count = await ApplicationModel.countDocuments();
      const applications = await ApplicationModel.find().limit(10);
      
      res.json({
        connected: true,
        database: mongoose.connection.name,
        host: mongoose.connection.host,
        totalApplications: count,
        recentApplications: applications.map(app => ({
          id: app.id,
          businessName: app.businessName,
          status: app.status,
          createdAt: app.createdAt
        }))
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to query MongoDB' });
    }
  });

  // View uploaded files
  app.get('/api/admin/files', (req: Request, res: Response) => {
    if (!fs.existsSync(uploadsDir)) {
      return res.json({ 
        directory: uploadsDir,
        exists: false,
        files: [] 
      });
    }
    
    const files = fs.readdirSync(uploadsDir).map(filename => {
      const filepath = path.join(uploadsDir, filename);
      const stats = fs.statSync(filepath);
      
      return {
        filename,
        size: `${(stats.size / 1024).toFixed(2)} KB`,
        created: stats.birthtime,
        modified: stats.mtime
      };
    });
    
    res.json({ 
      directory: uploadsDir,
      exists: true,
      count: files.length,
      files 
    });
  });

  // ============================================
  // RETRY RISK ASSESSMENT
  // ============================================

  // Re-run only the Risk agent for an already-processed application
  app.post('/api/applications/:id/retry-risk', async (req: Request, res: Response) => {
    try {
      let appObj: any;

      if (mongoose.connection.readyState === 1) {
        const doc = await ApplicationModel.findOne({ id: req.params.id });
        if (!doc) return res.status(404).json({ error: 'Application not found' });
        appObj = doc.toObject();
      } else {
        appObj = storage.get(req.params.id) || orchestrator.getApplication(req.params.id);
        if (!appObj) return res.status(404).json({ error: 'Application not found' });
      }

      console.log(`[Retry Risk] Re-assessing risk for ${appObj.id}`);

      const newRiskResult = await riskAgent.assess(appObj as any);

      // Replace only the RISK agent result in agentResults array
      const agentResults: any[] = appObj.agentResults || [];
      const riskIdx = agentResults.findIndex((r: any) => r.agentType === 'RISK');
      if (riskIdx >= 0) {
        agentResults[riskIdx] = newRiskResult;
      } else {
        agentResults.push(newRiskResult);
      }

      // Persist
      if (mongoose.connection.readyState === 1) {
        await ApplicationModel.findOneAndUpdate(
          { id: appObj.id },
          { agentResults },
          { new: true }
        );
      } else {
        appObj.agentResults = agentResults;
        storage.save(appObj);
      }

      console.log(`[Retry Risk] Done — status=${newRiskResult.status} score=${newRiskResult.score}`);
      return res.json({ success: true, riskResult: newRiskResult });
    } catch (error) {
      console.error('[Retry Risk] Error:', error);
      res.status(500).json({ error: 'Failed to retry risk assessment' });
    }
  });

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date(),
      eventBus: eventBus.isConnected() ? 'connected' : 'disconnected',
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
  });

  // ============================================
  // TELEMETRY ENDPOINTS
  // ============================================

  // GET /api/telemetry — aggregate across all tracked applications (in-memory + MongoDB)
  app.get('/api/telemetry', async (req: Request, res: Response) => {
    try {
      // 1. In-memory (current session, freshest data)
      const inMemorySummaries = telemetry.getAllSummaries();
      const inMemoryIds = new Set(inMemorySummaries.map(s => s.applicationId));

      // 2. MongoDB — load all apps that have persisted aiTelemetry
      let dbApps: any[] = [];
      if (mongoose.connection.readyState === 1) {
        dbApps = await ApplicationModel.find(
          { aiTelemetry: { $ne: null } },
          { id: 1, businessName: 1, status: 1, aiTelemetry: 1 }
        ).lean();
      }

      // 3. Build enriched in-memory summaries (add businessName/status from DB)
      const inMemoryEnriched = inMemorySummaries.map(s => {
        const dbDoc = dbApps.find((a: any) => a.id === s.applicationId);
        return {
          ...s,
          businessName: dbDoc?.businessName ?? s.applicationId,
          status: dbDoc?.status ?? 'PROCESSING',
          source: 'live',
        };
      });

      // 4. DB-only apps (not in memory — survived a restart)
      const dbOnly = dbApps
        .filter((a: any) => !inMemoryIds.has(a.id) && a.aiTelemetry)
        .map((a: any) => ({
          applicationId: a.id,
          businessName: a.businessName,
          status: a.status,
          source: 'mongodb',
          calls: a.aiTelemetry.calls ?? [],
          totals: a.aiTelemetry.totals ?? {
            totalCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
            totalLatencyMs: 0, totalCostUsd: 0, textractPages: 0,
            textractCostUsd: 0, llmCostUsd: 0, errorCount: 0,
          },
          collectedAt: a.aiTelemetry.collectedAt ?? new Date(),
        }));

      // 5. Merge and compute grand totals
      const allSummaries = [...inMemoryEnriched, ...dbOnly];

      const grand = allSummaries.reduce(
        (acc, s) => {
          acc.totalApplications++;
          acc.totalCalls        += s.totals.totalCalls        ?? 0;
          acc.totalTokens       += s.totals.totalTokens       ?? 0;
          acc.promptTokens      += s.totals.promptTokens      ?? 0;
          acc.completionTokens  += s.totals.completionTokens  ?? 0;
          acc.totalLatencyMs    += s.totals.totalLatencyMs    ?? 0;
          acc.totalCostUsd      += s.totals.totalCostUsd      ?? 0;
          acc.textractPages     += s.totals.textractPages     ?? 0;
          acc.textractCostUsd   += s.totals.textractCostUsd   ?? 0;
          acc.llmCostUsd        += s.totals.llmCostUsd        ?? 0;
          acc.errorCount        += s.totals.errorCount        ?? 0;
          return acc;
        },
        { totalApplications: 0, totalCalls: 0, totalTokens: 0, promptTokens: 0,
          completionTokens: 0, totalLatencyMs: 0, totalCostUsd: 0,
          textractPages: 0, textractCostUsd: 0, llmCostUsd: 0, errorCount: 0 }
      );

      res.json({ grand, applications: allSummaries, collectedAt: new Date() });
    } catch (err) {
      console.error('[Telemetry] GET /api/telemetry error:', err);
      res.status(500).json({ error: 'Failed to get telemetry' });
    }
  });

  // GET /api/telemetry/report — single HTML page showing ALL telemetry (open in browser)
  app.get('/api/telemetry/report', async (req: Request, res: Response) => {
    try {
      // Gather in-memory data
      const summaries = telemetry.getAllSummaries();

      // Also pull persisted telemetry from MongoDB for apps no longer in memory
      let dbApps: any[] = [];
      if (mongoose.connection.readyState === 1) {
        dbApps = await ApplicationModel.find({ aiTelemetry: { $ne: null } }, {
          id: 1, businessName: 1, status: 1, aiTelemetry: 1
        }).lean();
      }

      // Merge: prefer in-memory (fresher), fall back to DB
      const inMemoryIds = new Set(summaries.map(s => s.applicationId));
      const dbOnly = dbApps.filter((a: any) => !inMemoryIds.has(a.id) && a.aiTelemetry);

      const allApps = [
        ...summaries.map(s => ({
          businessName: dbApps.find((a: any) => a.id === s.applicationId)?.businessName ?? s.applicationId,
          status: dbApps.find((a: any) => a.id === s.applicationId)?.status ?? '—',
          source: 'live',
          ...s
        })),
        ...dbOnly.map((a: any) => ({
          applicationId: a.id,
          businessName: a.businessName,
          status: a.status,
          source: 'mongodb',
          ...a.aiTelemetry
        }))
      ];

      const grandTotals = allApps.reduce((acc, app) => {
        const t = app.totals ?? {};
        acc.totalCalls       += t.totalCalls       ?? 0;
        acc.totalTokens      += t.totalTokens      ?? 0;
        acc.totalCostUsd     += t.totalCostUsd     ?? 0;
        acc.textractCostUsd  += t.textractCostUsd  ?? 0;
        acc.llmCostUsd       += t.llmCostUsd       ?? 0;
        acc.totalLatencyMs   += t.totalLatencyMs   ?? 0;
        acc.errorCount       += t.errorCount       ?? 0;
        return acc;
      }, { totalCalls: 0, totalTokens: 0, totalCostUsd: 0, textractCostUsd: 0, llmCostUsd: 0, totalLatencyMs: 0, errorCount: 0 });

      const serviceColor: Record<string, string> = {
        DIAL: '#6366f1', TEXTRACT: '#f59e0b', MCC_ANALYSER: '#10b981',
        RISK_SCORING: '#ef4444', AI_PROXY_GPT4O: '#8b5cf6', default: '#64748b'
      };
      const agentColor: Record<string, string> = { KYC: '#3b82f6', MCC: '#10b981', RISK: '#f59e0b', default: '#64748b' };

      const rows = allApps.flatMap((app: any) =>
        (app.calls ?? []).map((c: any) => {
          const est = c.tokensEstimated;
          const tilde = est ? '<span title="estimated (API did not return usage)" style="color:#94a3b8;font-size:10px">~</span>' : '';
          let promptCell: string;
          let completionCell: string;
          let totalCell: string;
          if (c.pages != null && c.service === 'TEXTRACT') {
            promptCell = `${c.pages} pg`;
            completionCell = '—';
            totalCell = '—';
          } else if (c.totalTokens > 0) {
            promptCell     = `${tilde}${c.promptTokens.toLocaleString()}`;
            completionCell = `${tilde}${c.completionTokens.toLocaleString()}`;
            totalCell      = `${tilde}${c.totalTokens.toLocaleString()}`;
          } else {
            promptCell = completionCell = totalCell = '—';
          }
          return `
          <tr>
            <td>${app.businessName ?? app.applicationId}</td>
            <td><span class="badge" style="background:${agentColor[c.agent] ?? agentColor.default}">${c.agent}</span></td>
            <td><span class="badge" style="background:${serviceColor[c.service] ?? serviceColor.default}">${c.service}</span></td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.purpose}">${c.purpose}</td>
            <td>${c.model}</td>
            <td class="num">${promptCell}</td>
            <td class="num">${completionCell}</td>
            <td class="num">${totalCell}</td>
            <td class="num">${c.latencyMs}ms</td>
            <td class="num cost">$${(c.estimatedCostUsd ?? 0).toFixed(5)}</td>
            <td>${c.error ? `<span style="color:#ef4444">⚠ ${c.error.slice(0,40)}</span>` : '<span style="color:#10b981">✓</span>'}</td>
            <td style="color:#64748b;font-size:11px">${new Date(c.timestamp).toLocaleTimeString()}</td>
          </tr>`;
        }).join('')
      ).join('');

      const appSummaryRows = allApps.map((app: any) => {
        const t = app.totals ?? {};
        return `<tr>
          <td>${app.businessName ?? app.applicationId}</td>
          <td style="font-size:11px;color:#64748b">${app.applicationId}</td>
          <td><span class="badge" style="background:${app.status==='APPROVED'?'#10b981':app.status==='REJECTED'?'#ef4444':'#6366f1'}">${app.status}</span></td>
          <td class="num">${t.totalCalls ?? 0}</td>
          <td class="num">${(t.totalTokens ?? 0).toLocaleString()}</td>
          <td class="num">${t.textractPages ?? 0} pg</td>
          <td class="num">${Math.round((t.totalLatencyMs ?? 0)/1000)}s</td>
          <td class="num cost">$${(t.totalCostUsd ?? 0).toFixed(4)}</td>
          <td class="num" style="color:#f59e0b">$${(t.textractCostUsd ?? 0).toFixed(4)}</td>
          <td class="num" style="color:#6366f1">$${(t.llmCostUsd ?? 0).toFixed(4)}</td>
          <td style="color:${(t.errorCount??0)>0?'#ef4444':'#10b981'}">${t.errorCount ?? 0}</td>
          <td><span style="font-size:10px;color:${app.source==='live'?'#10b981':'#64748b'}">${app.source}</span></td>
        </tr>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Telemetry Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}
  h1{font-size:22px;font-weight:700;margin-bottom:4px}
  .subtitle{color:#64748b;font-size:13px;margin-bottom:24px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:28px}
  .card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px}
  .card .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
  .card .value{font-size:24px;font-weight:700}
  .card .sub{font-size:11px;color:#64748b;margin-top:2px}
  h2{font-size:15px;font-weight:600;margin-bottom:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
  .section{margin-bottom:32px}
  table{width:100%;border-collapse:collapse;font-size:12px;background:#1e293b;border-radius:10px;overflow:hidden}
  th{background:#0f172a;color:#64748b;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.05em;padding:10px 12px;text-align:left}
  td{padding:9px 12px;border-top:1px solid #1e293b;vertical-align:middle}
  tr:hover td{background:#263248}
  .num{text-align:right;font-variant-numeric:tabular-nums;font-family:'JetBrains Mono',monospace}
  .cost{color:#fbbf24;font-weight:600}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;color:#fff}
  .refresh{position:fixed;top:20px;right:24px;background:#6366f1;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px}
  .tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;background:#334155;color:#94a3b8;margin-left:4px}
</style>
</head>
<body>
<button class="refresh" onclick="location.reload()">↺ Refresh</button>
<h1>AI Telemetry Dashboard</h1>
<p class="subtitle">Real token usage · Actual latency · Cost estimates — ${new Date().toLocaleString()}</p>

<div class="cards">
  <div class="card">
    <div class="label">Applications</div>
    <div class="value">${allApps.length}</div>
    <div class="sub">${allApps.filter((a:any)=>a.source==='live').length} live · ${dbOnly.length} from DB</div>
  </div>
  <div class="card">
    <div class="label">Total AI Calls</div>
    <div class="value">${grandTotals.totalCalls}</div>
    <div class="sub">${grandTotals.errorCount} errors</div>
  </div>
  <div class="card">
    <div class="label">Total Tokens</div>
    <div class="value">${grandTotals.totalTokens.toLocaleString()}</div>
    <div class="sub">all LLM calls</div>
  </div>
  <div class="card">
    <div class="label">Total Cost</div>
    <div class="value" style="color:#fbbf24">$${grandTotals.totalCostUsd.toFixed(4)}</div>
    <div class="sub">LLM + Textract</div>
  </div>
  <div class="card">
    <div class="label">LLM Cost</div>
    <div class="value" style="color:#6366f1">$${grandTotals.llmCostUsd.toFixed(4)}</div>
    <div class="sub">DIAL / AI Proxy</div>
  </div>
  <div class="card">
    <div class="label">Textract Cost</div>
    <div class="value" style="color:#f59e0b">$${grandTotals.textractCostUsd.toFixed(4)}</div>
    <div class="sub">AWS FORMS+TABLES</div>
  </div>
  <div class="card">
    <div class="label">Avg Latency</div>
    <div class="value">${grandTotals.totalCalls > 0 ? Math.round(grandTotals.totalLatencyMs / grandTotals.totalCalls) : 0}ms</div>
    <div class="sub">per AI call</div>
  </div>
</div>

<div class="section">
  <h2>Per-Application Summary</h2>
  <table>
    <thead><tr>
      <th>Business</th><th>App ID</th><th>Status</th><th>Calls</th>
      <th>Tokens</th><th>Pages</th><th>Latency</th>
      <th>Total $</th><th>Textract $</th><th>LLM $</th><th>Errors</th><th>Source</th>
    </tr></thead>
    <tbody>${appSummaryRows || '<tr><td colspan="12" style="text-align:center;color:#475569;padding:24px">No data yet — submit an application to see telemetry</td></tr>'}</tbody>
  </table>
</div>

<div class="section">
  <h2>All AI Calls (raw)</h2>
  <p style="font-size:11px;color:#64748b;margin-bottom:10px">
    <span style="color:#94a3b8;font-weight:700">~</span> = estimated (DIAL proxy did not return usage data; calculated as 1 token ≈ 4 chars) &nbsp;·&nbsp;
    <span style="color:#f59e0b">—</span> = not applicable (external Java service / Textract)
  </p>
  <table>
    <thead><tr>
      <th>Application</th><th>Agent</th><th>Service</th><th>Purpose</th><th>Model</th>
      <th>Prompt tkns</th><th>Completion tkns</th><th>Total tkns</th>
      <th>Latency</th><th>Cost</th><th>Status</th><th>Time</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="12" style="text-align:center;color:#475569;padding:24px">No calls recorded yet</td></tr>'}</tbody>
  </table>
</div>

<script>
  // Auto-refresh every 10s when there are live apps being processed
  const liveCount = ${allApps.filter((a:any)=>a.source==='live').length};
  if (liveCount > 0) setTimeout(() => location.reload(), 10000);
</script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate telemetry report' });
    }
  });

  // GET /api/telemetry/:id — telemetry for a single application (in-memory + MongoDB fallback)
  app.get('/api/telemetry/:id', async (req: Request, res: Response) => {
    try {
      const inMemory = telemetry.getForApplication(req.params.id);
      if (inMemory.calls.length > 0) {
        return res.json(inMemory);
      }
      // Try MongoDB stored telemetry
      if (mongoose.connection.readyState === 1) {
        const doc = await ApplicationModel.findOne({ id: req.params.id }, { aiTelemetry: 1 });
        if (doc && (doc as any).aiTelemetry) {
          return res.json((doc as any).aiTelemetry);
        }
      }
      res.json({ applicationId: req.params.id, calls: [], totals: {}, collectedAt: new Date() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get telemetry' });
    }
  });

  // Serve uploaded files
  app.get('/api/documents/:filename', (req: Request, res: Response) => {
    const filepath = path.join(uploadsDir, req.params.filename);
    if (fs.existsSync(filepath)) {
      res.sendFile(filepath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // ============================================
  // START SERVER
  // ============================================
  app.listen(PORT, () => {
    console.log(`🚀 Merchant Onboarding API running on http://localhost:${PORT}`);
    console.log(`📊 Event Bus Status: ${eventBus.isConnected() ? '✅ Connected' : '⚠️  Fallback Mode'}`);
    console.log(`💾 MongoDB Status: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '⚠️  In-Memory Mode'}`);
    console.log(`\n📍 Admin Endpoints:`);
    console.log(`   - Stats: http://localhost:${PORT}/api/admin/stats`);
    console.log(`   - MongoDB: http://localhost:${PORT}/api/admin/mongodb`);
    console.log(`   - Files: http://localhost:${PORT}/api/admin/files`);
    console.log(`   - Health: http://localhost:${PORT}/health`);

    // Check companion Java services after a short delay to allow them to boot
    setTimeout(() => checkCompanionServices(), 8000);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down gracefully...');
    await eventBus.close();
    await mongoose.connection.close();
    process.exit(0);
  });
}

// ============================================
// COMPANION SERVICE HEALTH CHECK
// ============================================
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(res.statusCode !== undefined);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function checkCompanionServices() {
  const services = [
    { name: 'MCC Analyser',        port: 8091, url: 'http://localhost:8091' },
    { name: 'Smart Risk Scoring',   port: 8080, url: 'http://localhost:8080' },
  ];

  console.log('\n🔍 Checking companion Java services...');
  for (const svc of services) {
    const up = await checkPort(svc.port);
    if (up) {
      console.log(`   ✅ ${svc.name} is UP   → ${svc.url}`);
    } else {
      console.log(`   ❌ ${svc.name} is DOWN  (port ${svc.port} not responding)`);
    }
  }
}

startServer();