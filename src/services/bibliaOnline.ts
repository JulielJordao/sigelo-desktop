// src/services/bibliaOnline.ts
// Chama o backend Rust (comando `scrape_bible_passage`) e resolve o slug do livro
// para o formato do bibliaonline (mapa oficial extraído do próprio site).

import { invoke } from "@tauri-apps/api/core";

export const BIBLIA_ONLINE_DONATION = "https://www.bibliaonline.com.br/me/ofertar";
export const BIBLIA_ONLINE_SITE = "https://www.bibliaonline.com.br";

export interface ScrapedVerse {
  number: number;
  text: string;
}

export interface ScrapedPassage {
  provider: "bibliaonline";
  version: string;
  versionLabel: string;
  book: string;
  bookName: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
  reference: string;
  verses: ScrapedVerse[];
  text: string;
  source: {
    url: string;
    label: string;
    donationUrl: string;
    extractedAt: string;
  };
}

// normalização SÓ para casar chaves (nome -> slug). NÃO use no slug final:
// o slug do bibliaonline pode ter acento (ex.: 'jó').
const norm = (s?: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s.]/g, "")
    .toLowerCase();

// [nome, slug] — slugs conforme aparecem na URL do bibliaonline.
// ATENÇÃO às pegadinhas: Jó = 'jó' (com acento), Atos = 'atos', João = 'jo'.
const BOOKS: Array<[string, string]> = [
  // Antigo Testamento
  ["Gênesis", "gn"], ["Êxodo", "ex"], ["Levítico", "lv"], ["Números", "nm"],
  ["Deuteronômio", "dt"], ["Josué", "js"], ["Juízes", "jz"], ["Rute", "rt"],
  ["1 Samuel", "1sm"], ["2 Samuel", "2sm"], ["1 Reis", "1rs"], ["2 Reis", "2rs"],
  ["1 Crônicas", "1cr"], ["2 Crônicas", "2cr"], ["Esdras", "ed"], ["Neemias", "ne"],
  ["Ester", "et"], ["Jó", "jó"], ["Salmos", "sl"], ["Provérbios", "pv"],
  ["Eclesiastes", "ec"], ["Cânticos", "ct"], ["Isaías", "is"], ["Jeremias", "jr"],
  ["Lamentações", "lm"], ["Ezequiel", "ez"], ["Daniel", "dn"], ["Oséias", "os"],
  ["Joel", "jl"], ["Amós", "am"], ["Obadias", "ob"], ["Jonas", "jn"],
  ["Miquéias", "mq"], ["Naum", "na"], ["Habacuque", "hc"], ["Sofonias", "sf"],
  ["Ageu", "ag"], ["Zacarias", "zc"], ["Malaquias", "ml"],
  // Novo Testamento
  ["Mateus", "mt"], ["Marcos", "mc"], ["Lucas", "lc"], ["João", "jo"],
  ["Atos", "atos"], ["Romanos", "rm"], ["1 Coríntios", "1co"], ["2 Coríntios", "2co"],
  ["Gálatas", "gl"], ["Efésios", "ef"], ["Filipenses", "fp"], ["Colossenses", "cl"],
  ["1 Tessalonicenses", "1ts"], ["2 Tessalonicenses", "2ts"], ["1 Timóteo", "1tm"],
  ["2 Timóteo", "2tm"], ["Tito", "tt"], ["Filemom", "fm"], ["Hebreus", "hb"],
  ["Tiago", "tg"], ["1 Pedro", "1pe"], ["2 Pedro", "2pe"], ["1 João", "1jo"],
  ["2 João", "2jo"], ["3 João", "3jo"], ["Judas", "jd"], ["Apocalipse", "ap"],
];

// Alguns apelidos/variações comuns
const ALIASES: Array<[string, string]> = [
  ["Salmo", "sl"], ["Cantares", "ct"], ["Cânticos dos Cânticos", "ct"],
  ["Atos dos Apóstolos", "atos"], ["Revelação", "ap"], ["Apocalipse de João", "ap"],
];

const NAME_TO_SLUG: Record<string, string> = {};
for (const [name, slug] of [...BOOKS, ...ALIASES]) NAME_TO_SLUG[norm(name)] = slug;

const SLUG_SET = new Set(BOOKS.map(([, slug]) => slug));

/**
 * Converte o `book` do BibleRef (nome OU abreviação) para o slug do bibliaonline.
 * - Se já for um slug conhecido (inclui 'jó', 'atos', '1co'...), usa direto.
 * - Senão tenta pelo nome normalizado.
 * - Último recurso: devolve o input normalizado (o campo é editável na modal).
 */
export function resolveBibliaOnlineSlug(input?: string): string {
  const raw = (input || "").trim().toLowerCase();
  if (SLUG_SET.has(raw)) return raw;
  const key = norm(input);
  return NAME_TO_SLUG[key] || key;
}

export async function fetchPassageFromBibliaOnline(params: {
  version: string;
  book: string; // slug do bibliaonline (ex.: 'mt'); use resolveBibliaOnlineSlug antes
  chapter: number;
  verseStart?: number | null;
  verseEnd?: number | null;
  bookName?: string;
}): Promise<ScrapedPassage> {
  // invoke rejeita com a String de Err(...) do Rust; quem chama trata no catch.
  const data = await invoke<ScrapedPassage>("scrape_bible_passage", {
    version: params.version,
    book: params.book,
    chapter: params.chapter,
    verseStart: params.verseStart ?? null,
    verseEnd: params.verseEnd ?? null,
    bookName: params.bookName ?? null,
  });

  // Item 4: monta o texto com o número do verso quando há mais de um (ex.: capítulo
  // inteiro fica numerado). Versículo único fica sem o número, mais limpo.
  if (data?.verses?.length) {
    data.text =
      data.verses.length > 1
        ? data.verses.map((v) => `${v.number} ${v.text}`).join("\n")
        : data.verses[0].text;
  }

  if (data?.source) data.source.extractedAt = new Date().toISOString();
  return data;
}