// One door to the Go backend. Bound methods are called by name
// ("main.App.<Method>"), so nothing depends on generated bindings.
//
// In mock mode (npm run dev:mock) the same interface is served by mock.ts
// with made-up data, so the screen runs in a plain browser.

import type { AppState, BoardError, BoardEvent, CreateForm, GameStats, Release, ServerFeed, Snapshot, TicketActions, TicketDetail, UpdateInfo, Vacation } from './types';

export interface Backend {
  mock: boolean;
  state(): Promise<AppState>;
  reloadConfig(): Promise<AppState>;
  logout(): Promise<AppState>;
  connectServer(address: string): Promise<AppState>; // resolves when the browser sign-in is over
  cancelServerLogin(): Promise<void>;
  syncServer(): Promise<AppState>;
  forgetServer(): Promise<AppState>;
  onServer(cb: (state: AppState) => void): void;
  serverFeed(): Promise<ServerFeed | null>;
  onFeed(cb: (feed: ServerFeed) => void): void;
  /** The tray menu asks to open something: "notices" or "brief". */
  onTray(cb: (what: string) => void): void;
  setNotify(on: boolean): Promise<AppState>;
  snapshot(): Promise<Snapshot | null>;
  refresh(): Promise<void>;
  ticketDetail(key: string): Promise<TicketDetail>;
  // working on a ticket: each of these changes Jira
  ticketActions(key: string): Promise<TicketActions>;
  moveTicket(key: string, transitionId: string): Promise<void>;
  /** Changes one schedule field of a ticket (see TicketActions.fields). */
  setTicketField(key: string, id: string, kind: string, value: string, chosen: string[]): Promise<void>;
  /** account: an account id, "me", or "" to leave the ticket unassigned */
  assignTicket(key: string, account: string): Promise<void>;
  answerApproval(key: string, approvalId: string, approve: boolean): Promise<void>;
  /** mode: internal / public for a service desk request, plain elsewhere */
  createForm(space: string, type: string): Promise<CreateForm>;
  createTicket(space: string, type: string, values: Record<string, string | string[]>, assignee: string): Promise<string>;
  addComment(key: string, text: string, mode: 'internal' | 'public' | 'plain', mentioned: { id: string; name: string }[]): Promise<void>;
  /** People in Jira whose name holds the text, for the person fields of a waybill. */
  findPeople(query: string): Promise<{ id: string; name: string }[]>;
  /** Where the app stands and what it did lately, as text. */
  diagnostics(): Promise<string>;
  attachFile(key: string, name: string, base64: string): Promise<void>;
  /** Saves an attached file in the Downloads folder; resolves to where it is. */
  saveAttachment(id: string): Promise<string>;
  revealFile(path: string): Promise<void>;
  openUrl(url: string): void;
  onBoard(cb: (ev: BoardEvent) => void): void;
  onError(cb: (err: BoardError) => void): void;
  // the season's experience, levels and badges
  gameStats(): Promise<GameStats | null>;
  onGame(cb: (stats: GameStats) => void): void;
  // the user's own holiday; empty days cancel it
  myVacation(): Promise<Vacation>;
  setVacation(from: string, to: string, kind: string, coverId: string): Promise<Vacation>;
  /** Chooses the look of the user's own avatar (an index into LOOKS). */
  setAvatar(look: number): Promise<void>;
  // updates
  checkUpdate(): Promise<UpdateInfo>;
  lastUpdateCheck(): Promise<number>;
  releaseNotes(tag: string): Promise<Release>;
  notesToShow(): Promise<string>;
  installUpdate(tag: string): Promise<void>;
  restartApp(): Promise<void>;
  onUpdateProgress(cb: (done: number, total: number) => void): void;
}

async function real(): Promise<Backend> {
  const { Call, Events, Browser } = await import('@wailsio/runtime');
  const call = <T>(method: string, ...args: unknown[]) => Call.ByName(`main.App.${method}`, ...args) as Promise<T>;
  return {
    mock: false,
    state: () => call('State'),
    reloadConfig: () => call('ReloadConfig'),
    logout: () => call('Logout'),
    connectServer: (address) => call('ConnectServer', address),
    cancelServerLogin: () => call('CancelServerLogin'),
    syncServer: () => call('SyncServer'),
    forgetServer: () => call('ForgetServer'),
    onServer: (cb) => void Events.On('server:state', (ev: { data: AppState }) => cb(ev.data)),
    serverFeed: () => call('ServerFeed'),
    onFeed: (cb) => void Events.On('server:feed', (ev: { data: ServerFeed }) => cb(ev.data)),
    onTray: (cb) => void Events.On('tray:open', (ev: { data: string }) => cb(ev.data)),
    setNotify: (on) => call('SetNotify', on),
    snapshot: () => call('Snapshot'),
    refresh: () => call('Refresh'),
    ticketDetail: (key) => call('TicketDetail', key),
    ticketActions: (key) => call('TicketActions', key),
    moveTicket: (key, id) => call('MoveTicket', key, id),
    setTicketField: (key, id, kind, value, chosen) => call('SetTicketField', key, id, kind, value, chosen),
    assignTicket: (key, account) => call('AssignTicket', key, account),
    answerApproval: (key, id, approve) => call('AnswerApproval', key, id, approve),
    createForm: (space, type) => call('CreateForm', space, type),
    createTicket: (space, type, values, assignee) => call('CreateTicket', space, type, values, assignee),
    addComment: (key, text, mode, mentioned) => call('AddComment', key, text, mode, mentioned),
    findPeople: (query) => call('FindPeople', query),
    diagnostics: () => call('Diagnostics'),
    attachFile: (key, name, base64) => call('AttachFile', key, name, base64),
    saveAttachment: (id) => call('SaveAttachment', id),
    revealFile: (path) => call('RevealFile', path),
    // Only web pages are handed to the system: never a file or another app's link.
    // https only, except a server on this computer (development)
    openUrl: (url) => void (/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url) && Browser.OpenURL(url)),
    onBoard: (cb) => void Events.On('board:snapshot', (ev: { data: BoardEvent }) => cb(ev.data)),
    onError: (cb) => void Events.On('board:error', (ev: { data: BoardError }) => cb(ev.data)),
    gameStats: () => call('GameStats'),
    myVacation: () => call('MyVacation'),
    setVacation: (from, to, kind, coverId) => call('SetVacation', from, to, kind, coverId),
    setAvatar: (look) => call('SetAvatar', look),
    onGame: (cb) => void Events.On('game:stats', (ev: { data: GameStats }) => cb(ev.data)),
    checkUpdate: () => call('CheckUpdate'),
    lastUpdateCheck: () => call('LastUpdateCheck'),
    releaseNotes: (tag) => call('ReleaseNotes', tag),
    notesToShow: () => call('NotesToShow'),
    installUpdate: (tag) => call('InstallUpdate', tag),
    restartApp: () => call('RestartApp'),
    onUpdateProgress: (cb) =>
      void Events.On('update:progress', (ev: { data: [number, number] }) => cb(ev.data[0], ev.data[1])),
  };
}

export async function connect(): Promise<Backend> {
  if (__MOCK__) return (await import('./mock')).mockBackend();
  return real();
}
