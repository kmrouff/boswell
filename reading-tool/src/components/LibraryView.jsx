import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getPassages, getPassagesResult, savePassage, deletePassage, updatePassage } from '../lib/storage.js';
import { getPendingCaptures } from '../lib/pendingCaptures.js';
import PassageCard, { HeartIcon } from './PassageCard.jsx';
import StackedCard from './StackedCard.jsx';
import PendingPassageCard from './PendingPassageCard.jsx';
import SettingsDrawer from './SettingsDrawer.jsx';
import { titleSpineColor } from '../lib/titleColor.js';

const MISC = 'Miscellaneous';
const UNDO_WINDOW_MS = 5000;

// Width of the per-title color spine on a group header. Wide enough to read
// at a glance while scrolling, narrow enough that the header still reads as
// one accent-colored block rather than as two stripes.
const SPINE_WIDTH_PX = 5;

// The spine's lightness depends on how bright the current accent is, so the
// accent has to be read back out of the document rather than just referenced
// in CSS. theme.js fires 'theme-changed' whenever it rewrites the tokens.
const useAccentTriple = () => {
  const readAccent = () => getComputedStyle(document.documentElement).getPropertyValue('--acc');
  const [accent, setAccent] = useState(readAccent);
  useEffect(() => {
    const onThemeChange = () => setAccent(readAccent());
    window.addEventListener('theme-changed', onThemeChange);
    return () => window.removeEventListener('theme-changed', onThemeChange);
  }, []);
  return accent;
};

// Groups a list (already filtered/ordered) into render units: passages that
// share a stackId with 2+ others in this same list become one 'stack' unit
// at the position of their first (newest) appearance; everything else stays
// 'single'. Scoped to whatever list is passed in, so by-title mode naturally
// only stacks within a title without any extra bookkeeping.
const buildRenderItems = (list) => {
  const counts = new Map();
  for (const p of list) {
    if (!p.stackId) continue;
    counts.set(p.stackId, (counts.get(p.stackId) || 0) + 1);
  }
  const seenStacks = new Set();
  const items = [];
  for (const p of list) {
    if (p.stackId && counts.get(p.stackId) >= 2) {
      if (seenStacks.has(p.stackId)) continue;
      seenStacks.add(p.stackId);
      items.push({ type: 'stack', stackId: p.stackId, members: list.filter((x) => x.stackId === p.stackId) });
    } else {
      items.push({ type: 'single', passage: p });
    }
  }
  return items;
};

function DotsIcon() {
  return (
    <svg width="4" height="18" viewBox="0 0 4 18">
      <circle cx="2" cy="2" r="2" fill="currentColor" />
      <circle cx="2" cy="9" r="2" fill="currentColor" />
      <circle cx="2" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

export default function LibraryView({ onRequestTitle, flashRequest }) {
  const accentTriple = useAccentTriple();
  const [passages, setPassages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [expandedStacks, setExpandedStacks] = useState({});
  const [swipedId, setSwipedId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleted, setDeleted] = useState(null); // the removed passage, or null
  const [flashId, setFlashId] = useState(null);
  const [stackPickerFor, setStackPickerFor] = useState(null); // passage id or null
  const [loadError, setLoadError] = useState(null); // a failed load, kept distinct from an empty library
  // Placeholder cards for captures still being read/saved, so Library never
  // looks like a capture "didn't work" during the few-second extraction
  // round trip. Backed by lib/pendingCaptures.js, not a plain window event —
  // a capture only ever starts while CaptureView is mounted (Capture tab
  // active), which means LibraryView is *always* unmounted at that moment
  // and only mounts fresh once the user switches tabs. A plain event fired
  // in the meantime would already have gone unheard; reading the module's
  // current state in this lazy initializer catches anything already in
  // flight by the time this component exists to ask.
  const [pending, setPending] = useState(() => getPendingCaptures());
  const deleteTimerRef = useRef(null);
  const flashTimerRef = useRef(null);

  // Sequenced, not just `setPassages(await getPassages())`: several refreshes
  // can easily be in flight at once (the mount fetch, then a 'passage-saved'
  // from a capture that finishes saving a moment later), and there is no
  // guarantee the responses come back in the order they were issued. Without
  // this guard a slower *earlier* request can resolve last and overwrite the
  // newer result — dropping the just-saved passage back out of the list right
  // after its placeholder card was removed, which looks exactly like the
  // capture failed. Only the newest issued request is allowed to commit.
  const refreshSeqRef = useRef(0);

  const refresh = async () => {
    const seq = ++refreshSeqRef.current;
    const { passages: next, error } = await getPassagesResult();
    if (seq !== refreshSeqRef.current) return; // superseded by a later refresh
    // Kept separate from `passages` so a failed load can never be rendered
    // as "you have nothing saved" — see getPassagesResult.
    setLoadError(error);
    if (!error) setPassages(next);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const onPassageSaved = () => refresh();
    // Fires on every add/remove — re-reads the module's current list rather
    // than trying to reconstruct the diff locally.
    const onPendingChanged = () => setPending(getPendingCaptures());
    window.addEventListener('passage-saved', onPassageSaved);
    window.addEventListener('pending-captures-changed', onPendingChanged);
    return () => {
      window.removeEventListener('passage-saved', onPassageSaved);
      window.removeEventListener('pending-captures-changed', onPendingChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Citation jump from Chat: highlight the passage, and if it's hidden
  // inside a collapsed by-title group and/or a collapsed stack, expand
  // whichever of those it's inside so it's actually visible.
  useEffect(() => {
    if (!flashRequest) return;
    (async () => {
      const all = await getPassages();
      const target = all.find((p) => p.id === flashRequest.id);
      if (!target) return;
      if (grouped) {
        const key = target.sourceTitle || MISC;
        setExpandedGroups((g) => (g[key] ? g : { ...g, [key]: true }));
      }
      if (target.stackId && all.filter((p) => p.stackId === target.stackId).length >= 2) {
        setExpandedStacks((s) => (s[target.stackId] ? s : { ...s, [target.stackId]: true }));
      }
      setFlashId(flashRequest.id);
    })();
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashId(null), 1700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashRequest]);

  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

  // Optimistic — the card leaves the list immediately (swipe-to-delete needs
  // to feel instant); the actual delete happens in the background rather
  // than being awaited first.
  const handleDelete = (id) => {
    const passage = passages.find((p) => p.id === id);
    if (!passage) return;
    setPassages((prev) => prev.filter((p) => p.id !== id));
    setDeleted(passage);
    clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = setTimeout(() => setDeleted(null), UNDO_WINDOW_MS);
    deletePassage(id);
  };

  // Also optimistic, for the same reason — re-inserted at its correct
  // chronological position immediately, with the actual save firing in the
  // background.
  const undoDelete = () => {
    clearTimeout(deleteTimerRef.current);
    if (!deleted) return;
    const restored = deleted;
    setDeleted(null);
    setPassages((prev) =>
      [...prev, restored].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
    );
    savePassage(restored);
  };

  const toggleGroup = (title) => setExpandedGroups((g) => ({ ...g, [title]: !g[title] }));
  const toggleStack = (stackId) => setExpandedStacks((s) => ({ ...s, [stackId]: !s[stackId] }));

  const unlinkFromStack = async (id) => {
    await updatePassage(id, { stackId: null });
    refresh();
  };

  // Same-title passages this one could join into a stack — excludes itself
  // and anything already sharing its stackId, since those are already
  // stacked together. Reads from already-loaded state rather than
  // refetching — this is called during render, which can't await.
  const stackCandidates = (id) => {
    const source = passages.find((p) => p.id === id);
    if (!source?.sourceTitle) return [];
    return passages.filter(
      (p) => p.id !== id && p.sourceTitle === source.sourceTitle && !(source.stackId && p.stackId === source.stackId)
    );
  };

  // Joins source and target into one stack. If either already belongs to a
  // stack, every member of that stack comes along too — so picking one card
  // from an existing 3-stack merges the whole 3 in, not just that one card.
  const stackWith = async (sourceId, targetId) => {
    const source = passages.find((p) => p.id === sourceId);
    const target = passages.find((p) => p.id === targetId);
    if (!source || !target) return;
    const finalStackId = source.stackId || target.stackId || uuidv4();
    const sourceGroup = source.stackId ? passages.filter((p) => p.stackId === source.stackId) : [source];
    const targetGroup = target.stackId ? passages.filter((p) => p.stackId === target.stackId) : [target];
    const members = new Map([...sourceGroup, ...targetGroup].map((p) => [p.id, p]));
    await Promise.all(
      [...members.values()].filter((p) => p.stackId !== finalStackId).map((p) => updatePassage(p.id, { stackId: finalStackId }))
    );
    setExpandedStacks((s) => ({ ...s, [finalStackId]: true }));
    refresh();
  };

  if (loading) {
    return <div className="h-full" />;
  }

  const q = query.trim().toLowerCase();
  const matches = (p) => {
    const textMatch =
      !q ||
      p.refinedText.toLowerCase().includes(q) ||
      (p.sourceTitle || '').toLowerCase().includes(q) ||
      (p.sourceAuthor || '').toLowerCase().includes(q) ||
      (p.audioTranscript || '').toLowerCase().includes(q);
    return textMatch && (!favOnly || p.priority);
  };
  const filtered = passages.filter(matches);
  const titleCount = new Set(passages.filter((p) => p.sourceTitle).map((p) => p.sourceTitle)).size;

  const cardProps = {
    isOpen: false, // overridden per-card below
    onSwipeChange: setSwipedId,
    onDelete: handleDelete,
    onRequestTitle,
    onChanged: refresh,
    onRequestStack: setStackPickerFor,
  };

  let groupedEntries = null;
  if (grouped) {
    const groups = new Map();
    for (const p of filtered) {
      const key = p.sourceTitle || MISC;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    groupedEntries = [...groups.entries()].sort((a, b) => {
      if (a[0] === MISC) return 1;
      if (b[0] === MISC) return -1;
      return 0;
    });
  }

  const renderPassageOrStack = (item) =>
    item.type === 'stack' ? (
      expandedStacks[item.stackId] ? (
        <div key={item.stackId} className="mt-3 rounded-[calc(var(--radius)+6px)] border-l-2 pl-2" style={{ borderColor: 'rgb(var(--acc) / .4)' }}>
          <button
            type="button"
            onClick={() => toggleStack(item.stackId)}
            className="mb-2 flex items-center gap-1.5 border-none bg-transparent font-sans text-[11.5px] font-semibold"
            style={{ color: 'rgb(var(--acc))' }}
          >
            ▾ {item.members.length} captured together — tap to collapse
          </button>
          {item.members.map((passage) => (
            <div key={passage.id} className="mt-2">
              <PassageCard
                passage={passage}
                grouped={grouped}
                {...cardProps}
                isOpen={swipedId === passage.id}
                flash={flashId === passage.id}
                onUnlinkFromStack={unlinkFromStack}
              />
            </div>
          ))}
        </div>
      ) : (
        <div key={item.stackId} className="mt-3">
          <StackedCard members={item.members} onExpand={() => toggleStack(item.stackId)} />
        </div>
      )
    ) : (
      <div key={item.passage.id} className="mt-3">
        <PassageCard
          passage={item.passage}
          grouped={grouped}
          {...cardProps}
          isOpen={swipedId === item.passage.id}
          flash={flashId === item.passage.id}
        />
      </div>
    );

  // overflow-hidden matters here, not just cosmetic: SettingsDrawer sits
  // off-screen to the right (translateX(100%)) when closed, and without
  // this the browser will happily let a right-swipe anywhere in Library
  // horizontally scroll the page to reveal it — opening "the menu" via a
  // stray swipe instead of only the intended ⋮ button tap.
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-[18px] pt-[58px] pb-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-[34px] leading-none" style={{ color: 'rgb(var(--fg))' }}>
              Library
            </div>
            <div className="mt-1 font-serif text-sm italic" style={{ color: 'rgb(var(--fg) / .5)' }}>
              {passages.length} {passages.length === 1 ? 'passage' : 'passages'}
              {titleCount > 0 ? ` · ${titleCount} ${titleCount === 1 ? 'title' : 'titles'}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="-mr-2 -mt-1 flex h-[42px] w-[42px] items-center justify-center border-none bg-transparent transition-transform duration-150 active:scale-[0.85]"
            style={{ color: 'rgb(var(--fg) / .6)' }}
          >
            <DotsIcon />
          </button>
        </div>

        <div
          className="mt-3.5 flex h-[46px] items-center gap-2.5 rounded-[14px] border px-3.5"
          style={{ background: 'rgb(var(--fg) / .06)', borderColor: 'rgb(var(--fg) / .14)' }}
        >
          <span style={{ color: 'rgb(var(--fg) / .4)' }}>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your passages…"
            className="flex-1 border-none bg-transparent font-sans text-sm focus:outline-none"
            style={{ color: 'rgb(var(--fg))' }}
          />
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            aria-label="Show favorites only"
            className="flex items-center border-none bg-transparent p-1"
            style={{ color: favOnly ? '#D6584B' : 'rgb(var(--fg) / .4)' }}
          >
            <HeartIcon size={17} filled={favOnly} />
          </button>
        </div>

        <div className="mt-3 flex gap-1.5 rounded-xl p-1" style={{ background: 'rgb(var(--fg) / .06)' }}>
          <button
            type="button"
            onClick={() => {
              setGrouped(false);
              setSwipedId(null);
            }}
            className="h-10 flex-1 rounded-lg border-none font-sans text-[13px] font-semibold"
            style={{
              background: !grouped ? 'rgb(var(--fg) / .14)' : 'transparent',
              color: !grouped ? 'rgb(var(--fg))' : 'rgb(var(--fg) / .5)',
            }}
          >
            Recent
          </button>
          <button
            type="button"
            onClick={() => {
              setGrouped(true);
              setSwipedId(null);
            }}
            className="h-10 flex-1 rounded-lg border-none font-sans text-[13px] font-semibold"
            style={{
              background: grouped ? 'rgb(var(--fg) / .14)' : 'transparent',
              color: grouped ? 'rgb(var(--fg))' : 'rgb(var(--fg) / .5)',
            }}
          >
            By title
          </button>
        </div>
      </div>

      <div
        onScroll={() => swipedId && setSwipedId(null)}
        className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-6 select-none [-webkit-touch-callout:none]"
        style={{ touchAction: 'pan-y' }}
      >
        {loadError && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-lg text-parchment/70">Couldn't load your library</p>
            <p className="text-sm text-parchment/40">
              Your passages are safe — this device just couldn't reach them. Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={refresh}
              className="mt-3 rounded-full border-none px-5 py-2 font-sans text-sm font-semibold"
              style={{ background: 'rgb(var(--acc))', color: 'rgb(var(--on-acc))' }}
            >
              Retry
            </button>
          </div>
        )}

        {!loadError && passages.length === 0 && pending.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-lg text-parchment/70">No passages yet</p>
            <p className="text-sm text-parchment/40">
              Drag down over text in Capture to save your first one.
            </p>
          </div>
        )}

        {/* Only in the plain unfiltered Recent view — a placeholder has no
            real text yet, so it has nothing to offer a search/favorites
            filter or a by-title group. It'll have resolved into a real,
            filterable/groupable passage within a few seconds regardless. */}
        {!grouped &&
          !q &&
          !favOnly &&
          pending.map((p) => (
            <div key={p.id} className="mt-3">
              <PendingPassageCard />
            </div>
          ))}

        {passages.length > 0 && !grouped && buildRenderItems(filtered).map(renderPassageOrStack)}

        {passages.length > 0 &&
          grouped &&
          groupedEntries.map(([title, items]) => {
            const author = items.map((p) => p.sourceAuthor).find(Boolean) || null;
            const open = !!expandedGroups[title];
            return (
              <div key={title}>
                <button
                  type="button"
                  onClick={() => toggleGroup(title)}
                  className="relative mt-2.5 flex w-full items-center gap-2.5 overflow-hidden border-none px-[15px] py-3.5 text-left shadow-sm"
                  style={{
                    background: 'rgb(var(--acc))',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  {/* Decorative only: the title itself is right there in the
                      button, so the spine carries no information a screen
                      reader would otherwise miss. */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0"
                    style={{ width: SPINE_WIDTH_PX, background: titleSpineColor(title, accentTriple) }}
                  />
                  <span className="w-3 shrink-0 text-[11px]" style={{ color: 'rgb(var(--on-acc) / .7)' }}>
                    {open ? '▾' : '▸'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-serif text-[17px] leading-[1.2]" style={{ color: 'rgb(var(--on-acc))' }}>
                      {title}
                    </span>
                    {author && (
                      <span className="mt-0.5 block font-sans text-[11.5px] tracking-wide" style={{ color: 'rgb(var(--on-acc) / .7)' }}>
                        {author}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-sans text-xs" style={{ color: 'rgb(var(--on-acc) / .7)' }}>
                    {items.length}
                  </span>
                </button>
                {open && buildRenderItems(items).map(renderPassageOrStack)}
              </div>
            );
          })}

        {passages.length > 0 && filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-serif text-xl italic" style={{ color: 'rgb(var(--fg) / .7)' }}>
              Nothing matches that.
            </p>
          </div>
        )}
      </div>

      {deleted && (
        <div
          className="absolute inset-x-4 bottom-4 z-30 flex items-center justify-between gap-3 rounded-[14px] py-2.5 pr-3 pl-4 shadow-lg"
          style={{ background: 'var(--raised)', border: '1px solid rgb(var(--fg) / .22)' }}
        >
          <span className="font-sans text-[13.5px]" style={{ color: 'rgb(var(--fg))' }}>
            Passage deleted
          </span>
          <button
            type="button"
            onClick={undoDelete}
            className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-sans text-[13px] font-semibold"
            style={{ background: 'rgb(var(--acc) / .14)', borderColor: 'rgb(var(--acc) / .4)', color: 'rgb(var(--acc))' }}
          >
            <span className="text-[17px] leading-none">↺</span> Undo
          </button>
        </div>
      )}

      {stackPickerFor && (
        <div
          className="fixed inset-0 z-40 flex items-end"
          style={{ background: 'rgb(0 0 0 / .4)' }}
          onClick={() => setStackPickerFor(null)}
        >
          <div
            className="w-full rounded-t-2xl p-5"
            style={{ background: 'var(--raised)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 font-serif text-lg" style={{ color: 'rgb(var(--fg))' }}>
              Stack with…
            </div>
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {stackCandidates(stackPickerFor).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    stackWith(stackPickerFor, c.id);
                    setStackPickerFor(null);
                  }}
                  className="rounded-[14px] border p-3 text-left"
                  style={{ borderColor: 'rgb(var(--fg) / .14)', background: 'rgb(var(--fg) / .04)' }}
                >
                  <p className="m-0 line-clamp-1 font-serif text-[15px]" style={{ color: 'rgb(var(--fg))' }}>
                    {c.refinedText}
                  </p>
                  {c.pageNumber && (
                    <p className="mt-1 font-sans text-[11.5px]" style={{ color: 'rgb(var(--fg) / .5)' }}>
                      p. {c.pageNumber}
                    </p>
                  )}
                </button>
              ))}
              {stackCandidates(stackPickerFor).length === 0 && (
                <p className="py-2 font-sans text-sm" style={{ color: 'rgb(var(--fg) / .5)' }}>
                  No other passages from this title yet.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStackPickerFor(null)}
              className="mt-4 w-full rounded-full border py-2.5 font-sans text-sm font-semibold"
              style={{ borderColor: 'rgb(var(--fg) / .2)', color: 'rgb(var(--fg) / .7)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
