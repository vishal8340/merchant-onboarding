export enum OnboardingStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  PROCESSING = 'PROCESSING',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum AgentType {
  KYC = 'KYC',
  MCC = 'MCC',
  RISK = 'RISK'
}

export enum AgentStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  MANUAL_REVIEW_REQUIRED = 'MANUAL_REVIEW_REQUIRED'
}

export interface MerchantApplication {
  id: string;
  businessName: string;
  businessType: string;
  country: string;
  city?: string;
  taxId: string;
  contactEmail: string;
  contactPhone: string;
  website?: string;
  status: OnboardingStatus;
  agentResults: AgentResult[];
  documents: Document[];
  auditLog: AuditLogEntry[];
  textractResults?: TextractDocumentResult[];  // full Textract output per document
  createdAt: Date;
  updatedAt: Date;
}

export interface TextractDocumentResult {
  documentId: string;
  filename: string;
  documentType: string;
  text: string;
  lines: string[];
  words: string[];
  forms: Record<string, string>;
  tables: Array<Array<string[]>>;
  businessInfo: Record<string, string>;
  pageCount: number;
  blockCount: number;
  lineCount: number;
  wordCount: number;
  formFieldCount: number;
  tableCount: number;
  rawBlocks: any[];
  processedAt: Date;
}

export interface AgentResult {
  agentType: AgentType;
  status: AgentStatus;
  score?: number;
  findings: string[];
  requiresManualReview: boolean;
  completedAt?: Date;
  dialResponse?: any;
}

export interface Document {
  id: string;
  type: string;
  filename: string;
  uploadedAt: Date;
  verified: boolean;
  filepath?: string;  // Add this
  size?: number;      // Add this
  mimetype?: string;  // Add this
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  eventType: string;
  actor: string;
  details: Record<string, any>;
}

export interface CreateApplicationRequest {
  businessName: string;
  businessType: string;
  country: string;
  taxId: string;
  contactEmail: string;
  contactPhone: string;
  website?: string;
}