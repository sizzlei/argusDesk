// Adding files to a ticket: picked, dropped or pasted.

import type { Backend } from './backend';
import { errText, toast } from './ui';

const two = (n: number) => String(n).padStart(2, '0');

/** A pasted picture has no name of its own ("image.png"): it gets the time it was pasted. */
export function named(f: File, now = new Date()): File {
  if (!/^image\.\w+$/i.test(f.name)) return f;
  const ext = f.name.slice(f.name.lastIndexOf('.'));
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return new File([f], `screenshot-${stamp}${ext}`, { type: f.type });
}

/** The files of a drop or a paste; none when it carries text only. */
export function filesOf(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].map((f) => named(f));
}

export function sizeText(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function base64(f: File): Promise<string> {
  return new Promise((done, fail) => {
    const r = new FileReader();
    r.onerror = () => fail(new Error(`${f.name}: 파일을 읽을 수 없습니다`));
    r.onload = () => done(String(r.result).replace(/^data:[^,]*,/, ''));
    r.readAsDataURL(f);
  });
}

/** Sends files to a ticket one after another. Returns how many arrived; the rest are reported. */
export async function sendFiles(backend: Backend, key: string, files: File[]): Promise<number> {
  let sent = 0;
  for (const f of files) {
    try {
      await backend.attachFile(key, f.name, await base64(f));
      sent++;
    } catch (e) {
      toast(errText(e), 'error');
    }
  }
  return sent;
}
