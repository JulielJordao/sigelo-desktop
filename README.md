# Tauri + Vue + TypeScript

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)


Vue (controle)
     │
     │ invoke(update_projection)
     ▼
Tauri Command
     │
     ▼
renderer.rs
     │
     ├─ salva HTML no AppState
     └─ envia evento para janela projection
           │
           ▼
Janela Projection
           │
           ▼
renderiza HTML


# 🛡️ Sigelo - Arquitetura Open-Core & Módulos Premium

Bem-vindo! Este projeto adota um modelo **Open Core**. 

Isso significa que o núcleo do software é de código aberto (licença MIT) e aceita contribuições da comunidade. No entanto, algumas funcionalidades avançadas e módulos premium encontram-se criptografados neste repositório e são protegidos por direitos autorais (Código Proprietário). O uso dessas funcionalidades requer uma licença/assinatura comercial.

Para mais detalhes sobre as permissões e restrições, leia o arquivo [LICENSE](./LICENSE).

## 📖 Sobre o Sistema
O **Sigelo** é um aplicativo multiplataforma (Mobile/Desktop) construído com **Vue.js** no frontend e **Tauri (Rust)** no backend. Ele adota um modelo de negócios **Open-Core**: o núcleo principal do aplicativo é de código aberto e transparente para a comunidade, enquanto funcionalidades específicas e avançadas (como o Módulo de Retorno de Palco e Visualização de Cifras) são fechadas, exigindo uma licença premium para acesso.

Este documento detalha a arquitetura de segurança utilizada para proteger os módulos premium contra cópias não autorizadas e engenharia reversa, mantendo a integridade do repositório público.

---

## 🏗️ Estrutura de Pastas e Regras de Versionamento

Para que a arquitetura funcione, é estritamente necessário respeitar as regras do `.gitignore`. O código premium original **nunca** deve ir para o GitHub.

```text
📦 sigelo
 ┣ 📂 src
 ┃ ┣ 📂 premium-modules      # ❌ IGNORADO NO GIT: Seu código fonte privado
 ┃ ┗ 📂 views                # ✅ PÚBLICO: Telas open-source
 ┣ 📂 src-tauri
 ┃ ┣ 📂 src
 ┃ ┃ ┣ 📜 main.rs            # ✅ PÚBLICO: Backend Rust
 ┃ ┃ ┗ 📜 premium-bundle.enc # ✅ PÚBLICO: Payload Criptografado (seguro)
 ┣ 📜 build-premium.ts       # ✅ PÚBLICO: Script inteligente de empacotamento
 ┣ 📜 .env                   # ❌ IGNORADO NO GIT: Contém chaves secretas
 ┗ 📜 package.json

 # Arquivos e pastas Premium
src/premium-modules/
.env

🔐 Regras de Segurança e Variáveis de Ambiente
A segurança do sistema baseia-se na proteção da chave de descriptografia.

A Chave Mestra (PRIVATE_KEY): * Deve ter exatamente 32 caracteres.

Deve existir apenas no seu arquivo .env local e nas Secrets do seu ambiente de CI/CD.

Isolamento de Build:

O Vite/Vue é configurado para ignorar a PRIVATE_KEY.

O Tauri NÃO deve listar o .env no array de resources do tauri.conf.json.

Ofuscação no Rust:

A chave é injetada no binário (.dmg/.exe) em tempo de compilação usando a biblioteca obfstr para embaralhar a string, impedindo extração por inspeção de texto.

⚙️ O Fluxo de Compilação Condicional (Pre-Build)
Antes de o Rust compilar o aplicativo, o script build-premium.ts atua:

- Cache Inteligente: Verifica a data de modificação (mtime) dos arquivos. A criptografia (AES-256-GCM) só é refeita se houver alterações reais.

- Payload Vazio: Se o script for rodado por alguém da comunidade sem a PRIVATE_KEY e sem a pasta premium, ele gera um payload .enc vazio. O projeto compila normalmente, mas sem a funcionalidade paga.


🚀 Fluxo de Execução (Runtime)
A liberação da funcionalidade ocorre em três etapas:

Validação de Login: O usuário final faz login e a API valida a assinatura.

- Descriptografia em Memória: O frontend Vue solicita o módulo ao backend Tauri via IPC. O Rust utiliza a chave embutida para abrir o premium-bundle.enc na memória RAM.

- Injeção Dinâmica: O Rust devolve o código para o Vue, que utiliza URL.createObjectURL para montar o componente na interface.

- 💻 Guia de Comandos e Desenvolvimento
O projeto utiliza o Bun como gerenciador de pacotes e runtime ultrarrápido. Abaixo estão os comandos disponíveis no package.json para o ciclo de desenvolvimento:

Comandos Padrões do Frontend (Vue/Vite)

- bun run dev: Inicia o servidor de desenvolvimento do Vite (apenas frontend web, sem o backend Rust).

- bun run build: Executa a verificação de tipos (vue-tsc --noEmit) e compila o frontend web otimizado para produção.

- bun run preview: Levanta um servidor local para testar a versão web compilada no passo anterior.