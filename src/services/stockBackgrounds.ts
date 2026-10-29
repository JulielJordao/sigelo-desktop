// src/services/stockBackgrounds.ts
//
// Banco de fundos (Pixabay) — a busca passa pelo backend do Sigelo, que guarda
// a chave do Pixabay e faz o cache exigido por eles. O download do arquivo é
// feito pelo Rust (download_stock_background) direto para media/slides.
import { invoke, Channel } from '@tauri-apps/api/core';
import routes, { getData } from '../routes/index';

export type StockType = 'image' | 'video';

export interface StockItem {
  id: string;
  provider: 'pixabay';
  providerId: number;
  type: StockType;
  width: number;
  height: number;
  thumb: string;
  preview?: string;
  download: string;
  downloadWidth: number;
  sizeBytes?: number;
  duration?: number;
  author: string;
  authorUrl: string;
  pageUrl: string;
  tags: string;
}

export interface StockSearchResult {
  items: StockItem[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
  attribution: { name: string; url: string };
}

/** Busca no backend. Lança Error com mensagem amigável em caso de falha. */
export async function searchStock(q: string, type: StockType, page = 1): Promise<StockSearchResult> {
  const params = new URLSearchParams({ q, type, page: String(page) });
  const url = `${routes.defaultUrl}api/backgrounds/search?${params}`;
  try {
    return await getData<StockSearchResult>(url, localStorage.getItem('userToken') ?? '');
  } catch (error: any) {
    if (error instanceof Response) {
      const body = await error.json().catch(() => ({}));
      throw new Error(body?.msg || 'Não foi possível buscar fundos agora.');
    }
    if (error?.message === 'NETWORK_ERROR') {
      throw new Error('Sem conexão com a internet.');
    }
    throw new Error('Não foi possível buscar fundos agora.');
  }
}

/** Nome legível para o arquivo: "Céu Nuvens Azul - Pixabay 123456" */
export function stockFileName(item: StockItem): string {
  const words = item.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  const title = words.length ? words.join(' ') : item.type === 'video' ? 'Vídeo' : 'Imagem';
  return `${title} - Pixabay ${item.providerId}`;
}

/** Baixa o fundo para media/slides e devolve o caminho do arquivo. */
export async function downloadStock(item: StockItem, onProgress: (pct: number) => void): Promise<string> {
  const channel = new Channel<number>();
  channel.onmessage = (pct) => onProgress(pct);

  const credit = JSON.stringify({
    source: 'Pixabay',
    sourceUrl: 'https://pixabay.com/',
    pageUrl: item.pageUrl,
    author: item.author,
    authorUrl: item.authorUrl,
    tags: item.tags,
    providerId: item.providerId,
    type: item.type,
    downloadedAt: new Date().toISOString(),
  });

  return invoke<string>('download_stock_background', {
    url: item.download,
    fileName: stockFileName(item),
    credit,
    onProgress: channel,
  });
}
