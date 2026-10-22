import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'ADMIN' | 'USER' | 'APP_MANAGER';

export interface IUser extends mongoose.Document {
  userId: string;
  name: string;
  role: UserRole;
  email: string;
  passwordHash: string;
  validatePassword(password: string): Promise<boolean>;
}

const UserSchema = new mongoose.Schema<IUser>(
  {
    userId:       { type: String, required: true, unique: true, lowercase: true, trim: true },
    name:         { type: String, required: true },
    role:         { type: String, enum: ['ADMIN', 'USER', 'APP_MANAGER'], required: true },
    email:        { type: String, required: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

UserSchema.methods.validatePassword = async function (password: string): Promise<boolean> {
  return bcrypt.compare(password, this.passwordHash);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);

// ── Seed default users once at startup ───────────────────────────────────────
const DEFAULT_USERS: Array<{ userId: string; name: string; role: UserRole; email: string; password: string }> = [
  { userId: 'bfsi_admin',   name: 'Admin User',          role: 'ADMIN',       email: 'admin@merchantportal.com',   password: process.env.DEMO_ADMIN_PASSWORD ?? '' },
  { userId: 'app_manager',  name: 'Application Manager', role: 'APP_MANAGER', email: 'appmanager@merchantportal.com', password: process.env.DEMO_APP_MANAGER_PASSWORD ?? '' },
  { userId: 'user_demo',    name: 'Raj Enterprises',     role: 'USER',        email: 'raj@rajenterprises.in',      password: process.env.DEMO_USER_PASSWORD ?? '' },
  { userId: 'priya_retail', name: 'Priya Retail Co.',    role: 'USER',        email: 'priya@priyaretail.com',      password: process.env.DEMO_PRIYA_PASSWORD ?? '' },
  { userId: 'kumar_foods',  name: 'Kumar Foods Ltd.',    role: 'USER',        email: 'kumar@kumarfoods.in',        password: process.env.DEMO_KUMAR_PASSWORD ?? '' },
];

export async function seedUsers(): Promise<void> {
  for (const u of DEFAULT_USERS) {
    if (!u.password) continue;
    const passwordHash = await bcrypt.hash(u.password, 12);
    await UserModel.findOneAndUpdate(
      { userId: u.userId },
      { userId: u.userId, name: u.name, role: u.role, email: u.email, passwordHash },
      { upsert: true, new: true }
    );
    console.log(`✅ Upserted user: ${u.userId} (${u.role})`);
  }
}
