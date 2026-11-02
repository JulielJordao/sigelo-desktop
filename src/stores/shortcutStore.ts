// ═════════════════════════════════════════════════════════════════════════
// ATALHOS DE TECLADO (um lugar só)
//
// - "mod" = Ctrl no Windows/Linux e ⌘ (Command) no macOS: a mesma tecla em
//   todos os sistemas, com o modificador nativo de cada um.
// - A tecla é identificada por `e.code` (posição física: KeyK, KeyB, F5),
//   então funciona igual em teclado ABNT2 e americano.
// - Um único listener (instalado no MainLayout) despacha para quem se
//   inscreveu com `onShortcut(id, handler)`.
// - Atalho de tecla que digita sem Ctrl/⌘/Alt (ex.: Shift+F, "/") é ignorado
//   com o cursor em campo de texto; Ctrl/⌘ e F1–F12 funcionam em qualquer lugar.
// - O usuário pode trocar os atalhos em Configurações → Atalhos; ficam
//   salvos neste computador (localStorage).
// ═════════════════════════════════════════════════════════════════════════
import { defineStore } from 'pinia';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { type as osType } from '@tauri-apps/plugin-os';

export type OsKind = 'macos' | 'windows' | 'linux';

export interface Binding {
  /** Ctrl (Windows/Linux) ou ⌘ (macOS). */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** KeyboardEvent.code — ex.: KeyK, F5, Slash. */
  code: string;
}

export type ShortcutId =
  | 'songs.quickSearch'
  | 'bible.quickOpen'
  | 'projection.project'
  | 'projection.projectFromStart'
  | 'projection.toggleWindow';

export interface ShortcutAction {
  id: ShortcutId;
  label: string;
  description: string;
  defaultBinding: Binding;
  /** Não abre por cima de outra janela (diálogo) aberta. */
  blockedByDialog?: boolean;
}

const b = (code: string, opts: Partial<Omit<Binding, 'code'>> = {}): Binding => ({
  mod: !!opts.mod, shift: !!opts.shift, alt: !!opts.alt, code,
});

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: 'songs.quickSearch',
    label: 'Pesquisa rápida de músicas',
    description: 'Abre a busca por nome ou letra (aba Músicas ou Mídia).',
    defaultBinding: b('KeyK', { mod: true }),
    blockedByDialog: true,
  },
  {
    id: 'bible.quickOpen',
    label: 'Abertura rápida da Bíblia',
    description: 'Abre a busca de referência bíblica.',
    defaultBinding: b('KeyB', { mod: true }),
    blockedByDialog: true,
  },
  {
    id: 'projection.project',
    label: 'Projetar letra',
    description: 'Projeta o slide atual da música selecionada.',
    defaultBinding: b('F5'),
  },
  {
    id: 'projection.projectFromStart',
    label: 'Projetar letra do início',
    description: 'Volta ao primeiro slide e projeta.',
    defaultBinding: b('F5', { shift: true }),
  },
  {
    id: 'projection.toggleWindow',
    label: 'Mostrar/ocultar tela de projeção',
    description: 'Esconde ou mostra a janela de projeção sem parar a apresentação.',
    defaultBinding: b('KeyF', { mod: true }),
  },
];

/** Atalhos fixos (aparecem na lista, mas não são editáveis). */
export const FIXED_SHORTCUTS = [
  { label: 'Avançar / voltar slide', keys: ['→', '←'] },
  { label: 'Encerrar apresentação', keys: ['Esc'] },
];

// ─── Sistema operacional ────────────────────────────────────────────────
export const currentOs = (): OsKind => {
  try {
    const t = osType();
    if (t === 'macos' || t === 'windows' || t === 'linux') return t;
  } catch { /* fora do Tauri */ }
  const p = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Mac/i.test(p) ? 'macos' : /Win/i.test(p) ? 'windows' : 'linux';
};

export const OS_LABEL: Record<OsKind, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

// ─── Nomes das teclas ───────────────────────────────────────────────────
const KEY_NAMES: Record<string, string> = {
  Space: 'Espaço', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: '⌫', Delete: 'Del',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Slash: '/', Backslash: '\\', Period: '.', Comma: ',', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', IntlRo: '/',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins',
};

export const keyName = (code: string): string => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return KEY_NAMES[code] || code;
};

/** Partes para exibir em <kbd>: ["⌘", "K"] ou ["Ctrl", "K"]. */
export const bindingParts = (binding: Binding, os: OsKind = currentOs()): string[] => {
  const parts: string[] = [];
  if (os === 'macos') {
    if (binding.alt) parts.push('⌥');
    if (binding.shift) parts.push('⇧');
    if (binding.mod) parts.push('⌘');
  } else {
    if (binding.mod) parts.push('Ctrl');
    if (binding.alt) parts.push('Alt');
    if (binding.shift) parts.push('Shift');
  }
  parts.push(keyName(binding.code));
  return parts;
};

export const formatBinding = (binding: Binding, os: OsKind = currentOs()): string =>
  os === 'macos' ? bindingParts(binding, os).join('') : bindingParts(binding, os).join('+');

const sameBinding = (a: Binding, c: Binding) =>
  a.code === c.code && a.mod === c.mod && a.shift === c.shift && a.alt === c.alt;

// ─── Validação por sistema ──────────────────────────────────────────────
export type IssueLevel = 'error' | 'warning' | 'info';
export interface BindingIssue {
  level: IssueLevel;
  message: string;
}

const isTypingKey = (code: string) =>
  /^Key[A-Z]$/.test(code) || /^Digit\d$/.test(code) || /^Numpad\d$/.test(code) ||
  ['Space', 'Slash', 'Backslash', 'Period', 'Comma', 'Semicolon', 'Quote', 'BracketLeft',
    'BracketRight', 'Minus', 'Equal', 'Backquote', 'IntlRo', 'IntlBackslash'].includes(code);

const RESERVED: Record<OsKind, { test: (b: Binding) => boolean; message: string }[]> = {
  macos: [
    { test: (x) => x.mod && !x.shift && !x.alt && ['KeyQ', 'KeyW', 'KeyH', 'KeyM'].includes(x.code), message: '⌘Q / ⌘W / ⌘H / ⌘M são do macOS (sair, fechar, ocultar, minimizar).' },
    { test: (x) => x.mod && x.code === 'Space', message: '⌘Espaço abre o Spotlight.' },
    { test: (x) => x.mod && x.code === 'Tab', message: '⌘Tab troca de aplicativo.' },
    { test: (x) => x.mod && x.shift && ['Digit3', 'Digit4', 'Digit5'].includes(x.code), message: '⇧⌘3/4/5 são capturas de tela do macOS.' },
    { test: (x) => x.mod && x.alt && x.code === 'Escape', message: '⌥⌘Esc abre "Forçar encerrar".' },
  ],
  windows: [
    { test: (x) => x.alt && !x.mod && x.code === 'F4', message: 'Alt+F4 fecha a janela no Windows.' },
    { test: (x) => x.alt && x.code === 'Tab', message: 'Alt+Tab troca de janela.' },
    { test: (x) => x.mod && x.code === 'Escape', message: 'Ctrl+Esc abre o menu Iniciar.' },
    { test: (x) => x.mod && x.alt && x.code === 'Delete', message: 'Ctrl+Alt+Del é do sistema.' },
  ],
  linux: [
    { test: (x) => x.alt && !x.mod && x.code === 'F4', message: 'Alt+F4 fecha a janela.' },
    { test: (x) => x.alt && x.code === 'Tab', message: 'Alt+Tab troca de janela.' },
    { test: (x) => x.mod && x.alt && x.code === 'KeyT', message: 'Ctrl+Alt+T abre o terminal em várias distribuições.' },
    { test: (x) => x.mod && x.alt && /^F\d{1,2}$/.test(x.code), message: 'Ctrl+Alt+F1…F12 troca de terminal (TTY).' },
    { test: (x) => x.mod && x.alt && x.code.startsWith('Arrow'), message: 'Ctrl+Alt+setas troca de área de trabalho.' },
  ],
};

/** Atalhos de edição usados em todos os campos de texto. */
const EDITING = ['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ', 'KeyY'];

/** Problemas do atalho num sistema (erro = não pode usar). */
export const validateBinding = (binding: Binding, os: OsKind): BindingIssue[] => {
  const issues: BindingIssue[] = [];
  const mod = os === 'macos' ? '⌘' : 'Ctrl+';

  if (!binding.code) return [{ level: 'error', message: 'Escolha uma tecla além dos modificadores.' }];

  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Tab', 'Enter'].includes(binding.code) &&
    !binding.mod && !binding.alt) {
    issues.push({ level: 'error', message: 'Tecla usada para navegar na apresentação e nos campos.' });
  }

  if (binding.mod && !binding.alt && !binding.shift && EDITING.includes(binding.code)) {
    issues.push({ level: 'error', message: `${mod}${keyName(binding.code)} é copiar/colar/desfazer nos campos de texto.` });
  }

  for (const rule of RESERVED[os]) {
    if (rule.test(binding)) issues.push({ level: 'error', message: rule.message });
  }

  if (!binding.mod && !binding.alt && isTypingKey(binding.code)) {
    issues.push({
      level: 'warning',
      message: binding.shift
        ? 'Shift + tecla também digita (letra maiúscula/símbolo): não funciona com o cursor em campos de texto.'
        : 'Tecla de digitação: não funciona com o cursor em campos de texto.',
    });
  }

  if (os === 'macos' && binding.alt && !binding.mod && isTypingKey(binding.code)) {
    issues.push({ level: 'error', message: 'No macOS, Option + tecla digita caracteres especiais (ex.: ⌥F = ƒ).' });
  }

  if (os !== 'macos' && binding.mod && binding.alt && isTypingKey(binding.code)) {
    issues.push({
      level: 'warning',
      message: 'Ctrl+Alt equivale a AltGr: no teclado ABNT2 algumas combinações digitam símbolos (ex.: Ctrl+Alt+Q = /).',
    });
  }

  if (os !== 'macos' && binding.alt && !binding.mod && /^Key[A-Z]$/.test(binding.code)) {
    issues.push({ level: 'info', message: 'Alt + letra pode abrir menus em alguns programas do sistema.' });
  }

  if (/^F\d{1,2}$/.test(binding.code)) {
    issues.push({ level: 'info', message: 'Em notebooks, F1–F12 podem exigir a tecla Fn.' });
  }

  return issues;
};

/** Situação em cada sistema: o pior nível encontrado. */
export const bindingStatusByOs = (binding: Binding) =>
  (['windows', 'macos', 'linux'] as OsKind[]).map((os) => {
    const issues = validateBinding(binding, os);
    const level: IssueLevel | 'ok' = issues.some((i) => i.level === 'error')
      ? 'error'
      : issues.some((i) => i.level === 'warning')
        ? 'warning'
        : 'ok';
    return { os, level, issues };
  });

// ─── Utilidades de evento ───────────────────────────────────────────────
const MODIFIER_CODES = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'CapsLock', 'Fn'];

export const isModifierOnly = (e: KeyboardEvent) => MODIFIER_CODES.includes(e.code);

/** Converte o evento em atalho; `foreignMod` = Ctrl no Mac ou tecla Windows/Super nos outros. */
export const eventToBinding = (e: KeyboardEvent, os: OsKind = currentOs()) => ({
  binding: {
    mod: os === 'macos' ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    code: isModifierOnly(e) ? '' : e.code,
  } as Binding,
  foreignMod: os === 'macos' ? e.ctrlKey : e.metaKey,
});

const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return el.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' ||
    (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes((el as HTMLInputElement).type));
};

const isDialogOpen = () =>
  !!document.querySelector('.v-dialog.v-overlay--active');

// ─── Store ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'sigelo.shortcuts';

type Handler = (e: KeyboardEvent) => void;

export const useShortcutStore = defineStore('shortcuts', () => {
  const os = currentOs();
  const custom = ref<Partial<Record<ShortcutId, Binding>>>({});
  /** Enquanto o editor captura uma nova combinação, nenhum atalho dispara. */
  const isCapturing = ref(false);
  const handlers = new Map<ShortcutId, Set<Handler>>();
  let installed = false;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) custom.value = JSON.parse(raw) || {};
  } catch { custom.value = {}; }

  const persist = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(custom.value)); } catch { /* ignora */ }
  };

  const bindingFor = (id: ShortcutId): Binding =>
    custom.value[id] || SHORTCUT_ACTIONS.find((a) => a.id === id)!.defaultBinding;

  const bindings = computed(() =>
    SHORTCUT_ACTIONS.map((action) => ({
      ...action,
      binding: bindingFor(action.id),
      isCustom: !!custom.value[action.id],
    }))
  );

  /** Outra ação que já usa o mesmo atalho. */
  const conflictWith = (id: ShortcutId, binding: Binding) =>
    SHORTCUT_ACTIONS.find((a) => a.id !== id && sameBinding(bindingFor(a.id), binding));

  const setBinding = (id: ShortcutId, binding: Binding) => {
    const def = SHORTCUT_ACTIONS.find((a) => a.id === id)!.defaultBinding;
    if (sameBinding(def, binding)) delete custom.value[id];
    else custom.value = { ...custom.value, [id]: { ...binding } };
    persist();
  };

  const resetBinding = (id: ShortcutId) => {
    const next = { ...custom.value };
    delete next[id];
    custom.value = next;
    persist();
  };

  const resetAll = () => {
    custom.value = {};
    persist();
  };

  const label = (id: ShortcutId) => formatBinding(bindingFor(id), os);

  const register = (id: ShortcutId, handler: Handler) => {
    if (!handlers.has(id)) handlers.set(id, new Set());
    handlers.get(id)!.add(handler);
    return () => handlers.get(id)?.delete(handler);
  };

  const matches = (e: KeyboardEvent, binding: Binding) => {
    const mod = os === 'macos' ? e.metaKey : e.ctrlKey;
    const foreign = os === 'macos' ? e.ctrlKey : e.metaKey;
    return !foreign && e.code === binding.code && mod === binding.mod &&
      e.shiftKey === binding.shift && e.altKey === binding.alt;
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (isCapturing.value || e.repeat) return;
    for (const action of SHORTCUT_ACTIONS) {
      const binding = bindingFor(action.id);
      if (!matches(e, binding)) continue;

      // Tecla de digitação sem Ctrl/⌘/Alt (ex.: Shift+F, "/") não dispara dentro
      // de campos de texto. F5 e outras teclas que não digitam funcionam sempre.
      if (!binding.mod && !binding.alt && isTypingKey(binding.code) && isEditableTarget(e.target)) return;
      if (action.blockedByDialog && isDialogOpen()) return;

      const list = handlers.get(action.id);
      if (!list || list.size === 0) return;
      e.preventDefault();
      e.stopPropagation();
      list.forEach((fn) => fn(e));
      return;
    }
  };

  /** Liga o listener global (uma vez, na janela principal). */
  const install = () => {
    if (installed) return;
    installed = true;
    window.addEventListener('keydown', onKeydown, true);
  };

  const uninstall = () => {
    if (!installed) return;
    installed = false;
    window.removeEventListener('keydown', onKeydown, true);
  };

  return {
    os,
    bindings,
    isCapturing,
    bindingFor,
    conflictWith,
    setBinding,
    resetBinding,
    resetAll,
    label,
    register,
    install,
    uninstall,
  };
});

/** Inscreve um componente num atalho enquanto ele estiver montado. */
export const onShortcut = (id: ShortcutId, handler: Handler) => {
  const store = useShortcutStore();
  let off: (() => void) | null = null;
  onMounted(() => { off = store.register(id, handler); });
  onBeforeUnmount(() => { off?.(); });
};
