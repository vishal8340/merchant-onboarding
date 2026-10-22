import mongoose, { Schema, Document } from 'mongoose';

export interface IApplication extends Document {
  id: string;
  businessName: string;
  businessType: string;
  country: string;
  taxId: string;
  contactEmail: string;
  contactPhone: string;
  website?: string;
  status: string;
  agentResults: any[];
  documents: any[];
  auditLog: any[];
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationSchema: Schema = new Schema({
  id: { type: String, required: true, unique: true },
  businessName: { type: String, required: true },
  businessType: { type: String, required: true },
  country: { type: String, required: true },
  taxId: { type: String, required: true },
  contactEmail: { type: String, required: true },
  contactPhone: { type: String, required: true },
  website: String,
  status: { type: String, required: true },
  agentResults: [Schema.Types.Mixed],
  documents: [Schema.Types.Mixed],
  auditLog: [Schema.Types.Mixed]
}, {
  timestamps: true
});

export default mongoose.model<IApplication>('Application', ApplicationSchema);