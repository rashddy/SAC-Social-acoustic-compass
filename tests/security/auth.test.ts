import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { randomBytes } from '@noble/hashes/utils.js';

import { bleConnectionGrantsAccess, decideDatabaseAccess } from '../../src/services/auth/authorization';
import {
  INACTIVITY_MS,
  PRODUCTION_ARGON2,
  RECENT_AUTH_MS,
  TEST_ARGON2,
} from '../../src/services/auth/config';
import { createAuthController } from '../../src/services/auth/controller';
import { openTranscript, sealTranscript } from '../../src/services/auth/fieldCipher';
import { createPasswordRecord, usernamesMatch, verifyPassword } from '../../src/services/auth/password';
import { createSessionVault } from '../../src/services/auth/sessionVault';
import type { AccountDraft, AccountRecord, AccountStore, DeviceKeyStore, TranscriptStore } from '../../src/services/auth/types';

const PASSWORD = 'compass-passphrase';
const USERNAME = 'Amina';
const TRANSCRIPT = 'the speaker said hello from the left';

function memoryAccounts(): AccountStore & { snapshot(): AccountRecord | null } {
  const accounts: AccountRecord[] = [];
  let nextId = 1;
  const copy = (account: AccountRecord | undefined) => (account ? { ...account } : null);
  return {
    async findAccount() {
      return copy(accounts.find((row) => row.passwordHash) ?? accounts[0]);
    },
    async findByUsername(username: string) {
      return copy(accounts.find((row) => usernamesMatch(row.username, username)));
    },
    async findById(userID: number) {
      return copy(accounts.find((row) => row.userID === userID));
    },
    async findPasswordless() {
      return copy(accounts.find((row) => !row.passwordHash));
    },
    async insertAccount(draft: AccountDraft) {
      const account = { ...draft, userID: nextId, role: 'user' as const };
      nextId += 1;
      accounts.push(account);
      return { ...account };
    },
    async updateAccount(userID, patch) {
      const index = accounts.findIndex((row) => row.userID === userID);
      if (index < 0) return;
      accounts[index] = { ...accounts[index], ...patch, role: 'user' };
    },
    async eraseAccount(userID: number) {
      const index = accounts.findIndex((row) => row.userID === userID);
      if (index >= 0) accounts.splice(index, 1);
    },
    snapshot() {
      return copy(accounts[0]);
    },
  };
}

function memoryTranscripts(): TranscriptStore & { dump(): string[] } {
  const rows: string[] = [];
  return {
    async writeCiphertext(value) {
      rows.push(value);
    },
    async readStored() {
      return [...rows];
    },
    async clear() {
      rows.length = 0;
    },
    dump() {
      return [...rows];
    },
  };
}

function memoryKeys(): DeviceKeyStore & { mode: 'ok' | 'missing' | 'wrong' } {
  const key = randomBytes(32);
  return {
    mode: 'ok',
    async getDeviceKey() {
      if (this.mode === 'missing') throw new Error('encryption key unavailable');
      if (this.mode === 'wrong') return randomBytes(32);
      return key;
    },
  };
}

function harness() {
  const accounts = memoryAccounts();
  const transcripts = memoryTranscripts();
  const keys = memoryKeys();
  const events: string[] = [];
  let now = 1_700_000_000_000;
  const controller = createAuthController({
    accounts,
    transcripts,
    keys,
    clock: () => now,
    argon: TEST_ARGON2,
    audit: (event) => events.push(event),
  });
  return {
    accounts,
    transcripts,
    keys,
    events,
    controller,
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

test('production Argon2id stays fast enough to sign in on the phone', () => {
  assert.equal(PRODUCTION_ARGON2.m, 256);
  assert.equal(PRODUCTION_ARGON2.t, 1);
  assert.equal(PRODUCTION_ARGON2.p, 1);
  assert.equal(PRODUCTION_ARGON2.dkLen, 32);
});

test('production Argon2id hash verifies and does not store the password', async () => {
  const started = Date.now();
  const record = await createPasswordRecord(PASSWORD, PRODUCTION_ARGON2);
  const hashMs = Date.now() - started;
  const verified = await verifyPassword(PASSWORD, record.encoded);
  assert.equal(verified.ok, true);
  assert.equal(record.encoded.includes(PASSWORD), false);
  assert.equal(record.encoded.startsWith('sac-argon2id'), true);
  assert.ok(hashMs > 0);
});

test('password hashes use a unique salt and omit the password', async () => {
  const first = await createPasswordRecord(PASSWORD, TEST_ARGON2);
  const second = await createPasswordRecord(PASSWORD, TEST_ARGON2);
  assert.notEqual(first.encoded, second.encoded);
  assert.equal(first.encoded.includes(PASSWORD), false);
  assert.equal(second.encoded.includes(PASSWORD), false);
  assert.equal(first.encoded.startsWith('sac-argon2id$'), true);
});

test('correct password permits access and a wrong password is rejected', async () => {
  const { controller, advance, now } = harness();
  const created = await controller.createAccount(USERNAME, PASSWORD);
  assert.equal(created.ok, true);
  assert.equal(controller.isUnlocked(), true);
  controller.logout();
  assert.equal(controller.isUnlocked(), false);

  const wrong = await controller.login(USERNAME, 'not-the-password');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.message, 'Incorrect username or password.');
  assert.equal(controller.isUnlocked(), false);
  if (wrong.retryAt) advance(wrong.retryAt - now() + 1);

  const right = await controller.login(USERNAME, PASSWORD);
  assert.equal(right.ok, true);
  assert.equal(controller.isUnlocked(), true);
});

test('a heavy saved password check stops instead of freezing the phone', async () => {
  const { controller, accounts } = harness();
  assert.equal((await controller.createAccount(USERNAME, PASSWORD)).ok, true);
  controller.logout();
  const stored = accounts.snapshot();
  assert.ok(stored);
  await accounts.updateAccount(stored.userID, {
    passwordHash: stored.passwordHash.replace(/m=\d+,t=\d+/, 'm=19456,t=2'),
  });
  const started = Date.now();
  const result = await controller.login(USERNAME, PASSWORD);
  assert.ok(Date.now() - started < 500);
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /too heavy/i);
  assert.equal(controller.isUnlocked(), false);
});

test('another person can create an account on the same phone', async () => {
  const { controller } = harness();
  assert.equal((await controller.createAccount(USERNAME, PASSWORD)).ok, true);
  assert.equal(await controller.saveTranscript(TRANSCRIPT), 'ok');
  controller.logout();
  const second = await controller.createAccount('Luis', 'another-passphrase');
  assert.equal(second.ok, true);
  assert.equal(controller.session.getUsername(), 'Luis');
  controller.logout();

  const duplicate = await controller.createAccount('amina', 'another-passphrase');
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message ?? '', /already on this phone/);

  const first = await controller.login(USERNAME, PASSWORD);
  assert.equal(first.ok, true);
  assert.equal(controller.session.getUsername(), USERNAME);
  controller.logout();
  const other = await controller.login('Luis', 'another-passphrase');
  assert.equal(other.ok, true);
  assert.equal(controller.session.getUsername(), 'Luis');
  assert.equal(await controller.readTranscripts(), 'crypto');
});

test('stored account data contains no plaintext password and is not an admin role', async () => {
  const { controller, accounts } = harness();
  await controller.createAccount(USERNAME, PASSWORD);
  const stored = accounts.snapshot();
  assert.ok(stored);
  const dump = JSON.stringify(stored);
  assert.equal(dump.includes(PASSWORD), false);
  assert.equal(stored?.role, 'user');
  assert.equal(stored?.passwordHash.includes(PASSWORD), false);
  assert.equal(stored?.wrappedDek.includes(PASSWORD), false);
});

test('repeated failures lock the account and a new controller keeps that lock', async () => {
  const accounts = memoryAccounts();
  const transcripts = memoryTranscripts();
  const keys = memoryKeys();
  let now = 1_700_000_000_000;
  const first = createAuthController({
    accounts,
    transcripts,
    keys,
    clock: () => now,
    argon: TEST_ARGON2,
  });
  await first.createAccount(USERNAME, PASSWORD);
  first.logout();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await first.login(USERNAME, 'wrong-password');
    assert.equal(result.ok, false);
    assert.equal(result.locked ?? false, false);
    now = (result.retryAt ?? now) + 1;
  }

  const locked = await first.login(USERNAME, 'still-wrong');
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  assert.match(locked.message ?? '', /Too many attempts/);
  assert.equal((locked.message ?? '').includes(USERNAME), false);
  assert.equal((locked.message ?? '').toLowerCase().includes('not found'), false);

  const restarted = createAuthController({
    accounts,
    transcripts,
    keys,
    clock: () => now,
    argon: TEST_ARGON2,
  });
  assert.equal(restarted.isUnlocked(), false);
  const stillLocked = await restarted.login(USERNAME, PASSWORD);
  assert.equal(stillLocked.ok, false);
  assert.equal(stillLocked.locked, true);
  const otherName = await restarted.login('someone-else', PASSWORD);
  assert.equal(otherName.ok, false);
  assert.equal(otherName.locked ?? false, false);
  assert.equal(otherName.message, 'Incorrect username or password.');

  now = (stillLocked.retryAt ?? now) + 1;
  const afterWait = await restarted.login(USERNAME, PASSWORD);
  assert.equal(afterWait.ok, true);
});

test('logout and a fresh process block protected data', async () => {
  const { controller, transcripts } = harness();
  await controller.createAccount(USERNAME, PASSWORD);
  assert.equal(await controller.saveTranscript(TRANSCRIPT), 'ok');
  const visible = await controller.readTranscripts();
  assert.deepEqual(visible, [TRANSCRIPT]);

  controller.logout();
  assert.equal(controller.isUnlocked(), false);
  assert.equal(await controller.readTranscripts(), 'unauthorized');
  assert.equal(await controller.saveTranscript(TRANSCRIPT), 'unauthorized');
  assert.equal(await controller.deleteTranscripts(), 'unauthorized');
  assert.equal(transcripts.dump().some((row) => row.includes(TRANSCRIPT)), false);

  const restarted = createAuthController({
    accounts: memoryAccounts(),
    transcripts,
    keys: memoryKeys(),
    argon: TEST_ARGON2,
  });
  assert.equal(restarted.isUnlocked(), false);
  assert.equal(await restarted.readTranscripts(), 'unauthorized');
});

test('inactivity and backgrounding lock the session', async () => {
  const { controller, advance } = harness();
  await controller.createAccount(USERNAME, PASSWORD);
  advance(INACTIVITY_MS);
  assert.equal(controller.expireIfIdle(), true);
  assert.equal(controller.isUnlocked(), false);

  await controller.login(USERNAME, PASSWORD);
  controller.noteAppState('background');
  advance(INACTIVITY_MS);
  assert.equal(controller.noteAppState('active'), 'locked');
  assert.equal(controller.isUnlocked(), false);
});

test('a device restart does not restore an unlocked session', () => {
  const session = createSessionVault();
  session.unlock({
    userId: 1,
    username: USERNAME,
    dek: randomBytes(32),
    now: 10,
  });
  assert.equal(session.isUnlocked(), true);
  const restarted = createSessionVault();
  assert.equal(restarted.isUnlocked(), false);
  assert.equal(restarted.getDek(), null);
});

test('biometric cancellation or a bad key does not grant access', async () => {
  const { controller } = harness();
  await controller.createAccount(USERNAME, PASSWORD);
  let saved: Uint8Array | null = null;
  const enabled = await controller.enableBiometrics(async (dek) => {
    saved = new Uint8Array(dek);
    return true;
  });
  assert.equal(enabled.ok, true);
  controller.logout();

  const canceled = await controller.unlockWithBiometric(async () => null);
  assert.equal(canceled.ok, false);
  assert.equal(controller.isUnlocked(), false);

  const rejected = await controller.unlockWithBiometric(async () => {
    throw new Error('user canceled');
  });
  assert.equal(rejected.ok, false);
  assert.equal(controller.isUnlocked(), false);

  const mismatched = await controller.unlockWithBiometric(async () => randomBytes(32));
  assert.equal(mismatched.ok, false);
  assert.equal(controller.isUnlocked(), false);

  const unlocked = await controller.unlockWithBiometric(async () => saved);
  assert.equal(unlocked.ok, true);
  assert.equal(controller.isUnlocked(), true);
});

test('unauthorized callers cannot delete or read transcripts, even if BLE is connected', async () => {
  const { controller, advance } = harness();
  assert.equal(bleConnectionGrantsAccess(true), false);
  assert.equal(
    decideDatabaseAccess({
      unlocked: false,
      recentAuth: false,
      operation: 'read',
      bleConnected: true,
    }),
    'unauthorized',
  );

  await controller.createAccount(USERNAME, PASSWORD);
  assert.equal(await controller.saveTranscript(TRANSCRIPT), 'ok');
  advance(RECENT_AUTH_MS + 1_000);
  assert.equal(await controller.deleteTranscripts(), 'reauth');
  const stillThere = await controller.readTranscripts();
  assert.deepEqual(stillThere, [TRANSCRIPT]);

  controller.logout();
  assert.equal(await controller.deleteTranscripts(), 'unauthorized');
});

test('encrypted inspection does not reveal transcript plaintext and a bad key fails closed', async () => {
  const dek = randomBytes(32);
  const sealed = sealTranscript(TRANSCRIPT, dek);
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE tblAcousticEvent (transcription TEXT)');
  db.prepare('INSERT INTO tblAcousticEvent (transcription) VALUES (?)').run(sealed);
  const raw = db.prepare('SELECT transcription FROM tblAcousticEvent').get() as {
    transcription: string;
  };
  assert.equal(raw.transcription.includes(TRANSCRIPT), false);
  assert.equal(raw.transcription.startsWith('sac1:'), true);
  assert.equal(openTranscript(raw.transcription, dek), TRANSCRIPT);
  assert.throws(() => openTranscript(raw.transcription, randomBytes(32)));
  assert.throws(() => openTranscript(raw.transcription, null));
  assert.throws(() => sealTranscript(TRANSCRIPT, null));
  assert.throws(() => openTranscript(TRANSCRIPT, dek));
});

test('a missing or replaced device key does not unlock or turn encryption off', async () => {
  const { controller, keys, transcripts } = harness();
  await controller.createAccount(USERNAME, PASSWORD);
  assert.equal(await controller.saveTranscript(TRANSCRIPT), 'ok');
  controller.logout();

  keys.mode = 'wrong';
  const wrongKey = await controller.login(USERNAME, PASSWORD);
  assert.equal(wrongKey.ok, false);
  assert.match(wrongKey.message ?? '', /Encryption is still on/);
  assert.equal(controller.isUnlocked(), false);
  assert.equal(await controller.readTranscripts(), 'unauthorized');
  assert.equal(transcripts.dump()[0]?.includes(TRANSCRIPT), false);

  keys.mode = 'missing';
  const missing = await controller.login(USERNAME, PASSWORD);
  assert.equal(missing.ok, false);
  assert.equal(controller.isUnlocked(), false);
  assert.equal(await controller.saveTranscript('another line'), 'unauthorized');
});

test('sign-in works when this install has no keystore module', async () => {
  const accounts = memoryAccounts();
  const transcripts = memoryTranscripts();
  const controller = createAuthController({
    accounts,
    transcripts,
    keys: {
      async getDeviceKey() {
        return null;
      },
    },
    argon: TEST_ARGON2,
  });
  const created = await controller.createAccount(USERNAME, PASSWORD);
  assert.equal(created.ok, true);
  assert.equal(accounts.snapshot()?.wrappedDek.startsWith('pw1:'), true);
  assert.equal(await controller.saveTranscript(TRANSCRIPT), 'ok');
  assert.equal(transcripts.dump().some((row) => row.includes(TRANSCRIPT)), false);
  controller.logout();
  const loggedIn = await controller.login(USERNAME, PASSWORD);
  assert.equal(loggedIn.ok, true);
  assert.deepEqual(await controller.readTranscripts(), [TRANSCRIPT]);
});

test('account setup, login, and transcript storage do not use the network', async () => {
  const { controller } = harness();
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('offline');
  }) as typeof fetch;
  try {
    const created = await controller.createAccount(USERNAME, PASSWORD);
    assert.equal(created.ok, true);
    controller.logout();
    const loggedIn = await controller.login(USERNAME, PASSWORD);
    assert.equal(loggedIn.ok, true);
    assert.equal(await controller.saveTranscript(TRANSCRIPT), 'ok');
    assert.deepEqual(await controller.readTranscripts(), [TRANSCRIPT]);
    assert.equal(fetches, 0);
    assert.equal(
      decideDatabaseAccess({
        unlocked: true,
        recentAuth: true,
        operation: 'write',
        bleConnected: true,
      }),
      'allow',
    );
  } finally {
    globalThis.fetch = original;
  }
});
