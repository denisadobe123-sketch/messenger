import { useEffect, useState } from 'react';
import { decryptBytesFor } from './e2e.js';

// Вложения секретных чатов лежат на сервере как непрозрачный шифротекст —
// перед показом их нужно скачать и расшифровать на устройстве через
// e2e.js (тот же ECDH-производный ключ, что и для текста). Для обычных
// чатов otherId не передаётся, и хук просто отдаёт исходный url без сети.
export function useDecryptedMedia(url, otherId, token, mimetype) {
  const [state, setState] = useState({ src: otherId ? null : url, loading: !!otherId, error: null });

  useEffect(() => {
    if (!otherId || !url) { setState({ src: url, loading: false, error: null }); return; }
    let alive = true;
    let objectUrl = null;
    setState({ src: null, loading: true, error: null });
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Не удалось загрузить вложение');
        const encrypted = await res.arrayBuffer();
        const plain = await decryptBytesFor(otherId, token, encrypted);
        objectUrl = URL.createObjectURL(new Blob([plain], { type: mimetype || 'application/octet-stream' }));
        if (alive) setState({ src: objectUrl, loading: false, error: null });
      } catch (e) {
        if (alive) setState({ src: null, loading: false, error: e.message || 'Ошибка расшифровки' });
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, otherId, token, mimetype]);

  return state;
}
