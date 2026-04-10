export interface PasswordEntry {
  id: string;
  key: string;
  password: string;
  description: string;
  source?: 'imported';
  createdAt: Date;
  updatedAt: Date;
}
