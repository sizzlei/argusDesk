// Shapes sent by the Go backend (internal/model and app.go).

export interface PathStep {
  statusId: string;
  name: string;
  state: 'done' | 'current' | 'next';
}

export interface Box {
  key: string;
  summary: string;
  type: string;
  statusId: string;
  status: string;
  priority: string;
  assigneeId: string;
  assignee: string;
  reporter: string;
  created: string;
  updated: string;
  url: string;
  space: string;
  zone: string;
  tag: string;
  workflow: string;
  mine: boolean;
  enteredAt?: string;
  staleFrom?: string;
  staleRatio: number;
  stale: boolean;
  note?: string;
  path?: PathStep[];
}

export type ZoneKind = 'wait' | 'work' | 'desk' | 'done' | 'returned' | 'unsorted';

export interface ZoneView {
  id: string;
  name: string;
  kind: ZoneKind;
  count: number;
  staleCount: number;
  staleAfter?: string;
}

export interface SpaceView {
  id: string;
  name: string;
  zones: ZoneView[];
}

export interface Member {
  id: string;
  name: string;
  space: string;
  zone: string;
  count: number;
  me: boolean;
}

export interface Snapshot {
  name: string;
  configVersion: string;
  fetchedAt: string;
  spaces: SpaceView[];
  boxes: Box[];
  members: Member[];
  warnings: string[];
}

export interface Change {
  kind: 'added' | 'moved' | 'updated' | 'removed';
  key: string;
  fromZone?: string;
  toZone?: string;
}

export interface BoardEvent {
  snapshot: Snapshot;
  changes: Change[];
}

export interface BoardError {
  message: string;
  auth: boolean;
}

export interface AppState {
  version: string;
  configPath: string;
  configName: string;
  configVersion: string;
  configError: string;
  configLoaded: boolean;
  usingLastGood: boolean;
  site: string;
  email: string;
  signedIn: boolean;
  me: string;
  authError: string;
  pollSeconds: number;
}

export interface Release {
  version: string;
  tag: string;
  name: string;
  notes: string;
  notesHtml: string;
  url: string;
  published: string;
  assetName: string;
  assetUrl: string;
  assetSize: number;
}

export interface UpdateInfo {
  current: string;
  available: boolean;
  supported: boolean;
  release: Release;
}

export interface TicketComment {
  author: string;
  created: string;
  bodyHtml: string;
  internal: boolean;
}

export interface FormAnswer {
  label: string;
  value: string;
}

/** A Jira form attached to the ticket, with its answers in form order. */
export interface TicketForm {
  name: string;
  submitted: boolean;
  answers: FormAnswer[];
}

/** Forms, description and comments of one ticket. The HTML is rendered by Jira (untrusted). */
export interface TicketDetail {
  key: string;
  descriptionHtml: string;
  comments: TicketComment[];
  attachments: number;
  forms: TicketForm[];
  formsError: string;
}
