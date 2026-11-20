export const WORKSPACES = ['live', 'demo'] as const;
export const NAME_LIMIT = 80;

export type WorkspaceKind = (typeof WORKSPACES)[number];
export type Workspace = {
  name: string;
  demo: { vouchers: number; debit: number; credit: number } | null;
};

export const CHANNELS = {
  read: 'workspace:read',
  saveName: 'workspace:save-name',
} as const;

export type WorkspaceCommand =
  | { operation: 'read'; kind: WorkspaceKind }
  | { operation: 'saveName'; kind: WorkspaceKind; name: string };

export type WorkerReply = { id: number } & ({ workspace: Workspace } | { error: string });

export type WorkspaceBridge = {
  read(kind: WorkspaceKind): Promise<Workspace>;
  saveName(kind: WorkspaceKind, name: string): Promise<Workspace>;
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
