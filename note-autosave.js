// Show notes save themselves: a second after you stop typing, and when the box
// loses focus. Used by the shows tab (index.html) and the profile page.
//
// Markup: a .note-wrap containing a .note-status and a textarea with
//   data-note-date, data-note-field, oninput="noteInput(this)" onblur="noteFlush(this)"
// The page defines saveNoteValue(date, field, value) → Promise<boolean>.

const NOTE_SAVE_DELAY = 1000;
const noteTimers = new Map();   // textarea → pending save timer
const noteDirty = new Set();    // textareas with edits not yet saved
const noteSaving = new Set();   // textareas with a save in flight

function noteStatus(ta, text, kind) {
    const el = ta.closest('.note-wrap')?.querySelector('.note-status');
    if (!el) return;
    el.className = 'note-status' + (kind ? ' note-status-' + kind : '');
    if (kind === 'error') {
        el.innerHTML = 'not saved · <button type="button" class="note-retry">retry</button>';
        el.querySelector('.note-retry').onclick = () => { noteDirty.add(ta); noteFlush(ta); };
    } else {
        el.textContent = text;
    }
    clearTimeout(el._fade);
    if (kind === 'saved') el._fade = setTimeout(() => { el.textContent = ''; }, 2000);
}

function noteAutosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
}

function noteInput(ta) {
    noteAutosize(ta);
    noteDirty.add(ta);
    noteStatus(ta, 'editing…');
    clearTimeout(noteTimers.get(ta));
    noteTimers.set(ta, setTimeout(() => noteFlush(ta), NOTE_SAVE_DELAY));
}

async function noteFlush(ta) {
    clearTimeout(noteTimers.get(ta));
    noteTimers.delete(ta);
    if (!noteDirty.has(ta) || noteSaving.has(ta)) return;   // nothing new, or a save is running (it re-checks when done)
    const value = ta.value;
    noteSaving.add(ta);
    noteStatus(ta, 'saving…');
    let ok = false;
    try { ok = await saveNoteValue(ta.dataset.noteDate, ta.dataset.noteField, value); } catch { ok = false; }
    noteSaving.delete(ta);
    if (ta.value !== value) { noteFlush(ta); return; }      // typed more while saving
    if (ok) { noteDirty.delete(ta); noteStatus(ta, 'saved', 'saved'); }
    else noteStatus(ta, '', 'error');
}

// Save straight away when the tab is hidden, and warn before leaving with
// edits that haven't been saved.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') noteDirty.forEach(ta => noteFlush(ta));
});
window.addEventListener('beforeunload', e => {
    if (noteDirty.size) { e.preventDefault(); e.returnValue = ''; }
});
