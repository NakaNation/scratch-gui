// A one-record IndexedDB store holding the most recent project.
//
// This editor has no accounts and no project server, so a reload, a crashed tab
// or a closed laptop lid otherwise takes a lesson's work with it. localStorage
// is the obvious place and the wrong one: a project carrying a few library
// sprites runs to several megabytes, well past the ~5MB a whole origin gets,
// and it only stores strings, so an .sb3 would have to be base64'd on every
// save. IndexedDB stores the ArrayBuffer as it is and is not meaningfully
// capped for our sizes.

const DB_NAME = 'kairo-scratch-autosave';
const DB_VERSION = 1;
const STORE = 'project';
const KEY = 'latest';

const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // A private window, or a browser set to block site data, leaves this
    // hanging rather than erroring. Every caller treats a rejection as "no
    // autosave here", so time it out instead of waiting forever.
    setTimeout(() => reject(new Error('IndexedDB did not open')), 5000);
});

const withStore = (mode, run) => openDb().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => {
        db.close();
        resolve(request && request.result);
    };
    transaction.onerror = () => {
        db.close();
        reject(transaction.error);
    };
}));

/**
 * @returns {Promise<object|undefined>} the saved record, or undefined if there is none.
 *   A record is {project: ArrayBuffer, title: string, savedAt: number}.
 */
const readAutosave = () => withStore('readonly', store => store.get(KEY));

/**
 * @param {object} record the project to keep. Replaces whatever was there.
 * @returns {Promise} resolves once the write has committed.
 */
const writeAutosave = record => withStore('readwrite', store => store.put(record, KEY));

/**
 * @returns {Promise} resolves once the saved project is gone.
 */
const clearAutosave = () => withStore('readwrite', store => store.delete(KEY));

export {
    readAutosave,
    writeAutosave,
    clearAutosave
};
