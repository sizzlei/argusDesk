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
  myApproval?: boolean; // waiting for the signed-in user to approve
  enteredAt?: string;
  staleFrom?: string;
  staleRatio: number;
  stale: boolean;
  note?: string;
  path?: PathStep[];
}

export type ZoneKind = 'siding' | 'wait' | 'work' | 'desk' | 'done' | 'returned' | 'unsorted';

export interface ZoneView {
  id: string;
  name: string;
  kind: ZoneKind;
  count: number;
  staleCount: number;
  staleAfter?: string;
  approval?: boolean; // boxes here wait for an approving move
}

export interface SpaceView {
  id: string;
  name: string;
  project: string; // Jira project key
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

/** Something worth telling the user: shown in the notification centre. */
export interface Note {
  key: string; // the ticket it is about ("" for a summary)
  kind: 'approval' | 'new' | 'arrive' | 'mine' | 'assigned' | 'summary';
  title: string;
  body: string;
}

export interface BoardEvent {
  snapshot: Snapshot;
  changes: Change[];
  notes?: Note[];
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
  notify: boolean; // the user wants notifications
  notifyProblem: string; // why the system will not show them ("" = fine)
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

/** One move a ticket can make from its current status. */
export interface Transition {
  id: string;
  name: string;
  toId: string;
  toName: string;
  toKind: string; // kind of the zone it leads to ("" = unknown)
  needs: string[]; // fields Jira insists on: such a move is made in Jira
}

export interface Approver {
  id: string;
  name: string;
  decision: string; // "pending" | "approved" | "declined"
}

/** A pending Jira Service Management approval. */
export interface Approval {
  id: string;
  name: string;
  canAnswer: boolean;
  approvers: Approver[];
}

/** What the signed-in user can do with a ticket right now. */
export interface TicketActions {
  key: string;
  transitions: Transition[];
  approvals: Approval[];
  serviceDesk: boolean; // comments are internal or public; otherwise plain
  approvalsError: string;
}

/** What a person, or the whole team, has done in the season. */
export interface Tally {
  done: number;
  today: number;
  week: number;
  xp: number;
  level: number;
  levelXp: number; // experience this level starts at
  nextXp: number; // experience the next level starts at
}

export interface Badge {
  id: string;
  name: string;
  desc: string;
  scope: 'me' | 'team';
  have: number;
  need: number;
  earned: boolean;
}

/** The game state for one user: the team's total and the user's own, never anyone else's. */
export interface GameStats {
  since: string;
  team: Tally;
  me: Tally;
  badges: Badge[];
  fatigue: Record<string, number>; // by account id: 0 fresh, 1 tired, 2 resting
  away: Away[]; // holidays, current and coming
  myFatigue: number; // own fatigue, percent of the point where one rests
  avatars: Record<string, number>; // chosen look by account id
}

/** One teammate's holiday. */
export interface Away {
  id: string;
  name: string;
  from: string; // "2026-12-01"
  to: string;
  active: boolean;
  me: boolean;
}

/** The signed-in user's own holiday ("" = none). */
export interface Vacation {
  from: string;
  to: string;
  shared: boolean; // teammates see it
}
