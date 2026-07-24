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
│   ├── chordProOriginal.ts       ← PONTE pro seu chordPro.ts (ajustar caminho!)
│   └── chordProStage.ts          ← renderizador dark adaptado pra palco
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

## ⚠️ Passo crítico: conectar seu parser ChordPro

O `LayoutChordPro.vue` e o `LayoutMusician.vue` usam **seu parser real** (`chordPro.ts` que você compartilhou). A ponte fica em `utils/chordProOriginal.ts`:

```ts
// utils/chordProOriginal.ts
export * from '@/utils/chordPro';  // ← AJUSTAR CAMINHO
```

**Três opções** pra conectar:

1. **Ajustar o re-export** (recomendado se você já tem alias `@/`): mude a linha pra apontar pro local real do seu `chordPro.ts`.
2. **Copiar o conteúdo direto**: cole o conteúdo do seu `chordPro.ts` dentro de `chordProOriginal.ts` e remova a linha `export * from`.
3. **Import relativo**: troque por `'../../path/to/chordPro'` conforme a estrutura.

O `chordProStage.ts` (renderizador dark pro palco) importa apenas o que precisa: `parseChordProToStructure`, `transposeChord` e o tipo `ParsedLine`. **Não mexe** no seu código original.

### Por que não reusar o `chordProRender.ts` original?

Seu `buildVisualLines` gera HTML com classes Tailwind claras (`bg-indigo-50`, `text-indigo-700`) otimizadas pro seu PDF/tela principal. O `chordProStage.ts` reimplementa a mesma lógica com:

- ✓ Cores dark (fundo escuro de palco)
- ✓ Suporte a modo **inline** (acorde sobre sílaba) além do **separate**
- ✓ Ignora quebras de página (tela única do palco)
- ✓ Classes CSS próprias (`.stage-badge`, `.stage-chord-line`) sem dependência de Tailwind

---

## Dependências necessárias

```bash
npm install dompurify
npm install -D @types/dompurify
```

O `LayoutChordPro.vue` usa DOMPurify pra sanitizar o HTML gerado antes do `v-html`. Se você já usa DOMPurify em outro lugar do projeto, ótimo — é a mesma lib.

---

## Eventos Tauri consumidos

### Eventos compartilhados (já existentes no seu projeto)

| Evento | Payload | Uso |
|---|---|---|
| `update-projection` | `string` (JSON) | Conteúdo principal (slide/bíblia/HTML) |
| `project-media` | `MediaFile` | Mídia sendo projetada |
| `clear-projection` | `boolean` | Limpeza da projeção |
| `projection-time-sync` | `{ eventType, currentTime, duration, isPlaying }` | Tempo da mídia |
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
| `stage-chord-mode` | `'separate' \| 'inline'` | Troca modo de renderização de cifra |

### Comando Tauri opcional

O `StageMonitor` tenta chamar `invoke('get_stage_layout')` no mount. Se não existir, usa `'full'` como default — sem erro.

---

## Integração passo a passo

### 1. Mover os arquivos pro seu projeto

```
src/views/StageMonitor.vue
src/components/layouts/*.vue
src/stores/stageMonitorStore.ts
src/types/stage.ts
src/utils/chordProStage.ts
src/utils/chordProOriginal.ts    ← ajustar o caminho dentro dele!
```

### 2. Instalar DOMPurify

```bash
npm install dompurify @types/dompurify
```

### 3. Registrar janela Tauri

No `tauri.conf.json`:

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

### 4. Adicionar rota no Vue Router

```ts
{ path: '/stage-monitor', component: () => import('@/views/StageMonitor.vue') }
```

### 5. Atualizar o select de layouts

```ts
import { stageLayoutsSimple } from '@/stage-monitor/stageLayouts';
const stageLayouts = stageLayoutsSimple;
```

### 6. Emitir eventos ao mudar configuração

```ts
import { emitTo } from '@tauri-apps/api/event';

// Troca de layout
watch(() => localSettings.stageLayout, async (newLayout) => {
    await emitTo('stage', 'update-stage-layout', newLayout);
});

// Troca de modo de cifra (separado/inline)
watch(() => localSettings.chordRenderMode, async (newMode) => {
    await emitTo('stage', 'stage-chord-mode', newMode);
});
```

### 7. Enviar dados ao palco

```ts
// Cifra ChordPro (quando carrega música com cifra)
const choContent = await readTextFile('musica.cho');
await emitTo('stage', 'stage-chordpro-data', choContent);

// Cronômetro de fala
await emitTo('stage', 'stage-speech-timer', { action: 'start' });

// Notas do pregador
await emitTo('stage', 'stage-preacher-notes', 'Lembrar de citar João 3:16');
```

---

## Atalhos de teclado

### Globais (qualquer layout)

| Tecla | Ação |
|---|---|
| `F1` | Layout `full` |
| `F2` | Layout `current_only` |
| `F3` | Layout `preacher` |
| `F4` | Layout `musician` |
| `F6` | Layout `chordpro` |
| `F7` | Layout `split_verse` |
| `F8` | Layout `countdown` |
| `F9` | Layout `clock_focus` |
| `F10` | Layout `media_info` |
| `Ctrl+Esc` | Para projeção |

### Específicos do layout ChordPro

| Tecla | Ação |
|---|---|
| `+` / `−` | Transpor ±1 semitom |
| `0` | Resetar tom |
| `[` / `]` | Diminuir/aumentar fonte |
| `C` | Ocultar/mostrar cifra |
| `V` | Alternar modo (separado / inline) |
| `Espaço` | Toggle auto-scroll |
| `↑` / `↓` | Velocidade do scroll |

---

## Modos de renderização ChordPro

### Modo `separate` (padrão)

Acorde em cima, letra embaixo — idêntico ao seu PDF atual. Usa fonte monoespaçada (`JetBrains Mono`) pra alinhar acordes nas colunas corretas. Preserva o posicionamento exato gerado pelo seu `buildVisualLines`.

```
       G         D         Em        C
Quão grande és Tu, Senhor, Deus da criação
```

### Modo `inline`

Acorde posicionado diretamente acima da sílaba, estilo Ultimate Guitar / CifraClub. Mais compacto verticalmente, melhor pra músicas longas onde o espaço da tela importa.

```
G       D       Em    C
Quão grande   és Tu,  Senhor...
```

Alternar entre os dois:
- **Tecla V** no monitor
- Botão "Modo" no header do layout
- Evento `stage-chord-mode` da janela principal

---

## Reuso da lógica do seu parser

O `chordProStage.ts` espelha fielmente o comportamento do seu `buildVisualLines`:

| Recurso do seu parser | Comportamento no palco |
|---|---|
| `{c: Refrão}` → italic | ✓ Italic + borda lateral roxa |
| `{c: Intro}` / `{c: Solo}` | ✓ Badge inline ao lado da cifra |
| `{c: Verso 1}` | ✓ Badge de bloco acima |
| `{soc}` / `{eoc}` | ✓ Ativa/desativa modo refrão |
| `{np}` / page break | ⊘ Ignorado (tela única), adiciona espaço visual |
| `[* Anotação]` | ✓ Renderizada amarela, distinta de acordes |
| Transposição via `transposeChord` | ✓ Usa sua função original (respeita `/B`, `(add9)`, etc.) |
| Numeração `"1."` em negrito | ✓ Preservada |
| Detecção de coluna / posicionamento | ✓ Replicada |

Se você adicionar features no seu parser (novas diretivas, novos tipos de anotação), só precisa atualizar `chordProStage.ts` pra renderizá-los — a base de parsing já vem do seu código.

---

## Troubleshooting

**Import de `chordProOriginal.ts` falha**
→ Ajuste o caminho dentro de `utils/chordProOriginal.ts` pra apontar pro seu `chordPro.ts` real. Ou cole o conteúdo direto lá.

**DOMPurify not found**
→ `npm install dompurify @types/dompurify`

**Acordes desalinhados no modo separate**
→ Garanta que a fonte `JetBrains Mono` está carregada. Se não quiser adicionar ao projeto, mude a CSS em `LayoutChordPro.vue` pra `'Courier New', monospace`.

**Modo inline com acordes "pulando"**
→ É comportamento esperado quando há acorde sem sílaba embaixo (palavras curtas). O CSS usa `flex-wrap` pra acomodar — se ficar ruim, force `flex-wrap: nowrap` e `overflow-x: auto` no `.stage-inline-line`.

**Transposição não muda o tom exibido no header**
→ O `displayKey` usa `transposeChord` do seu parser, que pode não transpor tons simples (`"G"`) corretamente se o regex exigir sufixo. Se acontecer, ajuste o regex em `transposeChord` ou faça um wrapper no `chordProStage.ts`.

**Janela `stage` não aparece**
→ Verifique `tauri.conf.json`: `"visible": false` é OK (o monitor dá `show()` ao montar), mas o `label` tem que ser exatamente `'stage'` pra bater com o `emitTo('stage', ...)`.