// blob (de paste ou upload) -> {url, img} pronto pra usar em <img>/canvas.
// Extraído do Azulejo pra ser reaproveitado por qualquer módulo que aceite
// imagem colada/enviada (ex.: a máscara de densidade do Mosaico).
export function loadImageAsset(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve({ url, img });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao carregar imagem'));
    };
    img.src = url;
  });
}

export function listenForPaste(target, { onImage, onSvgText } = {}) {
  function handlePaste(e) {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file && onImage) onImage(file);
        return;
      }
    }
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.trim().startsWith('<svg') && onSvgText) {
      onSvgText(text);
    }
  }
  target.addEventListener('paste', handlePaste);
  return () => target.removeEventListener('paste', handlePaste);
}
