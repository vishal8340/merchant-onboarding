import axios from 'axios';
import { MerchantApplication } from '../types';

const API_BASE_URL = 'http://localhost:3001/api';
const AUTH_BASE_URL = 'http://localhost:3001';

export type UserRole = 'ADMIN' | 'USER' | 'APP_MANAGER';

export interface LoginResponse {
  token: string;
  user: {
    userId: string;
    name: string;
    role: UserRole;
    email: string;
  };
}

export const auth = {
  login: async (userId: string, password: string): Promise<LoginResponse> => {
    const response = await axios.post(`${AUTH_BASE_URL}/auth/login`, { userId, password });
    return response.data;
  },
};

export const api = {
  createApplication: async (data: any): Promise<MerchantApplication> => {
    const response = await axios.post(`${API_BASE_URL}/applications`, data);
    return response.data;
  },

  uploadDocument: async (applicationId: string, document: any): Promise<MerchantApplication> => {
    const response = await axios.post(
      `${API_BASE_URL}/applications/${applicationId}/documents`,
      document
    );
    return response.data;
  },

  submitApplication: async (applicationId: string): Promise<MerchantApplication> => {
    const response = await axios.post(
      `${API_BASE_URL}/applications/${applicationId}/submit`
    );
    return response.data;
  },

  getApplication: async (applicationId: string): Promise<MerchantApplication> => {
    const response = await axios.get(`${API_BASE_URL}/applications/${applicationId}`);
    return response.data;
  },

  getAllApplications: async (): Promise<MerchantApplication[]> => {
    const response = await axios.get(`${API_BASE_URL}/applications`);
    return response.data;
  },

  getPendingReviews: async (): Promise<MerchantApplication[]> => {
    const response = await axios.get(`${API_BASE_URL}/applications/review/pending`);
    return response.data;
  },

  submitReviewDecision: async (
    applicationId: string,
    decision: 'APPROVE' | 'REJECT',
    comments: string,
    reviewedBy: string
  ): Promise<MerchantApplication> => {
    const response = await axios.post(
      `${API_BASE_URL}/applications/${applicationId}/review`,
      { applicationId, decision, comments, reviewedBy }
    );
    return response.data;
  },

  generateCredentials: async (applicationId: string): Promise<{ merchantId: string; merchantPassword: string }> => {
    const response = await axios.post(`${API_BASE_URL}/applications/${applicationId}/credentials`);
    return response.data;
  },

  retryRiskAssessment: async (applicationId: string): Promise<{ success: boolean; riskResult: any }> => {
    const response = await axios.post(`${API_BASE_URL}/applications/${applicationId}/retry-risk`);
    return response.data;
  },

  checkDuplicate: async (applicationId: string): Promise<{ isDuplicate: boolean; conflictingFields: string[]; message: string }> => {
    const response = await axios.get(`${API_BASE_URL}/applications/${applicationId}/duplicate-check`);
    return response.data;
  },

  validateMerchant: async (fields: { businessName?: string; contactEmail?: string; contactPhone?: string }): Promise<{ isDuplicate: boolean; duplicateFields: string[]; message: string }> => {
    const response = await axios.post(`${AUTH_BASE_URL}/api/validate-merchant`, fields);
    return response.data;
  }
};

export const telemetryApi = {
  getAll: async (): Promise<any> => {
    const response = await axios.get(`${API_BASE_URL}/telemetry`);
    return response.data;
  },
  getForApp: async (applicationId: string): Promise<any> => {
    const response = await axios.get(`${API_BASE_URL}/telemetry/${applicationId}`);
    return response.data;
  },
};