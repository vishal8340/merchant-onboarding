import { MerchantApplication } from './types';

export class ApplicationStorage {
  private applications: Map<string, MerchantApplication> = new Map();

  save(application: MerchantApplication): void {
    application.updatedAt = new Date();
    this.applications.set(application.id, application);
  }

  get(id: string): MerchantApplication | undefined {
    return this.applications.get(id);
  }

  getAll(): MerchantApplication[] {
    return Array.from(this.applications.values());
  }

  getPendingReview(): MerchantApplication[] {
    return this.getAll().filter(app => app.status === 'MANUAL_REVIEW');
  }
}