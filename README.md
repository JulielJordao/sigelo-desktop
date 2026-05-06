#  Sigelo [!https://sigelo.cloud/_nuxt/icon_theme.DNh3D0mv.svg]

**Aplicativo multiplataforma para projeção em igrejas moderno e simples, construído com Vue 3, TypeScript e Tauri.**

[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Runtime-000000?logo=bun&logoColor=white)](https://bun.sh/)

---

## 📖 Modelo Open-Core & Módulos Premium

Bem-vindo ao repositório do **Sigelo**! Este projeto adota um modelo de negócios **Open-Core**:

Isso significa que o núcleo principal do software (sua fundação) é de **código aberto** e transparente, aceitando contribuições da comunidade. No entanto, algumas funcionalidades específicas e avançadas (como o Módulo de Retorno de Palco e a Visualização Avançada de Cifras) são **fechadas e criptografadas** neste repositório. 

O código fonte dessas funcionalidades premium é protegido por direitos autorais (Código Proprietário) e seu uso requer uma licença/assinatura comercial.

Para mais detalhes sobre as permissões e restrições, leia o arquivo [LICENSE](./LICENSE).

---

## 🏗️ Arquitetura e Comunicação IPC

O Sigelo utiliza o poder do Rust no backend e a reatividade do Vue no frontend. A comunicação entre janelas (ex: Tela Principal controlando a Tela de Projeção) segue uma arquitetura baseada em eventos via Tauri IPC:

```text
[ Vue (Controle / Editor) ]
             │
             │ invoke('update_projection')
             ▼
      [ Tauri Command ]
             │
             ▼
       [ renderer.rs ]
             │
             ├─> Salva HTML no AppState (Rust)
             │
             └─> Envia evento via canal para a janela 'projection'
                         │
                         ▼
               [ Janela Projection ]
                         │
                         ▼
                [ Renderiza HTML ]

 🔐 Segurança e Proteção de Código               

 Para proteger os módulos premium contra engenharia reversa e manter a integridade do repositório público, adotamos um sistema rigoroso de criptografia simétrica (AES-256-GCM) no momento do build.

Estrutura de Pastas e Versionamento

Para que a arquitetura funcione com segurança, as regras do .gitignore bloqueiam o envio do código original para o GitHub:

📦 sigelo
 ┣ 📂 src
 ┃ ┣ 📂 premium-modules      # ❌ IGNORADO NO GIT: Código fonte proprietário (.vue, .ts)
 ┃ ┗ 📂 views                # ✅ PÚBLICO: Telas open-source
 ┣ 📂 src-tauri
 ┃ ┣ 📂 src
 ┃ ┃ ┣ 📜 main.rs            # ✅ PÚBLICO: Backend em Rust
 ┃ ┃ ┗ 📜 premium-bundle.dat # ✅ PÚBLICO: Payload criptografado do código premium
 ┣ 📜 build-premium.ts       # ✅ PÚBLICO: Script inteligente de empacotamento
 ┣ 📜 .env                   # ❌ IGNORADO NO GIT: Contém chaves secretas
 ┗ 📜 package.json

 O Fluxo de Compilação (Pre-Build)

Antes de o Rust compilar o aplicativo, o nosso script de segurança (build-premium.ts) entra em ação:

1. Cache Inteligente: Verifica a data de modificação (mtime) dos arquivos locais. A criptografia só é refeita se houver alterações reais no código.

2. Encriptação: Pega todos os arquivos da pasta premium-modules, ofusca e tranca os dados usando a SIGELO_UPDATER_KEY (Chave AES de 32 caracteres).

3. Payload Vazio (Comunidade): Se o script for rodado por alguém da comunidade que clonou o repositório — sem a chave secreta e sem a pasta premium — ele gera um payload .dat vazio. O projeto compila normalmente para a comunidade, mas sem as funcionalidades pagas.

Fluxo de Execução (Runtime)

A liberação da funcionalidade premium ocorre em três etapas seguras:

1. Validação de Login: O usuário final faz login e a API oficial valida a assinatura.

2. Descriptografia em Memória: O frontend Vue solicita o módulo premium ao backend Tauri. O Rust utiliza a chave embutida e ofuscada (via lib obfstr) para abrir o premium-bundle.dat diretamente na memória RAM, sem gravar arquivos temporários no disco do cliente.

3. Injeção Dinâmica: O Rust devolve o código descriptografado em tempo real para o Vue, que o monta dinamicamente na interface.

⚙️ Configuração do Ambiente (IDE)
Para a melhor experiência de desenvolvimento, recomendamos o seguinte setup:

- IDE: VS Code

Extensões Recomendadas:

- Vue - Official (Volar)

- Tauri

- rust-analyzer

💻 Guia de Comandos (Bun)
O projeto utiliza o Bun como gerenciador de pacotes e runtime ultrarrápido. Certifique-se de instalar as dependências rodando bun install após clonar o repositório.

Desenvolvimento Desktop (Tauri)

Estes são os comandos que você usará 99% do tempo para desenvolver o app completo:

- bun tauri dev: Inicia o aplicativo em modo de desenvolvimento (levanta o Vue e a janela nativa do Tauri simultaneamente).

- bun tauri build: Compila a versão de produção final (Gera o instalador .exe, .dmg, .AppImage).

Comandos Exclusivos do Frontend (Web)

Use estes comandos se precisar testar alterações de design apenas no navegador, sem o backend Rust:

- bun run dev: Inicia apenas o servidor Vite para o frontend no navegador.

- bun run build: Executa a verificação de tipos e compila os arquivos web otimizados.

- bun run preview: Levanta um servidor local rápido para testar a versão web recém-compilada.