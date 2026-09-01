// Loads best-recordings.json (the source of truth — edit that, not this) into
// the BEST_RECORDINGS global. Filled in place, so render code can read it
// synchronously; await BEST_RECORDINGS_READY first.
const BEST_RECORDINGS = {};

const BEST_RECORDINGS_READY = fetch(new URL('best-recordings.json', document.currentScript.src))
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(data => Object.assign(BEST_RECORDINGS, data))
    .catch(err => {
        console.error('failed to load best-recordings.json', err);
        return BEST_RECORDINGS;
    });
