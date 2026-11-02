/**
 * Parser de arquivos OpenLyrics (http://openlyrics.info) para o formato
 * de música do Sigelo. A letra é devolvida como texto puro, com a mesma
 * convenção do editor: blocos separados por linha em branco e refrão
 * indentado com 5 espaços.
 */

export interface ParsedSong {
  fullName: string
  writerBy?: string
  versionBy?: string
  melodyBy?: string
  tags: string[]
  lyric: string
  sourceFile: string
}

const CHORUS_INDENT = '     ' // 5 espaços — igual ao ModalLocalSong

/** Converte um XML OpenLyrics em ParsedSong (ou null se inválido). */
export function parseOpenLyrics(
  xml: string,
  fileName: string,
  validTags: string[],
): ParsedSong | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')

  // DOMParser não lança em XML malformado; injeta <parsererror>.
  if (doc.querySelector('parsererror')) return null

  const song = doc.querySelector('song')
  if (!song) return null

  const title = text(song.querySelector('properties > titles > title'))
  if (!title) return null // sem título não serve

  const authors = Array.from(
    song.querySelectorAll('properties > authors > author'),
  )
  const byType = (t: string) =>
    authors.find((a) => a.getAttribute('type') === t)?.textContent?.trim() ||
    undefined
  // autor sem type = letrista, por padrão no OpenLyrics
  const plainAuthor = authors
    .find((a) => !a.getAttribute('type'))
    ?.textContent?.trim()

  const themes = Array.from(song.querySelectorAll('properties > themes > theme'))
    .map((t) => t.textContent?.trim() || '')
    .filter(Boolean)
  const tags = matchTags(themes, validTags)

  const verseOrder = text(song.querySelector('properties > verseOrder'))
  const verseEls = Array.from(song.querySelectorAll('lyrics > verse'))
  const ordered = applyVerseOrder(verseEls, verseOrder)

  const blocks = ordered.map((v) => {
    const name = v.getAttribute('name') || ''
    const isChorus = name.toLowerCase().startsWith('c')
    const body = verseToText(v)
    return isChorus
      ? body
          .split('\n')
          .map((l) => CHORUS_INDENT + l)
          .join('\n')
      : body
  })

  return {
    fullName: title,
    writerBy: byType('words') || plainAuthor,
    versionBy: byType('translation'),
    melodyBy: byType('music'),
    tags,
    lyric: blocks.join('\n\n'),
    sourceFile: fileName,
  }
}

function text(el: Element | null): string {
  return el?.textContent?.trim() || ''
}

/** Extrai o texto de um <verse>: <br/> vira quebra; tags internas são removidas. */
function verseToText(verse: Element): string {
  const lineGroups = Array.from(verse.querySelectorAll('lines'))
  return lineGroups
    .map((group) => {
      const html = group.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '') // remove <chord>, <comment>, <tag>, etc.
      return decodeEntities(html).trim()
    })
    .join('\n')
}

function decodeEntities(s: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = s
  return el.value
}

function applyVerseOrder(verses: Element[], order: string): Element[] {
  if (!order) return verses
  const byName = new Map<string, Element>()
  verses.forEach((v) => {
    const n = v.getAttribute('name')
    if (n && !byName.has(n)) byName.set(n, v)
  })
  const result = order
    .split(/\s+/)
    .map((n) => byName.get(n))
    .filter(Boolean) as Element[]
  return result.length ? result : verses
}

/** Casa temas do arquivo com as tags oficiais (ignora acento e maiúsculas). */
function matchTags(themes: string[], validTags: string[]): string[] {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  const validByNorm = new Map(validTags.map((t) => [norm(t), t]))
  const out = new Set<string>()
  themes.forEach((t) => {
    const hit = validByNorm.get(norm(t))
    if (hit) out.add(hit)
  })
  return Array.from(out)
}
