import { useState, useEffect } from 'react';
import { API_URL } from '../api.js';

// Кэш превью на время сессии: url -> data | null
const cache = new Map();
const inflight = new Map();

function fetchPreview(url, token) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (inflight.has(url)) return inflight.get(url);
  const p = fetch(`${API_URL}/link-preview?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(r => r.json())
    .then(data => {
      const valid = data && (data.title || data.description || data.image) ? data : null;
      cache.set(url, valid);
      inflight.delete(url);
      return valid;
    })
    .catch(() => { cache.set(url, null); inflight.delete(url); return null; });
  inflight.set(url, p);
  return p;
}

export default function LinkPreview({ url, token }) {
  const [data, setData] = useState(() => cache.get(url) || null);
  useEffect(() => {
    let alive = true;
    if (cache.get(url) !== undefined && cache.get(url) !== null) { setData(cache.get(url)); return; }
    fetchPreview(url, token).then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [url, token]);

  if (!data) return null;
  return (
    <a className="link-preview" href={data.url || url} target="_blank" rel="noreferrer noopener"
       onClick={(e) => e.stopPropagation()}>
      {data.image && <img className="link-preview-img" src={data.image} alt="" loading="lazy" />}
      <div className="link-preview-body">
        {data.site && <div className="link-preview-site">{data.site}</div>}
        {data.title && <div className="link-preview-title">{data.title}</div>}
        {data.description && <div className="link-preview-desc">{data.description}</div>}
      </div>
    </a>
  );
}
