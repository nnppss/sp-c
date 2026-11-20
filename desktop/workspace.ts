import type { BooksBridge, BookResult } from './books';

export const WORKSPACES = ['live', 'demo'] as const;
export const NAME_LIMIT = 80;
export const FIRM_FIELDS = {
  name: { label: 'Firm name', limit: 180 },
  owner: { label: 'Owner', limit: 180 },
  address: { label: 'Address', limit: 1000 },
  gstin: { label: 'GSTIN', limit: 32 },
} as const;

export type WorkspaceKind = (typeof WORKSPACES)[number];
export type FirmDetails = Record<keyof typeof FIRM_FIELDS, string>;
export type Firm = FirmDetails & { id: number; archived: boolean };
export type Workspace = {
  name: string;
  firms: Firm[];
  activeFirmId: number | null;
  demo: { firmId: number; vouchers: number; debit: number; credit: number } | null;
};

export const CHANNELS = {
  read: 'workspace:read',
  saveName: 'workspace:save-name',
  saveFirm: 'workspace:save-firm',
  selectFirm: 'workspace:select-firm',
  removeFirm: 'workspace:remove-firm',
} as const;

export type WorkspaceCommand =
  | { operation: 'read'; kind: WorkspaceKind }
  | { operation: 'saveName'; kind: WorkspaceKind; name: string }
  | { operation: 'saveFirm'; kind: WorkspaceKind; id: unknown; details: unknown }
  | { operation: 'selectFirm' | 'removeFirm'; kind: WorkspaceKind; id: unknown };

export type WorkerReply = { id: number } & ({ result: Workspace | BookResult } | { error: string });

export type WorkspaceBridge = BooksBridge & {
  read(kind: WorkspaceKind): Promise<Workspace>;
  saveName(kind: WorkspaceKind, name: string): Promise<Workspace>;
  saveFirm(kind: WorkspaceKind, id: number | null, details: FirmDetails): Promise<Workspace>;
  selectFirm(kind: WorkspaceKind, id: number): Promise<Workspace>;
  removeFirm(kind: WorkspaceKind, id: number): Promise<Workspace>;
  isMac: boolean;
};

export function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return value === 'live' || value === 'demo';
}

export function workspaceName(value: unknown): string {
  if (typeof value !== 'string' || value.length > NAME_LIMIT || !value.trim()) {
    throw new Error(`Enter a workspace name between 1 and ${NAME_LIMIT} characters.`);
  }
  return value.trim();
}
