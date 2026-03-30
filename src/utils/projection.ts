import { invoke } from '@tauri-apps/api/core'; // Use '@tauri-apps/api/tauri' se estiver no Tauri v1
import { useConfigStore } from '../stores/useConfigStore';

/**
 * Envia o conteúdo para a tela de projeção aplicando as configurações globais.
 * @param contentHtml O conteúdo base (ex: letra da música ou versículo)
 */
export async function startProjection(contentHtml: string) {
  const store = useConfigStore();
  const settings = store.settings;

  // Monta um container aplicando as configurações de Safe Area, Opacidade, etc.
  const styledHtmlPayload = `
    <div 
      class="projection-container theme-${settings.activeTheme.toLowerCase()}" 
      style="
        padding: ${settings.marginTop}px ${settings.marginRight}px ${settings.marginBottom}px ${settings.marginLeft}px;
        opacity: ${settings.bgOpacity / 100};
        aspect-ratio: ${settings.aspectRatio.replace(':', '/')};
        /* Se for usar Chroma Key, você pode injetar a cor de fundo aqui */
        background-color: ${settings.chromaKey !== 'none' ? settings.chromaKey : 'transparent'};
        width: 100vw;
        height: 100vh;
        box-sizing: border-box;
        transition: opacity 0.3s ${settings.transitionType === 'fade' ? 'ease-in-out' : 'none'};
      "
    >
      ${contentHtml}
    </div>
  `;

  try {
    // Chama a função Rust 'update_projection' com o HTML formatado
    await invoke('update_projection', { html: styledHtmlPayload });
    console.log('Projeção atualizada com sucesso!');
  } catch (error) {
    console.error('Erro ao atualizar a projeção pelo Tauri:', error);
  }
}