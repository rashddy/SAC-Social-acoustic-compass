export type AccountRecord = {
  userID: number;
  username: string;
  passwordHash: string;
  wrappedDek: string;
  failedAttempts: number;
  lockedUntil: number;
  biometricEnabled: boolean;
  biometricCheck: string;
  role: string;
};

export type AccountDraft = Omit<AccountRecord, 'userID'>;

export interface AccountStore {
  /** An account that can sign in, if one exists. */
  findAccount(): Promise<AccountRecord | null>;
  findByUsername(username: string): Promise<AccountRecord | null>;
  findById(userID: number): Promise<AccountRecord | null>;
  /** A leftover row from before password setup, with no hash yet. */
  findPasswordless(): Promise<AccountRecord | null>;
  insertAccount(draft: AccountDraft): Promise<AccountRecord>;
  updateAccount(userID: number, patch: Partial<AccountDraft>): Promise<void>;
  eraseAccount(userID: number): Promise<void>;
}

export interface TranscriptStore {
  writeCiphertext(value: string): Promise<void>;
  /** Raw stored values, including ciphertext, for inspection and decryption. */
  readStored(): Promise<string[]>;
  clear(): Promise<void>;
}

export interface DeviceKeyStore {
  /**
   * Hardware keystore key, or null when this install has no secure-store
   * native module. Null still allows password-wrapped encryption. A corrupt
   * stored key throws instead of returning null.
   */
  getDeviceKey(): Promise<Uint8Array | null>;
}

export type AuthResult = {
  ok: boolean;
  message?: string;
  retryAt?: number;
  locked?: boolean;
};
