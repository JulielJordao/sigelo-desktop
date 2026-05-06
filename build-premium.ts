import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, appendFileSync, rmSync } from 'fs';
import { join, relative, dirname } from 'path';
import { $ } from "bun";

const KEY = process.env.SIGELO_UPDATER_KEY;
const SOURCE_DIR = './src/premium-modules';
const OUTPUT_ENC = './src-tauri/src/premium-bundle.dat';
const LOG_FILE = './.premium-build-history';

// Marca arquivo opcional pra registrar deleções intencionais
// Ex: ".premium-deleted" contém uma lista de arquivos que foram propositalmente deletados
const DELETION_MARKER = './.premium-deleted';

// ==========================================
// FUNÇÕES UTILITÁRIAS
// ==========================================

function recordLog(action: string, fileCount: number) {
    const now = new Date().toLocaleString('pt-BR');
    const logEntry = `[${now}] ${action}: ${fileCount} arquivos processados\n`;
    appendFileSync(LOG_FILE, logEntry);
}

async function internalGitCommit(message: string) {
    try {
        if (!existsSync(join(SOURCE_DIR, '.git'))) {
            console.log("🌱 Inicializando Git interno para módulos premium...");
            await $`git init`.cwd(SOURCE_DIR);
        }

        const status = await $`git status --porcelain`.cwd(SOURCE_DIR).text();
        
        if (status.trim().length > 0) {
            console.log("📝 Registrando alterações no histórico interno...");
            await $`git add .`.cwd(SOURCE_DIR);
            await $`git commit -m "${message}"`.cwd(SOURCE_DIR);
        }
    } catch (e) {
        console.error("⚠️ Aviso: Não foi possível atualizar o histórico Git interno.");
    }
}

/**
 * Lê a lista de arquivos que foram propositalmente deletados.
 * Esses arquivos NÃO devem ser restaurados do .dat, mesmo que existam lá.
 */
function getIntentionalDeletions(): Set<string> {
    if (!existsSync(DELETION_MARKER)) return new Set();
    try {
        const content = readFileSync(DELETION_MARKER, 'utf-8');
        return new Set(
            content.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#')) // ignora comentários
        );
    } catch {
        return new Set();
    }
}

/**
 * Adiciona arquivos à lista de deleções intencionais.
 */
function markAsIntentionallyDeleted(paths: string[]) {
    if (paths.length === 0) return;
    const existing = getIntentionalDeletions();
    paths.forEach(p => existing.add(p));
    
    const header = '# Arquivos deletados intencionalmente — não serão restaurados do .dat\n';
    const content = header + Array.from(existing).sort().join('\n') + '\n';
    writeFileSync(DELETION_MARKER, content);
}

// ==========================================
// 0. INICIALIZAÇÃO
// ==========================================

if (!existsSync(SOURCE_DIR)) mkdirSync(SOURCE_DIR, { recursive: true });

// ─── Carrega o VFS do .dat (se existir) ────────────────────────────────────
let vfsFromDat: Record<string, string> = {};
let datIsValid = false;

if (existsSync(OUTPUT_ENC) && KEY?.length === 32) {
    try {
        const encryptedBuffer = readFileSync(OUTPUT_ENC);
        if (encryptedBuffer.length > 28) {
            const iv = encryptedBuffer.subarray(0, 12);
            const authTag = encryptedBuffer.subarray(encryptedBuffer.length - 16);
            const encryptedData = encryptedBuffer.subarray(12, encryptedBuffer.length - 16);

            const decipher = createDecipheriv('aes-256-gcm', Buffer.from(KEY), iv);
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
            vfsFromDat = JSON.parse(decrypted.toString());
            datIsValid = true;
        }
    } catch (e) {
        console.log("ℹ️ Nota: Payload premium detectado, mas a chave é inválida ou ausente. Ignorando.");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// 1. RESTAURAÇÃO INDIVIDUAL (POR ARQUIVO)
// ──────────────────────────────────────────────────────────────────────────
// Para CADA arquivo no .dat, verifica se existe no disco.
// Se não existir E não estiver na lista de deleções intencionais → RESTAURA
// ──────────────────────────────────────────────────────────────────────────

if (datIsValid && Object.keys(vfsFromDat).length > 0) {
    const intentionalDeletions = getIntentionalDeletions();
    let restoredCount = 0;
    const restoredFiles: string[] = [];

    for (const [path, content] of Object.entries(vfsFromDat)) {
        const fullPath = join(SOURCE_DIR, path);
        
        // Se o arquivo existe no disco, pula (vai ser comparado depois)
        if (existsSync(fullPath)) continue;
        
        // Se foi deletado intencionalmente, NÃO restaura
        if (intentionalDeletions.has(path)) {
            console.log(`   ⏭️  Pulando: ${path} (marcado como deletado intencionalmente)`);
            continue;
        }
        
        // Restaura o arquivo
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content);
        restoredFiles.push(path);
        restoredCount++;
    }

    if (restoredCount > 0) {
        console.log(`✨ ${restoredCount} arquivo(s) faltante(s) restaurado(s) do .dat:`);
        restoredFiles.forEach(f => console.log(`   ✅ ${f}`));
        recordLog("Restauração (Restore)", restoredCount);
    }
}

// Lista arquivos APÓS restauração
const allFiles = getAllFiles(SOURCE_DIR);

// ──────────────────────────────────────────────────────────────────────────
// 2. DETECÇÃO DE DELEÇÕES INTENCIONAIS
// ──────────────────────────────────────────────────────────────────────────
// Se um arquivo está no .dat mas NÃO está no disco APÓS a restauração,
// significa que o usuário tentou deletá-lo. Mas como a restauração já
// rodou, esse caso não deve acontecer aqui (só se o arquivo estiver na
// lista de deleções intencionais).
//
// REGRA NOVA: Para deletar de verdade, o usuário precisa rodar:
//   bun run build-premium --delete=<caminho/do/arquivo>
// ──────────────────────────────────────────────────────────────────────────

const deleteArg = process.argv.find(arg => arg.startsWith('--delete='));
if (deleteArg) {
    const fileToDelete = deleteArg.replace('--delete=', '').trim();
    
    if (fileToDelete) {
        const fullPath = join(SOURCE_DIR, fileToDelete);
        
        // Remove do disco
        if (existsSync(fullPath)) {
            rmSync(fullPath, { force: true });
            console.log(`   🗑️  Removido do disco: ${fileToDelete}`);
        }
        
        // Marca como deletado intencionalmente
        markAsIntentionallyDeleted([fileToDelete]);
        console.log(`   📝 Marcado como deletado intencional: ${fileToDelete}`);
        console.log(`   ℹ️  Esse arquivo NÃO será mais restaurado do .dat.`);
        
        // Recarrega lista de arquivos
        const updatedFiles = getAllFiles(SOURCE_DIR);
        if (updatedFiles.length === 0 && allFiles.length > 0) {
            console.log("⚠️ Atenção: você deletou o último arquivo. .dat será preservado.");
            process.exit(0);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// 3. CACHE CHECK (TIMESTAMP)
// ──────────────────────────────────────────────────────────────────────────

if (allFiles.length > 0 && existsSync(OUTPUT_ENC)) {
    let latestSourceTime = 0;
    for (const file of allFiles) {
        latestSourceTime = Math.max(latestSourceTime, statSync(file).mtimeMs);
    }

    // Se o .dat é mais novo que todos os arquivos E não houve deleção intencional
    const hasIntentionalDeletions = !!deleteArg;
    
    if (!hasIntentionalDeletions && statSync(OUTPUT_ENC).mtimeMs >= latestSourceTime) {
        console.log("⚡ Cache hit: Tudo atualizado.");
        process.exit(0);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// 4. SEGURANÇA
// ──────────────────────────────────────────────────────────────────────────

if (allFiles.length === 0) {
    if (!existsSync(OUTPUT_ENC)) writeFileSync(OUTPUT_ENC, Buffer.alloc(0));
    console.log("📦 Nenhum arquivo premium encontrado.");
    process.exit(0);
}

if (!KEY || KEY.length !== 32) {
    console.error("❌ ERRO FATAL: PRIVATE_KEY necessária para processar arquivos.");
    process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────
// 5. SINCRONIZAÇÃO (DISK → .DAT)
// ──────────────────────────────────────────────────────────────────────────
// IMPORTANTE: O .dat agora reflete TUDO que está no disco + arquivos
// preservados que estavam no .dat antigo (exceto os intencionalmente deletados).
// ──────────────────────────────────────────────────────────────────────────

console.log("⏳ Sincronizando alterações para o pacote .dat...");

const intentionalDeletions = getIntentionalDeletions();
const vfs: Record<string, string> = {};

// 5.1 — Adiciona TODOS os arquivos do disco
for (const file of allFiles) {
    const relativePath = relative(SOURCE_DIR, file).replace(/\\/g, '/');
    vfs[relativePath] = readFileSync(file, 'utf-8');
}

// 5.2 — PRESERVA arquivos do .dat que não estão no disco (a menos que tenham sido intencionalmente deletados)
//        Isso é crucial pra evitar que pulls em outros computadores percam arquivos.
let preservedCount = 0;
for (const [path, content] of Object.entries(vfsFromDat)) {
    if (!vfs[path] && !intentionalDeletions.has(path)) {
        vfs[path] = content;
        preservedCount++;
    }
}

if (preservedCount > 0) {
    console.log(`   🛡️  ${preservedCount} arquivo(s) preservado(s) do .dat antigo (não estavam no disco)`);
}

// ─── LOG DE ALTERAÇÕES ─────────────────────────────────────────────────────
const oldPaths = new Set(Object.keys(vfsFromDat));
const newPaths = new Set(Object.keys(vfs));

const added = [...newPaths].filter(p => !oldPaths.has(p));
const removed = [...oldPaths].filter(p => !newPaths.has(p));
const modified = [...newPaths].filter(p => oldPaths.has(p) && vfs[p] !== vfsFromDat[p]);

if (added.length > 0) {
    console.log(`   ➕ Adicionados: ${added.length} arquivo(s)`);
    added.forEach(p => console.log(`      + ${p}`));
}
if (removed.length > 0) {
    console.log(`   ➖ Removidos (intencional): ${removed.length} arquivo(s)`);
    removed.forEach(p => console.log(`      - ${p}`));
}
if (modified.length > 0) {
    console.log(`   📝 Modificados: ${modified.length} arquivo(s)`);
}

// ─── ENCRIPTAÇÃO ────────────────────────────────────────────────────────────
const jsonBuffer = Buffer.from(JSON.stringify(vfs));
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY), iv);
const encrypted = Buffer.concat([cipher.update(jsonBuffer), cipher.final()]);

writeFileSync(OUTPUT_ENC, Buffer.concat([iv, encrypted, cipher.getAuthTag()]));

// AÇÕES FINAIS
await internalGitCommit(`Build auto-commit: ${new Date().toLocaleString('pt-BR')}`);
recordLog("Sincronização (Build)", Object.keys(vfs).length);

console.log(`🔒 Sucesso: ${Object.keys(vfs).length} arquivos no .dat (${allFiles.length} no disco + ${preservedCount} preservados).`);

// ==========================================
// FUNÇÃO DE LISTAGEM
// ==========================================

function getAllFiles(dir: string, fileList: string[] = []): string[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir);
    for (const file of files) {
        const filepath = join(dir, file);
        
        // Ignora README, lixo de sistema e a pasta do Git interno
        if (file === 'README.md' || file === '.git' || file === '.DS_Store') continue;

        if (statSync(filepath).isDirectory()) {
            getAllFiles(filepath, fileList);
        } else {
            fileList.push(filepath);
        }
    }
    return fileList;
}