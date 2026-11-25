// One door to the Go backend. Bound methods are called by name
// ("main.App.<Method>"), so nothing depends on generated bindings.
//
// In mock mode (npm run dev:mock) the same interface is served by mock.ts
// with made-up data, so the screen runs in a plain browser.

import type { AppState, BoardError, BoardEvent, Release, Snapshot, TicketDetail, UpdateInfo } from './types';

export interface Backend {
  mock: boolean;
  state(): Promise<AppState>;
  chooseConfig(): Promise<AppState>;
  reloadConfig(): Promise<AppState>;
  login(site: string, email: string, token: string): Promise<AppState>;
  logout(): Promise<AppState>;
  snapshot(): Promise<Snapshot | null>;
  refresh(): Promise<void>;
  ticketDetail(key: string): Promise<TicketDetail>;
  openUrl(url: string): void;
  onBoard(cb: (ev: BoardEvent) => void): void;
  onError(cb: (err: BoardError) => void): void;
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
    chooseConfig: () => call('ChooseConfig'),
    reloadConfig: () => call('ReloadConfig'),
    login: (site, email, token) => call('Login', site, email, token),
    logout: () => call('Logout'),
    snapshot: () => call('Snapshot'),
    refresh: () => call('Refresh'),
    ticketDetail: (key) => call('TicketDetail', key),
    openUrl: (url) => void Browser.OpenURL(url),
    onBoard: (cb) => void Events.On('board:snapshot', (ev: { data: BoardEvent }) => cb(ev.data)),
    onError: (cb) => void Events.On('board:error', (ev: { data: BoardError }) => cb(ev.data)),
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
