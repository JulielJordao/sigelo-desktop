# Changelog

Todas as mudanças notáveis do **Sigelo** são documentadas aqui.  
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [Unreleased]

> Funcionalidades em desenvolvimento ou planejadas para próximas versões.

### Planejado
- Controle remoto via celular/tablet (web app ou aplicativo Sigelo na rede local)
- Legendas automáticas via speech-to-text durante a pregação
- Suporte a MIDI/OSC para integração com mesas de som e Stream Deck
- Modo "Kids": versículos com ilustrações, fontes maiores e cores vibrantes
- Quizzes bíblicos interativos para projeção
- Teleprompter para pregadores no Stage Display
- Sistema de pedidos de oração via QR Code
- Exportação de cortes/clipes com letras embutidas para redes sociais
- Saída independente para foyer/recepção com conteúdo diferente
- Suporte a múltiplas traduções da Bíblia lado a lado
- Tags e categorias para filtrar músicas (louvor, adoração, comunhão, etc.)
- Histórico de músicas e versículos usados recentemente
- Cifras e tonalidade no Stage Display com transposição em tempo real
- Botões rápidos: Black (escurecer), Logo e Clear (limpar tela)
- Transições personalizáveis entre slides (fade, corte, slide)
- Notas internas por música visíveis apenas no Stage Display
- Histórico de cultos/eventos passados com duplicação de escala
- Acesso sem necessidade de conta
- Cadastro de músicas locais

---

## [0.9.18] - 2026-05-06

> Primeira de aprimoramento

### Adicionado

#### Importar Youtube
- Download do youtube em segundo plano com barra de andamento no ícone do youtube

### Apresentação
- Implementação da função que mostra os créditos do autor.
- Implementação dos efeitos de transição de slides.

### Temas
- Implementação do sistema de pesquisa de temas.

### Tutorial
- Inserido as instruções principais.

> Correções de problemas na abertura da tela ao clicar em "Não mostrar novamente"
> Correção de problema que poderia impedir a saída da tela de inicialização para a tela principal.

## [0.9.17] - 2026-05-06

> Primeira versão pública do Sigelo.

### Adicionado

#### Gestão de Conteúdo
- Base de dados de músicas integrada com a conta do usuário em `sigelo.cloud`
- Modo offline: músicas sincronizadas localmente, funcionando sem internet
- Suporte a Bíblia online com busca por livro, capítulo e versículo
- Edição de letras com marcação de seções (Verso, Refrão)

#### Projeção e Multimídia
- Projeção de letras com suporte a múltiplas saídas de vídeo
- Monitor de Palco (Stage Display): letra atual, próxima, alertas e relógio
- Backgrounds de vídeo e imagem com suporte a Motion Graphics animados
- Pré-visualização ao vivo (Preview/Live) antes de projetar
- Integração com OBS Studio e vMix via Chroma Key (fundo verde)
- Comunicação NDI: envio de imagem pela rede local sem cabos físicos

#### Planeamento e Organização
- Playlist integrada com o cronograma de músicas criado no `sigelo.cloud`

#### Importação e Exportação
- Importação de arquivos PDF para projeção em modo especial
- Exportação de apresentação para `.pdf`
- Exportação de apresentação para PowerPoint (`.pptx`)
- Importação e cache de vídeos do YouTube com gerenciamento local

#### Ferramentas Auxiliares
- Alertas personalizados em tela (ex: "Proprietário do carro placa XXX comparecer ao estacionamento")
- Cronômetros e contagens regressivas para cultos e pregações
- Carrossel de anúncios e avisos da igreja
- Integração com YouTube: acesso e projeção de vídeos

#### Personalização Visual
- Temas e estilos: fontes, cores, sombras e alinhamento das letras
- Formatação de texto dinâmica com ajuste automático do tamanho da fonte
- Editor visual com usabilidade semelhante ao Canva

#### Interface e Sistema
- Interface com suporte a tema claro e escuro
- Barra de título customizada com controles de janela nativos (Windows e macOS)
- Indicador de status de conexão (online, rede local sem internet, offline)
- Sistema de atualização automática com verificação ao iniciar o app
- Botão animado de atualização no header com progresso de download
- Modal "Sobre" com versão do app e verificação manual de atualizações
- Suporte a macOS (universal: Intel + Apple Silicon) e Windows (x64)
- Suporte a Linux (x64 via AppImage)

---

## Notas de Versionamento

O Sigelo usa o seguinte esquema de versões enquanto está em desenvolvimento ativo:

- **`0.9.x`**: versões de desenvolvimento público — cada incremento em `x` representa uma nova release com correções ou funcionalidades.
- **`1.0.0`**: marco de lançamento estável, quando o conjunto principal de funcionalidades estiver completo.
- **MAJOR** (`x.0.0`): mudanças estruturais incompatíveis com versões anteriores.
- **MINOR** (`0.x.0`): novas funcionalidades retrocompatíveis.
- **PATCH** (`0.0.x`): correções de bugs e melhorias pontuais.

---

*Sigelo — Sistema de Projeção Multimídia para Igrejas*  
*Desenvolvido por [Juliel Jordão](https://sigelo.cloud)*