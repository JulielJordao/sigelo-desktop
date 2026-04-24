# Monitor de Palco (Stage Monitor) — Documentação

Sistema de monitor de retorno pro palco, projetado pra funcionar como janela secundária no seu app Tauri, espelhando os mesmos eventos da `ProjectionWindow` mas com layouts otimizados pra quem está no palco.

---  

## Estrutura de arquivos

```
stage-monitor/
├── StageMonitor.vue              ← componente raiz (listeners + seletor de layout)
├── stageLayouts.ts               ← array de opções pro <v-select>
├── types/
│   └── stage.ts                  ← tipos TypeScript compartilhados
├── stores/
│   └── stageMonitorStore.ts      ← Pinia store complementar
├── utils/
│   └── chordpro.ts               ← parser ChordPro mínimo (substituir depois)
└── layouts/
    ├── LayoutFull.vue
    ├── LayoutCurrentOnly.vue
    ├── LayoutScrolling.vue
    ├── LayoutPreacher.vue
    ├── LayoutMusician.vue
    ├── LayoutCountdown.vue
    ├── LayoutClockFocus.vue
    ├── LayoutSplitVerse.vue
    ├── LayoutNotesOnly.vue
    ├── LayoutMediaInfo.vue
    └── LayoutChordPro.vue
```

---

## Eventos Tauri consumidos

O `StageMonitor` escuta **todos os eventos que a `ProjectionWindow` escuta** (pra ficar em sincronia com o conteúdo), mais alguns extras específicos do palco.

### Eventos compartilhados (já existentes no seu projeto)

| Evento | Payload | Uso |
|---|---|---|
| `update-projection` | `string` (JSON) | Conteúdo principal (slide/bíblia/HTML) |
| `project-media` | `MediaFile` | Mídia sendo projetada |
| `clear-projection` | `boolean` | Limpeza da projeção |
| `projection-time-sync` | `{ eventType, currentTime, duration, isPlaying }` | Tempo da mídia (já existe!) |
| `update-notice-settings` | `string` (JSON) | Configurações do aviso |
| `sync-notice-playback` | `{ isActive, isPaused }` | Status do aviso |
| `update-timer-settings` | `string` (JSON) | Configurações do timer |
| `sync-timer-playback` | `{ action, timeRemaining }` | Status do timer |

### Eventos novos (você precisa emitir da janela principal)

| Evento | Payload | Descrição |
|---|---|---|
| `update-stage-layout` | `'full' \| 'current_only' \| ...` | Troca o layout do palco em tempo real |
| `stage-speech-timer` | `{ action: 'start' \| 'stop' \| 'reset' }` | Controla cronômetro de fala |
| `stage-chordpro-data` | `string` (raw `.cho`) | Envia letra+cifra pro layout chordpro |
| `stage-preacher-notes` | `string` | Envia notas do pregador |

### Comando Tauri opcional

O `StageMonitor` tenta chamar `invoke('get_stage_layout')` no mount pra restaurar o layout salvo. Se você não implementar esse comando no backend, ele simplesmente usa `'full'` como default — sem erro.

---

## Integração passo a passo

### 1. Mover os arquivos pro seu projeto

```
src/views/StageMonitor.vue          ← componente raiz
src/components/layouts/*.vue         ← ou onde preferir
src/stores/stageMonitorStore.ts
src/types/stage.ts
src/utils/chordpro.ts
```

Ajuste os imports no topo do `StageMonitor.vue` conforme a estrutura final.

### 2. Registrar rota / window Tauri

No seu `tauri.conf.json`, defina a janela de palco (se ainda não existe):

```json
{
    "label": "stage",
    "url": "/stage-monitor",
    "title": "Monitor de Palco",
    "visible": false,
    "decorations": false,
    "fullscreen": false
}
```

E crie a rota no Vue Router:

```ts
{ path: '/stage-monitor', component: () => import('@/views/StageMonitor.vue') }
```

### 3. Atualizar o select de layouts

No seu componente de configurações (onde está o `<v-select>` do layout):

```ts
import { stageLayoutsSimple } from '@/stage-monitor/stageLayouts';

const stageLayouts = stageLayoutsSimple;
```

E quando o usuário mudar o layout, emita pro monitor:

```ts
import { emitTo } from '@tauri-apps/api/event';

watch(() => localSettings.stageLayout, async (newLayout) => {
    await emitTo('stage', 'update-stage-layout', newLayout);
});
```

### 4. Emitir eventos novos quando necessário

**Cronômetro de fala** (botão "Iniciar fala" na janela principal):
```ts
await emitTo('stage', 'stage-speech-timer', { action: 'start' });
```

**Notas do pregador** (quando o operador carrega um roteiro):
```ts
await emitTo('stage', 'stage-preacher-notes', notesText);
```

**ChordPro** (quando carrega uma música com cifra):
```ts
const choContent = await readTextFile('musica.cho');
await emitTo('stage', 'stage-chordpro-data', choContent);
```

### 5. Enriquecer o payload dos slides (opcional mas recomendado)

Pra os layouts `full`, `preacher` e `split_verse` ficarem mais úteis, inclua no JSON de slide os campos:

```ts
{
    type: 'slide',
    // ... campos existentes
    notes: 'Lembrar de citar João 3:16',       // pra preacher/notes_only
    nextSlide: { text: { content: '...' } },   // pra full/musician
    chordpro: '{title:...}\n[G]letra...',      // pra chordpro
}
```

Pra bíblia, adicione versículos de contexto:

```ts
{
    type: 'bible',
    slide: {
        reference: 'João 3:16',
        htmlContent: '...',
        previousVerse: { text: 'Jo 3:15 — Para que todo aquele...' },
        nextVerse: { text: 'Jo 3:17 — Porque Deus enviou...' },
    }
}
```

Se você não enviar esses campos, os layouts ainda funcionam — só ficam sem a info extra.

---

## Atalhos de teclado

### Globais (qualquer layout)

| Tecla | Ação |
|---|---|
| `F1` | Layout `full` |
| `F2` | Layout `current_only` |
| `F3` | Layout `preacher` |
| `F4` | Layout `musician` |
| `F5` | Layout `chordpro` |
| `F6` | Layout `split_verse` |
| `F7` | Layout `countdown` |
| `F8` | Layout `clock_focus` |
| `F9` | Layout `media_info` |
| `Ctrl+Esc` | Para projeção |

### Específicos do layout ChordPro

| Tecla | Ação |
|---|---|
| `+` / `-` | Transpor ±1 semitom |
| `0` | Resetar tom |
| `[` / `]` | Diminuir/aumentar fonte |
| `C` | Ocultar/mostrar acordes |
| `Espaço` | Toggle auto-scroll |

---

## Sugestão automática de layout

O `StageMonitor` detecta o tipo de conteúdo e sugere o layout ideal no canto inferior esquerdo. O usuário pode clicar pra aplicar ou ignorar.

Regras:
- Tem ChordPro → sugere `chordpro`
- É conteúdo bíblico → sugere `split_verse`
- É mídia → sugere `media_info`
- Timer regressivo ativo → sugere `countdown`
- Tem notas → sugere `preacher`

---

## Substituindo o parser ChordPro

O arquivo `utils/chordpro.ts` é um stub funcional básico. Quando você integrar seu parser do CifraPro, basta manter a mesma interface:

```ts
export function parseChordPro(raw: string): ParsedSong { ... }
export function transposeSong(song: ParsedSong, semitones: number): ParsedSong { ... }
```

A interface `ParsedSong`:

```ts
interface ParsedSong {
    title?: string;
    artist?: string;
    key?: string;
    tempo?: number;
    capo?: number;
    lines: Array<{
        parts: Array<{ chord: string; lyric: string }>;
        section: 'verse' | 'chorus' | 'bridge' | 'intro' | 'outro' | 'default';
    }>;
}
```

Formato ChordPro suportado no stub atual:
- `{title: ...}`, `{artist: ...}`, `{key: ...}`, `{tempo: N}`, `{capo: N}`
- `{start_of_verse}` / `{end_of_verse}` (e `chorus`, `bridge`)
- Acordes inline: `[G]letra [D]com [Em]acordes`
- Comentários: linhas começando com `#`

---

## Troubleshooting

**Layout aparece em branco**
- Verifique se a janela `'stage'` está registrada no `tauri.conf.json` com o label correto
- Confirme que os eventos Tauri estão sendo emitidos com `emitTo('stage', ...)` e não com `emit(...)` global

**Tempo de mídia não atualiza**
- O evento `projection-time-sync` já é emitido pela sua `ProjectionWindow` atual (você tem `_startTimeSync()` no código). O palco escuta esse mesmo evento — sem trabalho extra.

**Aviso não aparece indicativo**
- O palco lê `sync-notice-playback` e `update-notice-settings`. Se esses eventos já vão pra projeção, vão pro palco também. Basta garantir que emitTo inclua o label do palco também, ou usar `emit()` global.

**Layout não troca**
- Verifique se está emitindo `update-stage-layout` com um dos valores válidos da union `StageLayout` (string, não objeto).
