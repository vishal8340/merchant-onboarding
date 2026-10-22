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
  createdAt: string;
  updatedAt: string;
  merchantId?: string;
  merchantPassword?: string;
}

export interface AgentResult {
  agentType: AgentType;
  status: AgentStatus;
  score?: number;
  findings: string[];
  requiresManualReview: boolean;
  completedAt?: string;
  dialResponse?: any;
}
export interface Document {
  id: string;
  type: string;
  filename: string;
  uploadedAt: string;
  verified: boolean;
  filepath?: string;
  size?: number;
  mimetype?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: string;
  actor: string;
  details: Record<string, any>;
}