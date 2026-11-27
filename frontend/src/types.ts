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
  reply?: string; // the requester wrote last, at this time: an answer is due
  urgent?: boolean; // its priority is one the settings call urgent
  deploy?: string; // when it goes to production: a date or a date-time, as Jira has it
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
  create?: boolean; // the team writes this space's tickets itself: the app can make one
  attach?: boolean; // files can be added to its tickets
  types?: { name: string; tag: string }[]; // the kinds of ticket that can be made there
}

/** One thing the team server wants seen. */
export interface ServerNotice {
  id: number;
  category: string;
  severity: 'crit' | 'warn' | 'info' | 'good';
  title: string;
  target: string;
  url: string; // the page on the server ("" = none)
  changed: string;
  due: string;
}

/** The team server's state in brief. */
export interface ServerFeed {
  notices: ServerNotice[];
  total: number; // more than are listed when the server holds over a hundred
  system: '' | 'ok' | 'warn' | 'fail'; // "" = this user may not see it
  systemUrl: string;
  allUrl: string;
}

/** One field of the form a ticket is made with. */
export interface CreateField {
  id: string;
  name: string;
  required: boolean;
  hasDefault: boolean;
  kind: 'text' | 'long' | 'option' | 'options' | 'date' | 'datetime' | 'number' | 'user' | 'users' | 'links' | 'other';
  options?: { id: string; name: string }[];
  default?: string; // a text, option ids apart by commas, a template, or the kind of link offered first
  people?: { id: string; name: string }[]; // who a person field starts with
}

/** The waybill for one kind of ticket. */
export interface CreateForm {
  space: string;
  type: string;
  fields: CreateField[];
  auto: string[]; // fields the app cannot show that Jira fills in by itself
  blocked: string[]; // required fields the app cannot fill in: the ticket has to be made in Jira
  jiraUrl: string;
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
  kind: 'added' | 'moved' | 'updated' | 'removed' | 'reply' | 'urgent';
  key: string;
  fromZone?: string;
  toZone?: string;
}

/** Something worth telling the user: shown in the notification centre. */
export interface Note {
  key: string; // the ticket it is about ("" for a summary)
  kind: 'urgent' | 'approval' | 'reply' | 'new' | 'arrive' | 'mine' | 'assigned' | 'summary';
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
  configName: string;
  configVersion: string;
  configFileVersion?: string; // what the settings call themselves, when configVersion is the team server's
  configError: string;
  configLoaded: boolean;
  usingLastGood: boolean;
  site: string;
  email: string;
  signedIn: boolean;
  me: string;
  meId: string; // the signed-in Jira account
  authError: string;
  pollSeconds: number;
  notify: boolean; // the user wants notifications
  notifyProblem: string; // why the system will not show them ("" = fine)
  server: string; // team server address ("" = none: settings file and Jira token)
  serverBusy: boolean; // waiting for the browser sign-in
  serverNeeds: '' | 'login' | 'jira' | 'config' | 'forbidden' | 'disabled' | 'locked' | 'site';
  serverProblem: string; // the last thing that went wrong with the server
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
/** A file attached to a ticket. Its url opens in the browser. */
export interface TicketFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  author: string;
  created: string;
  url: string;
}

export interface TicketDetail {
  key: string;
  descriptionHtml: string;
  comments: TicketComment[];
  attachments: number;
  files?: TicketFile[];
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
  toZone: string; // the zone it leads to ("" = unknown)
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
  myFatigue: number; // own strength left for the week, percent: 100 on Monday, 0 = no more boxes can be taken
  avatars: Record<string, number>; // chosen look by account id
}

/** One teammate's holiday. */
export interface Away {
  id: string;
  name: string;
  from: string; // "2026-12-01"
  to: string;
  kind: string; // "연차", "오전반차", ... ("" = not given)
  half: boolean; // part of a day: the teammate stays in the centre
  coverId: string; // who covers meanwhile
  cover: string;
  active: boolean; // away right now: resting in the lodge
  me: boolean;
}

/** The signed-in user's own holiday ("" = none). */
export interface Vacation {
  from: string;
  to: string;
  kind: string;
  coverId: string;
  cover: string;
  kinds: { name: string; half: boolean }[]; // the kinds a holiday can be
  calendar?: string; // how putting it on the team calendar went: '' none, 'ok', or why it failed
}
