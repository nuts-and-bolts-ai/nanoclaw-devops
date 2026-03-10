import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';

const GROUP_FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_FOLDERS = new Set(['global']);

export function isValidGroupFolder(folder: string): boolean {
  if (!folder) return false;
  if (folder !== folder.trim()) return false;
  if (!GROUP_FOLDER_PATTERN.test(folder)) return false;
  if (folder.includes('/') || folder.includes('\\')) return false;
  if (folder.includes('..')) return false;
  if (RESERVED_FOLDERS.has(folder.toLowerCase())) return false;
  return true;
}

export function assertValidGroupFolder(folder: string): void {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder "${folder}"`);
  }
}

function ensureWithinBase(baseDir: string, resolvedPath: string): void {
  const rel = path.relative(baseDir, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${resolvedPath}`);
  }
}

export function resolveGroupFolderPath(folder: string): string {
  assertValidGroupFolder(folder);
  const groupPath = path.resolve(GROUPS_DIR, folder);
  ensureWithinBase(GROUPS_DIR, groupPath);
  return groupPath;
}

export function resolveGroupIpcPath(folder: string): string {
  assertValidGroupFolder(folder);
  const ipcBaseDir = path.resolve(DATA_DIR, 'ipc');
  const ipcPath = path.resolve(ipcBaseDir, folder);
  ensureWithinBase(ipcBaseDir, ipcPath);
  return ipcPath;
}

const THREAD_TS_PATTERN = /^\d+\.\d+$/;

function assertValidThreadTs(threadTs: string): void {
  if (!THREAD_TS_PATTERN.test(threadTs)) {
    throw new Error(`Invalid thread_ts "${threadTs}"`);
  }
}

export function resolveThreadGroupPath(folder: string, threadTs: string): string {
  assertValidGroupFolder(folder);
  assertValidThreadTs(threadTs);
  const threadPath = path.resolve(GROUPS_DIR, folder, 'threads', threadTs);
  ensureWithinBase(GROUPS_DIR, threadPath);
  return threadPath;
}

export function resolveThreadIpcPath(folder: string, threadTs: string): string {
  assertValidGroupFolder(folder);
  assertValidThreadTs(threadTs);
  const ipcBaseDir = path.resolve(DATA_DIR, 'ipc');
  const threadIpcPath = path.resolve(ipcBaseDir, folder, 'threads', threadTs);
  ensureWithinBase(ipcBaseDir, threadIpcPath);
  return threadIpcPath;
}
