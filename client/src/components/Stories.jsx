import { useState, useEffect, useRef } from 'react';
import { API_URL } from '../api.js';
import { getSocket } from '../socket.js';
import { getAvatarColor } from '../avatarColor.js';

export default function StoriesBar({ currentUser, token }) {
  const [groups, setGroups] = useState([]);
  const [viewer, setViewer] = useState(null); // { groupIndex }
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  function load() {
    fetch(`${API_URL}/stories`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setGroups(Array.isArray(d) ? d : [])).catch(() => {});
  }
  useEffect(() => {
    load();
    const sock = getSocket();
    if (!sock) return;
    const onAdded = () => load();
    sock.on('story_added', onAdded);
    return () => sock.off('story_added', onAdded);
  }, [token]);

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const up = await fetch(`${API_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const data = await up.json();
      if (!up.ok || !data.url) throw new Error(data.error || 'upload failed');
      const mediaType = (data.mimetype || file.type).startsWith('video/') ? 'video' : 'image';
      await fetch(`${API_URL}/stories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaUrl: data.url, mediaType })
      });
      load();
    } catch (err) { alert('Не удалось опубликовать историю'); }
    setUploading(false);
  }

  const myGroup = groups.find(g => g.isMine);
  const others = groups.filter(g => !g.isMine);

  return (
    <>
      <div className="stories-bar">
        <div className="story-avatar" onClick={() => !uploading && fileRef.current?.click()}>
          <div className={`story-ring ${myGroup ? '' : 'add'}`}>
            {myGroup?.avatar
              ? <img src={myGroup.avatar} alt="" />
              : <div className="story-init">{uploading ? '…' : '+'}</div>}
          </div>
          <span className="story-name">Моя</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={onPickFile} />
        {myGroup && (
          <StoryRing group={myGroup} onClick={() => setViewer({ groupIndex: groups.indexOf(myGroup) })} />
        )}
        {others.map(g => (
          <StoryRing key={g.userId} group={g} onClick={() => setViewer({ groupIndex: groups.indexOf(g) })} />
        ))}
      </div>
      {viewer && (
        <StoryViewer groups={groups} startGroup={viewer.groupIndex} currentUser={currentUser} token={token}
          onClose={() => { setViewer(null); load(); }} />
      )}
    </>
  );
}

function StoryRing({ group, onClick }) {
  const initial = (group.username || '?')[0].toUpperCase();
  return (
    <div className="story-avatar" onClick={onClick}>
      <div className={`story-ring ${group.allViewed ? 'viewed' : ''}`}>
        {group.avatar ? <img src={group.avatar} alt="" />
          : <div className="story-init" style={{ background: getAvatarColor(group.username) }}>{initial}</div>}
      </div>
      <span className="story-name">{group.isMine ? 'Моя' : group.username}</span>
    </div>
  );
}

function StoryViewer({ groups, startGroup, currentUser, token, onClose }) {
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const timerRef = useRef(null);
  const group = groups[gi];
  const story = group?.stories[si];

  useEffect(() => {
    if (!story) return;
    // отметить просмотр
    if (!group.isMine && !story.viewers?.includes(currentUser.id)) {
      fetch(`${API_URL}/stories/${story.id}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    // авто-переход (для видео — по окончании, для фото — 5с)
    if (story.mediaType !== 'video') {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(next, 5000);
      return () => clearTimeout(timerRef.current);
    }
  }, [gi, si]);

  function next() {
    if (si < group.stories.length - 1) setSi(si + 1);
    else if (gi < groups.length - 1) { setGi(gi + 1); setSi(0); }
    else onClose();
  }
  function prev() {
    if (si > 0) setSi(si - 1);
    else if (gi > 0) { setGi(gi - 1); setSi(0); }
  }

  async function del() {
    if (!confirm('Удалить историю?')) return;
    await fetch(`${API_URL}/stories/${story.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    next();
  }

  if (!story) { onClose(); return null; }

  return (
    <div className="story-viewer-overlay">
      <div className="story-progress">
        {group.stories.map((_, i) => (
          <div key={i} className="story-progress-seg">
            <div className={`story-progress-fill ${i < si ? 'done' : i === si && story.mediaType !== 'video' ? 'active' : ''}`} />
          </div>
        ))}
      </div>
      <div className="story-viewer-head">
        <div className="avatar sm">{group.avatar ? <img src={group.avatar} alt="" /> : (group.username || '?')[0].toUpperCase()}</div>
        <span>{group.username}</span>
        {group.isMine && <span style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.8 }}>👁 {story.viewers?.length || 0}</span>}
        {group.isMine && <button className="icon-btn" style={{ color: '#fff' }} onClick={del} title="Удалить">🗑</button>}
      </div>
      <button className="story-close" onClick={onClose}>✕</button>
      <div className="story-nav left" onClick={prev} />
      <div className="story-nav right" onClick={next} />
      {story.mediaType === 'video'
        ? <video className="story-viewer-media" src={story.mediaUrl} autoPlay onEnded={next} controls={false} playsInline />
        : <img className="story-viewer-media" src={story.mediaUrl} alt="" />}
      {story.caption && <div className="story-caption">{story.caption}</div>}
    </div>
  );
}
