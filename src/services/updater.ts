import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export const SIMULATE_UPDATE = import.meta.env.VITE_SIMULATE_UPDATE === 'true';

export interface MockUpdate {
  version: string;
  currentVersion: string;
  body: string;
  date?: string;
  __isMock: true;
}

export type AnyUpdate = Update | MockUpdate;

// 👇 aceita unknown e estreita corretamente
export function isMockUpdate(u: AnyUpdate | null | undefined): u is MockUpdate {
  return !!u && (u as MockUpdate).__isMock === true;
}

const MOCK_UPDATE: MockUpdate = {
  version: '1.3.0',
  currentVersion: '1.2.0',
  body: 'Correções de bugs, melhorias no Stage Display e suporte a NDI.\n\n- Novo motor de renderização\n- Correção de travamentos no macOS\n- Performance otimizada',
  date: new Date().toISOString(),
  __isMock: true,
};

export async function checkForUpdate(): Promise<AnyUpdate | null> {
  if (SIMULATE_UPDATE) {
    await new Promise((r) => setTimeout(r, 1200));
    return MOCK_UPDATE;
  }

  try {
    const update = await check();
    return update ?? null;
  } catch (e) {
    console.error('Falha ao checar update:', e);
    throw e;
  }
}

export async function downloadAndInstall(
  update: AnyUpdate,
  onProgress?: (downloaded: number, total: number) => void
) {
  if (isMockUpdate(update)) {
    const total = 50 * 1024 * 1024;
    const steps = 50;
    const chunk = total / steps;

    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, 100));
      onProgress?.(chunk * i, total);
    }
    await new Promise((r) => setTimeout(r, 800));
    console.log('[MOCK] Instalação concluída.');
    return;
  }

  // 👇 aqui dentro, TS já sabe que é Update (não Mock)
  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength ?? 0;
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, contentLength);
        break;
      case 'Finished':
        break;
    }
  });

  await relaunch();
}